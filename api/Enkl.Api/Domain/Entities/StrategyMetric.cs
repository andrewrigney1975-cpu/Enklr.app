namespace Enkl.Api.Domain.Entities;

/// <summary>
/// A tracked KPI belonging to EXACTLY ONE of PillarId/EnablerId — never both, never neither. This
/// invariant is enforced only in StrategyMetricService (create/update), never a DB CHECK constraint,
/// per this tier's standing "no CHECK constraints anywhere" convention (root CLAUDE.md §3) — both FKs
/// are nullable here for exactly that reason. Never re-parented after creation (treated as immutable
/// once created — the simplest option, avoids ever needing to reconcile "which list did this used to
/// belong to"). TargetValue/UnitLabel are both optional free-form display hints, not used in any
/// calculation. Actual tracked values live in StrategyMetricEntry (an append-only history), never on
/// this row itself.
/// </summary>
public class StrategyMetric
{
    public Guid Id { get; set; }
    public Guid? PillarId { get; set; }
    public StrategyPillar? Pillar { get; set; }
    public Guid? EnablerId { get; set; }
    public StrategyEnabler? Enabler { get; set; }
    public string Name { get; set; } = "";
    public double? TargetValue { get; set; }
    public string? UnitLabel { get; set; }
    public int SortOrder { get; set; }
}
