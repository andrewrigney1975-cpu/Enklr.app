namespace Enkl.Api.Dtos;

public record WhiteboardParticipantDto(Guid UserId, string DisplayName, bool IsHost, bool IsOnline);

public record WhiteboardElementDto(Guid Id, string ElementType, string ElementJson, Guid CreatedByUserId, DateTime CreatedAt);

/// <summary>Full current state of a session — returned by both create/join and the plain
/// get-state endpoint, so a fresh join and an SSE-reconnect resync hit the exact same shape.</summary>
public record WhiteboardSessionStateDto(
    Guid Id, string JoinCode, string? Title, string Status, bool IsSaved, bool IsHost,
    Guid HostUserId, string HostDisplayName, DateTime CreatedAt,
    List<WhiteboardParticipantDto> Participants, List<WhiteboardElementDto> Elements);

public record CreateWhiteboardSessionRequest(string? Title);

public record JoinWhiteboardSessionRequest(string JoinCode);

public record AddWhiteboardElementRequest(string ElementType, string ElementJson);

public record UpdateWhiteboardElementRequest(string ElementJson);

public record WhiteboardCursorMoveRequest(double X, double Y);

/// <summary>Pushed over the SSE stream whenever a participant joins or leaves a whiteboard session —
/// ChangeType is "joined" | "left", same convention as TaskChangedEventDto's ChangeType.</summary>
public record WhiteboardParticipantEventDto(Guid SessionId, Guid UserId, string DisplayName, string ChangeType);

/// <summary>Pushed over the SSE stream whenever an element is added to, updated (moved), or removed
/// from a whiteboard session. ChangeType is "added" | "updated" | "removed" — on "removed", Element
/// carries only Id (the rest of the payload is unused by the frontend for that case).</summary>
public record WhiteboardElementEventDto(Guid SessionId, WhiteboardElementDto Element, string ChangeType);

/// <summary>Pushed over the SSE stream to every participant when the host closes the session — no
/// separate "removed" cleanup event is needed since the frontend just exits the modal on receipt.</summary>
public record WhiteboardSessionClosedEventDto(Guid SessionId);

/// <summary>Pushed over the SSE stream on every throttled cursor move — .NET/php-api tiers only,
/// see WhiteboardService.GetOtherParticipantUserIdsForCursorAsync's own doc comment. X/Y are in the
/// frontend's fixed 1600x900 SVG viewBox coordinate space, not raw pixels.</summary>
public record WhiteboardCursorMovedEventDto(Guid SessionId, Guid UserId, string DisplayName, double X, double Y);
