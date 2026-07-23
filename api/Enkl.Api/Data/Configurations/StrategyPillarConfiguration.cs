using Enkl.Api.Domain.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace Enkl.Api.Data.Configurations;

public class StrategyPillarConfiguration : IEntityTypeConfiguration<StrategyPillar>
{
    public void Configure(EntityTypeBuilder<StrategyPillar> b)
    {
        b.HasKey(p => p.Id);
        b.Property(p => p.Name).HasMaxLength(150).IsRequired();

        b.HasOne(p => p.Strategy)
            .WithMany()
            .HasForeignKey(p => p.StrategyId)
            .OnDelete(DeleteBehavior.Cascade);

        b.HasIndex(p => p.StrategyId);
    }
}
