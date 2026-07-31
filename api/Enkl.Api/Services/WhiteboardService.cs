using Enkl.Api.Data;
using Enkl.Api.Domain.Entities;
using Enkl.Api.Dtos;
using Microsoft.EntityFrameworkCore;

namespace Enkl.Api.Services;

/// <summary>
/// Org-wide collaborative whiteboard sessions — no ProjectMember concept applies, same "org
/// concept, not a project one" shape as ChatService. Every lookup re-derives the session from the
/// caller's own OrganisationId (never trusted from the client) and, for host-only actions, the
/// caller's own UserId against the session's stored HostUserId — never a client-supplied "I'm the
/// host" flag. A wrong join code and a right code for a different org's session return the
/// identical "not found" (no enumeration oracle).
/// </summary>
public class WhiteboardService
{
    private static readonly Random JoinCodeRandom = new();

    private readonly AppDbContext _db;
    private readonly SseBroadcaster _broadcaster;

    public WhiteboardService(AppDbContext db, SseBroadcaster broadcaster)
    {
        _db = db;
        _broadcaster = broadcaster;
    }

    public async Task<WhiteboardSessionStateDto> CreateSessionAsync(
        Guid organisationId, Guid callerUserId, string callerDisplayName, CreateWhiteboardSessionRequest request)
    {
        var joinCode = await GenerateUniqueOpenJoinCodeAsync();
        var session = new WhiteboardSession
        {
            Id = Guid.NewGuid(),
            OrganisationId = organisationId,
            HostUserId = callerUserId,
            JoinCode = joinCode,
            Title = string.IsNullOrWhiteSpace(request.Title) ? null : request.Title!.Trim(),
            Status = "open",
            IsSaved = false,
            CreatedAt = DateTime.UtcNow
        };
        _db.WhiteboardSessions.Add(session);
        _db.WhiteboardParticipants.Add(new WhiteboardParticipant
        {
            Id = Guid.NewGuid(),
            SessionId = session.Id,
            UserId = callerUserId,
            JoinedAt = DateTime.UtcNow
        });
        await _db.SaveChangesAsync();
        await CleanupExpiredUnsavedSessionsOpportunisticallyAsync();

        return await BuildStateDtoAsync(session.Id, callerUserId) ?? throw new InvalidOperationException("Session vanished immediately after creation.");
    }

    /// <summary>"Scratch until saved" — a session closed with IsSaved still false gets purged after
    /// a short grace window (1 hour), same opportunistic 1-in-20-chance-on-write pattern already
    /// used by mariadb-api's Events outbox and the PHP tiers' RateLimitHits table, rather than a
    /// separate scheduled job. WhiteboardElements/WhiteboardParticipants cascade-delete with their
    /// parent session (see WhiteboardElementConfiguration/WhiteboardParticipantConfiguration's own
    /// DeleteBehavior.Cascade), so this is a single bulk delete, not a fan-out.</summary>
    private async Task CleanupExpiredUnsavedSessionsOpportunisticallyAsync()
    {
        if (JoinCodeRandom.Next(20) != 0) return;

        var cutoff = DateTime.UtcNow.AddHours(-1);
        await _db.WhiteboardSessions
            .Where(s => s.Status == "closed" && !s.IsSaved && s.ClosedAt != null && s.ClosedAt < cutoff)
            .ExecuteDeleteAsync();
    }

