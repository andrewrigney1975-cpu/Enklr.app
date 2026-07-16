using Enkl.Api.Data;
using Enkl.Api.Domain;
using Enkl.Api.Domain.Entities;
using Enkl.Api.Validation;
using Microsoft.EntityFrameworkCore;

namespace Enkl.Api.Services;

/// <summary>
/// ARCHITECTURE-REVIEW.md finding 2.1: split out of MigrationService.cs (was 683 lines mixing several
/// distinct responsibilities) — this is the "which Organisation does this import land in, and what
/// Project.Key does it get" seam. Security review finding C3 (the cross-tenant account-injection fix:
/// an anonymous caller can no longer target an EXISTING org purely by name) lives entirely here.
/// </summary>
public class MigrationOrganisationResolver
{
    private readonly AppDbContext _db;

    public MigrationOrganisationResolver(AppDbContext db)
    {
        _db = db;
    }

    public async Task<(Organisation Organisation, bool Created)> ResolveOrganisationAsync(string name, Guid? callerOrgId)
    {
        if (callerOrgId is not null)
        {
            // Authenticated caller: always migrate into their own Organisation regardless of what
            // name the export document carries. This is the "add another local project to my
            // existing org" flow — never let a submitted name redirect it into someone else's org.
            var callerOrg = await _db.Organisations.AsNoTracking().FirstOrDefaultAsync(o => o.Id == callerOrgId.Value);
            if (callerOrg is not null) return (callerOrg, false);
            // Falls through to name-based resolution only if the token's org somehow no longer
            // exists; the existing-org check below still protects that path.
        }

        var normalized = UsernameNormalizer.Normalize(name);
        var existing = await _db.Organisations.AsNoTracking().FirstOrDefaultAsync(o => o.NormalizedName == normalized);
        if (existing is not null)
        {
            // An unauthenticated caller matching an existing Organisation purely by name was the
            // cross-tenant account-injection vector from the security review (finding C3): anyone
            // who knew/guessed an org's display name could get a login-capable user account
            // silently created inside it. Only an authenticated member of that org (handled above)
            // may add users to it via migration — everyone else must go through the bootstrap
            // (brand-new org) path below.
            throw new ApiValidationException(
                $"An organisation named \"{name}\" already exists. Sign in as a member of that organisation to migrate additional projects into it.");
        }

        var organisation = new Organisation { Id = Guid.NewGuid(), Name = name, NormalizedName = normalized, CreatedAt = DateTime.UtcNow };
        _db.Organisations.Add(organisation);
        return (organisation, true);
    }

    /// <summary>Project keys are unique per-Organisation, not globally — a key is only ever used
    /// within its own org's context (task keys, the Portfolio Dashboard's picker, etc.), so two
    /// unrelated orgs both having a "SMPL" project is fine. But every fresh local install seeds a
    /// project with the same "SMPL" key (createSeedDB in src/js/storage.js), so a key collision
    /// WITHIN the target org is still an expected, common case.</summary>
    public async Task<string> ResolveUniqueProjectKeyAsync(string baseKey, Guid organisationId)
    {
        var candidate = baseKey;
        var suffix = 1;
        while (await _db.Projects.AnyAsync(p => p.Key == candidate && p.OrganisationId == organisationId))
        {
            candidate = $"{baseKey}{++suffix}";
        }
        return candidate;
    }
}
