using Enkl.Api.Data;
using Microsoft.EntityFrameworkCore;

namespace Enkl.Api.Services;

/// <summary>
/// Shared by ProjectService.CreateAsync/UpdateAsync and PortfolioService.CreateProjectAsync — both
/// need to turn a user-supplied (or absent) key into a unique, per-organisation Project key, and this
/// logic previously lived only as private methods on ProjectService. Extracted so the two callers
/// can't silently drift apart; this is duplication WITHIN one tier, not the cross-tier duplication
/// this repo's PHP-parity convention actually calls for.
/// </summary>
public static class ProjectKeyResolver
{
    public static string DeriveKey(string? requestedKey, string name)
    {
        var trimmed = (requestedKey ?? "").Trim().ToUpperInvariant();
        if (trimmed.Length > 0) return trimmed.Length > 20 ? trimmed[..20] : trimmed;

        var fromName = new string(name.Where(char.IsLetter).ToArray()).ToUpperInvariant();
        if (fromName.Length > 4) fromName = fromName[..4];
        return fromName.Length > 0 ? fromName : "PROJ";
    }

    // Scoped to the target Organisation, not global — see ProjectService's own comment on this same
    // rule (two unrelated orgs both having a "DEMO" project is fine).
    public static async Task<string> ResolveUniqueKeyAsync(AppDbContext db, string baseKey, Guid organisationId, Guid? excludeProjectId = null)
    {
        var candidate = baseKey;
        var suffix = 1;
        while (await db.Projects.AnyAsync(p => p.Key == candidate && p.OrganisationId == organisationId && p.Id != excludeProjectId))
        {
            candidate = $"{baseKey}{++suffix}";
        }
        return candidate;
    }
}
