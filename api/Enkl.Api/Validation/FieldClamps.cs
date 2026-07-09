namespace Enkl.Api.Validation;

/// <summary>Ported from TASK_TYPE_ICON_LIBRARY (src/js/utils.js) — a TaskType's IconName must be one
/// of these or null, same rule storage.js's isValidTaskTypeIconName enforces client-side.</summary>
public static class FieldClamps
{
    public static readonly HashSet<string> TaskTypeIconNames = new()
    {
        "sparkle", "bug", "ty_investigate", "ty_document", "ty_analyse", "ty_procure", "ty_audit",
        "ty_report", "ty_communicate", "ty_design", "ty_develop", "ty_test", "ty_review", "ty_plan",
        "ty_research", "ty_train", "ty_support", "ty_deploy", "ty_migrate", "ty_configure",
        "ty_monitor", "ty_approve", "ty_negotiate", "ty_schedule", "ty_maintain", "ty_coordinate"
    };

    public static string? ValidIconNameOrNull(string? name) => name is not null && TaskTypeIconNames.Contains(name) ? name : null;
}
