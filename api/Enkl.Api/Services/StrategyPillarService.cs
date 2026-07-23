using Enkl.Api.Data;
using Enkl.Api.Domain.Entities;
using Enkl.Api.Dtos;
using Microsoft.EntityFrameworkCore;

namespace Enkl.Api.Services;

/// <summary>
/// Pillar + Enabler CRUD combined in one service — Enabler is a trivial child of Pillar, split
/// further only if this file gets large (same don't-over-split judgment as PortfolioCategoryService/
/// PortfolioResourceService's own split, root CLAUDE.md's api-tier remediation notes). Every method
/// re-validates ownership up the chain (Pillar -> Strategy -> Organisation, Enabler -> Pillar ->
/// Strategy -> Organisation) before touching anything — same "second FK gets its own re-validation"
/// discipline as PortfolioService.UpdateProjectCategoryAsync.
/// </summary>
public class StrategyPillarService
{
    private readonly AppDbContext _db;

    public StrategyPillarService(AppDbContext db)
    {
        _db = db;
    }

    private Task<bool> StrategyBelongsToOrgAsync(Guid organisationId, Guid strategyId) =>
        _db.Strategies.AnyAsync(s => s.Id == strategyId && s.OrganisationId == organisationId);

    private async Task<StrategyPillar?> GetOwnedPillarAsync(Guid organisationId, Guid pillarId)
    {
        return await _db.StrategyPillars
            .Include(p => p.Strategy)
            .FirstOrDefaultAsync(p => p.Id == pillarId && p.Strategy.OrganisationId == organisationId);
    }

    private async Task<StrategyEnabler?> GetOwnedEnablerAsync(Guid organisationId, Guid enablerId)
    {
        return await _db.StrategyEnablers
            .Include(e => e.Pillar).ThenInclude(p => p.Strategy)
            .FirstOrDefaultAsync(e => e.Id == enablerId && e.Pillar.Strategy.OrganisationId == organisationId);
    }

    // ---- Pillars ----

    public async Task<StrategyPillarDto?> CreatePillarAsync(Guid organisationId, Guid strategyId, CreateStrategyPillarRequest request)
    {
        if (!await StrategyBelongsToOrgAsync(organisationId, strategyId)) return null;

        var name = (request.Name ?? "").Trim();
        if (name.Length == 0) return null;
        if (name.Length > 150) name = name[..150];

        var maxSortOrder = await _db.StrategyPillars.Where(p => p.StrategyId == strategyId)
            .Select(p => (int?)p.SortOrder).MaxAsync() ?? -1;

        var pillar = new StrategyPillar
        {
            Id = Guid.NewGuid(),
            StrategyId = strategyId,
            Name = name,
            Description = string.IsNullOrWhiteSpace(request.Description) ? null : request.Description!.Trim(),
            SortOrder = maxSortOrder + 1
        };
        _db.StrategyPillars.Add(pillar);
        await _db.SaveChangesAsync();
        return ToDto(pillar);
    }

    public async Task<StrategyPillarDto?> UpdatePillarAsync(Guid organisationId, Guid pillarId, UpdateStrategyPillarRequest request)
    {
        var pillar = await GetOwnedPillarAsync(organisationId, pillarId);
        if (pillar is null) return null;

        var name = (request.Name ?? "").Trim();
        if (name.Length == 0) return null;
        if (name.Length > 150) name = name[..150];

        pillar.Name = name;
        pillar.Description = string.IsNullOrWhiteSpace(request.Description) ? null : request.Description!.Trim();
        pillar.SortOrder = request.SortOrder;
        await _db.SaveChangesAsync();
        return ToDto(pillar);
    }

    public async Task<bool> DeletePillarAsync(Guid organisationId, Guid pillarId)
    {
        var pillar = await GetOwnedPillarAsync(organisationId, pillarId);
        if (pillar is null) return false;

        _db.StrategyPillars.Remove(pillar);
        await _db.SaveChangesAsync();
        return true;
    }

    // ---- Enablers ----

    public async Task<StrategyEnablerDto?> CreateEnablerAsync(Guid organisationId, Guid pillarId, CreateStrategyEnablerRequest request)
    {
        var pillar = await GetOwnedPillarAsync(organisationId, pillarId);
        if (pillar is null) return null;

        var name = (request.Name ?? "").Trim();
        if (name.Length == 0) return null;
        if (name.Length > 150) name = name[..150];

        var maxSortOrder = await _db.StrategyEnablers.Where(e => e.PillarId == pillarId)
            .Select(e => (int?)e.SortOrder).MaxAsync() ?? -1;

        var enabler = new StrategyEnabler
        {
            Id = Guid.NewGuid(),
            PillarId = pillarId,
            Name = name,
            Description = string.IsNullOrWhiteSpace(request.Description) ? null : request.Description!.Trim(),
            SortOrder = maxSortOrder + 1
        };
        _db.StrategyEnablers.Add(enabler);
        await _db.SaveChangesAsync();
        return ToDto(enabler);
    }

