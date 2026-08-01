using System.Text.Json;
using Enkl.Api.Data;
using Enkl.Api.Domain.Entities;
using Enkl.Api.Dtos;
using Microsoft.EntityFrameworkCore;

namespace Enkl.Api.Services;

/// <summary>Project-member-facing Draft management + workflow progression for Form submissions (see
/// Domain/Entities/FormSubmission.cs's own doc comment for the single-table-for-every-form-type
/// design). Phase 1: create/edit/delete a Draft only. Phase 5 (this pass): Submit/Approve/Reject —
/// a compact SERVER-SIDE re-implementation of features/form-workflow-engine.js's gate/quorum logic
/// (deny-by-default, never trusting a client-claimed action), since this is the actual security
/// boundary — the frontend engine (Phase 4) is a UI convenience for deciding what to show, not the
/// enforcement point, same "server independently re-derives" principle as every other
/// cross-org/cross-role check in this codebase (root CLAUDE.md §4/§1).</summary>
public class FormSubmissionService
{
    private readonly AppDbContext _db;
    private readonly SseBroadcaster _broadcaster;
    private readonly TaskService _tasks;
    private static readonly JsonSerializerOptions JsonOpts = new() { PropertyNameCaseInsensitive = true };

    /// <summary>Every other JSON blob this feature touches (FieldsJson, WorkflowJson) is
    /// frontend-authored and already camelCase. ApprovalTrailJson is the one blob THIS server
    /// writes itself — without an explicit camelCase policy, System.Text.Json.Serialize defaults to
    /// the raw C# PascalCase property names (NodeId, ActorUserId, ...), silently diverging from
    /// every camelCase reader (features/form-workflow-engine.js, modals/forms-fillout.js's own
    /// trail rendering) even though deserialization still worked fine either way thanks to
    /// PropertyNameCaseInsensitive above — a real bug caught live in QA (the Approval Trail
    /// rendered blank) rather than by reasoning about it.</summary>
    private static readonly JsonSerializerOptions JsonWriteOpts = new() { PropertyNamingPolicy = JsonNamingPolicy.CamelCase };

    public FormSubmissionService(AppDbContext db, SseBroadcaster broadcaster, TaskService tasks)
    {
        _db = db;
        _broadcaster = broadcaster;
        _tasks = tasks;
    }

    // ---- Workflow graph model — mirrors features/form-workflow-engine.js's own shape exactly ----
    private class WfGate { public string Kind { get; set; } = ""; public string Value { get; set; } = ""; }
    /// <summary>Config for a "action" node's "raiseTaskInPortal" ActionType — see
    /// ExecuteActionNodeAsync's own doc comment for how each field is resolved at execution time.</summary>
    private class WfActionConfig
    {
        public Guid? PortalId { get; set; }
        public string? PriorityColumn { get; set; }
        public WfGate? AssigneeGate { get; set; }
        public string? TitleTemplate { get; set; }
    }
    private class WfNode
    {
        public string Id { get; set; } = "";
        public string Type { get; set; } = "";
        public string? Label { get; set; }
        public List<WfGate>? AuthorGates { get; set; }
        public List<WfGate>? ApproverGates { get; set; }
        public string? ApprovalMode { get; set; }
        // "action" node fields only — ActionType is currently only ever "raiseTaskInPortal", kept as
        // a plain string (not an enum) matching this codebase's usual "no CHECK constraint, app-level
        // interpretation only" convention for type-discriminator fields.
        public string? ActionType { get; set; }
        public WfActionConfig? Config { get; set; }
    }
    private class WfEdge { public string Id { get; set; } = ""; public string FromNodeId { get; set; } = ""; public string ToNodeId { get; set; } = ""; }
    private class WfGraph { public List<WfNode> Nodes { get; set; } = new(); public List<WfEdge> Edges { get; set; } = new(); }
    private class TrailEntry
    {
        public string NodeId { get; set; } = "";
        public Guid ActorUserId { get; set; }
        public string Action { get; set; } = "";
        public List<string> SatisfiedGateKeys { get; set; } = new();
        public string? Comment { get; set; }
        public string Timestamp { get; set; } = "";
    }
    private record ActingUser(Guid Id, bool IsOrgAdmin, bool IsProjectAdmin);

