namespace Enkl.Api.Domain.Entities;

/// <summary>
/// An Organisation-scoped group of Users, synced from a SCIM Group (see ScimGroupsController) —
/// distinct from TeamCommittee, which is scoped to a single Project and drives the per-project org
/// chart. An OrgTeam has no direct effect on any Project; TeamCommitteeService's "apply to project"
/// action is the one-way, manual bridge between the two (see its own doc comment for why it's a
/// snapshot/apply rather than a live sync).
/// </summary>
public class OrgTeam
{
    public Guid Id { get; set; }
    public Guid OrganisationId { get; set; }
    public Organisation Organisation { get; set; } = null!;
    public string Name { get; set; } = "";
    // The IdP's own group id (SCIM's `id`/`externalId`) — lets a later PATCH/PUT for the same
    // group resolve to this row even if Name has since been changed at the IdP. Null for a group
    // that somehow exists without ever coming from SCIM (not currently reachable via the UI, but
    // not disallowed at the schema level either).
    public string? ScimExternalId { get; set; }
    public DateTime DateCreated { get; set; }
    public DateTime DateLastModified { get; set; }

    public List<OrgTeamMember> Members { get; set; } = new();
}
