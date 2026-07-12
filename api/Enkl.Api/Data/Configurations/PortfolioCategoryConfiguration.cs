using Enkl.Api.Domain.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace Enkl.Api.Data.Configurations;

public class PortfolioCategoryConfiguration : IEntityTypeConfiguration<PortfolioCategory>
{
    public void Configure(EntityTypeBuilder<PortfolioCategory> b)
    {
        b.HasKey(c => c.Id);
        b.Property(c => c.Name).HasMaxLength(100).IsRequired();

        b.HasOne(c => c.Organisation)
            .WithMany()
            .HasForeignKey(c => c.OrganisationId)
            .OnDelete(DeleteBehavior.Cascade);
    }
}