    private static WfGraph ParseWorkflow(string? json)
    {
        if (string.IsNullOrWhiteSpace(json)) return new WfGraph();
        try { return JsonSerializer.Deserialize<WfGraph>(json, JsonOpts) ?? new WfGraph(); }
        catch (JsonException) { return new WfGraph(); }
    }
    private static List<TrailEntry> ParseTrail(string? json)
    {
        if (string.IsNullOrWhiteSpace(json)) return new List<TrailEntry>();
        try { return JsonSerializer.Deserialize<List<TrailEntry>>(json, JsonOpts) ?? new(); }
        catch (JsonException) { return new(); }
    }
    private static WfNode? FindNode(WfGraph g, string? id) => id is null ? null : g.Nodes.FirstOrDefault(n => n.Id == id);
    private static WfNode? FindStart(WfGraph g) => g.Nodes.FirstOrDefault(n => n.Type == "start");
    private static WfEdge? OutgoingEdge(WfGraph g, string nodeId) => g.Edges.FirstOrDefault(e => e.FromNodeId == nodeId);
    private static string GateKey(WfGate g) => g.Kind + ":" + g.Value;

    /// <summary>'teamMember' is satisfied unconditionally — the caller already passed this
    /// controller's own [Authorize(Policy = "ProjectMember")] gate to reach here at all, so every
    /// caller of this method is already at least a Team Member of the project.</summary>
    private static bool GateSatisfied(WfGate gate, ActingUser user)
    {
        if (gate.Kind == "namedUser") return Guid.TryParse(gate.Value, out var gid) && gid == user.Id;
        if (gate.Kind == "userType")
        {
            if (gate.Value == "orgAdmin") return user.IsOrgAdmin;
            if (gate.Value == "projectAdmin") return user.IsProjectAdmin || user.IsOrgAdmin;
            if (gate.Value == "teamMember") return true;
        }
        return false;
    }
    private static List<string> MatchingGateKeys(List<WfGate>? gates, ActingUser user) =>
        (gates ?? new()).Where(g => GateSatisfied(g, user)).Select(GateKey).ToList();
    private static bool SatisfiesAny(List<WfGate>? gates, ActingUser user) => MatchingGateKeys(gates, user).Count > 0;

    private static bool IsApprovalComplete(WfNode node, List<TrailEntry> trail)
    {
        var entries = trail.Where(t => t.NodeId == node.Id && t.Action == "approved").ToList();
        if (node.ApprovalMode == "all")
        {
            var required = (node.ApproverGates ?? new()).Select(GateKey).ToList();
            if (required.Count == 0) return false;
            var satisfied = new HashSet<string>(entries.SelectMany(e => e.SatisfiedGateKeys));
            return required.All(satisfied.Contains);
        }
        return entries.Count > 0;
    }

    private async Task<ActingUser> ResolveActingUserAsync(Guid projectId, Guid userId, bool callerIsOrgAdmin)
    {
        var isProjectAdmin = await _db.ProjectMembers.AsNoTracking()
            .AnyAsync(m => m.ProjectId == projectId && m.UserId == userId && m.IsProjectAdmin);
        return new ActingUser(userId, callerIsOrgAdmin, isProjectAdmin);
    }

    public async Task<List<FormSubmissionListItemDto>> ListMineAsync(Guid projectId, Guid callerUserId)
    {
        var subs = await _db.FormSubmissions.AsNoTracking()
            .Include(s => s.FormVersion).Include(s => s.SubmittedByUser)
            .Where(s => s.ProjectId == projectId && s.SubmittedByUserId == callerUserId)
            .OrderByDescending(s => s.DateLastModified)
            .ToListAsync();
        return subs.Select(ToListItemDto).ToList();
    }

    /// <summary>Submissions in this project currently sitting at an Approval node whose gates the
    /// caller satisfies — computed in memory (a plain SQL WHERE can't evaluate an opaque JSON
    /// workflow graph), so this is O(in-progress submissions in the project), not indexed; fine at
    /// this feature's expected scale, revisit if a project ever accumulates thousands of concurrent
    /// in-flight submissions.</summary>
    public async Task<List<FormSubmissionListItemDto>> ListAwaitingMyActionAsync(Guid projectId, Guid callerUserId, bool callerIsOrgAdmin)
    {
        var candidates = await _db.FormSubmissions.AsNoTracking()
            .Include(s => s.FormVersion).Include(s => s.SubmittedByUser)
            .Where(s => s.ProjectId == projectId && s.Status == "inProgress" && s.CurrentNodeId != null)
            .ToListAsync();
        if (candidates.Count == 0) return new();

        var user = await ResolveActingUserAsync(projectId, callerUserId, callerIsOrgAdmin);
        var result = new List<FormSubmissionListItemDto>();
        foreach (var s in candidates)
        {
            var node = FindNode(ParseWorkflow(s.FormVersion.WorkflowJson), s.CurrentNodeId);
            if (node is null || node.Type != "approval") continue;
            if (!SatisfiesAny(node.ApproverGates, user)) continue;
            result.Add(ToListItemDto(s));
        }
        return result.OrderByDescending(r => r.DateLastModified).ToList();
    }

