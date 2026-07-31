using Enkl.Api.Auth;
using Enkl.Api.Dtos;
using Enkl.Api.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace Enkl.Api.Controllers;

// Self-service, current-user-only — every signed-in user manages their own preferences, so this is
// [Authorize] only, no "OrgAdmin"/ProjectMember policy (unlike OrganisationsController's
// /api/organisations/me/* routes, which are all OrgAdmin-gated over OTHER users).
[ApiController]
[Authorize]
[Route("api/users/me")]
public class UsersController : ControllerBase
{
    private readonly UserPreferencesService _preferences;

    public UsersController(UserPreferencesService preferences)
    {
        _preferences = preferences;
    }

    [HttpGet("preferences")]
    public async Task<ActionResult<UserPreferencesDto>> GetPreferences()
    {
        var result = await _preferences.GetAsync(User.UserId());
        return Ok(result);
    }

    [HttpPut("preferences")]
    public async Task<IActionResult> UpdatePreferences(UpdateUserPreferencesRequest request)
    {
        var result = await _preferences.UpdateAsync(User.UserId(), request);
        return result is null ? BadRequest(new { message = "Avatar image is too large." }) : Ok(result);
    }
}
