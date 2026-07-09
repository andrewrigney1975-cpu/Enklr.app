namespace Enkl.Api.Domain.Entities;

public class TaskType
{
    public Guid Id { get; set; }
    public Guid ProjectId { get; set; }
    public Project Project { get; set; } = null!;
    public string Name { get; set; } = "";
    /// <summary>Must be one of TASK_TYPE_ICON_LIBRARY (src/js/utils.js) or null — validated in Validation/FieldClamps.cs.</summary>
    public string? IconName { get; set; }
}