    /// <summary>Deliberately scoped to the PROJECT only, not the caller's own submissions — any
    /// project member (including an approver reviewing someone else's submission) may view a
    /// submission's answers/trail, same trust level as everything else inside a project's own
    /// ProjectMember boundary. Only mutation (Update/Delete/Submit) stays owner-only.</summary>
    public async Task<FormSubmissionDto?> GetAsync(Guid projectId, Guid submissionId)
    {
        var submission = await _db.FormSubmissions.AsNoTracking()
            .FirstOrDefaultAsync(s => s.Id == submissionId && s.ProjectId == projectId);
        return submission is null ? null : ToDto(submission);
    }

    /// <summary>Null return covers two cases identically (no enumeration oracle between "no such
    /// form" and "that form isn't published") — a submission can only ever be started against a
    /// currently-published version, never a Draft or Archived one.</summary>
    public async Task<FormSubmissionDto?> CreateAsync(Guid projectId, Guid callerUserId, CreateFormSubmissionRequest request)
    {
        var formVersionExists = await _db.Forms.AsNoTracking()
            .AnyAsync(f => f.Id == request.FormVersionId && f.Status == "published");
        if (!formVersionExists) return null;

        var now = DateTime.UtcNow;
        var submission = new FormSubmission
        {
            Id = Guid.NewGuid(),
            FormVersionId = request.FormVersionId,
            ProjectId = projectId,
            SubmittedByUserId = callerUserId,
            Status = "draft",
            AnswersJson = request.AnswersJson,
            DateCreated = now,
            DateLastModified = now
        };
        _db.FormSubmissions.Add(submission);
        await _db.SaveChangesAsync();
        return ToDto(submission);
    }

    public async Task<FormSubmissionDto?> UpdateAsync(Guid projectId, Guid callerUserId, Guid submissionId, UpdateFormSubmissionRequest request)
    {
        var submission = await _db.FormSubmissions.FirstOrDefaultAsync(s =>
            s.Id == submissionId && s.ProjectId == projectId && s.SubmittedByUserId == callerUserId);
        if (submission is null) return null;
        if (submission.Status != "draft") return null;

        submission.AnswersJson = request.AnswersJson;
        submission.DateLastModified = DateTime.UtcNow;
        await _db.SaveChangesAsync();
        return ToDto(submission);
    }

    public async Task<bool> DeleteAsync(Guid projectId, Guid callerUserId, Guid submissionId)
    {
        var submission = await _db.FormSubmissions.FirstOrDefaultAsync(s =>
            s.Id == submissionId && s.ProjectId == projectId && s.SubmittedByUserId == callerUserId);
        if (submission is null) return false;
        if (submission.Status != "draft") return false;

        _db.FormSubmissions.Remove(submission);
        await _db.SaveChangesAsync();
        return true;
    }

    /// <summary>Moves a Draft into the workflow: the graph's Start node must lead directly to an
    /// Author node (anything else is treated as a misconfigured workflow, not silently skipped),
    /// the caller must satisfy that node's own gates, then the submission advances past it — to an
    /// immediate Approval node (Status becomes 'inProgress'), straight to an End node (Status
    /// becomes 'approved' — no approval step configured), or nowhere (a dead-end graph, left
    /// 'submitted' with no CurrentNodeId).</summary>
    public async Task<(bool ok, string error, FormSubmissionDto? dto)> SubmitAsync(Guid projectId, Guid callerUserId, bool callerIsOrgAdmin, Guid submissionId)
    {
        var submission = await _db.FormSubmissions.Include(s => s.FormVersion)
            .FirstOrDefaultAsync(s => s.Id == submissionId && s.ProjectId == projectId && s.SubmittedByUserId == callerUserId);
        if (submission is null) return (false, "not_found", null);
        if (submission.Status != "draft") return (false, "Only a Draft submission may be submitted.", null);

        var graph = ParseWorkflow(submission.FormVersion.WorkflowJson);
        var start = FindStart(graph);
        var firstEdge = start is null ? null : OutgoingEdge(graph, start.Id);
        var authorNode = firstEdge is null ? null : FindNode(graph, firstEdge.ToNodeId);
        if (authorNode is null || authorNode.Type != "author")
            return (false, "This form's workflow isn't configured to accept submissions yet.", null);

        var user = await ResolveActingUserAsync(projectId, callerUserId, callerIsOrgAdmin);
        if (!SatisfiesAny(authorNode.AuthorGates, user))
            return (false, "You are not permitted to submit this form.", null);

        var trail = ParseTrail(submission.ApprovalTrailJson);
        trail.Add(new TrailEntry
        {
            NodeId = authorNode.Id, ActorUserId = callerUserId, Action = "authored",
            SatisfiedGateKeys = MatchingGateKeys(authorNode.AuthorGates, user),
            Timestamp = DateTime.UtcNow.ToString("o")
        });

        var nextEdge = OutgoingEdge(graph, authorNode.Id);
        var nextNode = nextEdge is null ? null : FindNode(graph, nextEdge.ToNodeId);

        // Explicit transaction (api/Enkl.Api/CLAUDE.md's standing rule): ApplyNextNodeAsync may call
        // TaskService.CreateAsync (a committing call) for any "action" node(s) on the way to nextNode,
        // and this method does its own separate save afterward for the submission's own fields.
        await using var transaction = await _db.Database.BeginTransactionAsync();
        nextNode = await ApplyNextNodeAsync(submission, graph, nextNode, trail);

        // Serialized AFTER ApplyNextNodeAsync, not before — an action node along the way appends its
        // own "raisedTask" entry to trail, which must be captured in what actually gets persisted.
        submission.ApprovalTrailJson = JsonSerializer.Serialize(trail, JsonWriteOpts);
        submission.DateSubmitted = DateTime.UtcNow;
        submission.DateLastModified = DateTime.UtcNow;

        await _db.SaveChangesAsync();
        await transaction.CommitAsync();

        // Always a fresh arrival — the submission is moving off the Author node onto nextNode for
        // the very first time.
        NotifyIfNamedApproverNeeded(submission, nextNode, trail, isFreshArrival: true);
        return (true, "", ToDto(submission));
    }

