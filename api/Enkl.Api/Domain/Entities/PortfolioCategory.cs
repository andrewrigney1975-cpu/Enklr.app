namespace Enkl.Api.Domain.Entities;

/// <summary>
/// A user-definable grouping of Projects within the Portfolio Planner ("Must Have", "Nice to Have",
/// etc.) — organisation-scoped (unlike TaskType, which is scoped to a single Project), since the
/// Planner groups an org's entire project suite, not one project's tasks. Deleting a category
/// un-categorizes its projects (Project.CategoryId -> null) rather than deleting them — see
/// ProjectConfiguration's SetNull, mirroring TaskItem.TypeId's own SetNull precedent.
/// </summary>
public class PortfolioCategory
{
    public Guid Id { get; set; }
    public Guid OrganisationId { get; set; }
    public Organisation Organisation { get; set; } = null!;
    public string Name { get; set; } = "";
    public int SortOrder { get; set; }
}
