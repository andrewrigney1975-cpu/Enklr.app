using System.Security.Claims;
using Enkl.Api.Auth;
using Enkl.Api.Dtos;
using Enkl.Api.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace Enkl.Api.Controllers;

[ApiController]
[Authorize(Policy = "ProjectMember")]
[Route("api/projects/{projectId:guid}/tasks")]
public class TasksController : ControllerBase
{
    private readonly TaskService _tasks;
    private readonly SseBroadcaster _broadcaster;
    private readonly FormSubmissionService _formSubmissions;

    // FormSubmissionService is injected here rather than into TaskService itself, which would be a
    // straight constructor cycle (FormSubmissionService already depends on TaskService to raise a
    // task from a Form Workflow "action" node) — a controller depending on both is a clean one-way
    // graph, not a cycle, since TaskService itself gains no new dependency.
    public TasksController(TaskService tasks, SseBroadcaster broadcaster, FormSubmissionService formSubmissions)
    {
        _tasks = tasks;
        _broadcaster = broadcaster;
        _formSubmissions = formSubmissions;
    }

    // ARCHITECTURE-REVIEW.md finding 2.2: additive, targeted alternative to pulling every task
    // through GET /api/projects/{id} (ProjectService.GetProjectDetailAsync's one all-in-one graph
    // fetch) — see TaskService.GetTasksPagedAsync's own doc comment. page defaults to 1, pageSize to
    // 50 (clamped [1, 200] in the service) if the caller omits either.
    [HttpGet]
    public async Task<IActionResult> List(Guid projectId, [FromQuery] int page = 1, [FromQuery] int pageSize = 50)
    {
        var result = await _tasks.GetTasksPagedAsync(projectId, page, pageSize);
        return result is null ? NotFound() : Ok(result);
    }

    [HttpPost]
    public async Task<IActionResult> Create(Guid projectId, CreateTaskRequest request)
    {
        var result = await _tasks.CreateAsync(projectId, request);
        if (result is null) return BadRequest(new { message = "Invalid column." });
        await BroadcastAsync(projectId, result, "created");
        return Ok(result);
    }

    [HttpPut("{taskId:guid}")]
    public async Task<IActionResult> Update(Guid projectId, Guid taskId, UpdateTaskRequest request)
    {
        var result = await _tasks.UpdateAsync(projectId, taskId, request, User.FindFirstValue("displayName"));
        if (result is null) return NotFound();
        await BroadcastAsync(projectId, result, "updated");
        // Cheap no-op for the overwhelming majority of task updates (an indexed lookup that finds
        // nothing) — only actually does anything when this Task was raised by a Form Workflow
        // "raiseTaskInPortal" action node AND this update just moved it into a Done column. See
        // FormSubmissionService.ResumeIfLinkedTaskDoneAsync's own doc comment for the full shape.
        await _formSubmissions.ResumeIfLinkedTaskDoneAsync(taskId, request.FormClosingNotes);
        // Same shape, for the "In Review" transition — only does anything the first time this Task's
        // AssigneeId goes non-null while its linked submission is still 'submitted'.
        await _formSubmissions.MarkInReviewIfTaskAssignedAsync(taskId);
        return Ok(result);
    }

    // Cheap, single-indexed-lookup check the frontend fires only at the moment a Task is about to
    // move into a Done column, to decide whether to show the optional "Add closing notes?" prompt —
    // deliberately NOT part of TaskDto/GetProjectDetailAsync's own graph fetch, which every task on
    // every board load would otherwise pay for. 404 (not an empty 200) when unlinked, so the frontend
    // can treat "not linked" and "no such task" identically — there's nothing to prompt for either way.
    [HttpGet("{taskId:guid}/form-link")]
    public async Task<IActionResult> GetFormLink(Guid projectId, Guid taskId)
    {
        var submissionId = await _formSubmissions.GetRaisedFromTaskIdAsync(projectId, taskId);
        return submissionId is null ? NotFound() : Ok(new TaskFormLinkDto(submissionId.Value));
    }

    [HttpDelete("{taskId:guid}")]
    public async Task<IActionResult> Delete(Guid projectId, Guid taskId)
    {
        // Grab the key/title before deleting so the "X was deleted" toast can still name it.
        var deleted = await _tasks.GetTaskSummaryAsync(projectId, taskId);
        if (!await _tasks.DeleteAsync(projectId, taskId)) return NotFound();
        if (deleted is not null) await BroadcastAsync(projectId, deleted.Value.TaskId, deleted.Value.Key, deleted.Value.Title, "deleted");
        return NoContent();
    }

    // Best-effort — a notification failure must never fail the mutation itself, so any exception here
    // (e.g. a momentarily broken connection registry) is swallowed rather than surfaced to the caller.
    private async Task BroadcastAsync(Guid projectId, TaskDto task, string changeType) =>
        await BroadcastAsync(projectId, task.Id, task.Key, task.Title, changeType);

    private async Task BroadcastAsync(Guid projectId, Guid taskId, string taskKey, string title, string changeType)
    {
        try
        {
            var memberUserIds = await _tasks.GetProjectMemberUserIdsAsync(projectId);
            var userId = User.UserId();
            var displayName = User.FindFirstValue("displayName") ?? "Someone";
            var clientSessionId = Request.Headers["X-Client-Session-Id"].FirstOrDefault();

            _broadcaster.BroadcastTaskChanged(
                memberUserIds,
                new TaskChangedEventDto(projectId, taskId, taskKey, title, changeType, userId, displayName),
                clientSessionId);
        }
        catch
        {
            // Notification is best-effort — the mutation already succeeded and was already returned/
            // will be returned to the caller regardless.
        }
    }
}
