using Enkl.Api.Domain.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace Enkl.Api.Data.Configurations;

public class FormSubmissionConfiguration : IEntityTypeConfiguration<FormSubmission>
{
    public void Configure(EntityTypeBuilder<FormSubmission> b)
    {
        b.HasKey(s => s.Id);
        b.Property(s => s.Status).HasMaxLength(20).HasDefaultValue("draft");

        // Restrict, not Cascade — a Form version with real submissions against it shouldn't be
        // deletable at all (same reasoning as TaskItem.ColumnId's own Restrict FK: the submission
        // record is the thing that matters, not the convenience of a cascading delete).
        b.HasOne(s => s.FormVersion)
            .WithMany()
            .HasForeignKey(s => s.FormVersionId)
            .OnDelete(DeleteBehavior.Restrict);

        b.HasOne(s => s.Project)
            .WithMany()
            .HasForeignKey(s => s.ProjectId)
            .OnDelete(DeleteBehavior.Cascade);

        // Restrict, not Cascade/SetNull — a submission's identity as "who submitted this" is real
        // audit data, not incidental metadata; preserve it by preventing the User row from being
        // removed while submissions reference it, rather than orphaning or silently nulling it out.
        b.HasOne(s => s.SubmittedByUser)
            .WithMany()
            .HasForeignKey(s => s.SubmittedByUserId)
            .OnDelete(DeleteBehavior.Restrict);

        // SetNull, not Restrict/Cascade — a Task getting deleted must never block on or cascade into
        // deleting the FormSubmission that raised it; the link is just orphaned. Indexed since
        // ResumeIfLinkedTaskDoneAsync's whole lookup is keyed by this column.
        b.HasOne(s => s.RaisedTask)
            .WithMany()
            .HasForeignKey(s => s.RaisedTaskId)
            .OnDelete(DeleteBehavior.SetNull);

        b.HasIndex(s => new { s.ProjectId, s.SubmittedByUserId });
        b.HasIndex(s => s.FormVersionId);
        b.HasIndex(s => s.RaisedTaskId);
    }
}
