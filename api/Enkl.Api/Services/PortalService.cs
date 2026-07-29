using Enkl.Api.Data;
using Enkl.Api.Domain.Entities;
using Enkl.Api.Dtos;
using Microsoft.EntityFrameworkCore;

namespace Enkl.Api.Services;

/// <summary>
/// Backs Org-Admin authoring of Organisational Portals — OrgAdmin policy only, same cross-org
/// isolation stance as PortfolioService (every id a client supplies is independently re-validated
/// against the caller's own OrganisationId before anything is touched; a foreign-org id is silently
/// dropped/treated as not-found, never a distinguishable error).
/// </summary>
public class PortalService
{
    private static readonly string[] PriorityColumnNames = { "Trivial", "Low", "Medium", "High", "Critical" };

    private readonly AppDbContext _db;
    private readonly PortfolioService _portfolio;
    private readonly PortalAccessService _access;

    public PortalService(AppDbContext db, PortfolioService portfolio, PortalAccessService access)
    {
        _db = db;
        _portfolio = portfolio;
        _access = access;
    }

    public async Task<List<PortalDto>> ListAsync(Guid organisationId)
    {
        var portals = await _db.Portals.AsNoTracking()
            .Where(p => p.OrganisationId == organisationId)
            .OrderBy(p => p.Name)
            .ToListAsync();
        return portals.Select(ToDto).ToList();
    }

    public async Task<PortalDto?> GetAsync(Guid organisationId, Guid portalId)
    {
        var portal = await _db.Portals.AsNoTracking()
            .FirstOrDefaultAsync(p => p.Id == portalId && p.OrganisationId == organisationId);
        return portal is null ? null : ToDto(portal);
    }

    /// <summary>
    /// Provisions a dedicated, membership-free actioner Project (via PortfolioService.CreateProjectAsync
    /// — the same "OrgAdmin sketching something out isn't necessarily a member of it" reasoning that
    /// method's own doc comment already gives) with 5 fixed priority columns (Trivial..Critical,
    /// left-to-right via Column.Order), then the Portal row referencing it. PortfolioService.CreateProjectAsync
    /// commits its own SaveChangesAsync internally, and this method does a separate save afterward for
    /// the columns+Portal row — both wrapped in one explicit transaction per this tier's standing
    /// convention (api/Enkl.Api/CLAUDE.md) for exactly this shape, mirroring
    /// RetrospectiveService.PromoteItemAsync.
    /// </summary>
    public async Task<PortalDto> CreateAsync(Guid organisationId, Guid callerUserId, CreatePortalRequest request)
    {
        var name = string.IsNullOrWhiteSpace(request.Name) ? "Untitled Portal" : request.Name.Trim();
        var baseSlug = PortalSlugResolver.DeriveSlug(request.Slug, name);
        var uniqueSlug = await PortalSlugResolver.ResolveUniqueSlugAsync(_db, baseSlug, organisationId);

        await using var transaction = await _db.Database.BeginTransactionAsync();

        var project = await _portfolio.CreateProjectAsync(organisationId, new CreatePortfolioProjectRequest(
            Name: $"{name} (Portal)", Key: null, Priority: "medium", CategoryId: null, StartDate: null, EndDate: null));

        for (var i = 0; i < PriorityColumnNames.Length; i++)
        {
            _db.Columns.Add(new Column { Id = Guid.NewGuid(), ProjectId = project.Id, Name = PriorityColumnNames[i], Done = false, Order = i });
        }

        var now = DateTime.UtcNow;
        var portal = new Portal
        {
            Id = Guid.NewGuid(),
            OrganisationId = organisationId,
            Name = name,
            Slug = uniqueSlug,
            Description = request.Description,
            Status = "draft",
            ProjectId = project.Id,
            CreatedByUserId = callerUserId,
            DateCreated = now,
            DateLastModified = now
        };
        _db.Portals.Add(portal);

        await _db.SaveChangesAsync();
        await transaction.CommitAsync();

        return ToDto(portal);
    }

    public async Task<PortalDto?> UpdateAsync(Guid organisationId, Guid portalId, UpdatePortalRequest request)
    {
        var portal = await _db.Portals.FirstOrDefaultAsync(p => p.Id == portalId && p.OrganisationId == organisationId);
        if (portal is null) return null;

        var name = string.IsNullOrWhiteSpace(request.Name) ? portal.Name : request.Name.Trim();
        if (!string.IsNullOrWhiteSpace(request.Slug) || name != portal.Name)
        {
            var baseSlug = PortalSlugResolver.DeriveSlug(request.Slug, name);
            portal.Slug = await PortalSlugResolver.ResolveUniqueSlugAsync(_db, baseSlug, organisationId, portalId);
        }

        portal.Name = name;
        portal.Description = request.Description;
        portal.DateLastModified = DateTime.UtcNow;
        await _db.SaveChangesAsync();
        return ToDto(portal);
    }

