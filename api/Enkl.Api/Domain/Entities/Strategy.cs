namespace Enkl.Api.Domain.Entities;

/// <summary>
/// Organisation-scoped (like PortfolioCategory, not project-scoped) — an org can define several
/// Strategies over time (e.g. "FY26 Strategy", "FY27 Strategy"), exactly one of which is active at
/// once (enforced in StrategyService.ActivateAsync, not a DB constraint — see this tier's own "no
/// CHECK constraints" convention). Pillars/Enablers/Metrics/fulfilment all hang off a Strategy via
/// its Pillars, so switching which Strategy is active changes the whole feature's data without
/// deleting the inactive one's — deleting a Strategy (StrategyService.DeleteAsync) is a deliberate,
/// confirmed-with-user, cascading action, not routine housekeeping.
/// </summary>
public class Strategy
{
    public Guid Id { get; set; }
    public Guid OrganisationId { get; set; }
    public Organisation Organisation { get; set; } = null!;
    public string Name { get; set; } = "";
    public bool IsActive { get; set; }
    public int SortOrder { get; set; }
    public DateTime DateCreated { get; set; }
}
