using System.Text.Json;
using Enkl.Api.Data;
using Enkl.Api.Domain;
using Enkl.Api.Domain.Entities;
using Enkl.Api.Dtos;
using Enkl.Api.Validation;
using Microsoft.EntityFrameworkCore;

namespace Enkl.Api.Services;

public enum ScimDeleteResult { Deleted, NotFound, HasProjectMemberships }

/// <summary>
/// Maps SCIM's Users resource onto the app's existing User entity — the same entity Organisation-
/// Service's explicit create and SamlService's JIT provisioning already write to, so a user created
/// here shows up in Manage Users and can sign in via SAML (once one exists) exactly like any other
/// account. Deliberately does not touch ProjectMember/OrgTeamMember: SCIM's Users resource only
/// owns the account itself, not project membership or Org Team membership (that's Groups, Phase 4).
/// </summary>
public class ScimUserService
{
    private readonly AppDbContext _db;

    public ScimUserService(AppDbContext db)
    {
        _db = db;
    }

    public async Task<ScimListResponse<ScimUserResponse>> ListAsync(Guid orgId, string? filter, int startIndex, int count)
    {
        var query = _db.Users.Where(u => u.OrganisationId == orgId);

        if (!string.IsNullOrWhiteSpace(filter))
        {
            var (attr, value) = ScimFilterParser.ParseEq(filter);
            if (attr == "username" && value is not null)
            {
                var normalized = UsernameNormalizer.Normalize(value);
                query = query.Where(u => u.NormalizedUsername == normalized);
            }
            else if ((attr == "emails.value" || attr == "emails") && value is not null)
            {
                var normalized = EmailAddressNormalizer.Normalize(value);
                query = query.Where(u => u.NormalizedEmailAddress == normalized);
            }
            else
            {
                // Unsupported filter attribute/syntax: SCIM clients should get a clean "no matches"
                // rather than every user in the org (silently ignoring the filter) or a hard 400 for
                // every filter shape they might try — this only recognizes userName/emails.value eq.
                query = query.Where(_ => false);
            }
        }

        var total = await query.CountAsync();
        var page = await query.OrderBy(u => u.Username)
            .Skip(Math.Max(0, startIndex - 1)).Take(Math.Clamp(count, 1, 200))
            .ToListAsync();

        return new ScimListResponse<ScimUserResponse>(
            new[] { ScimSchemas.ListResponse }, total, startIndex, page.Count,
            page.Select(ToResponse).ToList());
    }

    public async Task<ScimUserResponse?> GetAsync(Guid orgId, Guid userId)
    {
        var user = await _db.Users.FirstOrDefaultAsync(u => u.Id == userId && u.OrganisationId == orgId);
        return user is null ? null : ToResponse(user);
    }

    public async Task<ScimUserResponse> CreateAsync(Guid orgId, ScimUserRequest request)
    {
        var email = ExtractEmail(request);
        var (validEmail, normalizedEmail) = await EmailValidation.ValidateAndNormalizeAsync(_db, email, requireEmail: true, excludeUserId: null);

        var displayName = ExtractDisplayName(request, validEmail!);
        var baseUsername = UsernameNormalizer.Normalize(displayName);
        if (baseUsername.Length == 0) baseUsername = "user";
        var usernameToUse = await _db.Users.AnyAsync(u => u.NormalizedUsername == baseUsername)
            ? await ResolveUniqueUsernameAsync(baseUsername)
            : baseUsername;

        var user = new User
        {
            Id = Guid.NewGuid(),
            OrganisationId = orgId,
            Username = usernameToUse,
            NormalizedUsername = usernameToUse,
            EmailAddress = validEmail,
            NormalizedEmailAddress = normalizedEmail,
            PasswordHash = null,
            DisplayName = displayName,
            MustChangePassword = false,
            IsOrgAdmin = false,
            IsActive = request.Active ?? true,
            CreatedAt = DateTime.UtcNow
        };
        _db.Users.Add(user);
        await _db.SaveChangesAsync();
        return ToResponse(user);
    }

