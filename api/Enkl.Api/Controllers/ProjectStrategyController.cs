using Enkl.Api.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace Enkl.Api.Controllers;

/// <summary>
/// Read-only Strategy surface for regular project members (ProjectMemberAuthorizationHandler already
/// live-verifies membership — or Org Admin status — against a real ProjectMembers row per request,
/// same discipline as PrinciplesController/RisksController/etc). No CRUD lives here at all; every
/// write happens through StrategyController (OrgAdmin) or the Portfolio Planner's fulfilment-upsert
/// route instead.
/// </summary>
[ApiController]
[Authorize(Policy = "ProjectMember")]
[Route("api/projects/{projectId:guid}/strategy")]
public class ProjectStrategyController : ControllerBase
{
    private readonly StrategyPillarService _pillars;
    private readonly StrategyMetricService _metrics;
    private readonly StrategyFulfilmentService _fulfilment;

    public ProjectStrategyController(StrategyPillarService pillars, StrategyMetricService metrics, StrategyFulfilmentService fulfilment)
    {
        _pillars = pillars;
        _metrics = metrics;
        _fulfilment = fulfilment;
    }

    [HttpGet("tree")]
    public async Task<IActionResult> GetTree(Guid projectId)
    {
        var tree = await _pillars.GetActivePillarTreeForProjectAsync(projectId);
        return tree is null ? NotFound() : Ok(tree);
    }

    [HttpGet("metrics/{metricId:guid}/entries")]
    public async Task<IActionResult> GetMetricHistory(Guid projectId, Guid metricId)
    {
        var history = await _metrics.GetHistoryForProjectAsync(projectId, metricId);
        return history is null ? NotFound() : Ok(history);
    }

    [HttpGet("fulfilment")]
    public async Task<IActionResult> GetFulfilment(Guid projectId)
    {
        var matrix = await _fulfilment.BuildSingleProjectMatrixAsync(projectId);
        return matrix is null ? NotFound() : Ok(matrix);
    }
}
