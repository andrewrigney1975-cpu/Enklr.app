using Enkl.Api.Data;
using Enkl.Api.Dtos;
using Microsoft.EntityFrameworkCore;

namespace Enkl.Api.Services;

public class OrganisationService
{
    private readonly AppDbContext _db;

    public OrganisationService(AppDbContext db)
    {
        _db = db;
    }

    public async Task<OrganisationDetailDto?> GetOrganisationAsync(Guid organisationId)
    {
        var org = await _db.Organisations
            .Include(o => o.Users)
            .FirstOrDefaultAsync(o => o.Id == organisationId);
        if (org is null) return null;

        return new OrganisationDetailDto(
            org.Id, org.Name,
            org.Users.Select(u => new OrgUserDto(u.Id, u.Username, u.DisplayName, u.IsOrgAdmin, u.CreatedAt)).ToList());
    }

    /// <summary>Returns false if the target user doesn't exist or belongs to a different Organisation
    /// than the caller — an OrgAdmin can only manage users within their own org.</summary>
    public async Task<bool> SetUserAdminAsync(Guid callerOrganisationId, Guid targetUserId, bool isOrgAdmin)
    {
        var user = await _db.Users.FirstOrDefaultAsync(u => u.Id == targetUserId);
        if (user is null || user.OrganisationId != callerOrganisationId) return false;

        user.IsOrgAdmin = isOrgAdmin;
        await _db.SaveChangesAsync();
        return true;
    }
}
