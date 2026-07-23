using Enkl.Api.Data;
using Enkl.Api.Domain.Entities;
using Enkl.Api.Dtos;
using Microsoft.EntityFrameworkCore;

namespace Enkl.Api.Services;

/// <summary>
/// ProjectPillarFulfilment upsert (called from Portfolio Planner's per-project Strategy modal) and the
/// fulfilment-matrix read that feeds all three radar views (per-project, portfolio-aggregate,
/// multi-project overlay). Kept separate from StrategyService/StrategyPillarService/StrategyMetricService
/// since its access pattern (ProjectMember-readable, not just OrgAdmin) differs — see
/// ProjectStrategyController's use of BuildMatrixAsync scoped to exactly one project.
/// </summary>
public class StrategyFulfilmentService
{
    private readonly AppDbContext _db;

    public StrategyFulfilmentService(AppDbContext db)
    {
        _db = db;
    }

    /// <summary>Find-or-create upsert for one (Project, Pillar) pair. Both ids are independently
    /// re-validated against the caller's org — a legitimate own-org project paired with another org's
    /// pillar id must fail closed (root CLAUDE.md §4's "second FK gets its own re-validation" rule),
    /// same discipline as PortfolioService.UpdateProjectCategoryAsync. Value is clamped 0-100, same
    /// convention as PortfolioResourceService.AddResourceAsync's AllocatedFraction clamp.</summary>
    public async Task<ProjectPillarFulfilmentDto?> UpsertAsync(Guid organisationId, Guid projectId, Guid pillarId, UpsertProjectPillarFulfilmentRequest request)
    {
        var projectExists = await _db.Projects.AnyAsync(p => p.Id == projectId && p.OrganisationId == organisationId);
        if (!projectExists) return null;

        var pillarExists = await _db.StrategyPillars.AnyAsync(p => p.Id == pillarId && p.Strategy.OrganisationId == organisationId);
        if (!pillarExists) return null;

        var clamped = Math.Clamp(request.FulfilmentPercent, 0, 100);

        var row = await _db.ProjectPillarFulfilments.FirstOrDefaultAsync(f => f.ProjectId == projectId && f.PillarId == pillarId);
        if (row is null)
        {
            row = new ProjectPillarFulfilment
            {
                Id = Guid.NewGuid(),
                ProjectId = projectId,
                PillarId = pillarId,
                FulfilmentPercent = clamped,
                DateLastModified = DateTime.UtcNow
            };
            _db.ProjectPillarFulfilments.Add(row);
        }
        else
        {
            row.FulfilmentPercent = clamped;
            row.DateLastModified = DateTime.UtcNow;
        }
        await _db.SaveChangesAsync();
        return new ProjectPillarFulfilmentDto(row.PillarId, row.FulfilmentPercent);
    }

    /// <summary>OrgAdmin matrix read across a client-supplied project-id list — re-derives which ids
    /// actually belong to the caller's org before touching anything (PortfolioService.ValidateProjectIdsAsync's
    /// exact discipline), so a foreign-org id is silently dropped rather than surfaced as an error. An
    /// empty/omitted list means "every project in the org."</summary>
    public async Task<StrategyFulfilmentMatrixDto> BuildMatrixAsync(Guid organisationId, List<Guid> requestedProjectIds)
    {
        var activeStrategy = await _db.Strategies.AsNoTracking()
            .Where(s => s.OrganisationId == organisationId && s.IsActive)
            .Select(s => new StrategyDto(s.Id, s.Name, s.IsActive, s.SortOrder, s.DateCreated))
            .FirstOrDefaultAsync();

        if (activeStrategy is null)
        {
            return new StrategyFulfilmentMatrixDto(null, new(), new(), new());
        }

        var pillars = await _db.StrategyPillars.AsNoTracking()
            .Where(p => p.StrategyId == activeStrategy.Id)
            .OrderBy(p => p.SortOrder)
            .Select(p => new StrategyPillarDto(p.Id, p.StrategyId, p.Name, p.Description, p.SortOrder))
            .ToListAsync();
        var pillarIds = pillars.Select(p => p.Id).ToList();

        var projectsQuery = _db.Projects.AsNoTracking().Where(p => p.OrganisationId == organisationId);
        if (requestedProjectIds.Count > 0)
        {
            projectsQuery = projectsQuery.Where(p => requestedProjectIds.Contains(p.Id));
        }
        var projects = await projectsQuery
            .Select(p => new { p.Id, p.Key, p.Name, p.IsActive })
            .ToListAsync();
        var projectIds = projects.Select(p => p.Id).ToList();

        var fulfilments = await _db.ProjectPillarFulfilments.AsNoTracking()
            .Where(f => projectIds.Contains(f.ProjectId) && pillarIds.Contains(f.PillarId))
            .ToListAsync();

        var projectDtos = projects.Select(p => new StrategyFulfilmentProjectDto(
            p.Id, p.Key, p.Name, p.IsActive,
            fulfilments.Where(f => f.ProjectId == p.Id).ToDictionary(f => f.PillarId, f => f.FulfilmentPercent)
        )).ToList();

        // Aggregate excludes projects with no value set for a given pillar — averaging only over
        // projects that actually have an opinion on that pillar, never counting an absence as 0
        // (confirmed with the user during planning).
        var aggregate = new Dictionary<Guid, double>();
        foreach (var pillarId in pillarIds)
        {
            var values = fulfilments.Where(f => f.PillarId == pillarId).Select(f => f.FulfilmentPercent).ToList();
            if (values.Count > 0) aggregate[pillarId] = values.Average();
        }

        return new StrategyFulfilmentMatrixDto(activeStrategy, pillars, projectDtos, aggregate);
    }

    /// <summary>Same shaped payload as BuildMatrixAsync, scoped to exactly one project — used by
    /// ProjectStrategyController's read-only surface. The caller (controller) has already verified
    /// project membership via ProjectMemberAuthorizationHandler; this only needs the project's
    /// OrganisationId to resolve the org's active Strategy.</summary>
    public async Task<StrategyFulfilmentMatrixDto?> BuildSingleProjectMatrixAsync(Guid projectId)
    {
        var project = await _db.Projects.AsNoTracking()
            .Where(p => p.Id == projectId)
            .Select(p => new { p.Id, p.OrganisationId, p.Key, p.Name, p.IsActive })
            .FirstOrDefaultAsync();
        if (project is null) return null;

        return await BuildMatrixAsync(project.OrganisationId, new List<Guid> { project.Id });
    }
}
