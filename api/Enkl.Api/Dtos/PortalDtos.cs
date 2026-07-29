namespace Enkl.Api.Dtos;

public record PortalDto(Guid Id, string Name, string Slug, string? Description, string Status, Guid ProjectId, DateTime DateCreated, DateTime DateLastModified, DateTime? PublishedAt);
public record CreatePortalRequest(string Name, string? Slug, string? Description);
public record UpdatePortalRequest(string Name, string? Slug, string? Description);

/// <summary>Kind: orgTeam|teamCommittee|namedUser — see PortalAccessGrant's own doc comment.</summary>
public record PortalAccessGrantDto(Guid Id, string Kind, Guid Value, DateTime DateCreated);
public record CreatePortalAccessGrantRequest(string Kind, Guid Value);

/// <summary>FormVersionId/FormName/FormStatus/FieldsJson are resolved at read time from whichever
/// Form row is currently published for FormGroupId — not stored on PortalForm itself. FormVersionId
/// is that resolved Form row's own Id — what a client actually needs to pass as
/// CreateFormSubmissionRequest.FormVersionId. FieldsJson is what lets the end-user Portal home page
/// (PortalHomeService.ListAvailableFormsAsync) render a brand-new submission's fields without
/// needing its own Org-Admin-only formsApi access.</summary>
public record PortalFormDto(Guid Id, Guid FormGroupId, int Order, string? FormName, string? FormStatus, string? FieldsJson, Guid? FormVersionId);
public record AttachPortalFormRequest(Guid FormGroupId, int Order);

public record PortalTopicDto(Guid Id, string Title, int Order);
public record CreatePortalTopicRequest(string Title, int Order);
public record UpdatePortalTopicRequest(string Title, int Order);

public record PortalQaEntryDto(Guid Id, Guid? PortalTopicId, string Question, string? Answer, int Order);
public record CreatePortalQaEntryRequest(string Question, string? Answer, Guid? PortalTopicId, int Order);
public record UpdatePortalQaEntryRequest(string Question, string? Answer, Guid? PortalTopicId, int Order);

/// <summary>The end-user Portal home page's combined Q&amp;A rail payload — topics + flat entry list
/// (each carrying its own PortalTopicId, null for ungrouped) rather than a nested shape, so the
/// frontend can group client-side however its accordion rendering wants to.</summary>
public record PortalQaDto(List<PortalTopicDto> Topics, List<PortalQaEntryDto> Entries);