    /// <summary>Resolves a join code to a session (must be open, must belong to the caller's own org)
    /// and creates/reactivates the caller's participant row. Returns null for a wrong code OR a
    /// right code belonging to a different org OR a closed session — all three cases are
    /// indistinguishable to the caller, deliberately.</summary>
    public async Task<(WhiteboardSessionStateDto State, List<Guid> ParticipantUserIds)?> JoinSessionAsync(
        Guid organisationId, Guid callerUserId, string callerDisplayName, string joinCode)
    {
        var session = await _db.WhiteboardSessions
            .FirstOrDefaultAsync(s => s.JoinCode == joinCode && s.OrganisationId == organisationId && s.Status == "open");
        if (session is null) return null;

        var existingParticipant = await _db.WhiteboardParticipants
            .FirstOrDefaultAsync(p => p.SessionId == session.Id && p.UserId == callerUserId);
        if (existingParticipant is null)
        {
            _db.WhiteboardParticipants.Add(new WhiteboardParticipant
            {
                Id = Guid.NewGuid(),
                SessionId = session.Id,
                UserId = callerUserId,
                JoinedAt = DateTime.UtcNow
            });
        }
        else if (existingParticipant.LeftAt is not null)
        {
            existingParticipant.LeftAt = null;
            existingParticipant.JoinedAt = DateTime.UtcNow;
        }
        await _db.SaveChangesAsync();

        // Includes the caller's own userId — broadcasting only needs to skip the ORIGINATING TAB
        // (excludeClientSessionId, applied by the controller), not the whole user, so a second tab
        // of the same joining user still gets notified. Same convention as ChatService's own
        // BroadcastChatMessage, which targets the full channel membership including the sender.
        var participantUserIds = await _db.WhiteboardParticipants.AsNoTracking()
            .Where(p => p.SessionId == session.Id && p.LeftAt == null)
            .Select(p => p.UserId)
            .ToListAsync();

        var state = await BuildStateDtoAsync(session.Id, callerUserId);
        return state is null ? null : (state, participantUserIds);
    }

    /// <summary>Current state for a resync (e.g. after an SSE reconnect) — the caller must be a
    /// currently-present participant (LeftAt IS NULL); a former participant or a stranger gets the
    /// same null a wrong session id would, no oracle.</summary>
    public async Task<WhiteboardSessionStateDto?> GetStateAsync(Guid organisationId, Guid callerUserId, Guid sessionId)
    {
        var isCurrentParticipant = await _db.WhiteboardParticipants.AsNoTracking()
            .AnyAsync(p => p.SessionId == sessionId && p.UserId == callerUserId && p.LeftAt == null
                && p.Session.OrganisationId == organisationId);
        if (!isCurrentParticipant) return null;

        return await BuildStateDtoAsync(sessionId, callerUserId);
    }

    public async Task<List<Guid>?> LeaveSessionAsync(Guid organisationId, Guid callerUserId, Guid sessionId)
    {
        var participant = await _db.WhiteboardParticipants
            .FirstOrDefaultAsync(p => p.SessionId == sessionId && p.UserId == callerUserId && p.LeftAt == null
                && p.Session.OrganisationId == organisationId);
        if (participant is null) return null;

        participant.LeftAt = DateTime.UtcNow;
        await _db.SaveChangesAsync();

        return await _db.WhiteboardParticipants.AsNoTracking()
            .Where(p => p.SessionId == sessionId && p.LeftAt == null)
            .Select(p => p.UserId)
            .ToListAsync();
    }

    /// <summary>Host-only. Returns false (not an exception) for "not the host"/"session doesn't
    /// exist in your org" — the controller maps that to a plain 403/404, same shape as ChatService's
    /// bool-returning membership checks.</summary>
    public async Task<bool> SaveSessionAsync(Guid organisationId, Guid callerUserId, Guid sessionId)
    {
        var session = await _db.WhiteboardSessions
            .FirstOrDefaultAsync(s => s.Id == sessionId && s.OrganisationId == organisationId && s.HostUserId == callerUserId);
        if (session is null) return false;

        session.IsSaved = true;
        session.SavedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync();
        return true;
    }

    /// <summary>Host-only. On success, returns the full list of currently-present participant user
    /// ids (captured before closing) so the controller can broadcast whiteboard-session-closed to
    /// everyone, including participants who never call GET-state again.</summary>
    public async Task<List<Guid>?> CloseSessionAsync(Guid organisationId, Guid callerUserId, Guid sessionId)
    {
        var session = await _db.WhiteboardSessions
            .FirstOrDefaultAsync(s => s.Id == sessionId && s.OrganisationId == organisationId && s.HostUserId == callerUserId);
        if (session is null) return null;

        var participantUserIds = await _db.WhiteboardParticipants.AsNoTracking()
            .Where(p => p.SessionId == sessionId && p.LeftAt == null)
            .Select(p => p.UserId)
            .ToListAsync();

        session.Status = "closed";
        session.ClosedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync();

        return participantUserIds;
    }

