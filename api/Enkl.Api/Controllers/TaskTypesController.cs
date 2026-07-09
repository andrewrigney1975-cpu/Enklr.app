using Enkl.Api.Dtos;
using Enkl.Api.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace Enkl.Api.Controllers;

[ApiController]
[Authorize(Policy = "ProjectMember")]
[Route("api/projects/{projectId:guid}/task-types")]
public class TaskTypesController : ControllerBase
{
    private readonly TaskTypeService _taskTypes;

    public TaskTypesController(TaskTypeService taskTypes)
    {
        _taskTypes = taskTypes;
    }

    [HttpPost]
    public async Task<IActionResult> Create(Guid projectId, CreateTaskTypeRequest request)
    {
        var result = await _taskTypes.CreateAsync(projectId, request);
        return result is null ? NotFound() : Ok(result);
    }

    [HttpPut("{typeId:guid}")]
    public async Task<IActionResult> Update(Guid projectId, Guid typeId, UpdateTaskTypeRequest request)
    {
        var result = await _taskTypes.UpdateAsync(projectId, typeId, request);
        return result is null ? NotFound() : Ok(result);
    }

    [HttpDelete("{typeId:guid}")]
    public async Task<IActionResult> Delete(Guid projectId, Guid typeId)
    {
        return await _taskTypes.DeleteAsync(projectId, typeId) ? NoContent() : NotFound();
    }
}
