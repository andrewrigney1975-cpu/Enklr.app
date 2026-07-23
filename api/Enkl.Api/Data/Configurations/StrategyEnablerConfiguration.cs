using Enkl.Api.Domain.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace Enkl.Api.Data.Configurations;

public class StrategyEnablerConfiguration : IEntityTypeConfiguration<StrategyEnabler>
{
    public void Configure(EntityTypeBuilder<StrategyEnabler> b)
    {
        b.HasKey(e => e.Id);
        b.Property(e => e.Name).HasMaxLength(150).IsRequired();

        b.HasOne(e => e.Pillar)
            .WithMany()
            .HasForeignKey(e => e.PillarId)
            .OnDelete(DeleteBehavior.Cascade);

        b.HasIndex(e => e.PillarId);
    }
}