    /// <summary>Caller must be a currently-present participant of an open session in their own
    /// org — a former participant, a stranger, or a closed session all get the same null. Returns
    /// the new element plus every currently-present participant's user id (including the caller —
    /// the controller's own excludeClientSessionId is what skips the originating tab specifically,
    /// same convention as ChatService.PostMessageAsync, so a second tab of the same acting user
    /// still gets the broadcast).</summary>
    public async Task<(WhiteboardElementDto Element, List<Guid> ParticipantUserIds)?> AddElementAsync(
        Guid organisationId, Guid callerUserId, Guid sessionId, AddWhiteboardElementRequest request)
    {
        var isCurrentParticipant = await _db.WhiteboardParticipants.AsNoTracking()
            .AnyAsync(p => p.SessionId == sessionId && p.UserId == callerUserId && p.LeftAt == null
                && p.Session.OrganisationId == organisationId && p.Session.Status == "open");
        if (!isCurrentParticipant) return null;

        var element = new WhiteboardElement
        {
            Id = Guid.NewGuid(),
            SessionId = sessionId,
            CreatedByUserId = callerUserId,
            ElementType = request.ElementType,
            ElementJson = request.ElementJson,
            CreatedAt = DateTime.UtcNow
        };
        _db.WhiteboardElements.Add(element);
        await _db.SaveChangesAsync();

        var participantUserIds = await _db.WhiteboardParticipants.AsNoTracking()
            .Where(p => p.SessionId == sessionId && p.LeftAt == null)
            .Select(p => p.UserId)
            .ToListAsync();

        var dto = new WhiteboardElementDto(element.Id, element.ElementType, element.ElementJson, element.CreatedByUserId, element.CreatedAt);
        return (dto, participantUserIds);
    }

    /// <summary>Move/resize (or any other in-place edit) of an existing element — same
    /// currently-present-participant gate as AddElementAsync. The new ElementJson fully replaces the
    /// old one; the server never interprets it (same "opaque JSON blob" convention as AddElementAsync).
    /// Returns null if the caller isn't a current participant of an open session in their own org, or
    /// the element doesn't belong to this session.</summary>
    public async Task<(WhiteboardElementDto Element, List<Guid> ParticipantUserIds)?> UpdateElementAsync(
        Guid organisationId, Guid callerUserId, Guid sessionId, Guid elementId, UpdateWhiteboardElementRequest request)
    {
        var isCurrentParticipant = await _db.WhiteboardParticipants.AsNoTracking()
            .AnyAsync(p => p.SessionId == sessionId && p.UserId == callerUserId && p.LeftAt == null
                && p.Session.OrganisationId == organisationId && p.Session.Status == "open");
        if (!isCurrentParticipant) return null;

        var element = await _db.WhiteboardElements
            .FirstOrDefaultAsync(e => e.Id == elementId && e.SessionId == sessionId && e.DeletedAt == null);
        if (element is null) return null;

        element.ElementJson = request.ElementJson;
        await _db.SaveChangesAsync();

        var participantUserIds = await _db.WhiteboardParticipants.AsNoTracking()
            .Where(p => p.SessionId == sessionId && p.LeftAt == null)
            .Select(p => p.UserId)
            .ToListAsync();

        var dto = new WhiteboardElementDto(element.Id, element.ElementType, element.ElementJson, element.CreatedByUserId, element.CreatedAt);
        return (dto, participantUserIds);
    }

