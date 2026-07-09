using Enkl.Api.Domain.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace Enkl.Api.Data.Configurations;

public class RiskConfiguration : IEntityTypeConfiguration<Risk>
{
    public void Configure(EntityTypeBuilder<Risk> b)
    {
        b.HasKey(r => r.Id);
        b.Property(r => r.Key).HasMaxLength(20).IsRequired();
        b.Property(r => r.Title).HasMaxLength(500).IsRequired();
        b.Property(r => r.Status).HasMaxLength(20).IsRequired();

        b.HasOne(r => r.Project)
            .WithMany(p => p.Risks)
            .HasForeignKey(r => r.ProjectId)
            .OnDelete(DeleteBehavior.Cascade);

        b.HasOne(r => r.Owner)
            .WithMany()
            .HasForeignKey(r => r.OwnerId)
            .OnDelete(DeleteBehavior.SetNull);

        b.HasOne(r => r.Task)
            .WithMany()
            .HasForeignKey(r => r.TaskId)
            .OnDelete(DeleteBehavior.SetNull);

        b.HasIndex(r => new { r.ProjectId, r.Key }).IsUnique();
    }
}

public class RiskDocumentConfiguration : IEntityTypeConfiguration<RiskDocument>
{
    public void Configure(EntityTypeBuilder<RiskDocument> b)
    {
        b.HasKey(x => new { x.RiskId, x.DocumentId });
        b.HasOne(x => x.Risk).WithMany(r => r.Documents).HasForeignKey(x => x.RiskId).OnDelete(DeleteBehavior.Cascade);
        b.HasOne(x => x.Document).WithMany().HasForeignKey(x => x.DocumentId).OnDelete(DeleteBehavior.Cascade);
    }
}

public class RiskPrincipleConfiguration : IEntityTypeConfiguration<RiskPrinciple>
{
    public void Configure(EntityTypeBuilder<RiskPrinciple> b)
    {
        b.HasKey(x => new { x.RiskId, x.PrincipleId });
        b.HasOne(x => x.Risk).WithMany(r => r.Principles).HasForeignKey(x => x.RiskId).OnDelete(DeleteBehavior.Cascade);
        b.HasOne(x => x.Principle).WithMany().HasForeignKey(x => x.PrincipleId).OnDelete(DeleteBehavior.Cascade);
    }
}

public class RiskObjectiveConfiguration : IEntityTypeConfiguration<RiskObjective>
{
    public void Configure(EntityTypeBuilder<RiskObjective> b)
    {
        b.HasKey(x => new { x.RiskId, x.ObjectiveId });
        b.HasOne(x => x.Risk).WithMany(r => r.Objectives).HasForeignKey(x => x.RiskId).OnDelete(DeleteBehavior.Cascade);
        b.HasOne(x => x.Objective).WithMany().HasForeignKey(x => x.ObjectiveId).OnDelete(DeleteBehavior.Cascade);
    }
}
