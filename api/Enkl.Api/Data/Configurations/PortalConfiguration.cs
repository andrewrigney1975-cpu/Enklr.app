using Enkl.Api.Domain.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace Enkl.Api.Data.Configurations;

public class PortalConfiguration : IEntityTypeConfiguration<Portal>
{
    public void Configure(EntityTypeBuilder<Portal> b)
    {
        b.HasKey(p => p.Id);
        b.Property(p => p.Name).HasMaxLength(200).IsRequired();
        b.Property(p => p.Slug).HasMaxLength(80).IsRequired();
        b.Property(p => p.Status).HasMaxLength(20).HasDefaultValue("draft");
        b.Property(p => p.IconName).HasMaxLength(50);

        b.HasOne(p => p.Organisation)
            .WithMany()
            .HasForeignKey(p => p.OrganisationId)
            .OnDelete(DeleteBehavior.Cascade);

        // Restrict — the actioner Project is the whole reason the Portal exists (where its raised
        // tasks live); deleting it out from under a live Portal must be blocked, not cascaded.
        b.HasOne(p => p.Project)
            .WithMany()
            .HasForeignKey(p => p.ProjectId)
            .OnDelete(DeleteBehavior.Restrict);

        b.HasOne(p => p.CreatedByUser)
            .WithMany()
            .HasForeignKey(p => p.CreatedByUserId)
            .OnDelete(DeleteBehavior.SetNull);

        b.HasIndex(p => new { p.OrganisationId, p.Slug }).IsUnique();
    }
}

public class PortalAccessGrantConfiguration : IEntityTypeConfiguration<PortalAccessGrant>
{
    public void Configure(EntityTypeBuilder<PortalAccessGrant> b)
    {
        b.HasKey(g => g.Id);
        b.Property(g => g.Kind).HasMaxLength(20).IsRequired();

        b.HasOne(g => g.Portal)
            .WithMany(p => p.AccessGrants)
            .HasForeignKey(g => g.PortalId)
            .OnDelete(DeleteBehavior.Cascade);

        b.HasIndex(g => new { g.PortalId, g.Kind, g.Value }).IsUnique();
    }
}

public class PortalFormConfiguration : IEntityTypeConfiguration<PortalForm>
{
    public void Configure(EntityTypeBuilder<PortalForm> b)
    {
        b.HasKey(f => f.Id);

        b.HasOne(f => f.Portal)
            .WithMany(p => p.Forms)
            .HasForeignKey(f => f.PortalId)
            .OnDelete(DeleteBehavior.Cascade);

        // FormGroupId deliberately has no FK to Form — Form is keyed by Id (one row per version),
        // not FormGroupId, so there's no single Form row a group id could reference; PortalHomeService
        // resolves it the same way FormService already does (query for Status="published" within the
        // group). Uniqueness still prevents attaching the same form group to a Portal twice.
        b.HasIndex(f => new { f.PortalId, f.FormGroupId }).IsUnique();
    }
}

public class PortalTopicConfiguration : IEntityTypeConfiguration<PortalTopic>
{
    public void Configure(EntityTypeBuilder<PortalTopic> b)
    {
        b.HasKey(t => t.Id);
        b.Property(t => t.Title).HasMaxLength(200).IsRequired();

        b.HasOne(t => t.Portal)
            .WithMany(p => p.Topics)
            .HasForeignKey(t => t.PortalId)
            .OnDelete(DeleteBehavior.Cascade);
    }
}

public class PortalQaEntryConfiguration : IEntityTypeConfiguration<PortalQaEntry>
{
    public void Configure(EntityTypeBuilder<PortalQaEntry> b)
    {
        b.HasKey(e => e.Id);
        b.Property(e => e.Question).HasMaxLength(500).IsRequired();
        b.Property(e => e.Nps).HasDefaultValue(0);

        b.HasOne(e => e.Portal)
            .WithMany(p => p.QaEntries)
            .HasForeignKey(e => e.PortalId)
            .OnDelete(DeleteBehavior.Cascade);

        // SetNull, not Cascade — deleting a Topic (a grouping heading) shouldn't delete its entries,
        // just leave them ungrouped, same "removing structure shouldn't destroy content" reasoning
        // as TeamCommittee.ParentId's own hierarchy handling.
        b.HasOne(e => e.PortalTopic)
            .WithMany(t => t.QaEntries)
            .HasForeignKey(e => e.PortalTopicId)
            .OnDelete(DeleteBehavior.SetNull);

        b.HasOne(e => e.CreatedByUser)
            .WithMany()
            .HasForeignKey(e => e.CreatedByUserId)
            .OnDelete(DeleteBehavior.SetNull);
    }
}
