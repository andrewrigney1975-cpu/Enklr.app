using Enkl.Api.Domain.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace Enkl.Api.Data.Configurations;

public class DashboardWidgetConfiguration : IEntityTypeConfiguration<DashboardWidget>
{
    public void Configure(EntityTypeBuilder<DashboardWidget> b)
    {
        b.HasKey(w => w.Id);
        b.Property(w => w.WidgetType).HasMaxLength(20).IsRequired();
        b.Property(w => w.Title).HasMaxLength(200).IsRequired();
        b.Property(w => w.Width).HasMaxLength(10).HasDefaultValue("full");
        b.Property(w => w.SortOrder).HasDefaultValue(0);

        b.HasOne(w => w.Dashboard)
            .WithMany(d => d.Widgets)
            .HasForeignKey(w => w.DashboardId)
            .OnDelete(DeleteBehavior.Cascade);

        // A widget survives its bound SavedQuery being deleted — it just loses its data binding
        // (surfaced to the frontend as "no query assigned"), rather than the whole widget vanishing.
        b.HasOne(w => w.SavedQuery)
            .WithMany()
            .HasForeignKey(w => w.SavedQueryId)
            .OnDelete(DeleteBehavior.SetNull);
    }
}
