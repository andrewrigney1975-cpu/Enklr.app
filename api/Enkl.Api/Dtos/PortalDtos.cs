namespace Enkl.Api.Dtos;

public record PortalDto(Guid Id, string Name, string Slug, string? Description, string? IconName, string Status, Guid ProjectId, DateTime DateCreated, DateTime DateLastModified, DateTime? PublishedAt);
public record CreatePortalRequest(string Name, string? Slug, string? Description, string? IconName);
public record UpdatePortalRequest(string Name, string? Slug, string? Description, string? IconName);

/// <summary>The side nav's "Portals" section entry — just enough to render one icon button and open
/// it (see PortalHomeService.ListAccessiblePortalsAsync).</summary>
public record AccessiblePortalDto(Guid Id, string Name, string Slug, string? IconName);

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

/// <summary>HeaderImageUrl/HeaderImageColor are resolved once, server-side, at Create/Update time
/// (PortalQaImageResolver) — never re-resolved on read, so the Portal home page pays zero Pexels
/// latency/rate-limit cost on view. Exactly one of the two is ever set: an image when Pexels found a
/// reasonable match for the entry's own keyword-extracted search query, otherwise a persisted random
/// fallback colour.</summary>
public record PortalQaEntryDto(Guid Id, Guid? PortalTopicId, string Question, string? Answer, int Order, int Nps, string? HeaderImageUrl, string? HeaderImageColor);
public record CreatePortalQaEntryRequest(string Question, string? Answer, Guid? PortalTopicId, int Order);
public record UpdatePortalQaEntryRequest(string Question, string? Answer, Guid? PortalTopicId, int Order);

/// <summary>"up" increments a PortalQaEntry's Nps by 1, "down" decrements it by 1 — no other values
/// accepted (ReorderDirection is reused for the same up/down vocabulary, see below).</summary>
public record VoteQaEntryNpsRequest(string Direction);

/// <summary>Shared by both Reorder endpoints (topics and entries) — "up" swaps with the previous
/// sibling in Order, "down" swaps with the next. Scoped: topics reorder among all of a Portal's own
/// topics; entries reorder among their own siblings only (same PortalTopicId, including the
/// ungrouped/null bucket) — see PortalService.ReorderQaEntryAsync's own doc comment for why.</summary>
public record ReorderRequest(string Direction);

/// <summary>The end-user Portal home page's combined Q&amp;A rail payload — topics + flat entry list
/// (each carrying its own PortalTopicId, null for ungrouped) rather than a nested shape, so the
/// frontend can group client-side however its accordion rendering wants to.</summary>
public record PortalQaDto(List<PortalTopicDto> Topics, List<PortalQaEntryDto> Entries);
