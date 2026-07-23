using Enkl.Api.Domain.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace Enkl.Api.Data.Configurations;

public class StrategyMetricEntryConfiguration : IEntityTypeConfiguration<StrategyMetricEntry>
{
    public void Configure(EntityTypeBuilder<StrategyMetricEntry> b)
    {
        b.HasKey(e => e.Id);

        b.HasOne(e => e.Metric)
            .WithMany()
            .HasForeignKey(e => e.MetricId)
            .OnDelete(DeleteBehavior.Cascade);

        b.HasIndex(e => new { e.MetricId, e.RecordedAt });
    }
}
