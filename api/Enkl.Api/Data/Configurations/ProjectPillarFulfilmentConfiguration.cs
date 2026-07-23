using Enkl.Api.Domain.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace Enkl.Api.Data.Configurations;

public class ProjectPillarFulfilmentConfiguration : IEntityTypeConfiguration<ProjectPillarFulfilment>
{
    public void Configure(EntityTypeBuilder<ProjectPillarFulfilment> b)
    {
        b.HasKey(f => f.Id);

        b.HasOne(f => f.Project)
            .WithMany()
            .HasForeignKey(f => f.ProjectId)
            .OnDelete(DeleteBehavior.Cascade);

        b.HasOne(f => f.Pillar)
            .WithMany()
            .HasForeignKey(f => f.PillarId)
            .OnDelete(DeleteBehavior.Cascade);

        // Unique index enforces at-most-one-row-per-(Project,Pillar) at the DB level too — the actual
        // enforcement is StrategyFulfilmentService's find-or-create upsert, but this closes the race
        // window between two concurrent requests both finding "no row yet" and both inserting. A real
        // unique index (not a CHECK constraint) — same convention as ChatChannelMembers'/
        // AnnouncementAcknowledgements' own composite unique indexes elsewhere in this tier.
        b.HasIndex(f => new { f.ProjectId, f.PillarId }).IsUnique();
        b.HasIndex(f => f.PillarId);
    }
}
