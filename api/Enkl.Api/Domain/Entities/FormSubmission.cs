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

    /// <summary>draft|submitted|inProgress|approved|rejected|cancelled — plain unconstrained
    /// string, same convention as Form.Status.</summary>
    public string Status { get; set; } = "draft";

    /// <summary>The Action node id (from FormVersion.WorkflowJson) this submission is currently
    /// sitting at, awaiting that node's gate to be satisfied. Null while still a Draft (not yet
    /// entered the workflow) and once a terminal status (approved/rejected/cancelled) is reached.
    /// Populated starting Phase 4/5 (the workflow engine) — always null in Phase 1.</summary>
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

    public DateTime DateCreated { get; set; }
    public DateTime DateLastModified { get; set; }
    public DateTime? DateSubmitted { get; set; }
}
