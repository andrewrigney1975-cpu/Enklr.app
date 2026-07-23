namespace Enkl.Api.Dtos;

public record StrategyDto(Guid Id, string Name, bool IsActive, int SortOrder, DateTime DateCreated);
public record CreateStrategyRequest(string Name);
public record UpdateStrategyRequest(string Name);

public record StrategyPillarDto(Guid Id, Guid StrategyId, string Name, string? Description, int SortOrder);
public record CreateStrategyPillarRequest(string Name, string? Description);
public record UpdateStrategyPillarRequest(string Name, string? Description, int SortOrder);

public record StrategyEnablerDto(Guid Id, Guid PillarId, string Name, string? Description, int SortOrder);
public record CreateStrategyEnablerRequest(string Name, string? Description);
public record UpdateStrategyEnablerRequest(string Name, string? Description, int SortOrder);

public record StrategyMetricDto(Guid Id, Guid? PillarId, Guid? EnablerId, string Name, double? TargetValue, string? UnitLabel, int SortOrder);
public record CreateStrategyMetricRequest(string Name, double? TargetValue, string? UnitLabel);
public record UpdateStrategyMetricRequest(string Name, double? TargetValue, string? UnitLabel, int SortOrder);

public record StrategyMetricEntryDto(Guid Id, Guid MetricId, DateTime RecordedAt, double Value, string? Note);
public record CreateStrategyMetricEntryRequest(double Value, string? Note);

/// <summary>The full definition tree for one Strategy — Pillars, each with its Enablers, each with
/// its own Metrics, plus Metrics attached directly to a Pillar. Used by both the OrgAdmin management
/// UI and the ProjectMember-readable view (same shape, see ProjectStrategyController).</summary>
public record StrategyPillarTreeDto(
    Guid Id, string Name, string? Description, int SortOrder,
    List<StrategyMetricDto> Metrics,
    List<StrategyEnablerTreeDto> Enablers);
public record StrategyEnablerTreeDto(
    Guid Id, string Name, string? Description, int SortOrder,
    List<StrategyMetricDto> Metrics);

public record UpsertProjectPillarFulfilmentRequest(int FulfilmentPercent);
public record ProjectPillarFulfilmentDto(Guid PillarId, int FulfilmentPercent);

/// <summary>Feeds all three radar views (per-project, portfolio-aggregate, multi-project overlay)
/// from one shape — see StrategyFulfilmentService.BuildMatrixAsync's own doc comment. The
/// ProjectMember-readable variant (ProjectStrategyController) returns this same shape with exactly
/// one Projects entry (no cross-project aggregate meaningfully different from that one project).</summary>
public record StrategyFulfilmentMatrixDto(
    StrategyDto? ActiveStrategy,
    List<StrategyPillarDto> Pillars,
    List<StrategyFulfilmentProjectDto> Projects,
    Dictionary<Guid, double> Aggregate);
public record StrategyFulfilmentProjectDto(
    Guid ProjectId, string ProjectKey, string ProjectName, bool IsActive,
    Dictionary<Guid, int> Fulfilment);
