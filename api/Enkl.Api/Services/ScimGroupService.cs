using System.Text.Json;
using System.Text.RegularExpressions;
using Enkl.Api.Data;
using Enkl.Api.Domain.Entities;
using Enkl.Api.Dtos;
using Microsoft.EntityFrameworkCore;

namespace Enkl.Api.Services;

/// <summary>
/// Maps SCIM's Groups resource onto OrgTeam/OrgTeamMember — the Organisation-scoped grouping
/// entity introduced specifically as the SCIM sync target, distinct from the Project-scoped
/// TeamCommittee used by the org-chart feature (see OrgTeam's own doc comment). This service never
/// touches TeamCommittee at all; TeamCommitteeService.ApplyOrgTeamAsync is the one-way, manual
/// bridge between the two.
/// </summary>
public class ScimGroupService
{
    private readonly AppDbContext _db;

    public ScimGroupService(AppDbContext db)
    {
        _db = db;
    }

    public async Task<ScimListResponse<ScimGroupResponse>> ListAsync(Guid orgId, string? filter, int startIndex, int count)
    {
        var query = _db.OrgTeams.Where(t => t.OrganisationId == orgId);

        if (!string.IsNullOrWhiteSpace(filter))
        {
            var (attr, value) = ScimFilterParser.ParseEq(filter);
            if (attr == "displayname" && value is not null)
            {
                query = query.Where(t => t.Name == value);
            }
            else
            {
                query = query.Where(_ => false);
            }
        }

        var total = await query.CountAsync();
        var pageIds = await query.OrderBy(t => t.Name)
            .Skip(Math.Max(0, startIndex - 1)).Take(Math.Clamp(count, 1, 200))
            .Select(t => t.Id).ToListAsync();

        var resources = new List<ScimGroupResponse>();
        foreach (var id in pageIds) resources.Add(await ToResponseAsync(id));

        return new ScimListResponse<ScimGroupResponse>(new[] { ScimSchemas.ListResponse }, total, startIndex, resources.Count, resources);
    }

    public async Task<ScimGroupResponse?> GetAsync(Guid orgId, Guid groupId)
    {
        var exists = await _db.OrgTeams.AnyAsync(t => t.Id == groupId && t.OrganisationId == orgId);
        return exists ? await ToResponseAsync(groupId) : null;
    }

    public async Task<ScimGroupResponse> CreateAsync(Guid orgId, ScimGroupRequest request)
    {
        var team = new OrgTeam
        {
            Id = Guid.NewGuid(),
            OrganisationId = orgId,
            Name = NormalizeName(request.DisplayName),
            ScimExternalId = string.IsNullOrWhiteSpace(request.ExternalId) ? null : request.ExternalId.Trim(),
            DateCreated = DateTime.UtcNow,
            DateLastModified = DateTime.UtcNow
        };
        _db.OrgTeams.Add(team);
        await AddMembersAsync(orgId, team.Id, ExtractMembers(request.Members));
        await _db.SaveChangesAsync();
        return await ToResponseAsync(team.Id);
    }

    /// <summary>PUT replaces the whole membership list, per SCIM full-resource-replace semantics —
    /// unlike PATCH's add/remove operations below, which touch only the members named.</summary>
    public async Task<ScimGroupResponse?> ReplaceAsync(Guid orgId, Guid groupId, ScimGroupRequest request)
    {
        var team = await _db.OrgTeams.FirstOrDefaultAsync(t => t.Id == groupId && t.OrganisationId == orgId);
        if (team is null) return null;

        team.Name = NormalizeName(request.DisplayName);
        team.DateLastModified = DateTime.UtcNow;

        var existing = await _db.Set<OrgTeamMember>().Where(m => m.OrgTeamId == team.Id).ToListAsync();
        _db.Set<OrgTeamMember>().RemoveRange(existing);
        await AddMembersAsync(orgId, team.Id, ExtractMembers(request.Members));

        await _db.SaveChangesAsync();
        return await ToResponseAsync(team.Id);
    }

