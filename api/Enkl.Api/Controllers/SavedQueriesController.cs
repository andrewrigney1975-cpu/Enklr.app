using Enkl.Api.Dtos;
using Enkl.Api.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace Enkl.Api.Controllers;

[ApiController]
[Authorize(Policy = "ProjectMember")]
[Route("api/projects/{projectId:guid}/saved-queries")]
public class SavedQueriesController : ControllerBase
{
    private readonly SavedQueryService _savedQueries;

    public SavedQueriesController(SavedQueryService savedQueries)
    {
        _savedQueries = savedQueries;
    }

    [HttpPost]
    public async Task<IActionResult> Create(Guid projectId, CreateSavedQueryRequest request)
    {
        var result = await _savedQueries.CreateAsync(projectId, request);
        return result is null ? NotFound() : Ok(result);
    }

    [HttpPut("{queryId:guid}")]
    public async Task<IActionResult> Update(Guid projectId, Guid queryId, CreateSavedQueryRequest request)
    {
        var result = await _savedQueries.UpdateAsync(projectId, queryId, request);
        return result is null ? NotFound() : Ok(result);
    }

    [HttpDelete("{queryId:guid}")]
    public async Task<IActionResult> Delete(Guid projectId, Guid queryId)
    {
        return await _savedQueries.DeleteAsync(projectId, queryId) ? NoContent() : NotFound();
    }
}
