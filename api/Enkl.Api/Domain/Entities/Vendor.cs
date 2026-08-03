namespace Enkl.Api.Domain.Entities;

/// <summary>An org-scoped record of a third-party vendor/supplier the Organisation deals with —
/// groundwork for future Vendor management + per-vendor API key granularity (see
/// VendorIntegration's own doc comment). No independent meaning outside its Organisation, same
/// "org-scoped child" shape as PortfolioCategory/Announcement/ChatChannel — Organisation itself
/// deliberately does NOT expose a back-nav collection for this (same reasoning as Announcement's own
/// doc comment: that pattern is reserved for the small set of entities Organisation already exposes
/// directly, not the default for every new org-scoped child).</summary>
public class Vendor
{
    public Guid Id { get; set; }
    public Guid OrganisationId { get; set; }
    public Organisation Organisation { get; set; } = null!;

    public string Name { get; set; } = "";
    public string? PrimaryContactPerson { get; set; }
    public string? ContactEmailAddress { get; set; }
    public string? ContactUrl { get; set; }
    public string? TaxNumber { get; set; }

    /// <summary>Defaults true — a newly-added vendor is active by default, same convention as
    /// Portal/Form Status fields defaulting to their own "usable immediately" state.</summary>
    public bool IsActive { get; set; } = true;

    public DateTime DateCreated { get; set; }
    public DateTime DateLastModified { get; set; }

    public List<VendorIntegration> VendorIntegrations { get; set; } = new();
}
