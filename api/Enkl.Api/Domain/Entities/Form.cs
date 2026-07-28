namespace Enkl.Api.Domain.Entities;

/// <summary>One row per FORM VERSION — not one row per form plus a separate versions table.
/// Versions of "the same form" share FormGroupId; there is no separate parent Form entity at all
/// (the "current" version is just whichever row for a given FormGroupId has Status="published").
/// FieldsJson and WorkflowJson are opaque, server-unvalidated blobs — same "no CHECK constraints,
/// application-level validation only" convention as DashboardWidget.ConfigJson/Project.WorkflowJson
/// — the frontend's Forms builder/engine own interpreting them entirely, the server just stores and
/// returns the raw text. Only one row per FormGroupId may have Status="published" at a time
/// (enforced in FormService.PublishAsync, not a DB constraint, same "one endpoint owns the flag"
/// shape as StrategyService.ActivateAsync).</summary>
public class Form
{
    public Guid Id { get; set; }
    public Guid OrganisationId { get; set; }
    public Organisation Organisation { get; set; } = null!;
    public Guid FormGroupId { get; set; }
    public string Name { get; set; } = "";
    public string? Description { get; set; }
    public int VersionNumber { get; set; }

    /// <summary>draft|published|archived — plain unconstrained string, no enum/CHECK, same
    /// convention as TaskItem.Priority/DashboardWidget.WidgetType.</summary>
    public string Status { get; set; } = "draft";

    public string? FieldsJson { get; set; }
    public string? WorkflowJson { get; set; }
    public Guid? CreatedByUserId { get; set; }
    public User? CreatedByUser { get; set; }
    public DateTime DateCreated { get; set; }
    public DateTime DateLastModified { get; set; }
    public DateTime? PublishedAt { get; set; }
}