    public async Task<StrategyEnablerDto?> UpdateEnablerAsync(Guid organisationId, Guid enablerId, UpdateStrategyEnablerRequest request)
    {
        var enabler = await GetOwnedEnablerAsync(organisationId, enablerId);
        if (enabler is null) return null;

        var name = (request.Name ?? "").Trim();
        if (name.Length == 0) return null;
        if (name.Length > 150) name = name[..150];

        enabler.Name = name;
        enabler.Description = string.IsNullOrWhiteSpace(request.Description) ? null : request.Description!.Trim();
        enabler.SortOrder = request.SortOrder;
        await _db.SaveChangesAsync();
        return ToDto(enabler);
    }

    public async Task<bool> DeleteEnablerAsync(Guid organisationId, Guid enablerId)
    {
        var enabler = await GetOwnedEnablerAsync(organisationId, enablerId);
        if (enabler is null) return false;

        _db.StrategyEnablers.Remove(enabler);
        await _db.SaveChangesAsync();
        return true;
    }

    // ---- Tree read (Pillars -> Enablers -> Metrics, plus Metrics directly on a Pillar) ----
    // Shared by StrategyController (OrgAdmin) and ProjectStrategyController (ProjectMember, read-only)
    // — same shape both callers need, queried directly here rather than round-tripping through
    // StrategyMetricService, same "a service freely queries another entity's table when it needs to
    // assemble one composite read" convention as PortfolioResourceService.GetResourcingSummaryAsync.

    public async Task<List<StrategyPillarTreeDto>> GetPillarTreeAsync(Guid strategyId)
    {
        var pillars = await _db.StrategyPillars.AsNoTracking()
            .Where(p => p.StrategyId == strategyId)
            .OrderBy(p => p.SortOrder)
            .ToListAsync();
        var pillarIds = pillars.Select(p => p.Id).ToList();

        var enablers = await _db.StrategyEnablers.AsNoTracking()
            .Where(e => pillarIds.Contains(e.PillarId))
            .OrderBy(e => e.SortOrder)
            .ToListAsync();
        var enablerIds = enablers.Select(e => e.Id).ToList();

        var metrics = await _db.StrategyMetrics.AsNoTracking()
            .Where(m => (m.PillarId != null && pillarIds.Contains(m.PillarId.Value)) || (m.EnablerId != null && enablerIds.Contains(m.EnablerId.Value)))
            .OrderBy(m => m.SortOrder)
            .ToListAsync();

        List<StrategyMetricDto> MetricsFor(Func<StrategyMetric, bool> predicate) =>
            metrics.Where(predicate).Select(m => new StrategyMetricDto(m.Id, m.PillarId, m.EnablerId, m.Name, m.TargetValue, m.UnitLabel, m.SortOrder)).ToList();

        return pillars.Select(p => new StrategyPillarTreeDto(
            p.Id, p.Name, p.Description, p.SortOrder,
            MetricsFor(m => m.PillarId == p.Id),
            enablers.Where(e => e.PillarId == p.Id).Select(e => new StrategyEnablerTreeDto(
                e.Id, e.Name, e.Description, e.SortOrder,
                MetricsFor(m => m.EnablerId == e.Id)
            )).ToList()
        )).ToList();
    }

    /// <summary>ProjectMember-readable variant of GetPillarTreeAsync — resolves the project's own
    /// org, then that org's active Strategy, then the tree; used by ProjectStrategyController where
    /// the caller has no strategyId of their own to supply. Null means either the project doesn't
    /// exist or the org has no active Strategy yet (both collapse to the same "nothing to show"
    /// response, no enumeration oracle needed here since this is a read-only, non-sensitive surface).</summary>
    public async Task<List<StrategyPillarTreeDto>?> GetActivePillarTreeForProjectAsync(Guid projectId)
    {
        var organisationId = await _db.Projects.Where(p => p.Id == projectId).Select(p => (Guid?)p.OrganisationId).FirstOrDefaultAsync();
        if (organisationId is null) return null;

        var activeStrategyId = await _db.Strategies
            .Where(s => s.OrganisationId == organisationId && s.IsActive)
            .Select(s => (Guid?)s.Id).FirstOrDefaultAsync();
        if (activeStrategyId is null) return null;

        return await GetPillarTreeAsync(activeStrategyId.Value);
    }

    private static StrategyPillarDto ToDto(StrategyPillar p) => new(p.Id, p.StrategyId, p.Name, p.Description, p.SortOrder);
    private static StrategyEnablerDto ToDto(StrategyEnabler e) => new(e.Id, e.PillarId, e.Name, e.Description, e.SortOrder);
}
