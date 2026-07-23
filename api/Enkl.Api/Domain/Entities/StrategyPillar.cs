namespace Enkl.Api.Domain.Entities;

/// <summary>
/// A fully custom, Org-Admin-defined strategic pillar belonging to one Strategy (e.g. "Customer
/// Trust", "Operational Excellence") — deliberately free-text, no fixed Balanced-Scorecard taxonomy.
/// SortOrder drives both list display and radar-chart axis ordering (views/strategy-radar.js).
/// </summary>
public class StrategyPillar
{
    public Guid Id { get; set; }
    public Guid StrategyId { get; set; }
    public Strategy Strategy { get; set; } = null!;
    public string Name { get; set; } = "";
    public string? Description { get; set; }
    public int SortOrder { get; set; }
}