    /// <summary>Approve/Reject at the submission's own CurrentNodeId — the node must be an Approval
    /// node the caller's own gates satisfy. Reject always ends the submission outright. Approve only
    /// advances once the node's own ANY/ALL quorum is fully satisfied (see IsApprovalComplete) — an
    /// ALL-mode node with other approvers still pending records this approval in the trail and
    /// leaves the submission exactly where it was.</summary>
    public async Task<(bool ok, string error, FormSubmissionDto? dto)> ActOnApprovalAsync(
        Guid projectId, Guid callerUserId, bool callerIsOrgAdmin, Guid submissionId, string action, string? comment)
    {
        if (action != "approve" && action != "reject") return (false, "Unknown action.", null);

        var submission = await _db.FormSubmissions.Include(s => s.FormVersion)
            .FirstOrDefaultAsync(s => s.Id == submissionId && s.ProjectId == projectId);
        if (submission is null) return (false, "not_found", null);
        if (submission.CurrentNodeId is null) return (false, "This submission is not awaiting approval.", null);

        var graph = ParseWorkflow(submission.FormVersion.WorkflowJson);
        var node = FindNode(graph, submission.CurrentNodeId);
        if (node is null || node.Type != "approval") return (false, "This submission is not awaiting approval.", null);

        var user = await ResolveActingUserAsync(projectId, callerUserId, callerIsOrgAdmin);
        if (!SatisfiesAny(node.ApproverGates, user)) return (false, "You are not permitted to act on this submission.", null);

        var trail = ParseTrail(submission.ApprovalTrailJson);
        var entryAction = action == "approve" ? "approved" : "rejected";
        trail.Add(new TrailEntry
        {
            NodeId = node.Id, ActorUserId = callerUserId, Action = entryAction,
            SatisfiedGateKeys = MatchingGateKeys(node.ApproverGates, user), Comment = comment,
            Timestamp = DateTime.UtcNow.ToString("o")
        });
        submission.DateLastModified = DateTime.UtcNow;

        // Explicit transaction (api/Enkl.Api/CLAUDE.md's standing rule): ApplyNextNodeAsync may call
        // TaskService.CreateAsync (a committing call) for any "action" node(s) along the way, and this
        // method does its own separate save afterward for the submission's own fields.
        await using var transaction = await _db.Database.BeginTransactionAsync();

        WfNode? nextNode = null;
        if (action == "reject")
        {
            submission.Status = "rejected";
        }
        else if (IsApprovalComplete(node, trail))
        {
            var edge = OutgoingEdge(graph, node.Id);
            nextNode = edge is null ? null : FindNode(graph, edge.ToNodeId);
            nextNode = await ApplyNextNodeAsync(submission, graph, nextNode, trail);
        }
        // else: quorum not yet complete — Status stays 'inProgress', CurrentNodeId unchanged, and
        // NotifyIfNamedApproverNeeded below re-checks the SAME node (not nextNode) — its own
        // ALL-mode branch is what notices the remaining-approver count just dropped to one.

        // Serialized AFTER ApplyNextNodeAsync, not before — an action node along the way appends its
        // own "raisedTask" entry to trail, which must be captured in what actually gets persisted.
        submission.ApprovalTrailJson = JsonSerializer.Serialize(trail, JsonWriteOpts);

        await _db.SaveChangesAsync();
        await transaction.CommitAsync();
        if (action == "approve")
        {
            // isFreshArrival is true only when this approval actually completed the CURRENT node's
            // quorum and advanced to a genuinely new nextNode (a multi-step Approval chain) — that's
            // a fresh arrival needing a full fan-out at nextNode, same as SubmitAsync's own first
            // arrival. When nextNode is null, quorum wasn't complete and we're still re-checking node
            // itself after a partial approval — not fresh, just the "narrows to one" case.
            NotifyIfNamedApproverNeeded(submission, nextNode ?? node, trail, isFreshArrival: nextNode is not null);
            // Only the FINAL approval (the one that actually advances the submission all the way to
            // an End node) notifies the submitter — an intermediate approval in a multi-step chain
            // just moves CurrentNodeId to the next Approval node, Status stays 'inProgress', and the
            // submitter has nothing new to know yet (they'll be notified once someone actually
            // decides it, same as every other pending-approval step).
            if (submission.Status == "approved") await NotifySubmitterOfDecisionAsync(submission, callerUserId, "approved", comment);
        }
        else
        {
            await NotifySubmitterOfDecisionAsync(submission, callerUserId, "rejected", comment);
        }
        return (true, "", ToDto(submission));
    }