    /// <summary>Soft-delete (eraser) — same currently-present-participant gate as AddElementAsync.
    /// Returns every currently-present participant's user id (including the caller — see
    /// AddElementAsync's own doc comment for why) for broadcast, or null if the caller isn't a
    /// current participant or the element doesn't belong to this session.</summary>
    public async Task<List<Guid>?> RemoveElementAsync(Guid organisationId, Guid callerUserId, Guid sessionId, Guid elementId)
    {
        var isCurrentParticipant = await _db.WhiteboardParticipants.AsNoTracking()
            .AnyAsync(p => p.SessionId == sessionId && p.UserId == callerUserId && p.LeftAt == null
                && p.Session.OrganisationId == organisationId && p.Session.Status == "open");
        if (!isCurrentParticipant) return null;

        var element = await _db.WhiteboardElements
            .FirstOrDefaultAsync(e => e.Id == elementId && e.SessionId == sessionId && e.DeletedAt == null);
        if (element is null) return null;

        element.DeletedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync();

        return await _db.WhiteboardParticipants.AsNoTracking()
            .Where(p => p.SessionId == sessionId && p.LeftAt == null)
            .Select(p => p.UserId)
            .ToListAsync();
    }

    /// <summary>Ephemeral cursor-position broadcast (.NET/php-api tiers only — no MariaDB
    /// equivalent, see mariadb-api/CLAUDE.md's own trade-off note; the frontend simply never
    /// receives this event on that tier). No DB write at all, unlike AddElementAsync — a cursor
    /// position is purely transient. Returns every currently-present participant's user id
    /// (including the caller — see AddElementAsync's own doc comment for why), or null if the
    /// caller isn't a current participant of an open session in their own org.</summary>
    public async Task<List<Guid>?> GetOtherParticipantUserIdsForCursorAsync(Guid organisationId, Guid callerUserId, Guid sessionId)
    {
        var isCurrentParticipant = await _db.WhiteboardParticipants.AsNoTracking()
            .AnyAsync(p => p.SessionId == sessionId && p.UserId == callerUserId && p.LeftAt == null
                && p.Session.OrganisationId == organisationId && p.Session.Status == "open");
        if (!isCurrentParticipant) return null;

        return await _db.WhiteboardParticipants.AsNoTracking()
            .Where(p => p.SessionId == sessionId && p.LeftAt == null)
            .Select(p => p.UserId)
            .ToListAsync();
    }

    // ---- Helpers ----

    private async Task<string> GenerateUniqueOpenJoinCodeAsync()
    {
        for (var attempt = 0; attempt < 10; attempt++)
        {
            var code = JoinCodeRandom.Next(0, 1_000_000).ToString("D6");
            var inUse = await _db.WhiteboardSessions.AsNoTracking().AnyAsync(s => s.JoinCode == code && s.Status == "open");
            if (!inUse) return code;
        }
        throw new InvalidOperationException("Could not generate a unique whiteboard join code — too many open sessions.");
    }

    private async Task<WhiteboardSessionStateDto?> BuildStateDtoAsync(Guid sessionId, Guid callerUserId)
    {
        var session = await _db.WhiteboardSessions.AsNoTracking()
            .Include(s => s.HostUser)
            .FirstOrDefaultAsync(s => s.Id == sessionId);
        if (session is null) return null;

        var online = _broadcaster.GetOnlineUserIds();

        var participants = await _db.WhiteboardParticipants.AsNoTracking()
            .Include(p => p.User)
            .Where(p => p.SessionId == sessionId && p.LeftAt == null)
            .Select(p => new WhiteboardParticipantDto(p.UserId, p.User.DisplayName, p.UserId == session.HostUserId, online.Contains(p.UserId)))
            .ToListAsync();

        var elements = await _db.WhiteboardElements.AsNoTracking()
            .Where(e => e.SessionId == sessionId && e.DeletedAt == null)
            .OrderBy(e => e.CreatedAt)
            .Select(e => new WhiteboardElementDto(e.Id, e.ElementType, e.ElementJson, e.CreatedByUserId, e.CreatedAt))
            .ToListAsync();

        return new WhiteboardSessionStateDto(
            session.Id, session.JoinCode, session.Title, session.Status, session.IsSaved,
            session.HostUserId == callerUserId, session.HostUserId, session.HostUser.DisplayName,
            session.CreatedAt, participants, elements);
    }
}
