namespace Enkl.Api.Domain.Entities;

public class Release
{
    public Guid Id { get; set; }
    public Guid ProjectId { get; set; }
    public Project Project { get; set; } = null!;
    public string Name { get; set; } = "";
    /// <summary>pending / in_progress / deployed — RELEASE_STATUS_META in src/js/mutations.js.</summary>
    public string Status { get; set; } = "pending";
    /// <summary>Hex color, rendered as the Release list row's left border and the Timeline bar's
    /// hatch color. Always set (never null) — defaults to light grey.</summary>
    public string Color { get; set; } = "#cccccc";
    public Guid? OwnerId { get; set; }
    public ProjectMember? Owner { get; set; }
    public DateOnly? StartDate { get; set; }
    public DateOnly? EndDate { get; set; }
    /// <summary>Markdown, ProjectAdmin/OrgAdmin-only write path (ReleasesController's dedicated
    /// notes endpoint) — never settable via the generic Create/Update requests, see
    /// ReleasesController.cs's own note.</summary>
    public string? ReleaseNotes { get; set; }
    public DateTime DateCreated { get; set; }
    public DateTime DateLastModified { get; set; }
}
