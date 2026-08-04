namespace Enkl.Api.Domain.Entities;

/// <summary>The one API-key-bearing integration owned by a Vendor — backs "Manage Vendors"'
/// per-Vendor Generate/Revoke API key flow. One active row per Vendor in practice ("rotate-only",
/// same as OrganisationApiKey): generating a new key reuses/updates this same row rather than
/// inserting a second one. Same bcrypt-hash-only, shown-once-at-generation pattern as
/// OrganisationApiKey.KeyHash — the raw key is never persisted, only its hash. A Vendor's key, once
/// generated and enabled, grants access to ANY published Public Query API endpoint in its
/// Organisation (see Auth/ApiKeyAuthFilter.cs) — identical scope to the org-wide key, no per-query
/// fine-grained restriction.</summary>
public class VendorIntegration
{
    public Guid Id { get; set; }
    public Guid VendorId { get; set; }
    public Vendor Vendor { get; set; } = null!;

    /// <summary>bcrypt hash via PasswordHasher, same as OrganisationApiKey.KeyHash — null until a
    /// key has actually been generated for this Vendor.</summary>
    public string? ApiKeyHash { get; set; }

    public DateTime? GeneratedAt { get; set; }
    public DateTime? LastUsedAt { get; set; }

    /// <summary>Defaults true (confirmed) — semantically "the currently generated key is enabled,"
    /// same role OrganisationApiKey.Enabled plays. Revoke sets this false (soft-disable, row kept
    /// for audit) rather than deleting the row.</summary>
    public bool IsActive { get; set; } = true;

    public DateTime DateCreated { get; set; }
    public DateTime DateLastModified { get; set; }
}
