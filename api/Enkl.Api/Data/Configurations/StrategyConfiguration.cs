using Enkl.Api.Domain.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace Enkl.Api.Data.Configurations;

public class StrategyConfiguration : IEntityTypeConfiguration<Strategy>
{
    public void Configure(EntityTypeBuilder<Strategy> b)
    {
        b.HasKey(s => s.Id);
        b.Property(s => s.Name).HasMaxLength(150).IsRequired();

        b.HasOne(s => s.Organisation)
            .WithMany()
            .HasForeignKey(s => s.OrganisationId)
            .OnDelete(DeleteBehavior.Cascade);

        b.HasIndex(s => new { s.OrganisationId, s.IsActive });
    }
}
