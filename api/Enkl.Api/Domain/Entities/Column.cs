namespace Enkl.Api.Domain.Entities;

public class Column
{
    public Guid Id { get; set; }
    public Guid ProjectId { get; set; }
    public Project Project { get; set; } = null!;
    public string Name { get; set; } = "";
    public bool Done { get; set; }
    public string? Color { get; set; }

    /// <summary>Whether Color also tints the column's background (the pre-existing full look);
    /// when false, Color still colors the top border but the background stays the plain default
    /// grey. Defaults true so every pre-existing colored column keeps its current appearance.</summary>
    public bool ColorBackground { get; set; } = true;

    /// <summary>Marks this as a "blocked" column: a normal column that can also hold real tasks, but
    /// additionally renders a non-draggable ghost clone of any project task currently blocked by an
    /// unfinished dependency (see utils.js's isTaskBlocked) — purely a frontend rendering concern,
    /// nothing server-side reads this beyond persisting/returning it.</summary>
    public bool IsBlocked { get; set; }
    public int Order { get; set; }

    /// <summary>WIP limit: -1 (default) means uncapped, any positive integer caps how many active
    /// tasks may sit in this column at once — see workflow-engine.js's evaluateColumnCap.</summary>
    public int Cap { get; set; } = -1;
}
