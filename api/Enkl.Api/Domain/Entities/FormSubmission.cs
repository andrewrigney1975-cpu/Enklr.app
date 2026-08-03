namespace Enkl.Api.Domain.Entities;

/// <summary>One row per submission of ANY form/version — a single table for every form type, per
/// the Enterprise Forms feature's own design (see the approved plan: "single table to store
/// submissions of any form type, dense-packed"). AnswersJson is a flat {fieldId: value} map
/// (dense-packed, opaque, server-unvalidated, same convention as Form.FieldsJson/
/// DashboardWidget.ConfigJson). ApprovalTrailJson is an append-only array of {nodeId, actorUserId,
/// action, timestamp, comment} kept in this same row rather than a separate audit table, per the
/// same "single table" requirement.</summary>
public class FormSubmission
{
    public Guid Id { get; set; }
    public Guid FormVersionId { get; set; }
    public Form FormVersion { get; set; } = null!;
    public Guid ProjectId { get; set; }
    public Project Project { get; set; } = null!;
    public Guid SubmittedByUserId { get; set; }
    public User SubmittedByUser { get; set; } = null!;

    /// <summary>draft|submitted|inProgress|approved|rejected|completed|cancelled — plain
    /// unconstrained string, same convention as Form.Status. "completed" is a distinct terminal
    /// status from "approved": both mean the graph reached an End node, but "completed" specifically
    /// means it got there via ResumeIfLinkedTaskDoneAsync (a linked raised Task reaching a Done
    /// column), never via a human's own Approval action — the Portal frontend's own stepper reads
    /// this distinction directly (see modals/portal-home.js's renderStepperHTML).</summary>
    public string Status { get; set; } = "draft";

    /// <summary>The Action node id (from FormVersion.WorkflowJson) this submission is currently
    /// sitting at, awaiting that node's gate to be satisfied. Null while still a Draft (not yet
    /// entered the workflow) and once a terminal status (approved/rejected/completed/cancelled) is
    /// reached. Populated starting Phase 4/5 (the workflow engine) — always null in Phase 1.</summary>
    public string? CurrentNodeId { get; set; }

    public string? AnswersJson { get; set; }
    public string? ApprovalTrailJson { get; set; }

    /// <summary>Set the instant a "raiseTaskInPortal" action node raises a Task for this submission
    /// (ExecuteActionNodeAsync). Nullable, ON DELETE SET NULL — a deleted Task must never break the
    /// submission row, just orphan the link. Once set, this submission stays paused (Status
    /// "inProgress", CurrentNodeId pointing at the action node) until TasksController notices this
    /// Task land in a Done column and calls ResumeIfLinkedTaskDoneAsync, which is what actually looks
    /// this column up — see that method's own doc comment for the full pause/resume shape.</summary>
    public Guid? RaisedTaskId { get; set; }
    public TaskItem? RaisedTask { get; set; }

    /// <summary>Set the instant a task-raised submission's RaisedTask is first assigned to a team
    /// member (MarkInReviewIfTaskAssignedAsync) — the point at which "In Review" (Status
    /// "inProgress") actually means someone has picked it up, rather than the moment the Task was
    /// merely raised. Null until then; also null for a submission that never went through the
    /// task-raising path at all (it went straight to a human Approval node instead, which already set
    /// Status "inProgress" immediately — that path doesn't need this stamp).</summary>
    public DateTime? InReviewAt { get; set; }

    /// <summary>A closing summary, set either by the deciding approver (ActOnApprovalAsync, on the
    /// decisive approve/reject) or transcribed from the raised Task's assignee when they complete that
    /// Task (ResumeIfLinkedTaskDoneAsync) — whichever path this submission actually took. Shown in the
    /// Portal's post-completion read-only view alongside the Approval Trail.</summary>
    public string? ClosingNotes { get; set; }

    public DateTime DateCreated { get; set; }
    public DateTime DateLastModified { get; set; }
    public DateTime? DateSubmitted { get; set; }
}
