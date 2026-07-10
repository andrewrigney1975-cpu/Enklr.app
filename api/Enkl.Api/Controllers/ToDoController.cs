using System.Security.Claims;
using Enkl.Api.Dtos;
using Enkl.Api.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace Enkl.Api.Controllers;

/// <summary>
/// Per-User resource, not per-Project/per-Organisation — plain [Authorize] with no Policy, same
/// gating as AuthController.ChangePassword (see that controller's own routing). Every action is
/// scoped by the caller's own userId; there's no {projectId}/{orgId} route segment anywhere here.
/// </summary>
[ApiController]
[Authorize]
[Route("api/todo-lists")]
public class ToDoController : ControllerBase
{
    private readonly ToDoService _todo;

    public ToDoController(ToDoService todo)
    {
        _todo = todo;
    }

    [HttpGet]
    public async Task<IActionResult> List()
    {
        return Ok(await _todo.ListAsync(CallerUserId()));
    }

    [HttpPost]
    public async Task<IActionResult> Create(CreateToDoListRequest request)
    {
        return Ok(await _todo.CreateListAsync(CallerUserId(), request));
    }

    [HttpPut("{listId:guid}")]
    public async Task<IActionResult> Rename(Guid listId, UpdateToDoListRequest request)
    {
        var result = await _todo.RenameListAsync(CallerUserId(), listId, request);
        return result is null ? NotFound() : Ok(result);
    }

    [HttpDelete("{listId:guid}")]
    public async Task<IActionResult> Delete(Guid listId)
    {
        return await _todo.DeleteListAsync(CallerUserId(), listId) ? NoContent() : NotFound();
    }

    [HttpPost("{listId:guid}/items")]
    public async Task<IActionResult> CreateItem(Guid listId, CreateToDoItemRequest request)
    {
        var result = await _todo.CreateItemAsync(CallerUserId(), listId, request);
        return result is null ? NotFound() : Ok(result);
    }

    [HttpPut("{listId:guid}/items/{itemId:guid}")]
    public async Task<IActionResult> UpdateItem(Guid listId, Guid itemId, UpdateToDoItemRequest request)
    {
        var result = await _todo.UpdateItemAsync(CallerUserId(), listId, itemId, request);
        return result is null ? NotFound() : Ok(result);
    }

    [HttpDelete("{listId:guid}/items/{itemId:guid}")]
    public async Task<IActionResult> DeleteItem(Guid listId, Guid itemId)
    {
        return await _todo.DeleteItemAsync(CallerUserId(), listId, itemId) ? NoContent() : NotFound();
    }

    private Guid CallerUserId() => Guid.Parse(User.FindFirstValue(ClaimTypes.NameIdentifier) ?? User.FindFirstValue("sub")!);
}
