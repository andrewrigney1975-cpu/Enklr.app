using Enkl.Api.Data;
using Enkl.Api.Domain.Entities;
using Enkl.Api.Dtos;
using Enkl.Api.Validation;
using Microsoft.EntityFrameworkCore;

namespace Enkl.Api.Services;

/// <summary>
/// The app's first per-User (not per-Project/per-Organisation) service — every method is scoped by
/// the caller's own userId, no project-membership or org-admin check involved anywhere (see
/// ToDoController's plain [Authorize], mirroring AuthController.ChangePassword's gating).
/// </summary>
public class ToDoService
{
    private readonly AppDbContext _db;

    public ToDoService(AppDbContext db)
    {
        _db = db;
    }

    public async Task<List<ToDoListDto>> ListAsync(Guid userId)
    {
        var lists = await _db.ToDoLists
            .Include(l => l.Items)
            .Where(l => l.UserId == userId)
            .OrderBy(l => l.DateCreated)
            .ToListAsync();

        return lists.Select(ToDto).ToList();
    }

    public async Task<ToDoListDto> CreateListAsync(Guid userId, CreateToDoListRequest request)
    {
        var title = (request.Title ?? "").Trim();
        if (title.Length == 0) throw new ApiValidationException("Please enter a list title.");
        if (title.Length > 200) title = title[..200];

        var now = DateTime.UtcNow;
        var list = new ToDoList { Id = Guid.NewGuid(), UserId = userId, Title = title, DateCreated = now, DateLastModified = now };
        _db.ToDoLists.Add(list);
        await _db.SaveChangesAsync();

        return ToDto(list);
    }

    /// <summary>Returns null if the list doesn't exist or belongs to a different User than the caller.</summary>
    public async Task<ToDoListDto?> RenameListAsync(Guid userId, Guid listId, UpdateToDoListRequest request)
    {
        var list = await _db.ToDoLists.Include(l => l.Items).FirstOrDefaultAsync(l => l.Id == listId && l.UserId == userId);
        if (list is null) return null;

        var title = (request.Title ?? "").Trim();
        if (title.Length == 0) throw new ApiValidationException("Please enter a list title.");
        list.Title = title.Length > 200 ? title[..200] : title;
        list.DateLastModified = DateTime.UtcNow;
        await _db.SaveChangesAsync();

        return ToDto(list);
    }

    public async Task<bool> DeleteListAsync(Guid userId, Guid listId)
    {
        var list = await _db.ToDoLists.FirstOrDefaultAsync(l => l.Id == listId && l.UserId == userId);
        if (list is null) return false;

        // ToDoItems.ToDoListId is Cascade — removing the list alone is enough (see 001_initial_schema.sql's
        // sibling comment / ToDoListConfiguration.cs).
        _db.ToDoLists.Remove(list);
        await _db.SaveChangesAsync();
        return true;
    }

    /// <summary>Returns null if the list doesn't exist or belongs to a different User than the caller —
    /// ToDoItem carries no UserId of its own, so ownership only ever flows through its parent list.</summary>
    public async Task<ToDoItemDto?> CreateItemAsync(Guid userId, Guid listId, CreateToDoItemRequest request)
    {
        var listExists = await _db.ToDoLists.AnyAsync(l => l.Id == listId && l.UserId == userId);
        if (!listExists) return null;

        var now = DateTime.UtcNow;
        var item = new ToDoItem
        {
            Id = Guid.NewGuid(), ToDoListId = listId,
            Note = request.Note ?? "", Completed = false, DueDate = request.DueDate,
            DateCreated = now, DateLastModified = now
        };
        _db.ToDoItems.Add(item);
        await _db.SaveChangesAsync();

        return ToItemDto(item);
    }

    public async Task<ToDoItemDto?> UpdateItemAsync(Guid userId, Guid listId, Guid itemId, UpdateToDoItemRequest request)
    {
        var item = await _db.ToDoItems
            .Include(i => i.ToDoList)
            .FirstOrDefaultAsync(i => i.Id == itemId && i.ToDoListId == listId && i.ToDoList.UserId == userId);
        if (item is null) return null;

        item.Note = request.Note ?? "";
        item.Completed = request.Completed;
        item.DueDate = request.DueDate;
        item.DateLastModified = DateTime.UtcNow;
        await _db.SaveChangesAsync();

        return ToItemDto(item);
    }

    public async Task<bool> DeleteItemAsync(Guid userId, Guid listId, Guid itemId)
    {
        var item = await _db.ToDoItems
            .Include(i => i.ToDoList)
            .FirstOrDefaultAsync(i => i.Id == itemId && i.ToDoListId == listId && i.ToDoList.UserId == userId);
        if (item is null) return false;

        _db.ToDoItems.Remove(item);
        await _db.SaveChangesAsync();
        return true;
    }

    private static ToDoListDto ToDto(ToDoList l) => new(
        l.Id, l.Title, l.DateCreated, l.DateLastModified,
        l.Items.OrderBy(i => i.DateCreated).Select(ToItemDto).ToList());

    private static ToDoItemDto ToItemDto(ToDoItem i) => new(i.Id, i.Note, i.Completed, i.DueDate, i.DateCreated, i.DateLastModified);
}