    /// <summary>Applies one node transition's terminal-status logic: null -> 'submitted', an End node
    /// -> 'approved', anything else -> 'inProgress' pinned at that node. An "action" node is executed
    /// (its side effect fires) the instant the graph transitions into it, but — unlike the auto-
    /// continue behavior this method used to have — does NOT auto-advance past itself afterward: it
    /// falls into the same 'inProgress' branch as an Approval node, pausing the submission there.
    /// For "raiseTaskInPortal" specifically, that pause is exactly the point — the submission stays
    /// paused until ResumeIfLinkedTaskDoneAsync notices the raised Task land in a Done column and
    /// re-calls this same method with the action node's own outgoing edge, walking the graph exactly
    /// one more step (which may itself be another action node, pausing again; or End; or a human
    /// Approval node). Callers MUST wrap this in an explicit transaction (api/Enkl.Api/CLAUDE.md's
    /// standing rule) — ExecuteActionNodeAsync below can call TaskService.CreateAsync, which commits
    /// its own SaveChangesAsync, and the caller does its own separate save afterward for the
    /// submission's own field changes.</summary>
    private async Task<WfNode?> ApplyNextNodeAsync(FormSubmission submission, WfGraph graph, WfNode? nextNode, List<TrailEntry> trail)
    {
        if (nextNode is not null && nextNode.Type == "action")
        {
            await ExecuteActionNodeAsync(submission, nextNode, trail);
        }

        if (nextNode is null) { submission.Status = "submitted"; submission.CurrentNodeId = null; }
        else if (nextNode.Type == "end") { submission.Status = "approved"; submission.CurrentNodeId = nextNode.Id; }
        else { submission.Status = "inProgress"; submission.CurrentNodeId = nextNode.Id; }

        return nextNode;
    }

