using Enkl.Api.Dtos;
using Enkl.Api.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace Enkl.Api.Controllers;

[ApiController]
[Authorize(Policy = "ProjectMember")]
[Route("api/projects/{projectId:guid}/risks")]
public class RisksController : ControllerBase
{
    private readonly RiskService _risks;

    public RisksController(RiskService risks)
    {
        _risks = risks;
    }

    [HttpPost]
    public async Task<IActionResult> Create(Guid projectId, CreateRiskRequest request)
    {
        var result = await _risks.CreateAsync(projectId, request);
        return result is null ? NotFound() : Ok(result);
    }

    [HttpPut("{riskId:guid}")]
    public async Task<IActionResult> Update(Guid projectId, Guid riskId, UpdateRiskRequest request)
    {
        var result = await _risks.UpdateAsync(projectId, riskId, request);
        return result is null ? NotFound() : Ok(result);
    }

    [HttpDelete("{riskId:guid}")]
    public async Task<IActionResult> Delete(Guid projectId, Guid riskId)
    {
        return await _risks.DeleteAsync(projectId, riskId) ? NoContent() : NotFound();
    }
}
