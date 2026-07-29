using Enkl.Api.Domain.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace Enkl.Api.Data.Configurations;

public class WhiteboardElementConfiguration : IEntityTypeConfiguration<WhiteboardElement>
{
    public void Configure(EntityTypeBuilder<WhiteboardElement> b)
    {
        b.HasKey(e => e.Id);
        b.Property(e => e.ElementType).HasMaxLength(20).IsRequired();

        b.HasOne(e => e.Session)
            .WithMany(s => s.Elements)
            .HasForeignKey(e => e.SessionId)
            .OnDelete(DeleteBehavior.Cascade);

        b.HasOne(e => e.CreatedByUser)
            .WithMany()
            .HasForeignKey(e => e.CreatedByUserId)
            .OnDelete(DeleteBehavior.Cascade);

        // Serves the "current board state" fetch (WHERE SessionId = ... AND DeletedAt IS NULL).
        b.HasIndex(e => new { e.SessionId, e.DeletedAt });
    }
}
