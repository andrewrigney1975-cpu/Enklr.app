namespace Enkl.Api.Domain.Entities;

/// <summary>
/// The app's first genuinely per-User resource (not scoped to a Project or an Organisation like
/// everything else) — owned by exactly one User, deleting the user or the list cascades to its items.
/// </summary>
public class ToDoList
{
    public Guid Id { get; set; }
    public Guid UserId { get; set; }
    public User User { get; set; } = null!;
    public string Title { get; set; } = "";
    public DateTime DateCreated { get; set; }
    public DateTime DateLastModified { get; set; }

    public List<ToDoItem> Items { get; set; } = new();
}