    /// <summary>The one action type implemented so far: raises a Task in the target Portal's own
    /// auto-provisioned actioner Project, in whichever of its 5 fixed priority columns
    /// (Trivial..Critical) Config.PriorityColumn names (case-insensitive; falls back to the lowest-
    /// Order column if the name doesn't match any of them, never throws for a misconfigured value).
    /// The target Portal is resolved dynamically first: if this submission's own ProjectId IS some
    /// Portal's actioner Project (i.e. it was actually filled out through that Portal —
    /// PortalHomeService.CreateSubmissionAsync stamps submissions with the Portal's own ProjectId at
    /// creation), that Portal always wins, regardless of Config.PortalId — a Form attached to
    /// multiple Portals raises into wherever THIS submission actually came from. Only when the
    /// submission's own project isn't any Portal's actioner project at all (a "free floating" Form
    /// filled out directly against an ordinary project) does Config.PortalId's org-admin-configured
    /// default apply. AssigneeId resolves via ResolveActionAssignee — "assigned to the form's
    /// approver if known": a namedUser AssigneeGate always wins; otherwise the most recent "approved"
    /// trail entry's actor, or unassigned if none exists yet (e.g. an action node placed before any
    /// Approval node). Silently no-ops (never throws) for any unrecognized ActionType or when neither
    /// resolution path yields a project (no origin Portal AND no configured default, or a configured
    /// default Portal that's since been deleted) — a misconfigured or since-deleted Portal must never
    /// break the whole Submit/Approve flow for a caller who has nothing to do with authoring that
    /// workflow.</summary>
    private async Task ExecuteActionNodeAsync(FormSubmission submission, WfNode actionNode, List<TrailEntry> trail)
    {
        if (actionNode.ActionType != "raiseTaskInPortal") return;

        var originPortal = await _db.Portals.AsNoTracking().FirstOrDefaultAsync(p => p.ProjectId == submission.ProjectId);
        Guid? targetProjectId = originPortal?.ProjectId;
        if (targetProjectId is null && actionNode.Config?.PortalId is Guid defaultPortalId)
        {
            var defaultPortal = await _db.Portals.AsNoTracking().FirstOrDefaultAsync(p => p.Id == defaultPortalId);
            targetProjectId = defaultPortal?.ProjectId;
        }
        if (targetProjectId is not Guid projectId) return;

        var columns = await _db.Columns.AsNoTracking().Where(c => c.ProjectId == projectId).OrderBy(c => c.Order).ToListAsync();
        if (columns.Count == 0) return;
        var wantedName = actionNode.Config?.PriorityColumn ?? "";
        var column = columns.FirstOrDefault(c => string.Equals(c.Name, wantedName, StringComparison.OrdinalIgnoreCase)) ?? columns[0];

        var assigneeId = ResolveActionAssignee(actionNode.Config?.AssigneeGate, trail);
        var title = string.IsNullOrWhiteSpace(actionNode.Config?.TitleTemplate)
            ? $"{submission.FormVersion.Name} — submission review"
            : actionNode.Config!.TitleTemplate!;

        var submitter = await _db.Users.AsNoTracking().FirstOrDefaultAsync(u => u.Id == submission.SubmittedByUserId);
        var submitterLine = submitter is null ? null : $"**Submitted by:** {submitter.DisplayName} ({submitter.Username})";
        var answersBlock = BuildAnswersDescription(submission.FormVersion.FieldsJson, submission.AnswersJson);
        var description = string.Join("\n\n", new[] { submitterLine, answersBlock }.Where(s => !string.IsNullOrEmpty(s)));
        if (description.Length == 0) description = null;

        var task = await _tasks.CreateAsync(projectId, new CreateTaskRequest(
            Title: title, Description: description, Priority: "medium", ColumnId: column.Id, AssigneeId: assigneeId,
            ReleaseId: null, TypeId: null, ParentTaskId: null, DependsOnTaskIds: null));
        submission.RaisedTaskId = task?.Id;

        trail.Add(new TrailEntry
        {
            NodeId = actionNode.Id, ActorUserId = Guid.Empty, Action = "raisedTask",
            SatisfiedGateKeys = new(), Comment = task?.Key, Timestamp = DateTime.UtcNow.ToString("o")
        });
    }

    /// <summary>Called by TasksController right after ANY task update — cheap no-op for the
    /// overwhelming majority of task moves (an indexed lookup on RaisedTaskId that finds nothing).
    /// When a Task that a "raiseTaskInPortal" action node raised has landed in a Done column, resumes
    /// the paused submission by walking exactly one more graph step from that action node's own
    /// outgoing edge (see ApplyNextNodeAsync's own doc comment for why this reuses that same method)
    /// — reaching End marks the submission "approved" ("the form is marked as complete"); reaching
    /// another Approval node instead just moves the pause to a human gate, same as any other Approval
    /// step; reaching another action node fires and pauses again. Idempotent and safe to call
    /// unconditionally: no-ops when no submission is currently paused on this Task, the Task's own
    /// column isn't Done, or the submission's current node isn't actually an "action" node
    /// (defensive — should never happen given CurrentNodeId/RaisedTaskId are only ever set
    /// together).</summary>
    public async Task ResumeIfLinkedTaskDoneAsync(Guid taskId)
    {
        var submission = await _db.FormSubmissions.Include(s => s.FormVersion)
            .FirstOrDefaultAsync(s => s.RaisedTaskId == taskId && s.Status == "inProgress");
        if (submission is null) return;

        var task = await _db.Tasks.AsNoTracking().Include(t => t.Column).FirstOrDefaultAsync(t => t.Id == taskId);
        if (task is null || !task.Column.Done) return;

        var graph = ParseWorkflow(submission.FormVersion.WorkflowJson);
        var currentNode = FindNode(graph, submission.CurrentNodeId);
        if (currentNode is null || currentNode.Type != "action") return;

        var trail = ParseTrail(submission.ApprovalTrailJson);
        trail.Add(new TrailEntry
        {
            NodeId = currentNode.Id, ActorUserId = Guid.Empty, Action = "taskCompleted",
            SatisfiedGateKeys = new(), Comment = task.Key, Timestamp = DateTime.UtcNow.ToString("o")
        });

        var edge = OutgoingEdge(graph, currentNode.Id);
        var nextNode = edge is null ? null : FindNode(graph, edge.ToNodeId);

        // Explicit transaction (api/Enkl.Api/CLAUDE.md's standing rule) — ApplyNextNodeAsync may
        // itself call TaskService.CreateAsync (another action node further along the graph), a
        // committing call, followed by this method's own separate save below.
        await using var transaction = await _db.Database.BeginTransactionAsync();
        await ApplyNextNodeAsync(submission, graph, nextNode, trail);
        submission.ApprovalTrailJson = JsonSerializer.Serialize(trail, JsonWriteOpts);
        submission.DateLastModified = DateTime.UtcNow;
        await _db.SaveChangesAsync();
        await transaction.CommitAsync();

        if (submission.Status == "approved")
        {
            await NotifySubmitterOfDecisionAsync(submission, Guid.Empty, "approved", null);
        }
    }

