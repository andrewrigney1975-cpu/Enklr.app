namespace Enkl.Api.Domain.Entities;

/// <summary>Curates which of the org's published Forms are surfaced on a given Portal's home page.
/// Keyed by FormGroupId (not a specific Form version row) so it always resolves to whichever version
/// is currently published — the exact same "resolve group to its published version" logic
/// FormService already applies org-wide; Form itself is untouched by this table.</summary>
public class PortalForm
{
    public Guid Id { get; set; }
    public Guid PortalId { get; set; }
    public Portal Portal { get; set; } = null!;
    public Guid FormGroupId { get; set; }
    public int Order { get; set; }
    public DateTime DateCreated { get; set; }
}
