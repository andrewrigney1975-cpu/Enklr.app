using Enkl.Api.Domain.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace Enkl.Api.Data.Configurations;

public class StrategyMetricConfiguration : IEntityTypeConfiguration<StrategyMetric>
{
    public void Configure(EntityTypeBuilder<StrategyMetric> b)
    {
        b.HasKey(m => m.Id);
        b.Property(m => m.Name).HasMaxLength(150).IsRequired();
        b.Property(m => m.UnitLabel).HasMaxLength(20);

        // Exactly one of PillarId/EnablerId is non-null — enforced only in StrategyMetricService
        // (no CHECK constraint, per this tier's standing convention). Both FKs are independently
        // optional here for exactly that reason.
        b.HasOne(m => m.Pillar)
            .WithMany()
            .HasForeignKey(m => m.PillarId)
            .OnDelete(DeleteBehavior.Cascade)
            .IsRequired(false);

        b.HasOne(m => m.Enabler)
            .WithMany()
            .HasForeignKey(m => m.EnablerId)
            .OnDelete(DeleteBehavior.Cascade)
            .IsRequired(false);

        b.HasIndex(m => m.PillarId);
        b.HasIndex(m => m.EnablerId);
    }
}
