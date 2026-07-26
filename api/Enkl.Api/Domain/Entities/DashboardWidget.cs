namespace Enkl.Api.Domain.Entities;

/// <summary>One tile on a Dashboard's page layout. WidgetType/Width are plain unconstrained
/// strings (no CHECK constraint, no enum column) — same convention as TaskItem.Priority — the
/// frontend owns validating the small fixed set of values (table|gauge|barGauge|chart|costBenefit|
/// timeline|text for WidgetType; third|half|full for Width). ConfigJson is an opaque,
/// server-unvalidated blob holding whatever settings that widget type needs (value/category column
/// names, chart sub-type, bar-gauge orientation, or the markdown text for a `text` widget) — the
/// server never inspects it, matching this codebase's "no CHECK constraints, application-level
/// validation only" rule for unconstrained string-shaped data.</summary>
public class DashboardWidget
{
    public Guid Id { get; set; }
    public Guid DashboardId { get; set; }
    public Dashboard Dashboard { get; set; } = null!;
    public string WidgetType { get; set; } = "";
    public string Title { get; set; } = "";
    /// <summary>Null only for a `text` widget — every data-driven widget type requires one.</summary>
    public Guid? SavedQueryId { get; set; }
    public SavedQuery? SavedQuery { get; set; }
    public string Width { get; set; } = "full";
    /// <summary>Explicit reorder position — same convention as Column.Order.</summary>
    public int SortOrder { get; set; }
    public string? ConfigJson { get; set; }
    public DateTime DateCreated { get; set; }
    public DateTime DateLastModified { get; set; }
}
