using Enkl.Api.Data;
using Microsoft.EntityFrameworkCore;

namespace Enkl.Api.Services;

/// <summary>
/// Mirrors ProjectKeyResolver's derive-then-uniquify shape, for Portal.Slug instead of Project.Key —
/// a human-readable, hashbang-routable (#!/portal/&lt;slug&gt;) identifier, unique per Organisation.
/// </summary>
public static class PortalSlugResolver
{
    public static string DeriveSlug(string? requestedSlug, string name)
    {
        var fromRequested = Slugify(requestedSlug ?? "");
        if (fromRequested.Length > 0) return Truncate(fromRequested);

        var fromName = Slugify(name);
        return Truncate(fromName.Length > 0 ? fromName : "portal");
    }

    public static async Task<string> ResolveUniqueSlugAsync(AppDbContext db, string baseSlug, Guid organisationId, Guid? excludePortalId = null)
    {
        var candidate = baseSlug;
        var suffix = 1;
        while (await db.Portals.AnyAsync(p => p.Slug == candidate && p.OrganisationId == organisationId && p.Id != excludePortalId))
        {
            candidate = $"{baseSlug}-{++suffix}";
        }
        return candidate;
    }

    private static string Slugify(string value)
    {
        var lowered = value.Trim().ToLowerInvariant();
        var chars = new char[lowered.Length];
        var len = 0;
        var lastWasDash = false;
        foreach (var c in lowered)
        {
            if (char.IsLetterOrDigit(c))
            {
                chars[len++] = c;
                lastWasDash = false;
            }
            else if (!lastWasDash && len > 0)
            {
                chars[len++] = '-';
                lastWasDash = true;
            }
        }
        if (len > 0 && chars[len - 1] == '-') len--;
        return new string(chars, 0, len);
    }

    private static string Truncate(string slug) => slug.Length > 80 ? slug[..80].TrimEnd('-') : slug;
}
