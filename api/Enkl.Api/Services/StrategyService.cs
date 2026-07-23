using Enkl.Api.Data;
using Enkl.Api.Domain.Entities;
using Enkl.Api.Dtos;
using Microsoft.EntityFrameworkCore;

namespace Enkl.Api.Services;

/// <summary>
/// Strategy CRUD + activate — every method takes organisationId first and filters by it, same
/// cross-org-isolation discipline as PortfolioCategoryService. Activating a Strategy is the one
/// place IsActive is ever written (root CLAUDE.md §7's "one endpoint owns the flag" rule) — flips
/// every other Strategy in the same org to false in the same DB round-trip.
/// </summary>
public class StrategyService
{
    private readonly AppDbContext _db;

    public StrategyService(AppDbContext db)
    {
        _db = db;
    }

    public async Task<List<StrategyDto>> ListAsync(Guid organisationId)
    {
        return await _db.Strategies.AsNoTracking()
            .Where(s => s.OrganisationId == organisationId)
            .OrderBy(s => s.SortOrder)
            .Select(s => new StrategyDto(s.Id, s.Name, s.IsActive, s.SortOrder, s.DateCreated))
            .ToListAsync();
    }

    public async Task<StrategyDto?> GetActiveAsync(Guid organisationId)
    {
        return await _db.Strategies.AsNoTracking()
            .Where(s => s.OrganisationId == organisationId && s.IsActive)
            .Select(s => new StrategyDto(s.Id, s.Name, s.IsActive, s.SortOrder, s.DateCreated))
            .FirstOrDefaultAsync();
    }

    public async Task<StrategyDto> CreateAsync(Guid organisationId, CreateStrategyRequest request)
    {
        var name = (request.Name ?? "").Trim();
        if (name.Length == 0) name = "Untitled Strategy";
        if (name.Length > 150) name = name[..150];

        var maxSortOrder = await _db.Strategies.Where(s => s.OrganisationId == organisationId)
            .Select(s => (int?)s.SortOrder).MaxAsync() ?? -1;

        var strategy = new Strategy
        {
            Id = Guid.NewGuid(),
            OrganisationId = organisationId,
            Name = name,
            IsActive = false,
            SortOrder = maxSortOrder + 1,
            DateCreated = DateTime.UtcNow
        };
        _db.Strategies.Add(strategy);
        await _db.SaveChangesAsync();
        return new StrategyDto(strategy.Id, strategy.Name, strategy.IsActive, strategy.SortOrder, strategy.DateCreated);
    }

    public async Task<StrategyDto?> UpdateAsync(Guid organisationId, Guid strategyId, UpdateStrategyRequest request)
    {
        var strategy = await _db.Strategies.FirstOrDefaultAsync(s => s.Id == strategyId && s.OrganisationId == organisationId);
        if (strategy is null) return null;

        var name = (request.Name ?? "").Trim();
        if (name.Length == 0) return null;
        if (name.Length > 150) name = name[..150];

        strategy.Name = name;
        await _db.SaveChangesAsync();
        return new StrategyDto(strategy.Id, strategy.Name, strategy.IsActive, strategy.SortOrder, strategy.DateCreated);
    }

    /// <summary>The only place IsActive is ever written — flips every other Strategy in this org to
    /// false first, then activates the requested one, in one transaction so a caller never observes
    /// (or a crash mid-way never leaves) zero or two active Strategies at once.</summary>
    public async Task<StrategyDto?> ActivateAsync(Guid organisationId, Guid strategyId)
    {
        var strategy = await _db.Strategies.FirstOrDefaultAsync(s => s.Id == strategyId && s.OrganisationId == organisationId);
        if (strategy is null) return null;

        await using var tx = await _db.Database.BeginTransactionAsync();
        var others = await _db.Strategies.Where(s => s.OrganisationId == organisationId && s.Id != strategyId && s.IsActive).ToListAsync();
        foreach (var other in others) other.IsActive = false;
        strategy.IsActive = true;
        await _db.SaveChangesAsync();
        await tx.CommitAsync();

        return new StrategyDto(strategy.Id, strategy.Name, strategy.IsActive, strategy.SortOrder, strategy.DateCreated);
    }

    /// <summary>Deletion is deliberate and confirmed with the user — cascades every Pillar/Enabler/
    /// Metric/MetricEntry/ProjectPillarFulfilment row that hung off this Strategy. Not routine
    /// housekeeping (the whole point of multiple named Strategies is preserving history), but not
    /// forbidden either — for cleaning up an abandoned draft or a genuine mistake.</summary>
    public async Task<bool> DeleteAsync(Guid organisationId, Guid strategyId)
    {
        var strategy = await _db.Strategies.FirstOrDefaultAsync(s => s.Id == strategyId && s.OrganisationId == organisationId);
        if (strategy is null) return false;

        _db.Strategies.Remove(strategy);
        await _db.SaveChangesAsync();
        return true;
    }
}
