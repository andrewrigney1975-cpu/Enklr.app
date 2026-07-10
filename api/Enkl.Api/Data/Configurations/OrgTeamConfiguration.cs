using Enkl.Api.Domain.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace Enkl.Api.Data.Configurations;

public class OrgTeamConfiguration : IEntityTypeConfiguration<OrgTeam>
{
    public void Configure(EntityTypeBuilder<OrgTeam> b)
    {
        b.HasKey(t => t.Id);
        b.Property(t => t.Name).HasMaxLength(200).IsRequired();
        b.Property(t => t.ScimExternalId).HasMaxLength(200);

        b.HasOne(t => t.Organisation)
            .WithMany(o => o.OrgTeams)
            .HasForeignKey(t => t.OrganisationId)
            .OnDelete(DeleteBehavior.Cascade);

        // Filtered (partial) unique index — only dedupes SCIM-sourced groups against each other;
        // a hypothetical ScimExternalId-less row (see OrgTeam's own doc comment) never collides.
        b.HasIndex(t => new { t.OrganisationId, t.ScimExternalId })
            .IsUnique()
            .HasFilter("\"ScimExternalId\" IS NOT NULL");
    }
}

public class OrgTeamMemberConfiguration : IEntityTypeConfiguration<OrgTeamMember>
{
    public void Configure(EntityTypeBuilder<OrgTeamMember> b)
    {
        b.HasKey(x => new { x.OrgTeamId, x.UserId });
        b.HasOne(x => x.OrgTeam).WithMany(t => t.Members).HasForeignKey(x => x.OrgTeamId).OnDelete(DeleteBehavior.Cascade);
        b.HasOne(x => x.User).WithMany().HasForeignKey(x => x.UserId).OnDelete(DeleteBehavior.Cascade);
    }
}
