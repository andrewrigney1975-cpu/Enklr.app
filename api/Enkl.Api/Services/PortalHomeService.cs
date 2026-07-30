using Enkl.Api.Data;
using Enkl.Api.Domain.Entities;
using Enkl.Api.Dtos;
using Microsoft.EntityFrameworkCore;

namespace Enkl.Api.Services;

/// <summary>
/// The end-user-facing side of Organisational Portals — deliberately [Authorize]-only at the
/// controller (no ProjectMember/OrgAdmin policy), since a Portal must be reachable by an org user
/// who belongs to zero projects. Every method here re-derives BOTH that the Portal is published AND
/// that the caller actually has access (via PortalAccessService), never trusting a client-supplied
/// portalId/slug alone — a foreign/nonexistent/unpublished/inaccessible Portal all return the same
/// "not found," matching this codebase's no-enumeration-oracle rule.
/// </summary>
public class PortalHomeService
{
    private readonly AppDbContext _db;
    private readonly PortalAccessService _access;
    private readonly PortalService _portals;
    private readonly FormSubmissionService _submissions;

    public PortalHomeService(AppDbContext db, PortalAccessService access, PortalService portals, FormSubmissionService submissions)
    {
        _db = db;
        _access = access;
        _portals = portals;
        _submissions = submissions;
    }

    public async Task<PortalDto?> GetBySlugAsync(Guid organisationId, string slug, Guid userId)
    {
        var portal = await GetAccessiblePortalBySlugAsync(organisationId, slug, userId);
        return portal is null ? null : ToDto(portal);
    }

    /// <summary>Backs the side nav's "Portals" section — every published Portal in the caller's own
    /// org that this user actually has access to, checked the same way (PortalAccessService) as
    /// every other read here. A plain per-candidate loop, not a single set-based query — fine at
    /// this feature's expected scale (an org's total Portal count), same tolerance this codebase's
    /// other small-scale in-memory checks already accept (see FormSubmissionService.ListAwaitingMyActionAsync's
    /// own doc comment for the precedent).</summary>
    public async Task<List<AccessiblePortalDto>> ListAccessibleAsync(Guid organisationId, Guid userId)
    {
        var candidates = await _db.Portals.AsNoTracking()
            .Where(p => p.OrganisationId == organisationId && p.Status == "published")
            .OrderBy(p => p.Name)
            .ToListAsync();

        var result = new List<AccessiblePortalDto>();
        foreach (var p in candidates)
        {
            if (await _access.UserHasPortalAccessAsync(p.Id, userId))
            {
                result.Add(new AccessiblePortalDto(p.Id, p.Name, p.Slug, p.IconName));
            }
        }
        return result;
    }

    public async Task<List<PortalFormDto>?> ListAvailableFormsAsync(Guid organisationId, Guid portalId, Guid userId)
    {
        if (await GetAccessiblePortalAsync(organisationId, portalId, userId) is null) return null;
        var portalForms = await _db.PortalForms.AsNoTracking()
            .Where(f => f.PortalId == portalId)
            .OrderBy(f => f.Order)
            .ToListAsync();
        return await _portals.ResolvePortalFormDtosAsync(portalForms);
    }

    /// <summary>The user's own submissions against this Portal's actioner Project, filtered down to
    /// just the forms actually attached to this Portal — a direct query rather than reusing
    /// FormSubmissionService.ListMineAsync, since that method has no FormGroupId-based filter and a
    /// user's own Project could in principle have other forms submitted outside this Portal's
    /// curated set (not possible today since only Portal-flow submissions target this Project, but
    /// filtering explicitly here is the correct, defensive shape regardless).</summary>
    public async Task<List<FormSubmissionListItemDto>?> ListMySubmissionsAsync(Guid organisationId, Guid portalId, Guid userId)
    {
        var portal = await GetAccessiblePortalAsync(organisationId, portalId, userId);
        if (portal is null) return null;

        var attachedGroupIds = await _db.PortalForms.AsNoTracking()
            .Where(f => f.PortalId == portalId)
            .Select(f => f.FormGroupId)
            .ToListAsync();
        if (attachedGroupIds.Count == 0) return new();

        var subs = await _db.FormSubmissions.AsNoTracking()
            .Include(s => s.FormVersion).Include(s => s.SubmittedByUser)
            .Where(s => s.ProjectId == portal.ProjectId && s.SubmittedByUserId == userId && attachedGroupIds.Contains(s.FormVersion.FormGroupId))
            .OrderByDescending(s => s.DateLastModified)
            .ToListAsync();
        return subs.Select(FormSubmissionService.ToListItemDto).ToList();
    }

