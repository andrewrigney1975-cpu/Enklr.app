using Enkl.Api.Auth;
using Enkl.Api.Dtos;
using Enkl.Api.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace Enkl.Api.Controllers;

/// <summary>
/// Org-wide collaborative whiteboard — [Authorize] only at class level (no ProjectMember/OrgAdmin
/// policy), since any org user can start or join a session, mirroring ChatController's own
/// org-wide, no-extra-policy shape.
/// </summary>
[ApiController]
[Authorize]
[Route("api/whiteboard/sessions")]
public class WhiteboardController : ControllerBase
{
    private readonly WhiteboardService _whiteboard;
    private readonly SseBroadcaster _broadcaster;

    public WhiteboardController(WhiteboardService whiteboard, SseBroadcaster broadcaster)
    {
        _whiteboard = whiteboard;
        _broadcaster = broadcaster;
    }

    private string CallerDisplayName => User.FindFirst("displayName")?.Value ?? "Someone";
    private string? ClientSessionId => Request.Headers["X-Client-Session-Id"].FirstOrDefault();

    [HttpPost]
    public async Task<IActionResult> Create(CreateWhiteboardSessionRequest request)
    {
        var result = await _whiteboard.CreateSessionAsync(User.OrgId(), User.UserId(), CallerDisplayName, request);
        return Ok(result);
    }

    [HttpPost("join")]
    public async Task<IActionResult> Join(JoinWhiteboardSessionRequest request)
    {
        var result = await _whiteboard.JoinSessionAsync(User.OrgId(), User.UserId(), CallerDisplayName, request.JoinCode ?? "");
        if (result is null) return NotFound();

        BroadcastParticipantChange(result.Value.State.Id, result.Value.OtherParticipantUserIds, "joined");
        return Ok(result.Value.State);
    }

    [HttpGet("{id:guid}")]
    public async Task<IActionResult> GetState(Guid id)
    {
        var result = await _whiteboard.GetStateAsync(User.OrgId(), User.UserId(), id);
        return result is null ? NotFound() : Ok(result);
    }

    [HttpPost("{id:guid}/elements")]
    public async Task<IActionResult> AddElement(Guid id, AddWhiteboardElementRequest request)
    {
        var result = await _whiteboard.AddElementAsync(User.OrgId(), User.UserId(), id, request);
        if (result is null) return NotFound();

        BroadcastElementChange(id, result.Value.Element, result.Value.OtherParticipantUserIds, "added");
        return Ok(result.Value.Element);
    }

    [HttpDelete("{id:guid}/elements/{elementId:guid}")]
    public async Task<IActionResult> RemoveElement(Guid id, Guid elementId)
    {
        var otherParticipantUserIds = await _whiteboard.RemoveElementAsync(User.OrgId(), User.UserId(), id, elementId);
        if (otherParticipantUserIds is null) return NotFound();

        var removedDto = new WhiteboardElementDto(elementId, "", "", User.UserId(), DateTime.UtcNow);
        BroadcastElementChange(id, removedDto, otherParticipantUserIds, "removed");
        return NoContent();
    }

    [HttpPost("{id:guid}/cursor")]
    public async Task<IActionResult> CursorMove(Guid id, WhiteboardCursorMoveRequest request)
    {
        var otherParticipantUserIds = await _whiteboard.GetOtherParticipantUserIdsForCursorAsync(User.OrgId(), User.UserId(), id);
        if (otherParticipantUserIds is null) return NotFound();

        try
        {
            _broadcaster.BroadcastWhiteboardCursorMoved(
                otherParticipantUserIds,
                new WhiteboardCursorMovedEventDto(id, User.UserId(), CallerDisplayName, request.X, request.Y));
        }
        catch
        {
            // best-effort, same convention as ChatController's own broadcast helpers
        }
        return NoContent();
    }

    [HttpPost("{id:guid}/leave")]
    public async Task<IActionResult> Leave(Guid id)
    {
        var remainingParticipantUserIds = await _whiteboard.LeaveSessionAsync(User.OrgId(), User.UserId(), id);
        if (remainingParticipantUserIds is null) return NotFound();

        BroadcastParticipantChange(id, remainingParticipantUserIds, "left");
        return NoContent();
    }

    [HttpPost("{id:guid}/save")]
    public async Task<IActionResult> Save(Guid id)
    {
        var ok = await _whiteboard.SaveSessionAsync(User.OrgId(), User.UserId(), id);
        return ok ? NoContent() : NotFound();
    }

    [HttpPost("{id:guid}/close")]
    public async Task<IActionResult> Close(Guid id)
    {
        var participantUserIds = await _whiteboard.CloseSessionAsync(User.OrgId(), User.UserId(), id);
        if (participantUserIds is null) return NotFound();

        try
        {
            _broadcaster.BroadcastWhiteboardSessionClosed(participantUserIds, new WhiteboardSessionClosedEventDto(id));
        }
        catch
        {
            // best-effort, same convention as ChatController's own broadcast helpers
        }
        return NoContent();
    }

    private void BroadcastElementChange(Guid sessionId, WhiteboardElementDto element, List<Guid> otherParticipantUserIds, string changeType)
    {
        try
        {
            _broadcaster.BroadcastWhiteboardElement(
                otherParticipantUserIds,
                new WhiteboardElementEventDto(sessionId, element, changeType),
                ClientSessionId);
        }
        catch
        {
            // best-effort, same convention as ChatController's own broadcast helpers
        }
    }

    private void BroadcastParticipantChange(Guid sessionId, List<Guid> otherParticipantUserIds, string changeType)
    {
        try
        {
            _broadcaster.BroadcastWhiteboardParticipant(
                otherParticipantUserIds,
                new WhiteboardParticipantEventDto(sessionId, User.UserId(), CallerDisplayName, changeType),
                ClientSessionId);
        }
        catch
        {
            // best-effort, same convention as ChatController's own broadcast helpers
        }
    }
}
