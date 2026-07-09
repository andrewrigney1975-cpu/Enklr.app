using Enkl.Api.Dtos;
using Enkl.Api.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace Enkl.Api.Controllers;

[ApiController]
[Authorize(Policy = "ProjectMember")]
[Route("api/projects/{projectId:guid}/decisions")]
public class DecisionsController : ControllerBase
{
    private readonly DecisionService _decisions;

    public DecisionsController(DecisionService decisions)
    {
        _decisions = decisions;
    }

    [HttpPost]
    public async Task<IActionResult> Create(Guid projectId, CreateDecisionRequest request)
    {
        var result = await _decisions.CreateAsync(projectId, request);
        return result is null ? NotFound() : Ok(result);
    }

    [HttpPut("{decisionId:guid}")]
    public async Task<IActionResult> Update(Guid projectId, Guid decisionId, UpdateDecisionRequest request)
    {
        var result = await _decisions.UpdateAsync(projectId, decisionId, request);
        return result is null ? NotFound() : Ok(result);
    }

    [HttpDelete("{decisionId:guid}")]
    public async Task<IActionResult> Delete(Guid projectId, Guid decisionId)
    {
        return await _decisions.DeleteAsync(projectId, decisionId) ? NoContent() : NotFound();
    }
}
