using Enkl.Api.Domain.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace Enkl.Api.Data.Configurations;

public class ObjectiveConfiguration : IEntityTypeConfiguration<Objective>
{
    public void Configure(EntityTypeBuilder<Objective> b)
    {
        b.HasKey(o => o.Id);
        b.Property(o => o.Key).HasMaxLength(20).IsRequired();
        b.Property(o => o.Title).HasMaxLength(500).IsRequired();

        b.HasOne(o => o.Project)
            .WithMany(p => p.Objectives)
            .HasForeignKey(o => o.ProjectId)
            .OnDelete(DeleteBehavior.Cascade);

        b.HasIndex(o => new { o.ProjectId, o.Key }).IsUnique();
    }
}

public class ObjectivePrincipleConfiguration : IEntityTypeConfiguration<ObjectivePrinciple>
{
    public void Configure(EntityTypeBuilder<ObjectivePrinciple> b)
    {
        b.HasKey(x => new { x.ObjectiveId, x.PrincipleId });
        b.HasOne(x => x.Objective).WithMany(o => o.Principles).HasForeignKey(x => x.ObjectiveId).OnDelete(DeleteBehavior.Cascade);
        b.HasOne(x => x.Principle).WithMany().HasForeignKey(x => x.PrincipleId).OnDelete(DeleteBehavior.Cascade);
    }
}
