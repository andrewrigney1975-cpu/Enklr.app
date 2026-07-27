using System.Text.Json;

namespace Enkl.Api.Dtos;

public record ProjectSummaryDto(Guid Id, string Name, string Key);
public record CreateProjectRequest(string Name, string Key, DateOnly? StartDate, DateOnly? EndDate, Guid? TemplateId = null, string? Description = null);
public record UpdateProjectRequest(string Name, string Key, DateOnly? StartDate, DateOnly? EndDate, string? Description = null);

/// <summary>NormalizedKey is whatever ProjectKeyResolver.DeriveKey actually turned the caller's raw
/// input into (trimmed, uppercased, length-capped) — the frontend's confirmation dialog and the
/// follow-up ChangeProjectKeyRequest should both use this value, not the raw input, so what the user
/// confirmed is exactly what gets persisted.</summary>
public record KeyAvailabilityDto(bool Available, string NormalizedKey);
public record ChangeProjectKeyRequest(string NewKey);

/// <summary>
/// Creating a project changes who the caller has access to — but membership is embedded in the JWT
/// at login time (see JwtTokenService), so the token that authenticated this very request doesn't
/// grant access to the project it just created. A fresh token (with the new project added to its
/// claims) rides along in the response so the frontend can swap it in immediately, exactly as if it
/// had just logged in again — see setToken() in api.js.
/// </summary>
public record CreateProjectResponseDto(ProjectDetailDto Project, string Token, DateTime TokenExpiresAt, string? Warning);

public record MemberDto(Guid Id, Guid UserId, string DisplayName, string? Email, string Color, string? Role, int? AllocatedFraction, Guid? ReportsToId, bool IsProjectAdmin, bool IsActive);
public record CreateMemberRequest(string Name, string? Email);
public record UpdateMemberRequest(string Name, string? Role, int? AllocatedFraction, Guid? ReportsToId);
public record SetProjectAdminRequest(bool IsProjectAdmin);

/// <summary>The "Add a team member" combobox's candidate list — every active User in the project's
/// own Organisation (not just ones already a ProjectMember here), so a person who's a member of a
/// different project in the same org still shows up and can be added to this one too. Frontend
/// excludes ids already in this project's own member list client-side (it already has that data from
/// the project-detail fetch) rather than this endpoint doing it server-side.</summary>
public record OrgUserCandidateDto(Guid Id, string DisplayName, string? Email);

public record ColumnDto(Guid Id, string Name, bool Done, string? Color, bool ColorBackground, int Order, int Cap);

public record TaskAuditLogEntryDto(Guid Id, DateTime Timestamp, string Field, string? OldValue, string? NewValue, string? ChangedBy);

/// <summary>AuthorName is the creation-time display-name snapshot (TaskComment.AuthorName) — always
/// present even if AuthorId later goes null (the member was removed). See TaskComment's own doc
/// comment.</summary>
public record TaskCommentDto(Guid Id, string Text, DateTime DateCreated, Guid? AuthorId, string AuthorName);
/// <summary>No AuthorId field — a comment's author is always derived server-side from the caller's
/// own ProjectMembers row, never accepted from the client (§4's standing "never trust the client's id
/// list" rule).</summary>
public record CreateTaskCommentRequest(string Text);
public record UpdateTaskCommentRequest(string Text);

public record TaskDto(
    Guid Id, string Key, string Title, string? Description, string Priority,
    Guid ColumnId, Guid? AssigneeId, Guid? ReleaseId, Guid? TypeId, Guid? ParentTaskId, string? DocumentationUrl,
    DateTime DateCreated, DateTime DateLastModified, DateTime? DateDone,
    DateOnly? StartDate, DateOnly? EndDate,
    int? BusinessValue, int? TaskCost, int Progress,
    decimal? EstimatedEffort, decimal? ActualEffort, bool Archived,
    List<Guid> DependsOnTaskIds, List<TaskAuditLogEntryDto> AuditLog, List<TaskCommentDto> Comments);

public record ReleaseDto(Guid Id, string Name, string Status, Guid? OwnerId, DateOnly? StartDate, DateOnly? EndDate, string? ReleaseNotes, string Color);
public record TaskTypeDto(Guid Id, string Name, string? IconName);
public record PrincipleDto(Guid Id, string Key, string Title, string? Description, string? DocumentUrl, bool IsOrganisationWide);
public record DocumentDto(Guid Id, string Key, string Title, string? Url, string? Description, Guid? OwnerId, Guid? TaskId, List<Guid> RelatedDocumentIds);
public record RiskDto(
    Guid Id, string Key, string Title, string? Description, int Likelihood, int Impact, string? Mitigations,
    Guid? OwnerId, Guid? TaskId, string Status, DateOnly? DateToClose, DateOnly? DateClosed,
    List<Guid> DocumentIds, List<Guid> PrincipleIds, List<Guid> ObjectiveIds);
