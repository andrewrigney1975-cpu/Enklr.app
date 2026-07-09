namespace Enkl.Api.Domain.Entities;

public class Release
{
    public Guid Id { get; set; }
    public Guid ProjectId { get; set; }
    public Project Project { get; set; } = null!;
    public string Name { get; set; } = "";
    /// <summary>pending / in_progress / deployed — RELEASE_STATUS_META in src/js/mutations.js.</summary>
    public string Status { get; set; } = "pending";
    public Guid? OwnerId { get; set; }
    public ProjectMember? Owner { get; set; }
    public DateOnly? StartDate { get; set; }
    public DateOnly? EndDate { get; set; }
    public DateTime DateCreated { get; set; }
    public DateTime DateLastModified { get; set; }
}
