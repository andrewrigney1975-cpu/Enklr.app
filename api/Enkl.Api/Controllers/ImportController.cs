using Enkl.Api.Auth;
using Enkl.Api.Dtos;
using Enkl.Api.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace Enkl.Api.Controllers;

/// <summary>Import Centre (App Settings &gt; Enterprise, Org-Admin only). One route per importable
/// entity — see ImportService's own doc comment for why this doesn't route through
/// OrganisationsController/MembersController etc. despite ultimately calling into those same
/// services' entity-creation logic.</summary>
[ApiController]
[Authorize(Policy = "OrgAdmin")]
[Route("api/organisations/me/import")]
public class ImportController : ControllerBase
{
    private readonly ImportService _import;

    public ImportController(ImportService import)
    {
        _import = import;
    }

    [HttpPost("organisation-users")]
    public async Task<IActionResult> ImportOrganisationUsers(ImportRequest request)
    {
        var result = await _import.ImportOrganisationUsersAsync(User.OrgId(), request);
        return Ok(result);
    }

    [HttpPost("team-members")]
    public async Task<IActionResult> ImportTeamMembers(ImportRequest request)
    {
        var result = await _import.ImportTeamMembersAsync(User.OrgId(), request);
        return Ok(result);
    }

    [HttpPost("teams-committees")]
    public async Task<IActionResult> ImportTeamsCommittees(ImportRequest request)
    {
        var result = await _import.ImportTeamsCommitteesAsync(User.OrgId(), request);
        return Ok(result);
    }
}
