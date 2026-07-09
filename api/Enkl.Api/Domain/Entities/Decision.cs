namespace Enkl.Api.Domain.Entities;

public class Decision
{
    public Guid Id { get; set; }
    public Guid ProjectId { get; set; }
    public Project Project { get; set; } = null!;
    public string Key { get; set; } = "";
    public string Title { get; set; } = "";
    public string? Description { get; set; }
    /// <summary>strategy/policy/budgetary/financial/functional/technical/process/operational — DECISION_TYPE_META in config.js.</summary>
    public string Type { get; set; } = "operational";
    /// <summary>open / in_review / completed — DECISION_STATUS_META in src/js/config.js.</summary>
    public string Status { get; set; } = "open";
    public string? Outcome { get; set; }
    public Guid? OwnerId { get; set; }
    public ProjectMember? Owner { get; set; }
    /// <summary>Free-text approver name (not a ProjectMember FK — mirrors dec.approver in export.js).</summary>
    public string? Approver { get; set; }
    public Guid? TaskId { get; set; }
    public TaskItem? Task { get; set; }
    public DateTime DateCreated { get; set; }
    public DateTime DateLastModified { get; set; }

    public List<DecisionDocument> Documents { get; set; } = new();
    public List<DecisionRisk> Risks { get; set; } = new();
    public List<DecisionPrinciple> Principles { get; set; } = new();
    public List<DecisionObjective> Objectives { get; set; } = new();
}
