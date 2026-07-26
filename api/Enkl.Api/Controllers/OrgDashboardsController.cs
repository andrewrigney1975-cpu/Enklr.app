using Enkl.Api.Auth;
using Enkl.Api.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace Enkl.Api.Controllers;

/// <summary>Org-Admin-only cross-project Dashboard browsing — Portfolio-pattern shape
/// (class-level OrgAdmin policy, caller's own OrgId claim is the only scope, root CLAUDE.md §4).
/// A Project Admin who isn't also an Org Admin never reaches this — they're limited to
/// DashboardsController's per-project routes, same as a plain member.</summary>
[ApiController]
[Authorize(Policy = "OrgAdmin")]
[Route("api/organisations/me/dashboards")]
public class OrgDashboardsController : ControllerBase
{
    private readonly DashboardService _dashboards;

    public OrgDashboardsController(DashboardService dashboards)
    {
        _dashboards = dashboards;
    }

    [HttpGet]
    public async Task<IActionResult> List()
    {
        return Ok(await _dashboards.ListForOrgAsync(User.OrgId()));
    }
}
