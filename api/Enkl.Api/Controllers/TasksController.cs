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

    public TasksController(TaskService tasks)
    {
        _tasks = tasks;
    }

    [HttpPost]
    public async Task<IActionResult> Create(Guid projectId, CreateTaskRequest request)
    {
        var result = await _tasks.CreateAsync(projectId, request);
        return result is null ? BadRequest(new { message = "Invalid column." }) : Ok(result);
    }

    [HttpPut("{taskId:guid}")]
    public async Task<IActionResult> Update(Guid projectId, Guid taskId, UpdateTaskRequest request)
    {
        var result = await _tasks.UpdateAsync(projectId, taskId, request);
        return result is null ? NotFound() : Ok(result);
    }

    [HttpDelete("{taskId:guid}")]
    public async Task<IActionResult> Delete(Guid projectId, Guid taskId)
    {
        return await _tasks.DeleteAsync(projectId, taskId) ? NoContent() : NotFound();
    }
}
