namespace Enkl.Api.Domain.Entities;

public class ToDoItem
{
    public Guid Id { get; set; }
    public Guid ToDoListId { get; set; }
    public ToDoList ToDoList { get; set; } = null!;
    public string Note { get; set; } = "";
    public bool Completed { get; set; }

    /// <summary>The app's first true datetime-with-time-of-day field — every other date field (Task/Release/Project) is date-only.</summary>
    public DateTime? DueDate { get; set; }

    public DateTime DateCreated { get; set; }
    public DateTime DateLastModified { get; set; }
}
