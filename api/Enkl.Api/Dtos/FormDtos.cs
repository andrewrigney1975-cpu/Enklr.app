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
