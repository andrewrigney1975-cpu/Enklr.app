namespace Enkl.Api.Dtos;

/// <summary>One form VERSION — see Domain/Entities/Form.cs's own doc comment for why there's no
/// separate parent "Form" shape. FieldsJson/WorkflowJson are opaque strings, unparsed server-side
/// (Phase 1: WorkflowJson is always null until Phase 4's workflow builder exists).</summary>
public record FormDto(
    Guid Id, Guid FormGroupId, string Name, string? Description, int VersionNumber, string Status,
    string? FieldsJson, string? WorkflowJson, DateTime DateCreated, DateTime DateLastModified,
    DateTime? PublishedAt);

public record CreateFormRequest(string Name, string? Description, string? FieldsJson);
public record UpdateFormRequest(string Name, string? Description, string? FieldsJson, string? WorkflowJson);

/// <summary>One row per FormGroupId, oldest-to-newest — the version-history list a "New version
/// from this one" / publish UI is built from.</summary>
public record FormVersionSummaryDto(
    Guid Id, int VersionNumber, string Status, DateTime DateCreated, DateTime DateLastModified, DateTime? PublishedAt);

public record FormSubmissionDto(
    Guid Id, Guid FormVersionId, Guid ProjectId, Guid SubmittedByUserId, string Status,
    string? CurrentNodeId, string? AnswersJson, string? ApprovalTrailJson,
    DateTime DateCreated, DateTime DateLastModified, DateTime? DateSubmitted);

public record CreateFormSubmissionRequest(Guid FormVersionId, string? AnswersJson);
public record UpdateFormSubmissionRequest(string? AnswersJson);

/// <summary>action: 'approve'|'reject' — Submit has no body (POST .../submit takes only the
/// submissionId), since the acting user's own gate check is entirely server-derived.</summary>
public record FormApprovalActionRequest(string Action, string? Comment);

/// <summary>A submission enriched with the display fields a list view needs (form name/version, the
/// submitter's display name) that the bare FormSubmissionDto doesn't carry — used by both "My
/// Submissions" and "Awaiting My Action", so the frontend renders both lists with one shared row
/// component.</summary>
public record FormSubmissionListItemDto(
    Guid Id, Guid FormVersionId, string FormName, int VersionNumber, string Status, string? CurrentNodeId,
    string? CurrentNodeLabel, Guid SubmittedByUserId, string SubmittedByDisplayName,
    DateTime DateCreated, DateTime DateLastModified, DateTime? DateSubmitted);
