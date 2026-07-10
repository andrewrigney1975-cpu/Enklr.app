namespace Enkl.Api.Dtos;

public record ToDoItemDto(Guid Id, string Note, bool Completed, DateTime? DueDate, DateTime DateCreated, DateTime DateLastModified);
public record ToDoListDto(Guid Id, string Title, DateTime DateCreated, DateTime DateLastModified, List<ToDoItemDto> Items);

public record CreateToDoListRequest(string Title);
public record UpdateToDoListRequest(string Title);

public record CreateToDoItemRequest(string Note, DateTime? DueDate);
/// <summary>One PUT covers note/due-date edits and the completed toggle alike — there's no separate toggle-only endpoint.</summary>
public record UpdateToDoItemRequest(string Note, bool Completed, DateTime? DueDate);
