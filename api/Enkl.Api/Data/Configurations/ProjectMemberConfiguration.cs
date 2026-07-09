using Enkl.Api.Domain.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace Enkl.Api.Data.Configurations;

public class ProjectMemberConfiguration : IEntityTypeConfiguration<ProjectMember>
{
    public void Configure(EntityTypeBuilder<ProjectMember> b)
    {
        b.HasKey(m => m.Id);
        b.Property(m => m.Color).HasMaxLength(20);
        b.Property(m => m.Role).HasMaxLength(100);

        b.HasOne(m => m.Project)
            .WithMany(p => p.Members)
            .HasForeignKey(m => m.ProjectId)
            .OnDelete(DeleteBehavior.Cascade);

        b.HasOne(m => m.User)
            .WithMany(u => u.ProjectMemberships)
            .HasForeignKey(m => m.UserId)
            .OnDelete(DeleteBehavior.Restrict);

        b.HasOne(m => m.ReportsTo)
            .WithMany()
            .HasForeignKey(m => m.ReportsToId)
            .OnDelete(DeleteBehavior.Restrict);

        b.HasIndex(m => new { m.ProjectId, m.UserId }).IsUnique();
    }
}
