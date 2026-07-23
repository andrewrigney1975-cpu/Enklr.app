using Enkl.Api.Auth;
using Enkl.Api.Dtos;
using Enkl.Api.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace Enkl.Api.Controllers;

/// <summary>
/// Org-Admin-only management of Strategies/Pillars/Enablers/Metrics + the fulfilment-matrix upsert
/// and OrgAdmin-side read. OrgAdmin policy ONLY (same reasoning as PortfolioController: an admin
/// managing strategy may not personally belong to every project it's mapped against). The
/// read-only ProjectMember surface lives in ProjectStrategyController instead.
/// </summary>
[ApiController]
[Authorize(Policy = "OrgAdmin")]
[Route("api/organisations/me/strategy")]
public class StrategyController : ControllerBase
{
    private readonly StrategyService _strategies;
    private readonly StrategyPillarService _pillars;
    private readonly StrategyMetricService _metrics;
    private readonly StrategyFulfilmentService _fulfilment;

    public StrategyController(StrategyService strategies, StrategyPillarService pillars, StrategyMetricService metrics, StrategyFulfilmentService fulfilment)
    {
        _strategies = strategies;
        _pillars = pillars;
        _metrics = metrics;
        _fulfilment = fulfilment;
    }

    [HttpGet]
    public async Task<IActionResult> List()
    {
        return Ok(await _strategies.ListAsync(User.OrgId()));
    }

    [HttpGet("active")]
    public async Task<IActionResult> GetActive()
    {
        var active = await _strategies.GetActiveAsync(User.OrgId());
        return active is null ? NotFound() : Ok(active);
    }

    [HttpPost]
    public async Task<IActionResult> Create(CreateStrategyRequest request)
    {
        return Ok(await _strategies.CreateAsync(User.OrgId(), request));
    }

    [HttpPut("{strategyId:guid}")]
    public async Task<IActionResult> Update(Guid strategyId, UpdateStrategyRequest request)
    {
        var result = await _strategies.UpdateAsync(User.OrgId(), strategyId, request);
        return result is null ? NotFound() : Ok(result);
    }

    [HttpPut("{strategyId:guid}/activate")]
    public async Task<IActionResult> Activate(Guid strategyId)
    {
        var result = await _strategies.ActivateAsync(User.OrgId(), strategyId);
        return result is null ? NotFound() : Ok(result);
    }

    [HttpDelete("{strategyId:guid}")]
    public async Task<IActionResult> Delete(Guid strategyId)
    {
        return await _strategies.DeleteAsync(User.OrgId(), strategyId) ? NoContent() : NotFound();
    }

    [HttpGet("{strategyId:guid}/tree")]
    public async Task<IActionResult> GetTree(Guid strategyId)
    {
        // Strategy ownership check happens implicitly: an empty tree for a foreign-org strategyId
        // looks identical to a real, empty own-org strategy — no enumeration oracle either way.
        var active = await _strategies.ListAsync(User.OrgId());
        if (!active.Any(s => s.Id == strategyId)) return NotFound();
        return Ok(await _pillars.GetPillarTreeAsync(strategyId));
    }

    [HttpPost("{strategyId:guid}/pillars")]
    public async Task<IActionResult> CreatePillar(Guid strategyId, CreateStrategyPillarRequest request)
    {
        var result = await _pillars.CreatePillarAsync(User.OrgId(), strategyId, request);
        return result is null ? NotFound() : Ok(result);
    }

    [HttpPut("pillars/{pillarId:guid}")]
    public async Task<IActionResult> UpdatePillar(Guid pillarId, UpdateStrategyPillarRequest request)
    {
        var result = await _pillars.UpdatePillarAsync(User.OrgId(), pillarId, request);
        return result is null ? NotFound() : Ok(result);
    }

    [HttpDelete("pillars/{pillarId:guid}")]
    public async Task<IActionResult> DeletePillar(Guid pillarId)
    {
        return await _pillars.DeletePillarAsync(User.OrgId(), pillarId) ? NoContent() : NotFound();
    }

