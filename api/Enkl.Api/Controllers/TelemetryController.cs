using Enkl.Api.Dtos;
using Enkl.Api.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;

namespace Enkl.Api.Controllers;

/// <summary>
/// Anonymous Real User Monitoring beacon — no Authorize policy at all (unlike every other
/// controller in this API), since it's a fire-and-forget report from every page load, signed in or
/// not. See Program.cs's MustChangePassword-enforcement middleware, which explicitly excludes this
/// route's path — there's no authenticated session here for that gate to meaningfully apply to, but
/// a signed-in caller's token (if one happens to be attached) would otherwise still authenticate and
/// trip it. Rate-limited (same IP-partitioned sliding-window mechanism as MigrationController/
/// AuthController, its own "telemetry" policy — see Program.cs) since this is a new unauthenticated
/// write surface.
/// </summary>
[EnableRateLimiting("telemetry")]
[ApiController]
[AllowAnonymous]
[Route("api/telemetry")]
public class TelemetryController : ControllerBase
{
    private readonly TelemetryService _telemetry;

    public TelemetryController(TelemetryService telemetry)
    {
        _telemetry = telemetry;
    }

    [HttpPost("page-load")]
    public async Task<IActionResult> ReportPageLoad(ReportPageLoadRequest request)
    {
        await _telemetry.RecordPageLoadAsync(request.DurationMs);
        return NoContent();
    }
}
