namespace Enkl.Api.Dtos;

public record PortalDto(Guid Id, string Name, string Slug, string? Description, string Status, Guid ProjectId, DateTime DateCreated, DateTime DateLastModified, DateTime? PublishedAt);
public record CreatePortalRequest(string Name, string? Slug, string? Description);
public record UpdatePortalRequest(string Name, string? Slug, string? Description);

/// <summary>Kind: orgTeam|teamCommittee|namedUser — see PortalAccessGrant's own doc comment.</summary>
public record PortalAccessGrantDto(Guid Id, string Kind, Guid Value, DateTime DateCreated);
public record CreatePortalAccessGrantRequest(string Kind, Guid Value);

/// <summary>FormName/FormStatus are resolved at read time from whichever Form row is currently
/// published for FormGroupId, for the authoring UI's convenience — not stored on PortalForm itself.</summary>
public record PortalFormDto(Guid Id, Guid FormGroupId, int Order, string? FormName, string? FormStatus);
public record AttachPortalFormRequest(Guid FormGroupId, int Order);

public record PortalTopicDto(Guid Id, string Title, int Order);
public record CreatePortalTopicRequest(string Title, int Order);
public record UpdatePortalTopicRequest(string Title, int Order);

public record PortalQaEntryDto(Guid Id, Guid? PortalTopicId, string Question, string? Answer, int Order);
public record CreatePortalQaEntryRequest(string Question, string? Answer, Guid? PortalTopicId, int Order);
public record UpdatePortalQaEntryRequest(string Question, string? Answer, Guid? PortalTopicId, int Order);