    /// <summary>PUT semantics are intentionally partial: email/displayName/active get replaced from
    /// the request, but the app's internal Username is never renamed by SCIM once created — see
    /// ApplyFieldChangeAsync's "username" case for the same reasoning applied to PATCH.</summary>
    public async Task<ScimUserResponse?> ReplaceAsync(Guid orgId, Guid userId, ScimUserRequest request)
    {
        var user = await _db.Users.FirstOrDefaultAsync(u => u.Id == userId && u.OrganisationId == orgId);
        if (user is null) return null;

        var email = ExtractEmail(request);
        if (!string.IsNullOrWhiteSpace(email) && !string.Equals(email, user.EmailAddress, StringComparison.OrdinalIgnoreCase))
        {
            var (validEmail, normalizedEmail) = await EmailValidation.ValidateAndNormalizeAsync(_db, email, requireEmail: true, excludeUserId: user.Id);
            user.EmailAddress = validEmail;
            user.NormalizedEmailAddress = normalizedEmail;
        }
        user.DisplayName = ExtractDisplayName(request, user.EmailAddress ?? user.Username);
        user.IsActive = request.Active ?? user.IsActive;

        await _db.SaveChangesAsync();
        return ToResponse(user);
    }

    public async Task<ScimUserResponse?> PatchAsync(Guid orgId, Guid userId, ScimPatchRequest request)
    {
        var user = await _db.Users.FirstOrDefaultAsync(u => u.Id == userId && u.OrganisationId == orgId);
        if (user is null) return null;

        foreach (var op in request.Operations)
        {
            if (!string.Equals(op.Op, "replace", StringComparison.OrdinalIgnoreCase) &&
                !string.Equals(op.Op, "add", StringComparison.OrdinalIgnoreCase)) continue;
            if (op.Value is not { } value) continue;

            // Two shapes seen in practice: Azure AD sends {"op":"Replace","value":{"active":false}}
            // (no path, one or more attributes under value); Okta sends
            // {"op":"replace","path":"active","value":false} (a single scalar at a specific path).
            if (string.IsNullOrEmpty(op.Path) && value.ValueKind == JsonValueKind.Object)
            {
                foreach (var prop in value.EnumerateObject())
                {
                    await ApplyFieldChangeAsync(user, prop.Name, prop.Value);
                }
            }
            else if (!string.IsNullOrEmpty(op.Path))
            {
                await ApplyFieldChangeAsync(user, op.Path, value);
            }
        }

        await _db.SaveChangesAsync();
        return ToResponse(user);
    }

    /// <summary>
    /// ProjectMember.UserId is a Restrict FK on purpose (see ProjectMemberConfiguration) — a
    /// directory deprovisioning event should never silently cascade away someone's task assignments
    /// and project history. Rejecting with HasProjectMemberships (surfaced as a 409 by the
    /// controller) is the correct behavior here; PATCH active:false is the expected real-world
    /// deprovisioning path and always works regardless of project memberships.
    /// </summary>
    public async Task<ScimDeleteResult> DeleteAsync(Guid orgId, Guid userId)
    {
        var user = await _db.Users.FirstOrDefaultAsync(u => u.Id == userId && u.OrganisationId == orgId);
        if (user is null) return ScimDeleteResult.NotFound;

        if (await _db.ProjectMembers.AnyAsync(m => m.UserId == userId))
        {
            return ScimDeleteResult.HasProjectMemberships;
        }

        _db.Users.Remove(user);
        await _db.SaveChangesAsync();
        return ScimDeleteResult.Deleted;
    }