    private static Guid? ResolveActionAssignee(WfGate? gate, List<TrailEntry> trail)
    {
        if (gate is not null && gate.Kind == "namedUser" && Guid.TryParse(gate.Value, out var namedId)) return namedId;
        // Default/"formApprover" behavior: the most recent approver in the trail, if any known yet.
        return trail.LastOrDefault(t => t.Action == "approved")?.ActorUserId;
    }

    // ---- Field model — mirrors features/form-fields.js's own shape exactly (see that file's own
    // doc comment for the full per-type FieldsJson/AnswersJson shape) ----
    private class WfFieldOption { public string Id { get; set; } = ""; public string? Label { get; set; } }
    private class WfField
    {
        public string Id { get; set; } = "";
        public string Type { get; set; } = "";
        public string? Label { get; set; }
        public List<WfFieldOption>? Options { get; set; }
        public string? GroupMode { get; set; }
        public bool Multiple { get; set; }
        public bool IncludesTime { get; set; }
    }

    /// <summary>Compiles every field's own label + entered answer (the submitted Form version's
    /// FieldsJson, matched against the submission's own AnswersJson — a flat {fieldId: value} map,
    /// see FormSubmission.cs's own doc comment) into a Markdown block for the raised Task's
    /// Description — same "Label: value" shape features/form-answers.js's renderAnswerReadOnlyHTML
    /// already renders for a submitted Form's read-only view, just as plain Markdown text instead of
    /// HTML (Task.Description is rendered through this app's own Markdown rich-text editor, same as
    /// every other task description — see modals/task.js's getTaskDescEditor().setMarkdown). An
    /// unanswered field still gets its own "— (no answer)" line, so the raised task always reflects
    /// the full field list, not just whatever happened to be filled in. Best-effort: any unparsable
    /// FieldsJson (or missing/unparsable AnswersJson) simply yields no description text rather than
    /// throwing — a malformed field/answer must never block the whole raise-task action.</summary>
    private static string? BuildAnswersDescription(string? fieldsJson, string? answersJson)
    {
        if (string.IsNullOrWhiteSpace(fieldsJson)) return null;
        List<WfField>? fields;
        try { fields = JsonSerializer.Deserialize<List<WfField>>(fieldsJson, JsonOpts); } catch { return null; }
        if (fields is null || fields.Count == 0) return null;

        Dictionary<string, JsonElement>? answers = null;
        if (!string.IsNullOrWhiteSpace(answersJson))
        {
            try { answers = JsonSerializer.Deserialize<Dictionary<string, JsonElement>>(answersJson, JsonOpts); } catch { /* treated as no answers below */ }
        }

        var lines = new List<string>();
        foreach (var field in fields)
        {
            if (string.IsNullOrWhiteSpace(field.Id)) continue;
            var label = string.IsNullOrWhiteSpace(field.Label) ? field.Id : field.Label;
            JsonElement? value = (answers is not null && answers.TryGetValue(field.Id, out var v)) ? v : null;
            lines.Add($"**{label}:** {FormatAnswerValue(field, value)}");
        }
        return lines.Count == 0 ? null : string.Join("\n\n", lines);
    }

    private static string FormatAnswerValue(WfField field, JsonElement? value)
    {
        if (value is not JsonElement el || el.ValueKind == JsonValueKind.Null || el.ValueKind == JsonValueKind.Undefined) return "—";

        if (field.Type == "radio" && field.GroupMode == "single")
        {
            return el.ValueKind == JsonValueKind.True ? "Yes" : "No";
        }
        if (el.ValueKind == JsonValueKind.Array)
        {
            var ids = el.EnumerateArray().Select(e => e.ValueKind == JsonValueKind.String ? e.GetString() ?? "" : e.ToString());
            var labels = ids.Select(id => OptionLabel(field, id)).ToList();
            return labels.Count == 0 ? "—" : string.Join(", ", labels);
        }
        if (field.Type is "checkboxGroup" or "select" || (field.Type == "radio" && field.GroupMode != "single"))
        {
            var id = el.ValueKind == JsonValueKind.String ? el.GetString() ?? "" : el.ToString();
            return OptionLabel(field, id);
        }
        return el.ValueKind == JsonValueKind.String ? (el.GetString() ?? "—") : el.ToString();
    }

    private static string OptionLabel(WfField field, string optionId)
    {
        var match = field.Options?.FirstOrDefault(o => o.Id == optionId);
        return match is null ? optionId : (string.IsNullOrWhiteSpace(match.Label) ? optionId : match.Label!);
    }

