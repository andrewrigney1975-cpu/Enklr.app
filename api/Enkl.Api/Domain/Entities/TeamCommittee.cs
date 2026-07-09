namespace Enkl.Api.Domain.Entities;

public class TeamCommittee
{
    public Guid Id { get; set; }
    public Guid ProjectId { get; set; }
    public Project Project { get; set; } = null!;
    public string Key { get; set; } = "";
    public string Name { get; set; } = "";
    public string? Description { get; set; }
    /// <summary>team / committee — TEAM_COMMITTEE_TYPES in src/js/config.js.</summary>
    public string Type { get; set; } = "team";
    public Guid? ParentId { get; set; }
    public TeamCommittee? Parent { get; set; }
    public DateTime DateCreated { get; set; }
    public DateTime DateLastModified { get; set; }

    public List<TeamCommitteeMember> Members { get; set; } = new();
}
