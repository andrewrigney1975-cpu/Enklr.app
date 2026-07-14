namespace Enkl.Api.Domain.Entities;

/// <summary>Join entity linking a global User to a Project, replacing today's per-project embedded Member record.</summary>
public class ProjectMember
{
    public Guid Id { get; set; }
    public Guid ProjectId { get; set; }
    public Project Project { get; set; } = null!;
    public Guid UserId { get; set; }
    public User User { get; set; } = null!;
    public string Color { get; set; } = "";
    public string? Role { get; set; }
    public int? AllocatedFraction { get; set; }
    public Guid? ReportsToId { get; set; }
    public ProjectMember? ReportsTo { get; set; }
}
