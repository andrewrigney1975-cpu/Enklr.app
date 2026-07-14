namespace Enkl.Api.Domain.Entities;

/// <summary>
/// Draft resourcing for a Portfolio Planner placeholder project — a role (free-text, drawn from the
/// org's existing ProjectMember.Role vocabulary in the UI but not constrained to it), an optional
/// real person (User), and one allocated percentage shared by both. UserId null = an unfilled role
/// (a staffing gap to report on); UserId set = a planned assignment that counts toward that person's
/// total workload alongside their real ProjectMember.AllocatedFraction rows elsewhere — see
/// PortfolioService.GetResourcingSummaryAsync. Project-scoped (not org-scoped), same as
/// ProjectMember/TaskType — see CLAUDE.md's guidance on choosing the right FK for a new entity.
/// </summary>
public class ProjectResourcePlaceholder
{
    public Guid Id { get; set; }
    public Guid ProjectId { get; set; }
    public Project Project { get; set; } = null!;
    public string Role { get; set; } = "";
    public Guid? UserId { get; set; }
    public User? User { get; set; }
    public int AllocatedFraction { get; set; }
}
