using Enkl.Api.Domain.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace Enkl.Api.Data.Configurations;

public class WhiteboardSessionConfiguration : IEntityTypeConfiguration<WhiteboardSession>
{
    public void Configure(EntityTypeBuilder<WhiteboardSession> b)
    {
        b.HasKey(s => s.Id);
        b.Property(s => s.JoinCode).HasMaxLength(6).IsRequired();
        b.Property(s => s.Status).HasMaxLength(20).HasDefaultValue("open");
        b.Property(s => s.Title).HasMaxLength(200);

        b.HasOne(s => s.Organisation)
            .WithMany()
            .HasForeignKey(s => s.OrganisationId)
            .OnDelete(DeleteBehavior.Cascade);

        b.HasOne(s => s.HostUser)
            .WithMany()
            .HasForeignKey(s => s.HostUserId)
            .OnDelete(DeleteBehavior.Cascade);

        // Not unique — JoinCode is only unique among currently-open sessions, enforced in
        // WhiteboardService (re-roll on collision), not at the DB level. Indexed for the join
        // lookup's WHERE JoinCode = ... AND Status = 'open' query.
        b.HasIndex(s => new { s.JoinCode, s.Status });
    }
}
