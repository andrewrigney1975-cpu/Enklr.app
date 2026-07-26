namespace Enkl.Api.Domain.Entities;

/// <summary>A Project Admin-authored Self-Service Dashboard — same "flat, project-scoped entity"
/// shape as SavedQuery (no display-key/counter scheme, no owner FK). Fetched via its own dedicated
/// endpoints (Controllers/DashboardsController.cs), not embedded in ProjectService's own
/// GetProjectDetailAsync payload — unlike SavedQueries, this is an opt-in (headerButtonVisibility
/// gated), potentially widget-heavy feature that shouldn't add weight to every ordinary project
/// load.</summary>
public class Dashboard
{
    public Guid Id { get; set; }
    public Guid ProjectId { get; set; }
    public Project Project { get; set; } = null!;
    public string Name { get; set; } = "";
    /// <summary>Back-of-office plain-text note (not markdown/rendered content) — helps a Project
    /// Admin remember what this dashboard is for, never shown to a plain viewing member.</summary>
    public string? Description { get; set; }
    public DateTime DateCreated { get; set; }
    public DateTime DateLastModified { get; set; }

    public List<DashboardWidget> Widgets { get; set; } = new();
}
