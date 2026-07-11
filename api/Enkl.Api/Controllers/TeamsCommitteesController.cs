using Enkl.Api.Dtos;
using Enkl.Api.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace Enkl.Api.Controllers;

// Team/committee CRUD (including applying a synced Org Team's membership onto one) is OrgAdmin-only
// — per product decision, a project member without that flag should neither see nor be able to use
// the Teams & Committees feature to change membership. Both [Authorize] policies must independently
// succeed (ASP.NET Core combines multiple attributes with AND), so this stays gated to members of
// this specific project who are ALSO their organisation's admin — see board.js's
// applyHeaderButtonVisibility for the matching frontend button-visibility gate.
[ApiController]
[Authorize(Policy = "ProjectMember")]
[Authorize(Policy = "OrgAdmin")]
[Route("api/projects/{projectId:guid}/teams-committees")]
public class TeamsCommitteesController : ControllerBase
{
    private readonly TeamCommitteeService _teamsCommittees;

    public TeamsCommitteesController(TeamCommitteeService teamsCommittees)
    {
        _teamsCommittees = teamsCommittees;
    }

    [HttpPost]
    public async Task<IActionResult> Create(Guid projectId, CreateTeamCommitteeRequest request)
    {
        var result = await _teamsCommittees.CreateAsync(projectId, request);
        return result is null ? NotFound() : Ok(result);
    }

    [HttpPut("{id:guid}")]
    public async Task<IActionResult> Update(Guid projectId, Guid id, UpdateTeamCommitteeRequest request)
    {
        var result = await _teamsCommittees.UpdateAsync(projectId, id, request);
        return result is null ? NotFound() : Ok(result);
    }

    [HttpDelete("{id:guid}")]
    public async Task<IActionResult> Delete(Guid projectId, Guid id)
    {
        return await _teamsCommittees.DeleteAsync(projectId, id) ? NoContent() : NotFound();
    }

    [HttpPost("from-org-team/{orgTeamId:guid}")]
    public async Task<IActionResult> ApplyOrgTeam(Guid projectId, Guid orgTeamId)
    {
        var result = await _teamsCommittees.ApplyOrgTeamAsync(projectId, orgTeamId);
        return result is null ? NotFound() : Ok(result);
    }
}
