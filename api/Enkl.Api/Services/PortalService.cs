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
    // Provisioned right after the 5 priority columns (Order 5-7) — status-tracking columns for the
    // actioner Project's own lifecycle, not priority-named, so they never collide with
    // ExecuteActionNodeAsync's priority-field-driven column matching (which only ever matches
    // against the 5 known priority keys). "Completed"/"Abandoned" are both terminal (Done = true) so
    // a task landing in either drops off the active board same as any other Done column; "On Hold"
    // stays Done = false — a paused task is still active work, just not currently being worked.
    private static readonly (string Name, bool Done)[] LifecycleColumns =
    {
        ("On Hold", false), ("Completed", true), ("Abandoned", true)
    };
    // Must match MemberService.MemberPalette[0]/ProjectService.FirstMemberColor — same convention,
    // just applied to every Org Admin at once instead of a single creator.
    private static readonly string[] MemberPalette =
    {
        "#0052CC", "#00875A", "#DE350B", "#5243AA", "#FF8B00", "#0065FF", "#008DA6", "#6B778C"
    };

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
    /// left-to-right via Column.Order) followed by 3 fixed lifecycle columns (On Hold, Completed,
    /// Abandoned — see LifecycleColumns' own doc comment), then the Portal row referencing it. PortfolioService.CreateProjectAsync
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
        for (var i = 0; i < LifecycleColumns.Length; i++)
        {
            var (columnName, done) = LifecycleColumns[i];
            _db.Columns.Add(new Column { Id = Guid.NewGuid(), ProjectId = project.Id, Name = columnName, Done = done, Order = PriorityColumnNames.Length + i });
        }

        // Every current Org Admin is auto-added as a Project Admin of the actioner Project — it's
        // membership-free by design (no ordinary org user should have to "join" it just to submit a
        // form through the Portal), but SOMEONE has to be able to open it, manage which analysts/
        // consultants can action raised tasks, and review/approve form submissions that land there.
        // Org Admins are the only role guaranteed to exist and be trustworthy for that at creation
        // time; a Portal's own Access grants govern who can use the Portal, this governs who can
        // administer its back-office project.
        var orgAdmins = await _db.Users.AsNoTracking()
            .Where(u => u.OrganisationId == organisationId && u.IsOrgAdmin)
            .Select(u => u.Id)
            .ToListAsync();
        for (var i = 0; i < orgAdmins.Count; i++)
        {
            _db.ProjectMembers.Add(new ProjectMember
            {
                Id = Guid.NewGuid(), ProjectId = project.Id, UserId = orgAdmins[i],
                Color = MemberPalette[i % MemberPalette.Length], IsProjectAdmin = true
            });
        }

        var now = DateTime.UtcNow;
        var portal = new Portal
        {
            Id = Guid.NewGuid(),
            OrganisationId = organisationId,
            Name = name,
            Slug = uniqueSlug,
            Description = request.Description,
            IconName = request.IconName,
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
        portal.IconName = request.IconName;
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
            // No specific target to validate — every current and future member of the caller's own
            // org is the target, by definition. The client-supplied Value is irrelevant/ignored;
            // Value is instead forced to organisationId itself below so there's exactly one
            // deterministic row per Portal (the existing PortalId+Kind+Value unique index still
            // dedupes it) rather than depending on whatever placeholder Guid the client happened to
            // send.
            "allOrgMembers" => true,
            _ => false
        };
        if (!targetValid) return null;

        var effectiveValue = request.Kind == "allOrgMembers" ? organisationId : request.Value;

        var existing = await _db.PortalAccessGrants
            .FirstOrDefaultAsync(g => g.PortalId == portalId && g.Kind == request.Kind && g.Value == effectiveValue);
        if (existing is not null) return new PortalAccessGrantDto(existing.Id, existing.Kind, existing.Value, existing.DateCreated);

        var grant = new PortalAccessGrant
        {
            Id = Guid.NewGuid(),
            PortalId = portalId,
            Kind = request.Kind,
            Value = effectiveValue,
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
        return entries.Select(ToQaEntryDto).ToList();
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
        return ToQaEntryDto(entry);
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
        return ToQaEntryDto(entry);
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

    /// <summary>Moves a Topic up/down among all of a Portal's own topics. Renumbers every sibling to
    /// a clean 0..n-1 sequence (ordered by current Order then DateCreated as a stable tiebreaker)
    /// before swapping the target with its neighbor — new topics/entries are always created with
    /// Order=0 (see CreateTopicAsync/CreateQaEntryAsync above, unchanged by this feature), so a plain
    /// swap of raw Order values would silently no-op the first time two siblings share a value. This
    /// self-heals that every time, regardless of how the data got here. Returns false for "doesn't
    /// belong to caller's org", "topic not found", or "already at that edge" alike — the frontend
    /// already disables the button at the edges, so this is just a safety no-op, not a user-facing
    /// error path. A Topic's own QaEntries are untouched by this — they stay tagged to this topic via
    /// PortalTopicId regardless of the topic's Order, so they visually move WITH their topic for free
    /// once the frontend groups entries under topics in topic-Order sequence.</summary>
    public async Task<bool> ReorderTopicAsync(Guid organisationId, Guid portalId, Guid topicId, string direction)
    {
        if (!await OwnsPortalAsync(organisationId, portalId)) return false;
        var topics = await _db.PortalTopics
            .Where(t => t.PortalId == portalId)
            .OrderBy(t => t.Order).ThenBy(t => t.DateCreated)
            .ToListAsync();
        return await ApplyReorder(topics, t => t.Id, topicId, direction, (t, order) => t.Order = order);
    }

    /// <summary>Moves a Q&amp;A entry up/down among its own siblings only — same PortalTopicId
    /// (including the ungrouped/null bucket) — matching how the admin Q&amp;A tab groups entries under
    /// topic headers; an entry never reorders across topics this way (moving it to a different topic
    /// is what Update's own PortalTopicId field is for). Same renumber-then-swap self-healing as
    /// ReorderTopicAsync above, and the same "false at either edge" no-op semantics.</summary>
    public async Task<bool> ReorderQaEntryAsync(Guid organisationId, Guid portalId, Guid entryId, string direction)
    {
        if (!await OwnsPortalAsync(organisationId, portalId)) return false;
        var entry = await _db.PortalQaEntries.AsNoTracking()
            .FirstOrDefaultAsync(e => e.Id == entryId && e.PortalId == portalId);
        if (entry is null) return false;

        var siblings = await _db.PortalQaEntries
            .Where(e => e.PortalId == portalId && e.PortalTopicId == entry.PortalTopicId)
            .OrderBy(e => e.Order).ThenBy(e => e.DateCreated)
            .ToListAsync();
        return await ApplyReorder(siblings, e => e.Id, entryId, direction, (e, order) => e.Order = order);
    }

    /// <summary>Shared swap-with-neighbor logic for both Reorder methods above — `items` must already
    /// be sorted in the caller's intended current order. Renumbers every item to 0..n-1 first (so
    /// stale/duplicate Order values from before this feature existed self-heal), then swaps the
    /// target with its "up"/"down" neighbor. Returns false without saving anything if the target
    /// isn't found or is already at the edge in that direction.</summary>
    private async Task<bool> ApplyReorder<T>(List<T> items, Func<T, Guid> getId, Guid targetId, string direction, Action<T, int> setOrder)
    {
        var index = items.FindIndex(i => getId(i) == targetId);
        if (index == -1) return false;

        var swapIndex = direction == "up" ? index - 1 : index + 1;
        if (swapIndex < 0 || swapIndex >= items.Count) return false;

        for (var i = 0; i < items.Count; i++) setOrder(items[i], i);
        (items[index], items[swapIndex]) = (items[swapIndex], items[index]);
        setOrder(items[swapIndex], swapIndex);
        setOrder(items[index], index);

        await _db.SaveChangesAsync();
        return true;
    }

    private Task<bool> OwnsPortalAsync(Guid organisationId, Guid portalId) =>
        _db.Portals.AsNoTracking().AnyAsync(p => p.Id == portalId && p.OrganisationId == organisationId);

    private static PortalDto ToDto(Portal p) => new(p.Id, p.Name, p.Slug, p.Description, p.IconName, p.Status, p.ProjectId, p.DateCreated, p.DateLastModified, p.PublishedAt);
    private static PortalQaEntryDto ToQaEntryDto(PortalQaEntry e) => new(e.Id, e.PortalTopicId, e.Question, e.Answer, e.Order, e.Nps);
}
