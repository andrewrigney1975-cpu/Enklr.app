using Enkl.Api.Auth;
using Enkl.Api.Data;
using Enkl.Api.Domain.Entities;
using Enkl.Api.Dtos;
using Enkl.Api.Validation;
using Microsoft.EntityFrameworkCore;

namespace Enkl.Api.Services;

/// <summary>
/// OrgAdmin-facing CRUD for Vendor records, plus per-Vendor API key generate/revoke — folded into
/// this one service rather than split out the way OrganisationApiKeyService is its own class (that
/// split exists because the org-wide key is one row shared across many unrelated features; a
/// Vendor's key is intrinsically part of that one Vendor's own record, so keeping it here keeps the
/// surface smaller for a feature this size). Every id is re-validated against the caller's own
/// organisationId before anything is touched — same cross-org-isolation discipline as
/// AnnouncementService/PortfolioCategoryService, no enumeration oracle (a foreign-org Vendor id is
/// silently treated as not-found, never a distinguishable error).
/// </summary>
public class VendorService
{
    private readonly AppDbContext _db;

    public VendorService(AppDbContext db)
    {
        _db = db;
    }

    public async Task<List<VendorDto>> ListAsync(Guid organisationId)
    {
        var vendors = await _db.Vendors.AsNoTracking()
            .Include(v => v.VendorIntegrations)
            .Where(v => v.OrganisationId == organisationId)
            .OrderBy(v => v.Name)
            .ToListAsync();
        return vendors.Select(ToDto).ToList();
    }

    public async Task<VendorDto?> GetAsync(Guid organisationId, Guid vendorId)
    {
        var vendor = await _db.Vendors.AsNoTracking()
            .Include(v => v.VendorIntegrations)
            .FirstOrDefaultAsync(v => v.Id == vendorId && v.OrganisationId == organisationId);
        return vendor is null ? null : ToDto(vendor);
    }

    public async Task<VendorDto> CreateAsync(Guid organisationId, CreateVendorRequest request)
    {
        var name = (request.Name ?? "").Trim();
        if (name.Length == 0) throw new ApiValidationException("Name is required.");

        var now = DateTime.UtcNow;
        var vendor = new Vendor
        {
            Id = Guid.NewGuid(),
            OrganisationId = organisationId,
            Name = name,
            PrimaryContactPerson = Trimmed(request.PrimaryContactPerson),
            ContactEmailAddress = Trimmed(request.ContactEmailAddress),
            ContactUrl = Trimmed(request.ContactUrl),
            TaxNumber = Trimmed(request.TaxNumber),
            DateCreated = now,
            DateLastModified = now
        };
        _db.Vendors.Add(vendor);
        await _db.SaveChangesAsync();
        return ToDto(vendor);
    }

    public async Task<VendorDto?> UpdateAsync(Guid organisationId, Guid vendorId, UpdateVendorRequest request)
    {
        var vendor = await _db.Vendors.Include(v => v.VendorIntegrations)
            .FirstOrDefaultAsync(v => v.Id == vendorId && v.OrganisationId == organisationId);
        if (vendor is null) return null;

        var name = (request.Name ?? "").Trim();
        if (name.Length == 0) throw new ApiValidationException("Name is required.");

        vendor.Name = name;
        vendor.PrimaryContactPerson = Trimmed(request.PrimaryContactPerson);
        vendor.ContactEmailAddress = Trimmed(request.ContactEmailAddress);
        vendor.ContactUrl = Trimmed(request.ContactUrl);
        vendor.TaxNumber = Trimmed(request.TaxNumber);
        vendor.IsActive = request.IsActive;
        vendor.DateLastModified = DateTime.UtcNow;
        await _db.SaveChangesAsync();
        return ToDto(vendor);
    }

    public async Task<bool> DeleteAsync(Guid organisationId, Guid vendorId)
    {
        var vendor = await _db.Vendors.FirstOrDefaultAsync(v => v.Id == vendorId && v.OrganisationId == organisationId);
        if (vendor is null) return false;

        // VendorIntegrations cascade-delete with it (see VendorIntegrationConfiguration) — no
        // separate cleanup needed here.
        _db.Vendors.Remove(vendor);
        await _db.SaveChangesAsync();
        return true;
    }

    /// <summary>Mints a new random key, stores only its hash, and returns the raw value — the one
    /// and only time it's ever retrievable. "Rotate-only": reuses the Vendor's existing
    /// VendorIntegration row if one already exists rather than inserting a second one, so a Vendor
    /// only ever has at most one key — generating a new one immediately invalidates whatever was
    /// issued before, same contract as OrganisationApiKeyService.GenerateAsync, and re-enables the
    /// key if it was previously revoked. Distinct "enklr_vendor_key_" prefix from the org-wide key's
    /// own "enklr_key_" so a leaked key's origin is identifiable at a glance.</summary>
    public async Task<GenerateVendorApiKeyResponse?> GenerateApiKeyAsync(Guid organisationId, Guid vendorId)
    {
        var vendor = await _db.Vendors.Include(v => v.VendorIntegrations)
            .FirstOrDefaultAsync(v => v.Id == vendorId && v.OrganisationId == organisationId);
        if (vendor is null) return null;

        var integration = vendor.VendorIntegrations.FirstOrDefault();
        var now = DateTime.UtcNow;
        if (integration is null)
        {
            integration = new VendorIntegration { Id = Guid.NewGuid(), VendorId = vendor.Id, DateCreated = now };
            _db.VendorIntegrations.Add(integration);
        }

        var rawKey = "enklr_vendor_key_" + Convert.ToBase64String(System.Security.Cryptography.RandomNumberGenerator.GetBytes(32))
            .Replace('+', '-').Replace('/', '_').TrimEnd('=');
        integration.ApiKeyHash = PasswordHasher.Hash(rawKey);
        integration.GeneratedAt = now;
        integration.IsActive = true;
        integration.DateLastModified = now;
        await _db.SaveChangesAsync();

        return new GenerateVendorApiKeyResponse(rawKey);
    }

    public async Task<VendorDto?> RevokeApiKeyAsync(Guid organisationId, Guid vendorId)
    {
        var vendor = await _db.Vendors.Include(v => v.VendorIntegrations)
            .FirstOrDefaultAsync(v => v.Id == vendorId && v.OrganisationId == organisationId);
        if (vendor is null) return null;

        var integration = vendor.VendorIntegrations.FirstOrDefault();
        if (integration is not null)
        {
            // Soft-disable, row kept for audit — same shape as OrganisationApiKeyService.RevokeAsync.
            integration.IsActive = false;
            integration.DateLastModified = DateTime.UtcNow;
            await _db.SaveChangesAsync();
        }
        return ToDto(vendor);
    }

    private static string? Trimmed(string? value)
    {
        if (value is null) return null;
        var trimmed = value.Trim();
        return trimmed.Length == 0 ? null : trimmed;
    }

    private static VendorDto ToDto(Vendor v)
    {
        var integration = v.VendorIntegrations.FirstOrDefault();
        return new VendorDto(
            v.Id, v.Name, v.PrimaryContactPerson, v.ContactEmailAddress, v.ContactUrl, v.TaxNumber,
            v.IsActive, v.DateCreated, v.DateLastModified,
            HasApiKey: !string.IsNullOrEmpty(integration?.ApiKeyHash),
            ApiKeyEnabled: integration?.IsActive ?? false,
            ApiKeyGeneratedAt: integration?.GeneratedAt,
            ApiKeyLastUsedAt: integration?.LastUsedAt);
    }
}
