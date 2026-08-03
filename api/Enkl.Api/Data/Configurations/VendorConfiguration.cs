using Enkl.Api.Domain.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace Enkl.Api.Data.Configurations;

public class VendorConfiguration : IEntityTypeConfiguration<Vendor>
{
    public void Configure(EntityTypeBuilder<Vendor> b)
    {
        b.HasKey(v => v.Id);
        b.Property(v => v.Name).HasMaxLength(200).IsRequired();
        b.Property(v => v.PrimaryContactPerson).HasMaxLength(200);
        b.Property(v => v.ContactEmailAddress).HasMaxLength(320);
        b.Property(v => v.ContactUrl).HasMaxLength(500);
        b.Property(v => v.TaxNumber).HasMaxLength(50);
        // Explicit HasDefaultValue, not just the C# property initializer — EF Core doesn't read a
        // property initializer as a SQL column default (see api/Enkl.Api/CLAUDE.md's documented
        // gotcha) — without this the migration would still come out defaulting to true by luck of
        // matching the initializer, but with no actual DB-level default, so a raw INSERT bypassing
        // the API would silently get false instead.
        b.Property(v => v.IsActive).HasDefaultValue(true);

        // Cascade — org-scoped child, no independent meaning outside its Organisation, same shape as
        // PortfolioCategory/Announcement/ChatChannel. No back-nav collection on Organisation itself
        // (WithMany(), not WithMany(o => o.Vendors)) — that pattern is reserved for the small set of
        // entities Organisation already exposes directly, not the default for every org-scoped child.
        b.HasOne(v => v.Organisation)
            .WithMany()
            .HasForeignKey(v => v.OrganisationId)
            .OnDelete(DeleteBehavior.Cascade);

        b.HasIndex(v => v.OrganisationId);
    }
}

public class VendorIntegrationConfiguration : IEntityTypeConfiguration<VendorIntegration>
{
    public void Configure(EntityTypeBuilder<VendorIntegration> b)
    {
        b.HasKey(i => i.Id);
        b.Property(i => i.ApiKey).HasMaxLength(200).IsRequired();

        // Cascade — an integration has no meaning without its owning Vendor, same containment
        // reasoning as Vendor.Organisation above.
        b.HasOne(i => i.Vendor)
            .WithMany(v => v.VendorIntegrations)
            .HasForeignKey(i => i.VendorId)
            .OnDelete(DeleteBehavior.Cascade);

        b.HasIndex(i => i.VendorId);
        // Globally unique, not scoped to Vendor — an ApiKey is a bearer secret meant to be looked up
        // directly (WHERE ApiKey = ...) once real auth is built on top of this, same "secret token,
        // not a human-facing short code" shape as a session token, NOT the composite-scoped-key
        // pattern Task.Key/Document.Key etc use (see SOLUTION_ARCHITECTURE.md's indexing section for
        // why those two cases are treated differently).
        b.HasIndex(i => i.ApiKey).IsUnique();
    }
}
