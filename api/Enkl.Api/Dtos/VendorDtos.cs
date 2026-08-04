namespace Enkl.Api.Dtos;

/// <summary>Key status is folded directly into VendorDto rather than a separate fetch — there's only
/// ever one active VendorIntegration per Vendor in practice (rotate-only, see
/// VendorService.GenerateApiKeyAsync), so a nested list would be needless indirection.</summary>
public record VendorDto(
    Guid Id, string Name, string? PrimaryContactPerson, string? ContactEmailAddress,
    string? ContactUrl, string? TaxNumber, bool IsActive, DateTime DateCreated, DateTime DateLastModified,
    bool HasApiKey, bool ApiKeyEnabled, DateTime? ApiKeyGeneratedAt, DateTime? ApiKeyLastUsedAt);

public record CreateVendorRequest(string Name, string? PrimaryContactPerson, string? ContactEmailAddress, string? ContactUrl, string? TaxNumber);
public record UpdateVendorRequest(string Name, string? PrimaryContactPerson, string? ContactEmailAddress, string? ContactUrl, string? TaxNumber, bool IsActive);

/// <summary>The raw key is only ever returned here, at generation time — never persisted, never
/// retrievable again, same "shown once" contract as GenerateApiKeyResponse (the org-wide key).</summary>
public record GenerateVendorApiKeyResponse(string Key);