    public async Task<PortalQaDto?> ListQaAsync(Guid organisationId, Guid portalId, Guid userId)
    {
        if (await GetAccessiblePortalAsync(organisationId, portalId, userId) is null) return null;

        var topics = await _db.PortalTopics.AsNoTracking()
            .Where(t => t.PortalId == portalId)
            .OrderBy(t => t.Order)
            .Select(t => new PortalTopicDto(t.Id, t.Title, t.Order))
            .ToListAsync();
        var entries = await _db.PortalQaEntries.AsNoTracking()
            .Where(e => e.PortalId == portalId)
            .OrderBy(e => e.Order)
            .Select(e => new PortalQaEntryDto(e.Id, e.PortalTopicId, e.Question, e.Answer, e.Order))
            .ToListAsync();
        return new PortalQaDto(topics, entries);
    }

    /// <summary>Delegates into FormSubmissionService.CreateAsync against the Portal's own actioner
    /// Project (which FormSubmissionService's methods take as a bare, un-authorized ProjectId — no
    /// ProjectMember policy a Portal-only user would never satisfy) after re-validating both Portal
    /// access AND that the requested form version's FormGroupId is actually attached to this Portal —
    /// a Portal user must only ever be able to submit the forms this Portal curates, not any
    /// published form in the org just because they now have a route to this Project.</summary>
    public async Task<FormSubmissionDto?> CreateSubmissionAsync(Guid organisationId, Guid portalId, Guid userId, CreateFormSubmissionRequest request)
    {
        var portal = await GetAccessiblePortalAsync(organisationId, portalId, userId);
        if (portal is null) return null;
        if (!await IsFormAttachedAsync(portalId, request.FormVersionId)) return null;
        return await _submissions.CreateAsync(portal.ProjectId, userId, request);
    }

    public async Task<FormSubmissionDto?> UpdateSubmissionAsync(Guid organisationId, Guid portalId, Guid userId, Guid submissionId, UpdateFormSubmissionRequest request)
    {
        var portal = await GetAccessiblePortalAsync(organisationId, portalId, userId);
        if (portal is null) return null;
        return await _submissions.UpdateAsync(portal.ProjectId, userId, submissionId, request);
    }

    public async Task<bool> DeleteSubmissionAsync(Guid organisationId, Guid portalId, Guid userId, Guid submissionId)
    {
        var portal = await GetAccessiblePortalAsync(organisationId, portalId, userId);
        if (portal is null) return false;
        return await _submissions.DeleteAsync(portal.ProjectId, userId, submissionId);
    }

    public async Task<(bool ok, string error, FormSubmissionDto? dto)> SubmitSubmissionAsync(Guid organisationId, Guid portalId, Guid userId, Guid submissionId)
    {
        var portal = await GetAccessiblePortalAsync(organisationId, portalId, userId);
        if (portal is null) return (false, "not_found", null);
        // callerIsOrgAdmin: always false here — a Portal end user submitting a form is never acting
        // with Org-Admin authority through this surface, regardless of their real IsOrgAdmin flag.
        return await _submissions.SubmitAsync(portal.ProjectId, userId, callerIsOrgAdmin: false, submissionId);
    }

    private async Task<bool> IsFormAttachedAsync(Guid portalId, Guid formVersionId)
    {
        var formGroupId = await _db.Forms.AsNoTracking()
            .Where(f => f.Id == formVersionId)
            .Select(f => (Guid?)f.FormGroupId)
            .FirstOrDefaultAsync();
        if (formGroupId is null) return false;
        return await _db.PortalForms.AsNoTracking().AnyAsync(f => f.PortalId == portalId && f.FormGroupId == formGroupId);
    }

    /// <summary>The one place both halves of "can this user see this Portal at all" are checked

    /// <summary>The one place both halves of "can this user see this Portal at all" are checked
    /// together — Status must be "published" (draft/archived are Org-Admin-preview-only, via
    /// PortalService, not this class) AND PortalAccessService must grant access. Returns null (never
    /// a distinguishable reason) for any failure.</summary>
    private async Task<Portal?> GetAccessiblePortalAsync(Guid organisationId, Guid portalId, Guid userId)
    {
        var portal = await _db.Portals.AsNoTracking()
            .FirstOrDefaultAsync(p => p.Id == portalId && p.OrganisationId == organisationId && p.Status == "published");
        if (portal is null) return null;
        return await _access.UserHasPortalAccessAsync(portalId, userId) ? portal : null;
    }

    private async Task<Portal?> GetAccessiblePortalBySlugAsync(Guid organisationId, string slug, Guid userId)
    {
        var portal = await _db.Portals.AsNoTracking()
            .FirstOrDefaultAsync(p => p.OrganisationId == organisationId && p.Slug == slug && p.Status == "published");
        if (portal is null) return null;
        return await _access.UserHasPortalAccessAsync(portal.Id, userId) ? portal : null;
    }

    private static PortalDto ToDto(Portal p) => new(p.Id, p.Name, p.Slug, p.Description, p.IconName, p.Status, p.ProjectId, p.DateCreated, p.DateLastModified, p.PublishedAt);
}
