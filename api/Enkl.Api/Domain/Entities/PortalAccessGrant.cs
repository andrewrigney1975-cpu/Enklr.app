namespace Enkl.Api.Domain.Entities;

/// <summary>One grant of Portal access to a group or a single user. A Portal with zero grants is
/// invisible to every org user (closed-by-default) — see PortalAccessService.UserHasPortalAccessAsync,
/// which independently re-derives access from these rows, never trusting a client-supplied claim.
/// Mirrors the Form Workflow gate vocabulary ({kind, value}) for consistency, but lives in its own
/// table (not embedded JSON) since access grants need their own CRUD UI, unlike gates edited inline
/// in the workflow graph.</summary>
public class PortalAccessGrant
{
    public Guid Id { get; set; }
    public Guid PortalId { get; set; }
    public Portal Portal { get; set; } = null!;

    /// <summary>orgTeam|teamCommittee|namedUser — plain unconstrained string, same convention as
    /// every other status/type field in this codebase.
    /// orgTeam: Value = OrgTeam.Id (a SCIM-synced group — this codebase's stand-in for "business
    ///          unit," see PORTALS.md; every OrgTeamMember gets access).
    /// teamCommittee: Value = TeamCommittee.Id (per-project org chart entity; every
    ///          TeamCommitteeMember, resolved through their ProjectMember, gets access).
    /// namedUser: Value = User.Id directly.</summary>
    public string Kind { get; set; } = "";

    public Guid Value { get; set; }

    public DateTime DateCreated { get; set; }
}
