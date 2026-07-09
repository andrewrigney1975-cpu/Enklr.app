using Enkl.Api.Domain.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace Enkl.Api.Data.Configurations;

public class DocumentConfiguration : IEntityTypeConfiguration<Document>
{
    public void Configure(EntityTypeBuilder<Document> b)
    {
        b.HasKey(d => d.Id);
        b.Property(d => d.Key).HasMaxLength(20).IsRequired();
        b.Property(d => d.Title).HasMaxLength(500).IsRequired();

        b.HasOne(d => d.Project)
            .WithMany(p => p.Documents)
            .HasForeignKey(d => d.ProjectId)
            .OnDelete(DeleteBehavior.Cascade);

        b.HasOne(d => d.Owner)
            .WithMany()
            .HasForeignKey(d => d.OwnerId)
            .OnDelete(DeleteBehavior.SetNull);

        b.HasOne(d => d.Task)
            .WithMany()
            .HasForeignKey(d => d.TaskId)
            .OnDelete(DeleteBehavior.SetNull);

        b.HasIndex(d => new { d.ProjectId, d.Key }).IsUnique();
    }
}

public class DocumentRelationConfiguration : IEntityTypeConfiguration<DocumentRelation>
{
    public void Configure(EntityTypeBuilder<DocumentRelation> b)
    {
        b.HasKey(dr => new { dr.DocumentId, dr.RelatedDocumentId });

        b.HasOne(dr => dr.Document)
            .WithMany(d => d.RelatedDocuments)
            .HasForeignKey(dr => dr.DocumentId)
            .OnDelete(DeleteBehavior.Cascade);

        b.HasOne(dr => dr.RelatedDocument)
            .WithMany()
            .HasForeignKey(dr => dr.RelatedDocumentId)
            .OnDelete(DeleteBehavior.Cascade);
    }
}
