using Enkl.Api.Domain.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace Enkl.Api.Data.Configurations;

public class ProjectResourcePlaceholderConfiguration : IEntityTypeConfiguration<ProjectResourcePlaceholder>
{
    public void Configure(EntityTypeBuilder<ProjectResourcePlaceholder> b)
    {
        b.HasKey(r => r.Id);
        b.Property(r => r.Role).HasMaxLength(100);

        b.HasOne(r => r.Project)
            .WithMany()
            .HasForeignKey(r => r.ProjectId)
            .OnDelete(DeleteBehavior.Cascade);

        // If the assigned person's account is ever deleted, the row survives as unassigned again
        // (the role placeholder itself is still meaningful) rather than being destroyed.
        b.HasOne(r => r.User)
            .WithMany()
            .HasForeignKey(r => r.UserId)
            .OnDelete(DeleteBehavior.SetNull);
    }
}
