using Enkl.Api.Domain.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace Enkl.Api.Data.Configurations;

public class OrganisationConfiguration : IEntityTypeConfiguration<Organisation>
{
    public void Configure(EntityTypeBuilder<Organisation> b)
    {
        b.HasKey(o => o.Id);
        b.Property(o => o.Name).HasMaxLength(200).IsRequired();
        b.Property(o => o.NormalizedName).HasMaxLength(200).IsRequired();
        b.HasIndex(o => o.NormalizedName).IsUnique();
    }
}
