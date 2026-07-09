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
    [AllowAnonymous]
    [HttpPost("projects")]
    public async Task<IActionResult> MigrateProject(MigrationImportRequest request)
    {
        // ApiValidationException (cycle checks, etc.) is mapped to 400 by the global exception
        // handler in Program.cs — no per-controller try/catch needed.
        var result = await _migration.MigrateAsync(request);
        return Ok(result);
    }
}
