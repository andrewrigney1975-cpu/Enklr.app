using Enkl.Api.Dtos;
using Enkl.Api.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace Enkl.Api.Controllers;

[ApiController]
[Authorize(Policy = "ProjectMember")]
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
}
