namespace Enkl.Api.Domain.Entities;

/// <summary>One API-key-bearing integration owned by a Vendor — groundwork only, for now: no
/// controller/service exposes this yet. Deliberately a PLAIN string ApiKey column, not a hash
/// (contrast OrganisationApiKey.KeyHash's bcrypt-hash-only, shown-once-at-generation pattern) — this
/// entity exists purely to establish the schema shape ahead of the real "extend API management to
/// per-vendor API keys" feature described when this was added; whether that feature reuses
/// OrganisationApiKey's hash-only pattern or needs the raw key persisted (e.g. for outbound calls TO
/// the vendor, not just inbound calls authenticated BY this key) is an open design question for that
/// later pass, not decided here.</summary>
public class VendorIntegration
{
    public Guid Id { get; set; }
    public Guid VendorId { get; set; }
    public Vendor Vendor { get; set; } = null!;

    public string ApiKey { get; set; } = "";

    /// <summary>No default specified (unlike Vendor.IsActive) — left as the plain bool zero-value
    /// (false) until the real feature decides what "freshly created, key not yet issued/activated"
    /// should mean.</summary>
    public bool IsActive { get; set; }

    public DateTime DateCreated { get; set; }
    public DateTime DateLastModified { get; set; }
}
