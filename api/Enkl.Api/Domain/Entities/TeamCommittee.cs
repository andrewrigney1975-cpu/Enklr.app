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

    // Set only when this row was created by TeamCommitteeService.ApplyOrgTeamAsync ("apply to
    // project") — lets a re-run find the same TeamCommittee again reliably (matching by Name would
    // break on a rename, or collide if two OrgTeams happened to share a name). SetNull on delete: an
    // OrgTeam deleted via SCIM must never touch a project's TeamCommittee — see ApplyOrgTeamAsync's
    // own doc comment for why that link is one-way and manual, not live.
    public Guid? SourceOrgTeamId { get; set; }
    public OrgTeam? SourceOrgTeam { get; set; }

    public List<TeamCommitteeMember> Members { get; set; } = new();
}