    private async Task ApplyFieldChangeAsync(User user, string path, JsonElement value)
    {
        // Strips a SCIM array-filter suffix like emails[type eq "work"].value down to "emails" —
        // "name.formatted" has no brackets and passes through unchanged.
        var key = path.Split('[')[0].Trim().ToLowerInvariant();
        switch (key)
        {
            case "active":
                if (value.ValueKind is JsonValueKind.True or JsonValueKind.False) user.IsActive = value.GetBoolean();
                else if (value.ValueKind == JsonValueKind.String && bool.TryParse(value.GetString(), out var parsedActive)) user.IsActive = parsedActive;
                break;
            case "displayname":
            case "name.formatted":
                if (value.ValueKind == JsonValueKind.String && value.GetString() is { Length: > 0 } newName)
                {
                    user.DisplayName = newName.Length > 200 ? newName[..200] : newName;
                }
                break;
            case "username":
                // Deliberately unsupported — the app's internal Username is derived once at
                // creation and used for login/dedup elsewhere (e.g. MemberService's project-member
                // matching); renaming it out from under those paths is a bigger change than this
                // integration takes on. displayName/emails are the identifying fields SCIM can change.
                break;
            case "emails":
                var newEmail = ExtractEmailFromValue(value);
                if (!string.IsNullOrWhiteSpace(newEmail) && !string.Equals(newEmail, user.EmailAddress, StringComparison.OrdinalIgnoreCase))
                {
                    var (validEmail, normalizedEmail) = await EmailValidation.ValidateAndNormalizeAsync(_db, newEmail, requireEmail: false, excludeUserId: user.Id);
                    if (validEmail is not null)
                    {
                        user.EmailAddress = validEmail;
                        user.NormalizedEmailAddress = normalizedEmail;
                    }
                }
                break;
        }
    }

    private static string? ExtractEmailFromValue(JsonElement value)
    {
        if (value.ValueKind == JsonValueKind.String) return value.GetString();
        if (value.ValueKind == JsonValueKind.Array)
        {
            foreach (var item in value.EnumerateArray())
            {
                if (item.ValueKind == JsonValueKind.Object && item.TryGetProperty("value", out var v) && v.ValueKind == JsonValueKind.String)
                {
                    return v.GetString();
                }
            }
        }
        return null;
    }

    private static string? ExtractEmail(ScimUserRequest request)
    {
        var fromEmails = request.Emails?.FirstOrDefault(e => e.Primary == true)?.Value
            ?? request.Emails?.FirstOrDefault()?.Value;
        if (!string.IsNullOrWhiteSpace(fromEmails)) return fromEmails;
        // Many IdPs' SCIM implementations set userName to the email itself — accept that as a
        // fallback identifier when no explicit emails entry was sent.
        if (!string.IsNullOrWhiteSpace(request.UserName) && request.UserName.Contains('@')) return request.UserName;
        return null;
    }

    private static string ExtractDisplayName(ScimUserRequest request, string emailFallback)
    {
        var name = request.DisplayName;
        if (string.IsNullOrWhiteSpace(name)) name = request.Name?.Formatted;
        if (string.IsNullOrWhiteSpace(name))
        {
            var parts = new[] { request.Name?.GivenName, request.Name?.FamilyName }.Where(p => !string.IsNullOrWhiteSpace(p));
            name = string.Join(' ', parts);
        }
        if (string.IsNullOrWhiteSpace(name)) name = emailFallback.Split('@')[0];
        name = name.Trim();
        return name.Length > 200 ? name[..200] : name;
    }

    private async Task<string> ResolveUniqueUsernameAsync(string baseUsername)
    {
        var candidate = baseUsername;
        var suffix = 1;
        while (await _db.Users.AnyAsync(u => u.NormalizedUsername == candidate))
        {
            candidate = $"{baseUsername}{++suffix}";
        }
        return candidate;
    }

    // User has no DateLastModified column — Created/LastModified both report CreatedAt, a known
    // simplification rather than adding a column no other read path in the app needs yet.
    private static ScimUserResponse ToResponse(User user) => new(
        new[] { ScimSchemas.User },
        user.Id.ToString(),
        user.Username,
        new ScimNameDto(user.DisplayName, null, null),
        user.DisplayName,
        user.EmailAddress is null ? new List<ScimEmailDto>() : new List<ScimEmailDto> { new(user.EmailAddress, true, "work") },
        user.IsActive,
        new ScimMetaDto("User", user.CreatedAt, user.CreatedAt, $"/Users/{user.Id}"));
}
