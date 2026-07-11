using System.Security.Claims;
using Enkl.Api.Dtos;
using Enkl.Api.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace Enkl.Api.Controllers;

[ApiController]
[Route("api/migration")]
public class MigrationController : ControllerBase
{
    private readonly MigrationService _migration;

    public MigrationController(MigrationService migration)
    {
        _migration = migration;
    }

    // Anonymous deliberately: the very first migration creates the first Organisation and User
    // accounts, so there's no one to authenticate as yet. Revisit once there's a standalone
    // "create Organisation" flow that can hand back credentials before the first migration runs.
    // If a valid JWT IS present, though, we use its orgId claim so a signed-in user migrating an
    // additional local project always lands in their own Organisation — see MigrationService's
    // ResolveOrganisationAsync for why an anonymous caller can no longer target an existing org by
    // name (security review finding C3: that was an unauthenticated cross-tenant account-injection
    // vector).
    [AllowAnonymous]
    [HttpPost("projects")]
    public async Task<IActionResult> MigrateProject(MigrationImportRequest request)
    {
        Guid? callerOrgId = null;
        if (User.Identity?.IsAuthenticated == true)
        {
            var orgIdClaim = User.FindFirstValue("orgId");
            if (orgIdClaim is not null) callerOrgId = Guid.Parse(orgIdClaim);
        }

        // ApiValidationException (cycle checks, etc.) is mapped to 400 by the global exception
        // handler in Program.cs — no per-controller try/catch needed.
        var result = await _migration.MigrateAsync(request, callerOrgId);
        return Ok(result);
    }
}
