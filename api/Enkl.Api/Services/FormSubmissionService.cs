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

    public FormSubmissionService(AppDbContext db, SseBroadcaster broadcaster)
    {
        _db = db;
        _broadcaster = broadcaster;
    }

    // ---- Workflow graph model — mirrors features/form-workflow-engine.js's own shape exactly ----
    private class WfGate { public string Kind { get; set; } = ""; public string Value { get; set; } = ""; }
    private class WfNode
    {
        public string Id { get; set; } = "";
        public string Type { get; set; } = "";
        public string? Label { get; set; }
        public List<WfGate>? AuthorGates { get; set; }
        public List<WfGate>? ApproverGates { get; set; }
        public string? ApprovalMode { get; set; }
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

        submission.ApprovalTrailJson = JsonSerializer.Serialize(trail, JsonWriteOpts);
        submission.DateSubmitted = DateTime.UtcNow;
        submission.DateLastModified = DateTime.UtcNow;
        ApplyNextNode(submission, nextNode);

        await _db.SaveChangesAsync();
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
        submission.ApprovalTrailJson = JsonSerializer.Serialize(trail, JsonWriteOpts);
        submission.DateLastModified = DateTime.UtcNow;

        WfNode? nextNode = null;
        if (action == "reject")
        {
            submission.Status = "rejected";
        }
        else if (IsApprovalComplete(node, trail))
        {
            var edge = OutgoingEdge(graph, node.Id);
            nextNode = edge is null ? null : FindNode(graph, edge.ToNodeId);
            ApplyNextNode(submission, nextNode);
        }
        // else: quorum not yet complete — Status stays 'inProgress', CurrentNodeId unchanged, and
        // NotifyIfNamedApproverNeeded below re-checks the SAME node (not nextNode) — its own
        // ALL-mode branch is what notices the remaining-approver count just dropped to one.

        await _db.SaveChangesAsync();
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

    private static void ApplyNextNode(FormSubmission submission, WfNode? nextNode)
    {
        if (nextNode is null) { submission.Status = "submitted"; submission.CurrentNodeId = null; }
        else if (nextNode.Type == "end") { submission.Status = "approved"; submission.CurrentNodeId = nextNode.Id; }
        else { submission.Status = "inProgress"; submission.CurrentNodeId = nextNode.Id; }
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

    private static FormSubmissionListItemDto ToListItemDto(FormSubmission s)
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