    [HttpPost("pillars/{pillarId:guid}/enablers")]
    public async Task<IActionResult> CreateEnabler(Guid pillarId, CreateStrategyEnablerRequest request)
    {
        var result = await _pillars.CreateEnablerAsync(User.OrgId(), pillarId, request);
        return result is null ? NotFound() : Ok(result);
    }

    [HttpPut("enablers/{enablerId:guid}")]
    public async Task<IActionResult> UpdateEnabler(Guid enablerId, UpdateStrategyEnablerRequest request)
    {
        var result = await _pillars.UpdateEnablerAsync(User.OrgId(), enablerId, request);
        return result is null ? NotFound() : Ok(result);
    }

    [HttpDelete("enablers/{enablerId:guid}")]
    public async Task<IActionResult> DeleteEnabler(Guid enablerId)
    {
        return await _pillars.DeleteEnablerAsync(User.OrgId(), enablerId) ? NoContent() : NotFound();
    }

    [HttpPost("pillars/{pillarId:guid}/metrics")]
    public async Task<IActionResult> CreateMetricOnPillar(Guid pillarId, CreateStrategyMetricRequest request)
    {
        var result = await _metrics.CreateAsync(User.OrgId(), pillarId, null, request);
        return result is null ? BadRequest() : Ok(result);
    }

    [HttpPost("enablers/{enablerId:guid}/metrics")]
    public async Task<IActionResult> CreateMetricOnEnabler(Guid enablerId, CreateStrategyMetricRequest request)
    {
        var result = await _metrics.CreateAsync(User.OrgId(), null, enablerId, request);
        return result is null ? BadRequest() : Ok(result);
    }

    [HttpPut("metrics/{metricId:guid}")]
    public async Task<IActionResult> UpdateMetric(Guid metricId, UpdateStrategyMetricRequest request)
    {
        var result = await _metrics.UpdateAsync(User.OrgId(), metricId, request);
        return result is null ? NotFound() : Ok(result);
    }

    [HttpDelete("metrics/{metricId:guid}")]
    public async Task<IActionResult> DeleteMetric(Guid metricId)
    {
        return await _metrics.DeleteAsync(User.OrgId(), metricId) ? NoContent() : NotFound();
    }

    [HttpPost("metrics/{metricId:guid}/entries")]
    public async Task<IActionResult> RecordMetricEntry(Guid metricId, CreateStrategyMetricEntryRequest request)
    {
        var result = await _metrics.RecordEntryAsync(User.OrgId(), metricId, request);
        return result is null ? NotFound() : Ok(result);
    }

    [HttpGet("metrics/{metricId:guid}/entries")]
    public async Task<IActionResult> GetMetricHistory(Guid metricId)
    {
        var result = await _metrics.GetHistoryAsync(User.OrgId(), metricId);
        return result is null ? NotFound() : Ok(result);
    }

    // GET, not POST — pure read, same MustChangePassword-gate-avoidance reasoning as
    // PortfolioController.GetAggregate. projectIds is a single comma-joined string, matching
    // PortfolioController's own convention for cross-framework array-param portability.
    [HttpGet("fulfilment-matrix")]
    public async Task<IActionResult> GetFulfilmentMatrix([FromQuery] string? projectIds)
    {
        var ids = (projectIds ?? "")
            .Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
            .Select(s => Guid.TryParse(s, out var g) ? g : (Guid?)null)
            .Where(g => g.HasValue)
            .Select(g => g!.Value)
            .ToList();
        return Ok(await _fulfilment.BuildMatrixAsync(User.OrgId(), ids));
    }

    // Absolute route override — logically nested under Portfolio Planner's own namespace (the only
    // place this is ever written from, per the approved plan) rather than under this controller's
    // own /strategy prefix. A genuine mutation, so PUT (trips the MustChangePassword gate, as intended).
    [HttpPut("~/api/organisations/me/portfolio/projects/{projectId:guid}/strategy-fulfilment/{pillarId:guid}")]
    public async Task<IActionResult> UpsertFulfilment(Guid projectId, Guid pillarId, UpsertProjectPillarFulfilmentRequest request)
    {
        var result = await _fulfilment.UpsertAsync(User.OrgId(), projectId, pillarId, request);
        return result is null ? NotFound() : Ok(result);
    }
}