    public async Task<PortalDto?> PublishAsync(Guid organisationId, Guid portalId)
    {
        var portal = await _db.Portals.FirstOrDefaultAsync(p => p.Id == portalId && p.OrganisationId == organisationId);
        if (portal is null) return null;

        var now = DateTime.UtcNow;
        portal.Status = "published";
        portal.PublishedAt ??= now;
        portal.DateLastModified = now;
        await _db.SaveChangesAsync();
        return ToDto(portal);
    }

    public async Task<PortalDto?> ArchiveAsync(Guid organisationId, Guid portalId)
    {
        var portal = await _db.Portals.FirstOrDefaultAsync(p => p.Id == portalId && p.OrganisationId == organisationId);
        if (portal is null) return null;

        portal.Status = "archived";
        portal.DateLastModified = DateTime.UtcNow;
        await _db.SaveChangesAsync();
        return ToDto(portal);
    }

    /// <summary>Removes the Portal (cascades to its access grants/forms/topics/Q&amp;A entries) but
    /// deliberately leaves its actioner Project untouched — any tasks already raised there, and the
    /// project itself, survive the Portal front door being torn down.</summary>
    public async Task<bool> DeleteAsync(Guid organisationId, Guid portalId)
    {
        var portal = await _db.Portals.FirstOrDefaultAsync(p => p.Id == portalId && p.OrganisationId == organisationId);
        if (portal is null) return false;

        _db.Portals.Remove(portal);
        await _db.SaveChangesAsync();
        return true;
    }

    // ---- Access grants ----

    public async Task<List<PortalAccessGrantDto>?> ListAccessGrantsAsync(Guid organisationId, Guid portalId)
    {
        if (!await OwnsPortalAsync(organisationId, portalId)) return null;
        var grants = await _db.PortalAccessGrants.AsNoTracking()
            .Where(g => g.PortalId == portalId)
            .OrderBy(g => g.DateCreated)
            .ToListAsync();
        return grants.Select(g => new PortalAccessGrantDto(g.Id, g.Kind, g.Value, g.DateCreated)).ToList();
    }

    /// <summary>Independently re-validates that the grant's target (Value) actually belongs to the
    /// caller's own org before creating it — same cross-org isolation stance as every other write in
    /// this class. Returns null for an unrecognized Kind, a target that doesn't resolve to the
    /// caller's org, or a Portal the caller doesn't own — all treated identically (not found), no
    /// distinguishable error.</summary>
    public async Task<PortalAccessGrantDto?> AddAccessGrantAsync(Guid organisationId, Guid portalId, CreatePortalAccessGrantRequest request)
    {
        if (!await OwnsPortalAsync(organisationId, portalId)) return null;

        var targetValid = request.Kind switch
        {
            "namedUser" => await _db.Users.AnyAsync(u => u.Id == request.Value && u.OrganisationId == organisationId),
            "orgTeam" => await _db.OrgTeams.AnyAsync(t => t.Id == request.Value && t.OrganisationId == organisationId),
            "teamCommittee" => await _db.TeamsCommittees.AnyAsync(tc => tc.Id == request.Value && tc.Project.OrganisationId == organisationId),
            _ => false
        };
        if (!targetValid) return null;

        var existing = await _db.PortalAccessGrants
            .FirstOrDefaultAsync(g => g.PortalId == portalId && g.Kind == request.Kind && g.Value == request.Value);
        if (existing is not null) return new PortalAccessGrantDto(existing.Id, existing.Kind, existing.Value, existing.DateCreated);

        var grant = new PortalAccessGrant
        {
            Id = Guid.NewGuid(),
            PortalId = portalId,
            Kind = request.Kind,
            Value = request.Value,
            DateCreated = DateTime.UtcNow
        };
        _db.PortalAccessGrants.Add(grant);
        await _db.SaveChangesAsync();
        return new PortalAccessGrantDto(grant.Id, grant.Kind, grant.Value, grant.DateCreated);
    }

    public async Task<bool> RemoveAccessGrantAsync(Guid organisationId, Guid portalId, Guid grantId)
    {
        if (!await OwnsPortalAsync(organisationId, portalId)) return false;
        var grant = await _db.PortalAccessGrants.FirstOrDefaultAsync(g => g.Id == grantId && g.PortalId == portalId);
        if (grant is null) return false;
        _db.PortalAccessGrants.Remove(grant);
        await _db.SaveChangesAsync();
        return true;
    }