    /// <summary>Phase 6's SSE-push scope (a plain userType gate has no single "specific person" to
    /// target, so this only ever fires for named-user gates), widened in Phase 9 for ALL-mode:
    /// (a) a fresh ANY-mode node — notify every namedUser gate at once, since any one of them can act
    /// right now; (b) a FRESHLY-REACHED ALL-mode node (isFreshArrival) — fan out to every remaining
    /// namedUser gate at once too, not just the last one, so a multi-person parallel approval doesn't
    /// leave everyone but the final approver to discover it only via "Awaiting My Action" polling; or
    /// (c) a re-check of the SAME ALL-mode node after a partial approval (isFreshArrival false) —
    /// only once exactly ONE required gate remains unsatisfied, so partial progress on a large
    /// approver list doesn't re-notify everyone still pending on every single approval, just the one
    /// person now actually able to complete it. Anyone else still finds their pending approvals via
    /// "Awaiting My Action" (Phase 5), not a push.</summary>
    private void NotifyIfNamedApproverNeeded(FormSubmission submission, WfNode? node, List<TrailEntry> trail, bool isFreshArrival)
    {
        if (node is null || node.Type != "approval") return;
        List<Guid> targets;
        if (node.ApprovalMode == "all")
        {
            var satisfied = new HashSet<string>(trail.Where(t => t.NodeId == node.Id && t.Action == "approved").SelectMany(e => e.SatisfiedGateKeys));
            var remaining = (node.ApproverGates ?? new()).Where(g => !satisfied.Contains(GateKey(g))).ToList();
            if (isFreshArrival)
            {
                targets = remaining.Where(g => g.Kind == "namedUser")
                    .Select(g => Guid.TryParse(g.Value, out var id) ? id : (Guid?)null)
                    .Where(id => id.HasValue).Select(id => id!.Value).ToList();
            }
            else
            {
                targets = remaining.Count == 1 && remaining[0].Kind == "namedUser" && Guid.TryParse(remaining[0].Value, out var soleId)
                    ? new List<Guid> { soleId } : new();
            }
        }
        else
        {
            targets = (node.ApproverGates ?? new())
                .Where(g => g.Kind == "namedUser")
                .Select(g => Guid.TryParse(g.Value, out var id) ? id : (Guid?)null)
                .Where(id => id.HasValue).Select(id => id!.Value).ToList();
        }
        if (targets.Count == 0) return;

        var payload = new FormActionRequiredEventDto(submission.ProjectId, submission.Id, submission.FormVersion.Name, DateTime.UtcNow);
        foreach (var userId in targets) _broadcaster.BroadcastFormActionRequired(userId, payload);
    }

    /// <summary>Phase 7/8: notifies the original submitter of a final decision (approved or
    /// rejected), always and unconditionally — no gate-satisfaction ambiguity to resolve, a decision
    /// has exactly one interested party. Skipped if the decider and the submitter are the same person
    /// (a userType-gated approver acting on their own submission is possible in principle) — nothing
    /// to tell them they don't already know.</summary>
    private async Task NotifySubmitterOfDecisionAsync(FormSubmission submission, Guid decidedByUserId, string decision, string? comment)
    {
        if (submission.SubmittedByUserId == decidedByUserId) return;
        var actedByDisplayName = await _db.Users.AsNoTracking()
            .Where(u => u.Id == decidedByUserId).Select(u => u.DisplayName).FirstOrDefaultAsync() ?? "someone";
        var payload = new FormSubmissionDecidedEventDto(
            submission.ProjectId, submission.Id, submission.FormVersion.Name, decision, actedByDisplayName, comment, DateTime.UtcNow);
        _broadcaster.BroadcastFormSubmissionDecided(submission.SubmittedByUserId, payload);
    }

    // internal, not private — reused directly by PortalHomeService.ListMySubmissionsAsync, which
    // needs a FormGroupId-filtered variant of ListMineAsync that this class doesn't otherwise expose.
    internal static FormSubmissionListItemDto ToListItemDto(FormSubmission s)
    {
        var node = FindNode(ParseWorkflow(s.FormVersion.WorkflowJson), s.CurrentNodeId);
        return new FormSubmissionListItemDto(
            s.Id, s.FormVersionId, s.FormVersion.Name, s.FormVersion.VersionNumber, s.Status, s.CurrentNodeId,
            node?.Label, s.SubmittedByUserId, s.SubmittedByUser.DisplayName, s.DateCreated, s.DateLastModified, s.DateSubmitted);
    }

    private static FormSubmissionDto ToDto(FormSubmission s) => new(
        s.Id, s.FormVersionId, s.ProjectId, s.SubmittedByUserId, s.Status, s.CurrentNodeId,
        s.AnswersJson, s.ApprovalTrailJson, s.DateCreated, s.DateLastModified, s.DateSubmitted);
}
