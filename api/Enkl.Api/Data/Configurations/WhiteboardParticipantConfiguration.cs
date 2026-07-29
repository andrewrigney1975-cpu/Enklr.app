using Enkl.Api.Domain.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace Enkl.Api.Data.Configurations;

public class WhiteboardParticipantConfiguration : IEntityTypeConfiguration<WhiteboardParticipant>
{
    public void Configure(EntityTypeBuilder<WhiteboardParticipant> b)
    {
        b.HasKey(p => p.Id);

        b.HasOne(p => p.Session)
            .WithMany(s => s.Participants)
            .HasForeignKey(p => p.SessionId)
            .OnDelete(DeleteBehavior.Cascade);

        b.HasOne(p => p.User)
            .WithMany()
            .HasForeignKey(p => p.UserId)
            .OnDelete(DeleteBehavior.Cascade);

        b.HasIndex(p => new { p.SessionId, p.UserId });
    }
}
