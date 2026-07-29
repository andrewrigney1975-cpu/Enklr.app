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

        return await BuildStateDtoAsync(session.Id, callerUserId) ?? throw new InvalidOperationException("Session vanished immediately after creation.");
    }

    /// <summary>Resolves a join code to a session (must be open, must belong to the caller's own org)
    /// and creates/reactivates the caller's participant row. Returns null for a wrong code OR a
    /// right code belonging to a different org OR a closed session — all three cases are
    /// indistinguishable to the caller, deliberately.</summary>
    public async Task<(WhiteboardSessionStateDto State, List<Guid> OtherParticipantUserIds)?> JoinSessionAsync(
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

        var otherParticipantUserIds = await _db.WhiteboardParticipants.AsNoTracking()
            .Where(p => p.SessionId == session.Id && p.LeftAt == null && p.UserId != callerUserId)
            .Select(p => p.UserId)
            .ToListAsync();

        var state = await BuildStateDtoAsync(session.Id, callerUserId);
        return state is null ? null : (state, otherParticipantUserIds);
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
