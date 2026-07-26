using Enkl.Api.Dtos;
using Enkl.Api.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace Enkl.Api.Controllers;

/// <summary>Self-Service Dashboards, project-scoped. Read (List/Get) is available to any
/// ProjectMember; every mutation is additionally ProjectAdmin-gated per-action (same shape
/// ProjectsController.UpdateSettings/UpdateWorkflow already use) rather than a whole-class
/// ProjectAdmin gate, since unlike Columns/Members this controller genuinely has real GET routes
/// a plain member needs.</summary>
[ApiController]
[Authorize(Policy = "ProjectMember")]
[Route("api/projects/{projectId:guid}/dashboards")]
public class DashboardsController : ControllerBase
{
    private readonly DashboardService _dashboards;

    public DashboardsController(DashboardService dashboards)
    {
        _dashboards = dashboards;
    }

    [HttpGet]
    public async Task<IActionResult> List(Guid projectId)
    {
        return Ok(await _dashboards.ListAsync(projectId));
    }

    [HttpGet("{dashboardId:guid}")]
    public async Task<IActionResult> Get(Guid projectId, Guid dashboardId)
    {
        var result = await _dashboards.GetAsync(projectId, dashboardId);
        return result is null ? NotFound() : Ok(result);
    }

    [HttpPost]
    [Authorize(Policy = "ProjectAdmin")]
    public async Task<IActionResult> Create(Guid projectId, CreateDashboardRequest request)
    {
        var result = await _dashboards.CreateAsync(projectId, request);
        return result is null ? NotFound() : Ok(result);
    }

    [HttpPut("{dashboardId:guid}")]
    [Authorize(Policy = "ProjectAdmin")]
    public async Task<IActionResult> Update(Guid projectId, Guid dashboardId, CreateDashboardRequest request)
    {
        var result = await _dashboards.UpdateAsync(projectId, dashboardId, request);
        return result is null ? NotFound() : Ok(result);
    }

    [HttpDelete("{dashboardId:guid}")]
    [Authorize(Policy = "ProjectAdmin")]
    public async Task<IActionResult> Delete(Guid projectId, Guid dashboardId)
    {
        return await _dashboards.DeleteAsync(projectId, dashboardId) ? NoContent() : NotFound();
    }

    [HttpPost("{dashboardId:guid}/widgets")]
    [Authorize(Policy = "ProjectAdmin")]
    public async Task<IActionResult> CreateWidget(Guid projectId, Guid dashboardId, CreateDashboardWidgetRequest request)
    {
        var result = await _dashboards.CreateWidgetAsync(projectId, dashboardId, request);
        return result is null ? NotFound() : Ok(result);
    }

    [HttpPut("{dashboardId:guid}/widgets/{widgetId:guid}")]
    [Authorize(Policy = "ProjectAdmin")]
    public async Task<IActionResult> UpdateWidget(Guid projectId, Guid dashboardId, Guid widgetId, CreateDashboardWidgetRequest request)
    {
        var result = await _dashboards.UpdateWidgetAsync(projectId, dashboardId, widgetId, request);
        return result is null ? NotFound() : Ok(result);
    }

    [HttpDelete("{dashboardId:guid}/widgets/{widgetId:guid}")]
    [Authorize(Policy = "ProjectAdmin")]
    public async Task<IActionResult> DeleteWidget(Guid projectId, Guid dashboardId, Guid widgetId)
    {
        return await _dashboards.DeleteWidgetAsync(projectId, dashboardId, widgetId) ? NoContent() : NotFound();
    }
}
