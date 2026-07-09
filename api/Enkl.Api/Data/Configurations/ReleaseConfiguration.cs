using Enkl.Api.Domain.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace Enkl.Api.Data.Configurations;

public class ReleaseConfiguration : IEntityTypeConfiguration<Release>
{
    public void Configure(EntityTypeBuilder<Release> b)
    {
        b.HasKey(r => r.Id);
        b.Property(r => r.Name).HasMaxLength(200).IsRequired();
        b.Property(r => r.Status).HasMaxLength(20).IsRequired();

        b.HasOne(r => r.Project)
            .WithMany(p => p.Releases)
            .HasForeignKey(r => r.ProjectId)
            .OnDelete(DeleteBehavior.Cascade);

        b.HasOne(r => r.Owner)
            .WithMany()
            .HasForeignKey(r => r.OwnerId)
            .OnDelete(DeleteBehavior.SetNull);
    }
}
