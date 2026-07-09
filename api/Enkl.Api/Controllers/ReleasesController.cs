using Enkl.Api.Dtos;
using Enkl.Api.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace Enkl.Api.Controllers;

[ApiController]
[Authorize(Policy = "ProjectMember")]
[Route("api/projects/{projectId:guid}/releases")]
public class ReleasesController : ControllerBase
{
    private readonly ReleaseService _releases;

    public ReleasesController(ReleaseService releases)
    {
        _releases = releases;
    }

    [HttpPost]
    public async Task<IActionResult> Create(Guid projectId, CreateReleaseRequest request)
    {
        var result = await _releases.CreateAsync(projectId, request);
        return result is null ? NotFound() : Ok(result);
    }

    [HttpPut("{releaseId:guid}")]
    public async Task<IActionResult> Update(Guid projectId, Guid releaseId, UpdateReleaseRequest request)
    {
        var result = await _releases.UpdateAsync(projectId, releaseId, request);
        return result is null ? NotFound() : Ok(result);
    }

    [HttpDelete("{releaseId:guid}")]
    public async Task<IActionResult> Delete(Guid projectId, Guid releaseId)
    {
        return await _releases.DeleteAsync(projectId, releaseId) ? NoContent() : NotFound();
    }
}