public record ObjectiveDto(Guid Id, string Key, string Title, string? Description, List<Guid> PrincipleIds);
public record TeamCommitteeDto(Guid Id, string Key, string Name, string? Description, string Type, Guid? ParentId, List<Guid> MemberIds);
public record DecisionDto(
    Guid Id, string Key, string Title, string? Description, string Type, string Status, string? Outcome,
    Guid? OwnerId, string? Approver, Guid? TaskId,
    List<Guid> DocumentIds, List<Guid> RiskIds, List<Guid> PrincipleIds, List<Guid> ObjectiveIds);

/// <summary>A saved Advanced Query SQL snippet (features/query-engine.js) — shared across every
/// member of the project, same as any other project-scoped entity. No display key/counter scheme
/// (unlike Risk's KEY-RISK-001) — Name is the human identifier.</summary>
public record SavedQueryDto(Guid Id, string Name, string Sql, DateTime DateCreated, bool ExposeViaApi);

/// <summary>Self-Service Dashboard (Project Admin-authored, feature-flag gated) — deliberately NOT
/// part of ProjectDetailDto (see Domain/Entities/Dashboard.cs's own doc comment): fetched via its
/// own dedicated Controllers/DashboardsController.cs endpoints instead, so an ordinary project load
/// never pays for widget-heavy dashboard content most projects won't have opted into.</summary>
public record DashboardWidgetDto(
    Guid Id, string WidgetType, string Title, Guid? SavedQueryId, string Width, int SortOrder,
    string? ConfigJson);

/// <summary>Widgets carries the same lightweight per-widget shape as DashboardDetailDto's own list
/// (type/width/sortOrder/configJson, no SavedQuery execution involved) so the Dashboards picker's
/// tiles (modals/dashboards.js's buildDashboardTilePreviewSvg) can draw a layout-accurate SVG preview
/// — full/half/third/twoThird widget areas plus a per-type/sub-type icon — without a second request
/// per tile to fetch the full DashboardDetailDto.</summary>
public record DashboardListItemDto(
    Guid Id, string Name, string? Description, int WidgetCount, DateTime DateLastModified,
    List<DashboardWidgetDto> Widgets);

public record DashboardDetailDto(
    Guid Id, string Name, string? Description, DateTime DateCreated, DateTime DateLastModified,
    List<DashboardWidgetDto> Widgets);

public record CreateDashboardRequest(string Name, string? Description);

public record CreateDashboardWidgetRequest(
    string WidgetType, string Title, Guid? SavedQueryId, string Width, int SortOrder, string? ConfigJson);

/// <summary>Cross-project row for the Org-Admin "browse every Dashboard in the org" picker
/// (Controllers/OrgDashboardsController.cs) — same Portfolio-pattern shape as
/// PortfolioService.ListProjectsAsync's own DTOs carrying enough project context for a picker UI
/// that spans projects. Widgets — see DashboardListItemDto's own doc comment; same tile-preview use.</summary>
public record OrgDashboardListItemDto(
    Guid Id, string Name, string? Description, int WidgetCount, DateTime DateLastModified,
    Guid ProjectId, string ProjectName, string ProjectKey, List<DashboardWidgetDto> Widgets);

public record ProjectDetailDto(
    Guid Id, string Name, string Key, Guid OrganisationId,
    List<MemberDto> Members, List<ColumnDto> Columns, List<TaskDto> Tasks,
    List<ReleaseDto> Releases, List<TaskTypeDto> TaskTypes, List<PrincipleDto> Principles,
    List<DocumentDto> Documents, List<RiskDto> Risks, List<ObjectiveDto> Objectives,
    List<TeamCommitteeDto> TeamsCommittees, List<DecisionDto> Decisions,
    List<RetrospectiveDto> Retrospectives, List<SavedQueryDto> SavedQueries,
    ProjectSettingsDto HeaderButtonVisibility, JsonElement? Workflow,
    DateOnly? StartDate, DateOnly? EndDate, string? Description);

/// <summary>
/// The 11 opt-in/opt-out feature-flag booleans shown in the "App Settings" modal
/// (normalizeHeaderButtonVisibility in src/js/storage.js) — persisted as
/// Project.HeaderButtonVisibilityJson. Property names are serialized camelCase (see
/// ProjectSettingsSerializer) so they line up exactly with the client's own field names, and with
/// the "changeAuditing" key TaskService.IsChangeAuditingEnabledAsync already reads from that same
/// column.
/// </summary>
public record ProjectSettingsDto(
    bool Documents, bool Risks, bool Decisions, bool Health, bool Principles, bool Objectives,
    bool TeamsCommittees, bool Workflow, bool TimeTracking, bool ChangeAuditing, bool SubTasks,
    bool Retrospective, bool Strategy, bool Dashboards);

