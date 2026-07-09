using Enkl.Api.Domain.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace Enkl.Api.Data.Configurations;

public class ProjectConfiguration : IEntityTypeConfiguration<Project>
{
    public void Configure(EntityTypeBuilder<Project> b)
    {
        b.HasKey(p => p.Id);
        b.Property(p => p.Name).HasMaxLength(200).IsRequired();
        b.Property(p => p.Key).HasMaxLength(20).IsRequired();
        b.Property(p => p.HeaderButtonVisibilityJson).HasColumnType("jsonb");
        b.Property(p => p.WorkflowJson).HasColumnType("jsonb");
        b.HasIndex(p => p.Key).IsUnique();

        b.HasOne(p => p.Organisation)
            .WithMany(o => o.Projects)
            .HasForeignKey(p => p.OrganisationId)
            .OnDelete(DeleteBehavior.Restrict);
    }
}
