using System.Security.Claims;
using System.Text.Json;
using Enkl.Api.Dtos;
using Enkl.Api.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace Enkl.Api.Controllers;

[ApiController]
[Authorize]
[Route("api/projects")]
public class ProjectsController : ControllerBase
{
    private readonly ProjectService _projects;

    public ProjectsController(ProjectService projects)
    {
        _projects = projects;
    }

    [HttpGet]
    public async Task<IActionResult> GetProjects()
    {
        var userId = Guid.Parse(User.FindFirstValue(ClaimTypes.NameIdentifier) ?? User.FindFirstValue("sub")!);
        return Ok(await _projects.GetProjectsForUserAsync(userId));
    }

    [HttpGet("{projectId:guid}")]
    [Authorize(Policy = "ProjectMember")]
    public async Task<IActionResult> GetProject(Guid projectId)
    {
        var detail = await _projects.GetProjectDetailAsync(projectId);
        return detail is null ? NotFound() : Ok(detail);
    }

    [HttpPut("{projectId:guid}/settings")]
    [Authorize(Policy = "ProjectMember")]
    public async Task<IActionResult> UpdateSettings(Guid projectId, ProjectSettingsDto request)
    {
        var result = await _projects.UpdateProjectSettingsAsync(projectId, request);
        return result is null ? NotFound() : Ok(result);
    }

    [HttpPut("{projectId:guid}/workflow")]
    [Authorize(Policy = "ProjectMember")]
    public async Task<IActionResult> UpdateWorkflow(Guid projectId, [FromBody] JsonElement request)
    {
        var result = await _projects.UpdateProjectWorkflowAsync(projectId, request);
        return result is null ? NotFound() : Ok(result);
    }
}