public record CreateColumnRequest(string Name, bool Done, string? Color, bool ColorBackground = true);
public record UpdateColumnRequest(string Name, bool Done, string? Color, bool ColorBackground, int Order, int Cap);

public record CreateTaskRequest(
    string Title, string? Description, string Priority, Guid ColumnId, Guid? AssigneeId,
    Guid? ReleaseId, Guid? TypeId, Guid? ParentTaskId, List<Guid>? DependsOnTaskIds,
    string? DocumentationUrl = null, DateOnly? StartDate = null, DateOnly? EndDate = null,
    int? BusinessValue = null, int? TaskCost = null, int Progress = 0,
    decimal? EstimatedEffort = null, decimal? ActualEffort = null, bool Archived = false);
public record UpdateTaskRequest(
    string Title, string? Description, string Priority, Guid ColumnId, Guid? AssigneeId,
    Guid? ReleaseId, Guid? TypeId, Guid? ParentTaskId, List<Guid>? DependsOnTaskIds,
    string? DocumentationUrl, DateOnly? StartDate, DateOnly? EndDate,
    int? BusinessValue, int? TaskCost, int Progress,
    decimal? EstimatedEffort, decimal? ActualEffort, bool Archived);

public record CreateReleaseRequest(string Name, string Status, Guid? OwnerId, DateOnly? StartDate, DateOnly? EndDate, string? Color);
public record UpdateReleaseRequest(string Name, string Status, Guid? OwnerId, DateOnly? StartDate, DateOnly? EndDate, string? Color);
public record UpdateReleaseNotesRequest(string? ReleaseNotes);

public record CreateTaskTypeRequest(string Name, string? IconName);
public record UpdateTaskTypeRequest(string Name, string? IconName);

public record CreateSavedQueryRequest(string Name, string Sql, bool ExposeViaApi = false);

public record CreatePrincipleRequest(string Title, string? Description, string? DocumentUrl);
public record UpdatePrincipleRequest(string Title, string? Description, string? DocumentUrl);

public record CreateDocumentRequest(string Title, string? Url, string? Description, Guid? OwnerId, Guid? TaskId, List<Guid>? RelatedDocumentIds);
public record UpdateDocumentRequest(string Title, string? Url, string? Description, Guid? OwnerId, Guid? TaskId, List<Guid>? RelatedDocumentIds);

public record CreateRiskRequest(
    string Title, string? Description, int Likelihood, int Impact, string? Mitigations,
    Guid? OwnerId, Guid? TaskId, List<Guid>? DocumentIds, List<Guid>? PrincipleIds, List<Guid>? ObjectiveIds,
    string Status, DateOnly? DateToClose, DateOnly? DateClosed);
public record UpdateRiskRequest(
    string Title, string? Description, int Likelihood, int Impact, string? Mitigations,
    Guid? OwnerId, Guid? TaskId, List<Guid>? DocumentIds, List<Guid>? PrincipleIds, List<Guid>? ObjectiveIds,
    string Status, DateOnly? DateToClose, DateOnly? DateClosed);

public record CreateObjectiveRequest(string Title, string? Description, List<Guid>? PrincipleIds);
public record UpdateObjectiveRequest(string Title, string? Description, List<Guid>? PrincipleIds);

public record CreateTeamCommitteeRequest(string Name, string? Description, string Type, Guid? ParentId, List<Guid>? MemberIds);
public record UpdateTeamCommitteeRequest(string Name, string? Description, string Type, Guid? ParentId, List<Guid>? MemberIds);

/// <summary>Result of TeamCommitteeService.ApplyOrgTeamAsync ("apply to project") — Warnings uses
/// the same list-of-strings pattern as MigrationResultDto for anything skipped.</summary>
public record ApplyOrgTeamResultDto(TeamCommitteeDto TeamCommittee, List<string> Warnings);

public record CreateDecisionRequest(
    string Title, string? Description, string Type, string Status, string? Outcome,
    Guid? OwnerId, string? Approver, Guid? TaskId,
    List<Guid>? DocumentIds, List<Guid>? RiskIds, List<Guid>? PrincipleIds, List<Guid>? ObjectiveIds);
public record UpdateDecisionRequest(
    string Title, string? Description, string Type, string Status, string? Outcome,
    Guid? OwnerId, string? Approver, Guid? TaskId,
    List<Guid>? DocumentIds, List<Guid>? RiskIds, List<Guid>? PrincipleIds, List<Guid>? ObjectiveIds);
