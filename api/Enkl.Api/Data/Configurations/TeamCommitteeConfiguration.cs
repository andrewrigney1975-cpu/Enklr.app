using Enkl.Api.Domain.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace Enkl.Api.Data.Configurations;

public class TeamCommitteeConfiguration : IEntityTypeConfiguration<TeamCommittee>
{
    public void Configure(EntityTypeBuilder<TeamCommittee> b)
    {
        b.HasKey(t => t.Id);
        b.Property(t => t.Key).HasMaxLength(20).IsRequired();
        b.Property(t => t.Name).HasMaxLength(200).IsRequired();
        b.Property(t => t.Type).HasMaxLength(20).IsRequired();

        b.HasOne(t => t.Project)
            .WithMany(p => p.TeamsCommittees)
            .HasForeignKey(t => t.ProjectId)
            .OnDelete(DeleteBehavior.Cascade);

        b.HasOne(t => t.Parent)
            .WithMany()
            .HasForeignKey(t => t.ParentId)
            .OnDelete(DeleteBehavior.Restrict);

        b.HasIndex(t => new { t.ProjectId, t.Key }).IsUnique();
    }
}

public class TeamCommitteeMemberConfiguration : IEntityTypeConfiguration<TeamCommitteeMember>
{
    public void Configure(EntityTypeBuilder<TeamCommitteeMember> b)
    {
        b.HasKey(x => new { x.TeamCommitteeId, x.ProjectMemberId });
        b.HasOne(x => x.TeamCommittee).WithMany(t => t.Members).HasForeignKey(x => x.TeamCommitteeId).OnDelete(DeleteBehavior.Cascade);
        b.HasOne(x => x.ProjectMember).WithMany().HasForeignKey(x => x.ProjectMemberId).OnDelete(DeleteBehavior.Cascade);
    }
}
