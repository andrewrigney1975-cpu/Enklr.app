using Enkl.Api.Domain.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace Enkl.Api.Data.Configurations;

public class FormConfiguration : IEntityTypeConfiguration<Form>
{
    public void Configure(EntityTypeBuilder<Form> b)
    {
        b.HasKey(f => f.Id);
        b.Property(f => f.Name).HasMaxLength(200).IsRequired();
        b.Property(f => f.Status).HasMaxLength(20).HasDefaultValue("draft");

        b.HasOne(f => f.Organisation)
            .WithMany()
            .HasForeignKey(f => f.OrganisationId)
            .OnDelete(DeleteBehavior.Cascade);

        // Nullable — the authoring user's account may later be removed; the version itself (and any
        // submissions filed against it) should survive that, same reasoning as Announcement's own
        // CreatedByUserId.
        b.HasOne(f => f.CreatedByUser)
            .WithMany()
            .HasForeignKey(f => f.CreatedByUserId)
            .OnDelete(DeleteBehavior.SetNull);

        b.HasIndex(f => new { f.FormGroupId, f.VersionNumber });
    }
}