    /// <summary>
    /// Recognizes the operations IdPs actually send for group membership changes: "add"/path
    /// "members" (append one or more), "remove"/path "members[value eq \"&lt;userId&gt;\"]" (drop
    /// one specific member — the common single-unassign case), and "replace" on displayName (rename,
    /// in both the Okta path-scoped and Azure-AD whole-object-value forms — see ScimUserService's
    /// PatchAsync for the same two shapes on Users). A bare "remove" on "members" with no targeted
    /// value clears the whole list. Anything else is a no-op rather than an error, same scope-limit
    /// reasoning as ScimUserService.ApplyFieldChangeAsync.
    /// </summary>
    public async Task<ScimGroupResponse?> PatchAsync(Guid orgId, Guid groupId, ScimPatchRequest request)
    {
        var team = await _db.OrgTeams.FirstOrDefaultAsync(t => t.Id == groupId && t.OrganisationId == orgId);
        if (team is null) return null;

        foreach (var op in request.Operations)
        {
            var opName = (op.Op ?? "").ToLowerInvariant();
            var pathKey = (op.Path ?? "").Split('[')[0].Trim().ToLowerInvariant();

            if (op.Value is { } value)
            {
                if (opName == "replace" && string.IsNullOrEmpty(op.Path) && value.ValueKind == JsonValueKind.Object)
                {
                    if (value.TryGetProperty("displayName", out var dn) && dn.ValueKind == JsonValueKind.String)
                    {
                        team.Name = NormalizeName(dn.GetString());
                    }
                    continue;
                }
                if (opName == "replace" && pathKey == "displayname" && value.ValueKind == JsonValueKind.String)
                {
                    team.Name = NormalizeName(value.GetString());
                    continue;
                }
                if (opName == "add" && pathKey == "members")
                {
                    await AddMembersAsync(orgId, team.Id, ExtractUserIds(value));
                    continue;
                }
            }

            if (opName == "remove" && pathKey == "members")
            {
                var targeted = ExtractMemberIdFromPathFilter(op.Path) ?? (op.Value is { } v ? ExtractUserIds(v).FirstOrDefault() : (Guid?)null);
                var toRemove = targeted is { } singleId
                    ? await _db.Set<OrgTeamMember>().Where(m => m.OrgTeamId == team.Id && m.UserId == singleId).ToListAsync()
                    : await _db.Set<OrgTeamMember>().Where(m => m.OrgTeamId == team.Id).ToListAsync();
                _db.Set<OrgTeamMember>().RemoveRange(toRemove);
            }
        }

        team.DateLastModified = DateTime.UtcNow;
        await _db.SaveChangesAsync();
        return await ToResponseAsync(team.Id);
    }

    public async Task<bool> DeleteAsync(Guid orgId, Guid groupId)
    {
        var team = await _db.OrgTeams.FirstOrDefaultAsync(t => t.Id == groupId && t.OrganisationId == orgId);
        if (team is null) return false;

        // Cascades OrgTeamMember; any TeamCommittee.SourceOrgTeamId pointing here SetNulls (see
        // TeamCommitteeConfiguration) rather than touching the TeamCommittee itself — deleting the
        // source group must never reach into a project's org chart.
        _db.OrgTeams.Remove(team);
        await _db.SaveChangesAsync();
        return true;
    }

    private async Task AddMembersAsync(Guid orgId, Guid teamId, List<Guid> userIds)
    {
        foreach (var userId in userIds)
        {
            if (await _db.Users.AnyAsync(u => u.Id == userId && u.OrganisationId == orgId) &&
                !await _db.Set<OrgTeamMember>().AnyAsync(m => m.OrgTeamId == teamId && m.UserId == userId))
            {
                _db.Set<OrgTeamMember>().Add(new OrgTeamMember { OrgTeamId = teamId, UserId = userId });
            }
        }
    }

    private static List<Guid> ExtractMembers(List<ScimGroupMemberDto>? members) =>
        (members ?? new List<ScimGroupMemberDto>())
            .Select(m => Guid.TryParse(m.Value, out var id) ? id : (Guid?)null)
            .Where(id => id.HasValue).Select(id => id!.Value).ToList();

    private static List<Guid> ExtractUserIds(JsonElement value)
    {
        var ids = new List<Guid>();
        if (value.ValueKind == JsonValueKind.Array)
        {
            foreach (var item in value.EnumerateArray())
            {
                var raw = item.ValueKind == JsonValueKind.Object && item.TryGetProperty("value", out var v) && v.ValueKind == JsonValueKind.String
                    ? v.GetString()
                    : item.ValueKind == JsonValueKind.String ? item.GetString() : null;
                if (raw is not null && Guid.TryParse(raw, out var id)) ids.Add(id);
            }
        }
        else if (value.ValueKind == JsonValueKind.String && Guid.TryParse(value.GetString(), out var singleId))
        {
            ids.Add(singleId);
        }
        return ids;
    }

    private static Guid? ExtractMemberIdFromPathFilter(string? path)
    {
        if (string.IsNullOrEmpty(path)) return null;
        var match = Regex.Match(path, "value\\s+eq\\s+\"([0-9a-fA-F-]{36})\"", RegexOptions.IgnoreCase);
        return match.Success && Guid.TryParse(match.Groups[1].Value, out var id) ? id : null;
    }

    private static string NormalizeName(string? name)
    {
        var trimmed = string.IsNullOrWhiteSpace(name) ? "Unnamed Team" : name.Trim();
        return trimmed.Length > 200 ? trimmed[..200] : trimmed;
    }

    private async Task<ScimGroupResponse> ToResponseAsync(Guid id)
    {
        var team = await _db.OrgTeams.AsNoTracking().Include(t => t.Members).ThenInclude(m => m.User).FirstAsync(t => t.Id == id);
        return new ScimGroupResponse(
            new[] { ScimSchemas.Group },
            team.Id.ToString(),
            team.ScimExternalId,
            team.Name,
            team.Members.Select(m => new ScimGroupMemberDto(m.UserId.ToString(), m.User.DisplayName)).ToList(),
            new ScimMetaDto("Group", team.DateCreated, team.DateLastModified, $"/Groups/{team.Id}"));
    }
}
