using Enkl.Api.Domain.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace Enkl.Api.Data.Configurations;

public class UserConfiguration : IEntityTypeConfiguration<User>
{
    public void Configure(EntityTypeBuilder<User> b)
    {
        b.HasKey(u => u.Id);
        b.Property(u => u.Username).HasMaxLength(64).IsRequired();
        b.Property(u => u.NormalizedUsername).HasMaxLength(64).IsRequired();
        b.Property(u => u.DisplayName).HasMaxLength(200).IsRequired();
        b.Property(u => u.PasswordHash).IsRequired();
        b.HasIndex(u => u.NormalizedUsername).IsUnique();

        b.HasOne(u => u.Organisation)
            .WithMany(o => o.Users)
            .HasForeignKey(u => u.OrganisationId)
            .OnDelete(DeleteBehavior.Restrict);
    }
}
