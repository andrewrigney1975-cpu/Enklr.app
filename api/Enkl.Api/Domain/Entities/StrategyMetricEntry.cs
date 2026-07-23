namespace Enkl.Api.Domain.Entities;

/// <summary>
/// One dated reading of a StrategyMetric's value — a genuinely new time-series concept for this app
/// (no existing precedent; the closest structural analog, PageLoadTiming, is deliberately anonymous
/// ops telemetry with no owning FK at all, semantically unrelated). Deliberately append-only from the
/// API's perspective (StrategyMetricService only ever POSTs a new entry, never PUTs an existing one)
/// — RecordedAt is always server-set (UtcNow), never client-supplied/backdated, so this stays an
/// honest log of when a reading was actually taken.
/// </summary>
public class StrategyMetricEntry
{
    public Guid Id { get; set; }
    public Guid MetricId { get; set; }
    public StrategyMetric Metric { get; set; } = null!;
    public DateTime RecordedAt { get; set; }
    public double Value { get; set; }
    public string? Note { get; set; }
}
