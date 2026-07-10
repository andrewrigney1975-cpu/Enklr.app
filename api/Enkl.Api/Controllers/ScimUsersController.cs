using Enkl.Api.Auth;
using Enkl.Api.Dtos;
using Enkl.Api.Services;
using Enkl.Api.Validation;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace Enkl.Api.Controllers;

/// <summary>
/// SCIM 2.0 Users endpoint for one Organisation — gated by ScimAuthFilter's per-org static bearer
/// token, not a user JWT (see that filter's own comment for why). Anonymous at the ASP.NET Core
/// auth-scheme level for the same reason SamlController is: the filter itself is the real gate.
/// ApiValidationException (thrown by the shared EmailValidation helper) is caught locally here and
/// translated into a SCIM error envelope rather than letting it reach the app's generic
/// {message}-shaped exception handler, which a SCIM client wouldn't recognize.
/// </summary>
[ApiController]
[AllowAnonymous]
[TypeFilter(typeof(ScimAuthFilter))]
[Route("api/scim/v2/{orgId:guid}/Users")]
public class ScimUsersController : ControllerBase
{
    private readonly ScimUserService _users;

    public ScimUsersController(ScimUserService users)
    {
        _users = users;
    }

    [HttpGet]
    public async Task<IActionResult> List(Guid orgId, [FromQuery] string? filter, [FromQuery] int startIndex = 1, [FromQuery] int count = 100)
    {
        return Ok(await _users.ListAsync(orgId, filter, startIndex, count));
    }

    [HttpGet("{id:guid}")]
    public async Task<IActionResult> Get(Guid orgId, Guid id)
    {
        var result = await _users.GetAsync(orgId, id);
        return result is null ? ScimNotFound() : Ok(result);
    }

    [HttpPost]
    public async Task<IActionResult> Create(Guid orgId, ScimUserRequest request)
    {
        try
        {
            var result = await _users.CreateAsync(orgId, request);
            return Created($"/api/scim/v2/{orgId}/Users/{result.Id}", result);
        }
        catch (ApiValidationException ex)
        {
            return ScimError(400, ex.Message);
        }
    }

    [HttpPut("{id:guid}")]
    public async Task<IActionResult> Replace(Guid orgId, Guid id, ScimUserRequest request)
    {
        try
        {
            var result = await _users.ReplaceAsync(orgId, id, request);
            return result is null ? ScimNotFound() : Ok(result);
        }
        catch (ApiValidationException ex)
        {
            return ScimError(400, ex.Message);
        }
    }

    [HttpPatch("{id:guid}")]
    public async Task<IActionResult> Patch(Guid orgId, Guid id, ScimPatchRequest request)
    {
        try
        {
            var result = await _users.PatchAsync(orgId, id, request);
            return result is null ? ScimNotFound() : Ok(result);
        }
        catch (ApiValidationException ex)
        {
            return ScimError(400, ex.Message);
        }
    }

    [HttpDelete("{id:guid}")]
    public async Task<IActionResult> Delete(Guid orgId, Guid id)
    {
        var result = await _users.DeleteAsync(orgId, id);
        return result switch
        {
            ScimDeleteResult.Deleted => NoContent(),
            ScimDeleteResult.NotFound => ScimNotFound(),
            ScimDeleteResult.HasProjectMemberships => ScimError(409, "This user is still a member of one or more projects. Remove them from those projects, or deactivate the account (PATCH active:false) instead of deleting it."),
            _ => ScimError(500, "Unexpected error.")
        };
    }

    private ObjectResult ScimNotFound() => ScimError(404, "User not found.");

    private ObjectResult ScimError(int status, string detail) => new(new
    {
        schemas = new[] { ScimSchemas.Error },
        status = status.ToString(),
        detail
    })
    { StatusCode = status };
}
