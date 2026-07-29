namespace Enkl.Api.Domain.Entities;

/// <summary>Optional grouping heading for the Portal's Q&amp;A rail (modelled like knowledge-base
/// article categories) — PortalQaEntry.PortalTopicId is nullable, so ungrouped entries are also
/// allowed directly under the Portal.</summary>
public class PortalTopic
{
    public Guid Id { get; set; }
    public Guid PortalId { get; set; }
    public Portal Portal { get; set; } = null!;
    public string Title { get; set; } = "";
    public int Order { get; set; }
    public DateTime DateCreated { get; set; }
    public DateTime DateLastModified { get; set; }

    public List<PortalQaEntry> QaEntries { get; set; } = new();
}
