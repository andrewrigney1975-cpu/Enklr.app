using Enkl.Api.Domain.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace Enkl.Api.Data.Configurations;

public class ToDoItemConfiguration : IEntityTypeConfiguration<ToDoItem>
{
    public void Configure(EntityTypeBuilder<ToDoItem> b)
    {
        b.HasKey(i => i.Id);
        b.Property(i => i.Note).IsRequired();
        b.HasIndex(i => i.ToDoListId);

        b.HasOne(i => i.ToDoList)
            .WithMany(l => l.Items)
            .HasForeignKey(i => i.ToDoListId)
            .OnDelete(DeleteBehavior.Cascade);
    }
}
