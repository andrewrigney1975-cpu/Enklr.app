namespace Enkl.Api.Domain.Entities;

/// <summary>
/// A Project's 0-100% "fulfilment" of one Pillar — at most one row per (ProjectId, PillarId) pair,
/// upsert semantics (find-or-create in StrategyFulfilmentService), not a free-form multi-row list
/// like ProjectResourcePlaceholder. Edited only from inside the Portfolio Planner (a project's own
/// "Strategy" button) — works for both active and inactive/planned projects, same as every other
/// Portfolio Planner field. FulfilmentPercent is clamped 0-100 at write time, same convention as
/// ProjectResourcePlaceholder.AllocatedFraction.
/// </summary>
public class ProjectPillarFulfilment
{
    public Guid Id { get; set; }
    public Guid ProjectId { get; set; }
    public Project Project { get; set; } = null!;
    public Guid PillarId { get; set; }
    public StrategyPillar Pillar { get; set; } = null!;
    public int FulfilmentPercent { get; set; }
    public DateTime DateLastModified { get; set; }
}
