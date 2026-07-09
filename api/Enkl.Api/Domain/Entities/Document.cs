namespace Enkl.Api.Domain.Entities;

public class Document
{
    public Guid Id { get; set; }
    public Guid ProjectId { get; set; }
    public Project Project { get; set; } = null!;
    public string Key { get; set; } = "";
    public string Title { get; set; } = "";
    public string? Url { get; set; }
    public string? Description { get; set; }
    public Guid? OwnerId { get; set; }
    public ProjectMember? Owner { get; set; }
    public Guid? TaskId { get; set; }
    public TaskItem? Task { get; set; }
    public DateTime DateCreated { get; set; }
    public DateTime DateLastModified { get; set; }

    public List<DocumentRelation> RelatedDocuments { get; set; } = new();
}
