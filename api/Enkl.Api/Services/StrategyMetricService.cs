using Enkl.Api.Data;
using Enkl.Api.Domain.Entities;
using Enkl.Api.Dtos;
using Microsoft.EntityFrameworkCore;

namespace Enkl.Api.Services;

/// <summary>
/// Metric CRUD (enforcing the exactly-one-parent rule: exactly one of PillarId/EnablerId non-null,
/// app-layer only per root CLAUDE.md's no-CHECK-constraints convention) plus append-only
/// StrategyMetricEntry recording/history. Ownership re-validation always resolves back to
/// OrganisationId regardless of which parent the metric has.
/// </summary>
public class StrategyMetricService
{
    private readonly AppDbContext _db;

    public StrategyMetricService(AppDbContext db)
    {
        _db = db;
    }

    private async Task<Guid?> ResolvePillarOrgAsync(Guid pillarId) =>
        await _db.StrategyPillars.Where(p => p.Id == pillarId).Select(p => (Guid?)p.Strategy.OrganisationId).FirstOrDefaultAsync();

    private async Task<Guid?> ResolveEnablerOrgAsync(Guid enablerId) =>
        await _db.StrategyEnablers.Where(e => e.Id == enablerId).Select(e => (Guid?)e.Pillar.Strategy.OrganisationId).FirstOrDefaultAsync();

    private async Task<StrategyMetric?> GetOwnedMetricAsync(Guid organisationId, Guid metricId)
    {
        var metric = await _db.StrategyMetrics
            .Include(m => m.Pillar!).ThenInclude(p => p.Strategy)
            .Include(m => m.Enabler!).ThenInclude(e => e.Pillar).ThenInclude(p => p.Strategy)
            .FirstOrDefaultAsync(m => m.Id == metricId);
        if (metric is null) return null;

        var owningOrg = metric.PillarId != null ? metric.Pillar!.Strategy.OrganisationId : metric.Enabler!.Pillar.Strategy.OrganisationId;
        return owningOrg == organisationId ? metric : null;
    }

    public async Task<StrategyMetricDto?> CreateAsync(Guid organisationId, Guid? pillarId, Guid? enablerId, CreateStrategyMetricRequest request)
    {
        // Exactly one parent — never both, never neither.
        if ((pillarId is null) == (enablerId is null)) return null;

        if (pillarId is not null)
        {
            var org = await ResolvePillarOrgAsync(pillarId.Value);
            if (org != organisationId) return null;
        }
        else
        {
            var org = await ResolveEnablerOrgAsync(enablerId!.Value);
            if (org != organisationId) return null;
        }

        var name = (request.Name ?? "").Trim();
        if (name.Length == 0) return null;
        if (name.Length > 150) name = name[..150];

        var unitLabel = string.IsNullOrWhiteSpace(request.UnitLabel) ? null : request.UnitLabel!.Trim();
        if (unitLabel != null && unitLabel.Length > 20) unitLabel = unitLabel[..20];

        var maxSortOrder = await _db.StrategyMetrics
            .Where(m => pillarId != null ? m.PillarId == pillarId : m.EnablerId == enablerId)
            .Select(m => (int?)m.SortOrder).MaxAsync() ?? -1;

        var metric = new StrategyMetric
        {
            Id = Guid.NewGuid(),
            PillarId = pillarId,
            EnablerId = enablerId,
            Name = name,
            TargetValue = request.TargetValue,
            UnitLabel = unitLabel,
            SortOrder = maxSortOrder + 1
        };
        _db.StrategyMetrics.Add(metric);
        await _db.SaveChangesAsync();
        return ToDto(metric);
    }

    public async Task<StrategyMetricDto?> UpdateAsync(Guid organisationId, Guid metricId, UpdateStrategyMetricRequest request)
    {
        var metric = await GetOwnedMetricAsync(organisationId, metricId);
        if (metric is null) return null;

        var name = (request.Name ?? "").Trim();
        if (name.Length == 0) return null;
        if (name.Length > 150) name = name[..150];

        var unitLabel = string.IsNullOrWhiteSpace(request.UnitLabel) ? null : request.UnitLabel!.Trim();
        if (unitLabel != null && unitLabel.Length > 20) unitLabel = unitLabel[..20];

        metric.Name = name;
        metric.TargetValue = request.TargetValue;
        metric.UnitLabel = unitLabel;
        metric.SortOrder = request.SortOrder;
        await _db.SaveChangesAsync();
        return ToDto(metric);
    }

    public async Task<bool> DeleteAsync(Guid organisationId, Guid metricId)
    {
        var metric = await GetOwnedMetricAsync(organisationId, metricId);
        if (metric is null) return false;

        _db.StrategyMetrics.Remove(metric);
        await _db.SaveChangesAsync();
        return true;
    }

    // ---- Metric entries (append-only time series) ----

    public async Task<StrategyMetricEntryDto?> RecordEntryAsync(Guid organisationId, Guid metricId, CreateStrategyMetricEntryRequest request)
    {
        var metric = await GetOwnedMetricAsync(organisationId, metricId);
        if (metric is null) return null;

        var entry = new StrategyMetricEntry
        {
            Id = Guid.NewGuid(),
            MetricId = metricId,
            RecordedAt = DateTime.UtcNow,
            Value = request.Value,
            Note = string.IsNullOrWhiteSpace(request.Note) ? null : request.Note!.Trim()
        };
        _db.StrategyMetricEntries.Add(entry);
        await _db.SaveChangesAsync();
        return new StrategyMetricEntryDto(entry.Id, entry.MetricId, entry.RecordedAt, entry.Value, entry.Note);
    }

    public async Task<List<StrategyMetricEntryDto>?> GetHistoryAsync(Guid organisationId, Guid metricId)
    {
        var metric = await GetOwnedMetricAsync(organisationId, metricId);
        if (metric is null) return null;

        return await _db.StrategyMetricEntries.AsNoTracking()
            .Where(e => e.MetricId == metricId)
            .OrderBy(e => e.RecordedAt)
            .Select(e => new StrategyMetricEntryDto(e.Id, e.MetricId, e.RecordedAt, e.Value, e.Note))
            .ToListAsync();
    }

    /// <summary>ProjectMember-readable variant — resolves the project's own org first (the caller has
    /// no organisationId of their own, only a projectId ProjectMemberAuthorizationHandler already
    /// verified they belong to), then re-uses the same ownership-checked GetHistoryAsync so a metric
    /// from a different org can't be probed via this route either.</summary>
    public async Task<List<StrategyMetricEntryDto>?> GetHistoryForProjectAsync(Guid projectId, Guid metricId)
    {
        var organisationId = await _db.Projects.Where(p => p.Id == projectId).Select(p => (Guid?)p.OrganisationId).FirstOrDefaultAsync();
        if (organisationId is null) return null;
        return await GetHistoryAsync(organisationId.Value, metricId);
    }

    private static StrategyMetricDto ToDto(StrategyMetric m) => new(m.Id, m.PillarId, m.EnablerId, m.Name, m.TargetValue, m.UnitLabel, m.SortOrder);
}
