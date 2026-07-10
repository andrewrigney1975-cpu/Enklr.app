using Enkl.Api.Auth;
using Enkl.Api.Dtos;
using Enkl.Api.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace Enkl.Api.Controllers;

/// <summary>SCIM 2.0 Groups endpoint for one Organisation — same ScimAuthFilter bearer-token gating
/// as ScimUsersController; see that controller's own comment for the rationale.</summary>
[ApiController]
[AllowAnonymous]
[TypeFilter(typeof(ScimAuthFilter))]
[Route("api/scim/v2/{orgId:guid}/Groups")]
public class ScimGroupsController : ControllerBase
{
    private readonly ScimGroupService _groups;

    public ScimGroupsController(ScimGroupService groups)
    {
        _groups = groups;
    }

    [HttpGet]
    public async Task<IActionResult> List(Guid orgId, [FromQuery] string? filter, [FromQuery] int startIndex = 1, [FromQuery] int count = 100)
    {
        return Ok(await _groups.ListAsync(orgId, filter, startIndex, count));
    }

    [HttpGet("{id:guid}")]
    public async Task<IActionResult> Get(Guid orgId, Guid id)
    {
        var result = await _groups.GetAsync(orgId, id);
        return result is null ? ScimNotFound() : Ok(result);
    }

    [HttpPost]
    public async Task<IActionResult> Create(Guid orgId, ScimGroupRequest request)
    {
        var result = await _groups.CreateAsync(orgId, request);
        return Created($"/api/scim/v2/{orgId}/Groups/{result.Id}", result);
    }

    [HttpPut("{id:guid}")]
    public async Task<IActionResult> Replace(Guid orgId, Guid id, ScimGroupRequest request)
    {
        var result = await _groups.ReplaceAsync(orgId, id, request);
        return result is null ? ScimNotFound() : Ok(result);
    }

    [HttpPatch("{id:guid}")]
    public async Task<IActionResult> Patch(Guid orgId, Guid id, ScimPatchRequest request)
    {
        var result = await _groups.PatchAsync(orgId, id, request);
        return result is null ? ScimNotFound() : Ok(result);
    }

    [HttpDelete("{id:guid}")]
    public async Task<IActionResult> Delete(Guid orgId, Guid id)
    {
        return await _groups.DeleteAsync(orgId, id) ? NoContent() : ScimNotFound();
    }

    private ObjectResult ScimNotFound() => new(new
    {
        schemas = new[] { ScimSchemas.Error },
        status = "404",
        detail = "Group not found."
    })
    { StatusCode = 404 };
}
