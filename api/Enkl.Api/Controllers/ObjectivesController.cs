using Enkl.Api.Dtos;
using Enkl.Api.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace Enkl.Api.Controllers;

[ApiController]
[Authorize(Policy = "ProjectMember")]
[Route("api/projects/{projectId:guid}/objectives")]
public class ObjectivesController : ControllerBase
{
    private readonly ObjectiveService _objectives;

    public ObjectivesController(ObjectiveService objectives)
    {
        _objectives = objectives;
    }

    [HttpPost]
    public async Task<IActionResult> Create(Guid projectId, CreateObjectiveRequest request)
    {
        var result = await _objectives.CreateAsync(projectId, request);
        return result is null ? NotFound() : Ok(result);
    }

    [HttpPut("{objectiveId:guid}")]
    public async Task<IActionResult> Update(Guid projectId, Guid objectiveId, UpdateObjectiveRequest request)
    {
        var result = await _objectives.UpdateAsync(projectId, objectiveId, request);
        return result is null ? NotFound() : Ok(result);
    }

    [HttpDelete("{objectiveId:guid}")]
    public async Task<IActionResult> Delete(Guid projectId, Guid objectiveId)
    {
        return await _objectives.DeleteAsync(projectId, objectiveId) ? NoContent() : NotFound();
    }
}
