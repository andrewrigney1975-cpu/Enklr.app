namespace Enkl.Api.Dtos;

/// <summary>
/// Pushed over the SSE stream (Controllers/EventsController.cs) whenever a task is created, updated,
/// or deleted — mirrors the shape src/js/features/live-updates.js expects. ChangeType is one of
/// "created" | "updated" | "deleted".
/// </summary>
public record TaskChangedEventDto(
    Guid ProjectId, Guid TaskId, string TaskKey, string Title, string ChangeType,
    Guid ChangedByUserId, string ChangedByDisplayName);

/// <summary>
/// Pushed over the SSE stream whenever a chat message is posted, edited, or (soft-)deleted —
/// ChangeType is one of "created" | "updated" | "deleted", same convention as TaskChangedEventDto.
/// MentionedUserIds is the set of channel members @-tagged in this message (only meaningful on
/// "created"/"updated"); the frontend shows an extra highlighted alert to whichever recipient's own
/// user id appears in it, everyone else just sees the normal live-message update.
/// </summary>
public record ChatMessageEventDto(
    Guid ChannelId, Guid MessageId, string Text, string ChangeType,
    Guid? AuthorUserId, string AuthorName, DateTime DateCreated, bool IsDeleted,
    List<Guid> MentionedUserIds);

/// <summary>Pushed over the SSE stream whenever any user's reaction on a message is added or removed
/// — Reactions is the message's full, recomputed reaction summary (not a delta), so a recipient just
/// replaces whatever it had cached for MessageId.</summary>
public record ChatReactionEventDto(Guid ChannelId, Guid MessageId, List<ChatReactionSummaryDto> Reactions);

/// <summary>Pushed over the SSE stream to a single named user whenever a Form submission's own
/// workflow advances to an Approval node that gates them BY NAME — see FormSubmissionService's own
/// notification helper for the deliberately narrow v1 scope (a plain userType gate has no single
/// "specific person" to target, so it never fires this).</summary>
public record FormActionRequiredEventDto(
    Guid ProjectId, Guid SubmissionId, string FormName, DateTime Timestamp);

/// <summary>Pushed over the SSE stream to the ORIGINAL SUBMITTER whenever their submission reaches a
/// final decision — Decision is "approved" or "rejected". Unlike FormActionRequiredEventDto's
/// gate-satisfaction-dependent targeting, a decision always has exactly one unambiguous interested
/// party (the submitter), so there's no "who" resolution needed. Carries FormName alongside Decision
/// specifically so the toast/despatch reads as "X was approved/rejected" rather than a bare result
/// with no context about which submission it refers to.</summary>
public record FormSubmissionDecidedEventDto(
    Guid ProjectId, Guid SubmissionId, string FormName, string Decision, string ActedByDisplayName, string? Comment, DateTime Timestamp);
