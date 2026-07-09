using Enkl.Api.Dtos;
using Enkl.Api.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace Enkl.Api.Controllers;

[ApiController]
[Authorize(Policy = "ProjectMember")]
[Route("api/projects/{projectId:guid}/columns")]
public class ColumnsController : ControllerBase
{
    private readonly ColumnService _columns;

    public ColumnsController(ColumnService columns)
    {
        _columns = columns;
    }

    [HttpPost]
    public async Task<IActionResult> Create(Guid projectId, CreateColumnRequest request)
    {
        return Ok(await _columns.CreateAsync(projectId, request));
    }

    [HttpPut("{columnId:guid}")]
    public async Task<IActionResult> Update(Guid projectId, Guid columnId, UpdateColumnRequest request)
    {
        var result = await _columns.UpdateAsync(projectId, columnId, request);
        return result is null ? NotFound() : Ok(result);
    }

    [HttpDelete("{columnId:guid}")]
    public async Task<IActionResult> Delete(Guid projectId, Guid columnId)
    {
        return await _columns.DeleteAsync(projectId, columnId) ? NoContent() : NotFound();
    }
}
