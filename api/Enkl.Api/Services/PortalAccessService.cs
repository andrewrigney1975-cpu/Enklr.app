using Enkl.Api.Data;
using Enkl.Api.Domain.Entities;
using Microsoft.EntityFrameworkCore;

namespace Enkl.Api.Services;

/// <summary>
/// The one shared access predicate for Organisational Portals — independently re-derives whether a
/// user has access to a Portal from its PortalAccessGrant rows, never trusting a client-supplied
/// claim. Reused by PortalService (so an Org Admin previewing sees the same result a real user
/// would) and PortalHomeService (the actual enforcement point). A Portal with zero grants is
/// invisible to every org user — closed by default, matching this codebase's defensive-default
/// convention.
/// </summary>
public class PortalAccessService
{
    private readonly AppDbContext _db;

    public PortalAccessService(AppDbContext db)
    {
        _db = db;
    }

    public async Task<bool> UserHasPortalAccessAsync(Guid portalId, Guid userId)
    {
        var grants = await _db.PortalAccessGrants.AsNoTracking()
            .Where(g => g.PortalId == portalId)
            .ToListAsync();
        if (grants.Count == 0) return false;

        if (grants.Any(g => g.Kind == "namedUser" && g.Value == userId)) return true;

        // "allOrgMembers" grants every user IN THE SAME ORG as the Portal, never trusting the
        // caller's userId alone — re-derives both the Portal's own OrganisationId and the caller's
        // OrganisationId and requires them to match, so this can never become a de-facto "anyone at
        // all" grant if this predicate is ever reused for a differently-scoped caller.
        if (grants.Any(g => g.Kind == "allOrgMembers"))
        {
            var portalOrgId = await _db.Portals.AsNoTracking()
                .Where(p => p.Id == portalId).Select(p => (Guid?)p.OrganisationId).FirstOrDefaultAsync();
            var userOrgId = await _db.Users.AsNoTracking()
                .Where(u => u.Id == userId).Select(u => (Guid?)u.OrganisationId).FirstOrDefaultAsync();
            if (portalOrgId is not null && portalOrgId == userOrgId) return true;
        }

        var orgTeamIds = grants.Where(g => g.Kind == "orgTeam").Select(g => g.Value).ToList();
        if (orgTeamIds.Count > 0)
        {
            var inOrgTeam = await _db.Set<OrgTeamMember>().AsNoTracking()
                .AnyAsync(m => m.UserId == userId && orgTeamIds.Contains(m.OrgTeamId));
            if (inOrgTeam) return true;
        }

        var teamCommitteeIds = grants.Where(g => g.Kind == "teamCommittee").Select(g => g.Value).ToList();
        if (teamCommitteeIds.Count > 0)
        {
            // TeamCommitteeMember links to ProjectMemberId, not UserId directly — a user must already
            // be a ProjectMember of whatever project that TeamCommittee belongs to (see
            // TeamCommittee's own doc comment).
            var inTeamCommittee = await _db.Set<TeamCommitteeMember>().AsNoTracking()
                .AnyAsync(m => teamCommitteeIds.Contains(m.TeamCommitteeId) && m.ProjectMember.UserId == userId);
            if (inTeamCommittee) return true;
        }

        return false;
    }
}