    /// <summary>Lets an Org Admin preview a Portal exactly as a given real user would see it —
    /// reuses PortalAccessService so authoring and enforcement can never disagree.</summary>
    public Task<bool> PreviewUserHasAccessAsync(Guid portalId, Guid userId) => _access.UserHasPortalAccessAsync(portalId, userId);

    // ---- Forms ----

    public async Task<List<PortalFormDto>?> ListAttachedFormsAsync(Guid organisationId, Guid portalId)
    {
        if (!await OwnsPortalAsync(organisationId, portalId)) return null;
        var portalForms = await _db.PortalForms.AsNoTracking()
            .Where(f => f.PortalId == portalId)
            .OrderBy(f => f.Order)
            .ToListAsync();
        return await ResolvePortalFormDtosAsync(portalForms);
    }

    /// <summary>Re-validates FormGroupId resolves to a currently-published Form belonging to the
    /// caller's own org before attaching it — Form itself is untouched by this table.</summary>
    public async Task<PortalFormDto?> AttachFormAsync(Guid organisationId, Guid portalId, AttachPortalFormRequest request)
    {
        if (!await OwnsPortalAsync(organisationId, portalId)) return null;

        var published = await _db.Forms.AsNoTracking()
            .FirstOrDefaultAsync(f => f.FormGroupId == request.FormGroupId && f.OrganisationId == organisationId && f.Status == "published");
        if (published is null) return null;

        var existing = await _db.PortalForms.FirstOrDefaultAsync(f => f.PortalId == portalId && f.FormGroupId == request.FormGroupId);
        if (existing is not null)
        {
            existing.Order = request.Order;
            await _db.SaveChangesAsync();
            return new PortalFormDto(existing.Id, existing.FormGroupId, existing.Order, published.Name, published.Status, published.FieldsJson, published.Id);
        }

        var portalForm = new PortalForm
        {
            Id = Guid.NewGuid(),
            PortalId = portalId,
            FormGroupId = request.FormGroupId,
            Order = request.Order,
            DateCreated = DateTime.UtcNow
        };
        _db.PortalForms.Add(portalForm);
        await _db.SaveChangesAsync();
        return new PortalFormDto(portalForm.Id, portalForm.FormGroupId, portalForm.Order, published.Name, published.Status, published.FieldsJson, published.Id);
    }

    public async Task<bool> DetachFormAsync(Guid organisationId, Guid portalId, Guid portalFormId)
    {
        if (!await OwnsPortalAsync(organisationId, portalId)) return false;
        var portalForm = await _db.PortalForms.FirstOrDefaultAsync(f => f.Id == portalFormId && f.PortalId == portalId);
        if (portalForm is null) return false;
        _db.PortalForms.Remove(portalForm);
        await _db.SaveChangesAsync();
        return true;
    }

    internal async Task<List<PortalFormDto>> ResolvePortalFormDtosAsync(List<PortalForm> portalForms)
    {
        if (portalForms.Count == 0) return new List<PortalFormDto>();
        var groupIds = portalForms.Select(f => f.FormGroupId).ToList();
        var published = await _db.Forms.AsNoTracking()
            .Where(f => groupIds.Contains(f.FormGroupId) && f.Status == "published")
            .ToDictionaryAsync(f => f.FormGroupId, f => f);

        return portalForms.Select(f =>
        {
            published.TryGetValue(f.FormGroupId, out var form);
            return new PortalFormDto(f.Id, f.FormGroupId, f.Order, form?.Name, form?.Status, form?.FieldsJson, form?.Id);
        }).ToList();
    }

    // ---- Q&A ----

    public async Task<List<PortalTopicDto>?> ListTopicsAsync(Guid organisationId, Guid portalId)
    {
        if (!await OwnsPortalAsync(organisationId, portalId)) return null;
        var topics = await _db.PortalTopics.AsNoTracking()
            .Where(t => t.PortalId == portalId)
            .OrderBy(t => t.Order)
            .ToListAsync();
        return topics.Select(t => new PortalTopicDto(t.Id, t.Title, t.Order)).ToList();
    }

    public async Task<PortalTopicDto?> CreateTopicAsync(Guid organisationId, Guid portalId, CreatePortalTopicRequest request)
    {
        if (!await OwnsPortalAsync(organisationId, portalId)) return null;
        var now = DateTime.UtcNow;
        var topic = new PortalTopic { Id = Guid.NewGuid(), PortalId = portalId, Title = request.Title.Trim(), Order = request.Order, DateCreated = now, DateLastModified = now };
        _db.PortalTopics.Add(topic);
        await _db.SaveChangesAsync();
        return new PortalTopicDto(topic.Id, topic.Title, topic.Order);
    }

