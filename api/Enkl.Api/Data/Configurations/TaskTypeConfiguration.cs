using Enkl.Api.Domain.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace Enkl.Api.Data.Configurations;

public class TaskTypeConfiguration : IEntityTypeConfiguration<TaskType>
{
    public void Configure(EntityTypeBuilder<TaskType> b)
    {
        b.HasKey(t => t.Id);
        b.Property(t => t.Name).HasMaxLength(100).IsRequired();
        b.Property(t => t.IconName).HasMaxLength(50);

        b.HasOne(t => t.Project)
            .WithMany(p => p.TaskTypes)
            .HasForeignKey(t => t.ProjectId)
            .OnDelete(DeleteBehavior.Cascade);
    }
}
