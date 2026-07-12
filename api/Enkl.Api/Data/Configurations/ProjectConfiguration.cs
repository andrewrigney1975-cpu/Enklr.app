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
        // Composite, not single-column — a project Key is only ever meaningful within its own
        // Organisation's context (task keys, the Portfolio Dashboard's picker, etc.), so two unrelated
        // orgs both having a "DEMO" project must be allowed. (Confirmed bug: this used to be a
        // single-column unique index on Key alone, silently forcing every org to compete over the
        // same global key namespace even though every application-level lookup is already org-scoped.)
        b.HasIndex(p => new { p.OrganisationId, p.Key }).IsUnique();

        b.HasOne(p => p.Organisation)
            .WithMany(o => o.Projects)
            .HasForeignKey(p => p.OrganisationId)
            .OnDelete(DeleteBehavior.Restrict);
    }
}