    public async Task<PortalTopicDto?> UpdateTopicAsync(Guid organisationId, Guid portalId, Guid topicId, UpdatePortalTopicRequest request)
    {
        if (!await OwnsPortalAsync(organisationId, portalId)) return null;
        var topic = await _db.PortalTopics.FirstOrDefaultAsync(t => t.Id == topicId && t.PortalId == portalId);
        if (topic is null) return null;
        topic.Title = request.Title.Trim();
        topic.Order = request.Order;
        topic.DateLastModified = DateTime.UtcNow;
        await _db.SaveChangesAsync();
        return new PortalTopicDto(topic.Id, topic.Title, topic.Order);
    }

    public async Task<bool> DeleteTopicAsync(Guid organisationId, Guid portalId, Guid topicId)
    {
        if (!await OwnsPortalAsync(organisationId, portalId)) return false;
        var topic = await _db.PortalTopics.FirstOrDefaultAsync(t => t.Id == topicId && t.PortalId == portalId);
        if (topic is null) return false;
        _db.PortalTopics.Remove(topic);
        await _db.SaveChangesAsync();
        return true;
    }

    public async Task<List<PortalQaEntryDto>?> ListQaEntriesAsync(Guid organisationId, Guid portalId)
    {
        if (!await OwnsPortalAsync(organisationId, portalId)) return null;
        var entries = await _db.PortalQaEntries.AsNoTracking()
            .Where(e => e.PortalId == portalId)
            .OrderBy(e => e.Order)
            .ToListAsync();
        return entries.Select(e => new PortalQaEntryDto(e.Id, e.PortalTopicId, e.Question, e.Answer, e.Order)).ToList();
    }

    public async Task<PortalQaEntryDto?> CreateQaEntryAsync(Guid organisationId, Guid portalId, Guid callerUserId, CreatePortalQaEntryRequest request)
    {
        if (!await OwnsPortalAsync(organisationId, portalId)) return null;
        if (request.PortalTopicId is Guid topicId && !await _db.PortalTopics.AnyAsync(t => t.Id == topicId && t.PortalId == portalId))
        {
            return null;
        }

        var now = DateTime.UtcNow;
        var entry = new PortalQaEntry
        {
            Id = Guid.NewGuid(), PortalId = portalId, PortalTopicId = request.PortalTopicId,
            Question = request.Question.Trim(), Answer = request.Answer, Order = request.Order,
            CreatedByUserId = callerUserId, DateCreated = now, DateLastModified = now
        };
        _db.PortalQaEntries.Add(entry);
        await _db.SaveChangesAsync();
        return new PortalQaEntryDto(entry.Id, entry.PortalTopicId, entry.Question, entry.Answer, entry.Order);
    }

    public async Task<PortalQaEntryDto?> UpdateQaEntryAsync(Guid organisationId, Guid portalId, Guid entryId, UpdatePortalQaEntryRequest request)
    {
        if (!await OwnsPortalAsync(organisationId, portalId)) return null;
        var entry = await _db.PortalQaEntries.FirstOrDefaultAsync(e => e.Id == entryId && e.PortalId == portalId);
        if (entry is null) return null;
        if (request.PortalTopicId is Guid topicId && !await _db.PortalTopics.AnyAsync(t => t.Id == topicId && t.PortalId == portalId))
        {
            return null;
        }

        entry.Question = request.Question.Trim();
        entry.Answer = request.Answer;
        entry.PortalTopicId = request.PortalTopicId;
        entry.Order = request.Order;
        entry.DateLastModified = DateTime.UtcNow;
        await _db.SaveChangesAsync();
        return new PortalQaEntryDto(entry.Id, entry.PortalTopicId, entry.Question, entry.Answer, entry.Order);
    }

    public async Task<bool> DeleteQaEntryAsync(Guid organisationId, Guid portalId, Guid entryId)
    {
        if (!await OwnsPortalAsync(organisationId, portalId)) return false;
        var entry = await _db.PortalQaEntries.FirstOrDefaultAsync(e => e.Id == entryId && e.PortalId == portalId);
        if (entry is null) return false;
        _db.PortalQaEntries.Remove(entry);
        await _db.SaveChangesAsync();
        return true;
    }

    private Task<bool> OwnsPortalAsync(Guid organisationId, Guid portalId) =>
        _db.Portals.AsNoTracking().AnyAsync(p => p.Id == portalId && p.OrganisationId == organisationId);

    private static PortalDto ToDto(Portal p) => new(p.Id, p.Name, p.Slug, p.Description, p.Status, p.ProjectId, p.DateCreated, p.DateLastModified, p.PublishedAt);
}
