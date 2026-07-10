using Enkl.Api.Domain.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace Enkl.Api.Data.Configurations;

public class OrganisationSsoConfigConfiguration : IEntityTypeConfiguration<OrganisationSsoConfig>
{
    public void Configure(EntityTypeBuilder<OrganisationSsoConfig> b)
    {
        // OrganisationId doubles as the PK, enforcing the 1:1 at the schema level (there's no
        // separate Id column to accidentally let a second config row exist for the same org).
        b.HasKey(c => c.OrganisationId);

        b.Property(c => c.IdpEntityId).HasMaxLength(500);
        b.Property(c => c.IdpSsoUrl).HasMaxLength(500);
        b.Property(c => c.IdpSigningCertificate).HasColumnType("text");
        b.Property(c => c.ScimBearerTokenHash).HasColumnType("text");

        b.HasOne(c => c.Organisation)
            .WithOne(o => o.SsoConfig)
            .HasForeignKey<OrganisationSsoConfig>(c => c.OrganisationId)
            .OnDelete(DeleteBehavior.Cascade);
    }
}
