namespace Enkl.Api.Domain.Entities;

public class Risk
{
    public Guid Id { get; set; }
    public Guid ProjectId { get; set; }
    public Project Project { get; set; } = null!;
    public string Key { get; set; } = "";
    public string Title { get; set; } = "";
    public string? Description { get; set; }
    /// <summary>1-5 — RISK_LIKELIHOOD_META in src/js/config.js.</summary>
    public int Likelihood { get; set; }
    /// <summary>1-5 — RISK_IMPACT_META in src/js/config.js.</summary>
    public int Impact { get; set; }
    public string? Mitigations { get; set; }
    public Guid? OwnerId { get; set; }
    public ProjectMember? Owner { get; set; }
    public Guid? TaskId { get; set; }
    public TaskItem? Task { get; set; }
    /// <summary>new / in_review / closed — RISK_STATUS_META in src/js/config.js.</summary>
    public string Status { get; set; } = "new";
    public DateOnly? DateToClose { get; set; }
    public DateOnly? DateClosed { get; set; }
    public DateTime DateCreated { get; set; }
    public DateTime DateLastModified { get; set; }

    public List<RiskDocument> Documents { get; set; } = new();
    public List<RiskPrinciple> Principles { get; set; } = new();
    public List<RiskObjective> Objectives { get; set; } = new();
}
