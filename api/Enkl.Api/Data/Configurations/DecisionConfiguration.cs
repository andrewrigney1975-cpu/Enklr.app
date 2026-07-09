using Enkl.Api.Domain.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace Enkl.Api.Data.Configurations;

public class DecisionConfiguration : IEntityTypeConfiguration<Decision>
{
    public void Configure(EntityTypeBuilder<Decision> b)
    {
        b.HasKey(d => d.Id);
        b.Property(d => d.Key).HasMaxLength(20).IsRequired();
        b.Property(d => d.Title).HasMaxLength(500).IsRequired();
        b.Property(d => d.Type).HasMaxLength(20).IsRequired();
        b.Property(d => d.Status).HasMaxLength(20).IsRequired();
        b.Property(d => d.Approver).HasMaxLength(200);

        b.HasOne(d => d.Project)
            .WithMany(p => p.Decisions)
            .HasForeignKey(d => d.ProjectId)
            .OnDelete(DeleteBehavior.Cascade);

        b.HasOne(d => d.Owner)
            .WithMany()
            .HasForeignKey(d => d.OwnerId)
            .OnDelete(DeleteBehavior.SetNull);

        b.HasOne(d => d.Task)
            .WithMany()
            .HasForeignKey(d => d.TaskId)
            .OnDelete(DeleteBehavior.SetNull);

        b.HasIndex(d => new { d.ProjectId, d.Key }).IsUnique();
    }
}

public class DecisionDocumentConfiguration : IEntityTypeConfiguration<DecisionDocument>
{
    public void Configure(EntityTypeBuilder<DecisionDocument> b)
    {
        b.HasKey(x => new { x.DecisionId, x.DocumentId });
        b.HasOne(x => x.Decision).WithMany(d => d.Documents).HasForeignKey(x => x.DecisionId).OnDelete(DeleteBehavior.Cascade);
        b.HasOne(x => x.Document).WithMany().HasForeignKey(x => x.DocumentId).OnDelete(DeleteBehavior.Cascade);
    }
}

public class DecisionRiskConfiguration : IEntityTypeConfiguration<DecisionRisk>
{
    public void Configure(EntityTypeBuilder<DecisionRisk> b)
    {
        b.HasKey(x => new { x.DecisionId, x.RiskId });
        b.HasOne(x => x.Decision).WithMany(d => d.Risks).HasForeignKey(x => x.DecisionId).OnDelete(DeleteBehavior.Cascade);
        b.HasOne(x => x.Risk).WithMany().HasForeignKey(x => x.RiskId).OnDelete(DeleteBehavior.Cascade);
    }
}

public class DecisionPrincipleConfiguration : IEntityTypeConfiguration<DecisionPrinciple>
{
    public void Configure(EntityTypeBuilder<DecisionPrinciple> b)
    {
        b.HasKey(x => new { x.DecisionId, x.PrincipleId });
        b.HasOne(x => x.Decision).WithMany(d => d.Principles).HasForeignKey(x => x.DecisionId).OnDelete(DeleteBehavior.Cascade);
        b.HasOne(x => x.Principle).WithMany().HasForeignKey(x => x.PrincipleId).OnDelete(DeleteBehavior.Cascade);
    }
}

public class DecisionObjectiveConfiguration : IEntityTypeConfiguration<DecisionObjective>
{
    public void Configure(EntityTypeBuilder<DecisionObjective> b)
    {
        b.HasKey(x => new { x.DecisionId, x.ObjectiveId });
        b.HasOne(x => x.Decision).WithMany(d => d.Objectives).HasForeignKey(x => x.DecisionId).OnDelete(DeleteBehavior.Cascade);
        b.HasOne(x => x.Objective).WithMany().HasForeignKey(x => x.ObjectiveId).OnDelete(DeleteBehavior.Cascade);
    }
}
