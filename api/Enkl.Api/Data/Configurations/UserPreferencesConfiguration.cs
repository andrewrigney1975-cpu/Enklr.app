using Enkl.Api.Domain.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace Enkl.Api.Data.Configurations;

public class UserPreferencesConfiguration : IEntityTypeConfiguration<UserPreferences>
{
    public void Configure(EntityTypeBuilder<UserPreferences> b)
    {
        // UserId doubles as the PK, enforcing the 1:1 at the schema level (same shape as
        // OrganisationSsoConfigConfiguration) — there's no separate Id column to accidentally let a
        // second preferences row exist for the same user.
        b.HasKey(p => p.UserId);

        b.Property(p => p.Avatar).HasColumnType("text");
        b.Property(p => p.HeaderColour).HasMaxLength(20);

        b.HasOne(p => p.User)
            .WithOne(u => u.Preferences)
            .HasForeignKey<UserPreferences>(p => p.UserId)
            .OnDelete(DeleteBehavior.Cascade);
    }
}
