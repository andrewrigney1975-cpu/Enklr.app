namespace Enkl.Api.Dtos;

/// <summary>
/// Backs the Org-Admin-only Portfolio Dashboard (src/js/modals/portfolio-dashboard.js). See
/// Services/PortfolioService.cs's own doc comment for the cross-org isolation guarantee every one of
/// these relies on — none of this is ever populated from a project outside the caller's own
/// Organisation, regardless of what the client asked for.
/// </summary>
public record PortfolioProjectDto(Guid Id, string Name, string Key, DateOnly? StartDate, DateOnly? EndDate, string Priority, bool IsActive, Guid? CategoryId);

/// <summary>
/// Backs the Portfolio Planner's "Add Project" form — creates a placeholder Project with IsActive
/// false (see PortfolioService.CreateProjectAsync's doc comment for why this is its own lightweight
/// path rather than reusing ProjectService.CreateAsync).
/// </summary>
public record CreatePortfolioProjectRequest(string Name, string? Key, string? Priority, Guid? CategoryId, DateOnly? StartDate, DateOnly? EndDate);

/// <summary>
/// The only request shape that may ever set Project.IsActive — see
/// PortfolioService.UpdateProjectActiveAsync for the server-side date-completeness check this
/// triggers whenever IsActive is true.
/// </summary>
public record UpdatePortfolioProjectActiveRequest(bool IsActive);

public record UpdatePortfolioProjectCategoryRequest(Guid? CategoryId);

public record PortfolioCategoryDto(Guid Id, string Name, int SortOrder);
public record CreatePortfolioCategoryRequest(string Name);
public record UpdatePortfolioCategoryRequest(string Name);
public record UpdatePortfolioCategorySortOrderRequest(int SortOrder);

/// <summary>
/// Backs the Portfolio Dashboard's Timeline chart (click-to-edit modal + drag-to-schedule bars).
/// Deliberately narrower than UpdateProjectRequest (Name/Key untouched) — this is purely a
/// forward-planning date-scheduling action, not a general project-edit surface, so it stays scoped
/// to exactly what the Timeline chart lets an Org Admin change. Either field can be null to clear a
/// previously-set date (reverting that project back to the "no dates" hatched-bar state).
/// </summary>
public record UpdatePortfolioProjectDatesRequest(DateOnly? StartDate, DateOnly? EndDate);

/// <summary>
/// A purpose-built, narrower read shape than the existing RiskDto — the Portfolio Dashboard's risk
/// matrix doesn't need the Document/Principle/Objective cross-reference lists RiskDto carries, but
/// DOES need to know which selected project each risk came from (ProjectId/ProjectKey), for the
/// matrix's per-project legend/coloring — a tag RiskDto has no reason to carry everywhere else it's
/// used (a single-project response has no ambiguity to disambiguate).
/// </summary>
public record PortfolioRiskDto(
    Guid Id, string Key, string Title, string? Description, int Likelihood, int Impact, string? Mitigations,
    Guid? OwnerId, Guid? TaskId, string Status, DateOnly? DateToClose, DateOnly? DateClosed,
    Guid ProjectId, string ProjectKey);

/// <summary>
/// Shaped so the frontend can feed it straight into the SAME client-side health math the per-project
/// Health Dashboard already uses (computeOverallHealth/computeTopTeamMembers/buildRiskMatrixSvg,
/// features/health.js + mutations.js) — Members/Columns/Tasks/Releases/Risks/Decisions are exactly
/// what those functions read, merged across every validated project rather than duplicated per
/// entity type. Principle/Objective/Document/Retrospective counts are scalars, not full lists — the
/// summary boxes only ever need a count, so there's no reason to ship that row data to the browser.
/// StartDate/EndDate are the earliest-start/latest-end bounding range across the selected projects
/// (there's no single natural "start/end" for a multi-project merge) — feeds the same burndown-style
/// timeline-progress math a single project's own StartDate/EndDate would.
/// </summary>
public record PortfolioAggregateDto(
    List<MemberDto> Members,
    List<ColumnDto> Columns,
    List<TaskDto> Tasks,
    List<ReleaseDto> Releases,
    List<PortfolioRiskDto> Risks,
    List<DecisionDto> Decisions,
    DateOnly? StartDate,
    DateOnly? EndDate,
    int OrgUserCount,
    int PrincipleCount,
    int ObjectiveCount,
    int DocumentCount,
    int RetrospectiveCount);

/// <summary>
/// Draft resourcing (role + optional real person + allocated %) attached to a Portfolio Planner
/// placeholder project — see ProjectResourcePlaceholder's own doc comment. Role is free-text, not
/// constrained to ListDistinctRolesAsync's suggestions (that list only backs the frontend's
/// autocomplete). UserId/UserDisplayName are both null for an unfilled role.
/// </summary>
public record ProjectResourcePlaceholderDto(Guid Id, Guid ProjectId, string Role, Guid? UserId, string? UserDisplayName, int AllocatedFraction);
public record CreateProjectResourcePlaceholderRequest(string Role, Guid? UserId, int AllocatedFraction);
public record UpdateProjectResourcePlaceholderRequest(string Role, Guid? UserId, int AllocatedFraction);

/// <summary>
/// Backs the Portfolio Dashboard's Resourcing section — org-wide (NOT scoped to the dashboard's
/// selected-project picker, unlike every other DTO in this file), since placeholder resources only
/// ever exist on inactive projects and the picker deliberately excludes those (see
/// PortfolioService.GetResourcingSummaryAsync's doc comment for why this can't reuse
/// PortfolioAggregateDto's project-id-scoped shape).
/// </summary>
public record UnfilledPlaceholderDto(Guid Id, Guid ProjectId, string ProjectName, string ProjectKey, string Role, int AllocatedFraction);

/// <summary>
/// One org member's combined workload: RealAllocationTotal sums their ProjectMember.AllocatedFraction
/// across every real project they belong to; PlaceholderAllocationTotal sums every
/// ProjectResourcePlaceholder row assigned to them across every draft project. Neither total is
/// clamped to 100 — a sum over 100 IS the over-allocation signal this exists to surface.
/// </summary>
public record UserAllocationDto(Guid UserId, string DisplayName, int RealAllocationTotal, int PlaceholderAllocationTotal);

public record PortfolioResourcingSummaryDto(List<UnfilledPlaceholderDto> UnfilledRoles, List<UserAllocationDto> UserAllocations);

public record PortfolioActivityPointDto(DateOnly Date, int Count);

/// <summary>Daily counts only (mirrors vendor-portal's own /dashboard/activity shape) — day/week/
/// month/etc. bucketing happens client-side, reusing views/timeline.js's existing TIMESCALE_CONFIG.</summary>
public record PortfolioActivityDto(
    List<PortfolioActivityPointDto> Created,
    List<PortfolioActivityPointDto> Edited,
    List<PortfolioActivityPointDto> Done);
