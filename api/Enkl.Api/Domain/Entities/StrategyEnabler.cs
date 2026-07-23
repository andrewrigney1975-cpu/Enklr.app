namespace Enkl.Api.Domain.Entities;

/// <summary>
/// A supporting capability/initiative behind one Pillar (e.g. "Staff upskilling", "Cloud migration")
/// — descriptive only, deliberately has NO direct per-project fulfilment % of its own (only Pillars
/// do, via ProjectPillarFulfilment) — confirmed with the user. StrategyMetrics may attach to an
/// Enabler instead of a Pillar directly (see StrategyMetric's own doc comment).
/// </summary>
public class StrategyEnabler
{
    public Guid Id { get; set; }
    public Guid PillarId { get; set; }
    public StrategyPillar Pillar { get; set; } = null!;
    public string Name { get; set; } = "";
    public string? Description { get; set; }
    public int SortOrder { get; set; }
}
