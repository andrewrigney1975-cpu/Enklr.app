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
            .Select(e => new PortalQaEntryDto(e.Id, e.PortalTopicId, e.Question, e.Answer, e.Order, e.Nps))
            .ToListAsync();
        return new PortalQaDto(topics, entries);
    }

    /// <summary>End-user thumbs-up/down voting on a Q&amp;A entry — "up" is +1, anything else is -1, no
    /// floor/ceiling, no per-user vote tracking (a simple tally, not a persistent per-user ledger, per
    /// this feature's own deliberately minimal spec). Gated the same way every other read/write here
    /// is: the Portal must be published AND the caller must actually have an access grant for it —
    /// re-derived fresh, never trusted from a client-supplied claim.</summary>
    public async Task<bool> VoteQaEntryNpsAsync(Guid organisationId, Guid portalId, Guid entryId, string direction, Guid userId)
    {
        if (await GetAccessiblePortalAsync(organisationId, portalId, userId) is null) return false;
        var entry = await _db.PortalQaEntries.FirstOrDefaultAsync(e => e.Id == entryId && e.PortalId == portalId);
        if (entry is null) return false;
        entry.Nps += direction == "up" ? 1 : -1;
        await _db.SaveChangesAsync();
        return true;
    }

    /// <summary>Re-fetches ONE of the caller's own submissions with its full AnswersJson — needed to
    /// actually reopen a saved Draft with its previously-entered answers bound back into the form
    /// (FormSubmissionListItemDto, what the "My requests" pane's own list already has in hand, never
    /// carries AnswersJson at all). FormSubmissionService.GetAsync itself has no ownership check
    /// baked in (the normal ProjectMember-scoped fill-out surface trusts any project member to read
    /// any submission in their own project) — that trust boundary doesn't apply to a Portal-only user
    /// with no project membership at all, so this method re-derives ownership explicitly: a
    /// submission that exists but was submitted by someone else returns null here, identical to a
    /// nonexistent one, no distinguishable error.</summary>
    public async Task<FormSubmissionDto?> GetSubmissionAsync(Guid organisationId, Guid portalId, Guid userId, Guid submissionId, bool callerIsOrgAdmin)
    {
        var portal = await GetAccessiblePortalAsync(organisationId, portalId, userId);
        if (portal is null) return null;
        var submission = await _submissions.GetAsync(portal.ProjectId, submissionId);
        if (submission is null) return null;
        if (submission.SubmittedByUserId == userId) return submission;

        // Not the submitter — only visible if the caller is currently a legitimate reviewer for it
        // (i.e. it's sitting at an Approval node whose gates they satisfy). Reuses
        // ListAwaitingMyActionAsync's own gate-evaluation rather than re-parsing the workflow graph
        // here, so there's exactly one place that logic lives. Anyone else gets the same null as a
        // nonexistent submission — no enumeration oracle. The caller's REAL IsOrgAdmin flag is used
        // here (unlike SubmitSubmissionAsync's own deliberate always-false) — an orgAdmin-gated
        // Approval node (the natural gate for the Org Admins auto-added to every actioner Project)
        // could otherwise never be satisfied by anyone through this surface at all.
        var awaiting = await _submissions.ListAwaitingMyActionAsync(portal.ProjectId, userId, callerIsOrgAdmin);
        return awaiting.Any(a => a.Id == submissionId) ? submission : null;
    }

    /// <summary>Submissions against this Portal's own actioner Project currently awaiting the
    /// caller's approval — the Portal-surface counterpart to ProjectFormsController's
    /// "submissions/awaiting-me", needed because a Portal-configured approver is never a
    /// ProjectMember of the actioner Project (it's deliberately created with zero members) and so
    /// has no route to that project-scoped endpoint at all. Delegates straight into
    /// FormSubmissionService's own gate-evaluation logic — a Portal submission is a completely
    /// ordinary FormSubmission underneath, just reached through a different, membership-free front
    /// door. Unlike SubmitSubmissionAsync, this uses the caller's REAL IsOrgAdmin flag — an
    /// orgAdmin-gated Approval node is the natural gate for the Org Admins PortalService.CreateAsync
    /// auto-adds to every actioner Project, and suppressing it here would make such a node
    /// unsatisfiable by anyone through this surface.</summary>
    public async Task<List<FormSubmissionListItemDto>?> ListAwaitingMyActionAsync(Guid organisationId, Guid portalId, Guid userId, bool callerIsOrgAdmin)
    {
        var portal = await GetAccessiblePortalAsync(organisationId, portalId, userId);
        if (portal is null) return null;
        return await _submissions.ListAwaitingMyActionAsync(portal.ProjectId, userId, callerIsOrgAdmin);
    }

    /// <summary>Approve/reject a submission sitting at an Approval node in this Portal's actioner
    /// Project. Unlike SubmitSubmissionAsync (which deliberately always passes false — a Portal end
    /// user filling out a form is never acting with Org-Admin authority), this uses the caller's REAL
    /// IsOrgAdmin flag: an orgAdmin-gated Approval node is the natural gate for the Org Admins
    /// PortalService.CreateAsync auto-adds to every actioner Project, and suppressing it here would
    /// make such a node unsatisfiable by anyone through this surface.</summary>
    public async Task<(bool ok, string error, FormSubmissionDto? dto)> ActOnApprovalAsync(Guid organisationId, Guid portalId, Guid userId, Guid submissionId, string action, string? comment, bool callerIsOrgAdmin, string? closingNotes = null)
    {
        var portal = await GetAccessiblePortalAsync(organisationId, portalId, userId);
        if (portal is null) return (false, "not_found", null);
        return await _submissions.ActOnApprovalAsync(portal.ProjectId, userId, callerIsOrgAdmin, submissionId, action, comment, closingNotes);
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
