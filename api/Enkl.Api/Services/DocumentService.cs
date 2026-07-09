using Enkl.Api.Data;
using Enkl.Api.Domain.Entities;
using Enkl.Api.Dtos;
using Microsoft.EntityFrameworkCore;

namespace Enkl.Api.Services;

public class DocumentService
{
    private readonly AppDbContext _db;

    public DocumentService(AppDbContext db)
    {
        _db = db;
    }

    public async Task<DocumentDto?> CreateAsync(Guid projectId, CreateDocumentRequest request)
    {
        var project = await _db.Projects.FirstOrDefaultAsync(p => p.Id == projectId);
        if (project is null) return null;

        var document = new Document
        {
            Id = Guid.NewGuid(), ProjectId = projectId, Key = await NextKeyAsync(projectId, project.Key),
            Title = request.Title, Url = request.Url, Description = request.Description,
            OwnerId = request.OwnerId, TaskId = request.TaskId,
            DateCreated = DateTime.UtcNow, DateLastModified = DateTime.UtcNow
        };
        _db.Documents.Add(document);
        await SetRelatedDocumentsAsync(document, request.RelatedDocumentIds);
        await _db.SaveChangesAsync();
        return await ToDtoAsync(document.Id);
    }

    public async Task<DocumentDto?> UpdateAsync(Guid projectId, Guid documentId, UpdateDocumentRequest request)
    {
        var document = await _db.Documents.Include(d => d.RelatedDocuments).FirstOrDefaultAsync(d => d.Id == documentId && d.ProjectId == projectId);
        if (document is null) return null;

        document.Title = request.Title;
        document.Url = request.Url;
        document.Description = request.Description;
        document.OwnerId = request.OwnerId;
        document.TaskId = request.TaskId;
        document.DateLastModified = DateTime.UtcNow;

        _db.Set<DocumentRelation>().RemoveRange(document.RelatedDocuments);
        await SetRelatedDocumentsAsync(document, request.RelatedDocumentIds);

        await _db.SaveChangesAsync();
        return await ToDtoAsync(document.Id);
    }

    public async Task<bool> DeleteAsync(Guid projectId, Guid documentId)
    {
        var document = await _db.Documents.FirstOrDefaultAsync(d => d.Id == documentId && d.ProjectId == projectId);
        if (document is null) return false;

        _db.Documents.Remove(document);
        await _db.SaveChangesAsync();
        return true;
    }

    private async Task SetRelatedDocumentsAsync(Document document, List<Guid>? relatedIds)
    {
        // A document can never relate to itself — filtered here too, not just client-side.
        foreach (var relatedId in (relatedIds ?? new List<Guid>()).Distinct().Where(id => id != document.Id))
        {
            if (await _db.Documents.AnyAsync(d => d.Id == relatedId && d.ProjectId == document.ProjectId))
            {
                _db.Set<DocumentRelation>().Add(new DocumentRelation { DocumentId = document.Id, RelatedDocumentId = relatedId });
            }
        }
    }

    private async Task<string> NextKeyAsync(Guid projectId, string projectKey)
    {
        var count = await _db.Documents.CountAsync(d => d.ProjectId == projectId);
        return $"{projectKey}-DOC-{(count + 1):D3}";
    }

    private async Task<DocumentDto> ToDtoAsync(Guid documentId)
    {
        var d = await _db.Documents.Include(x => x.RelatedDocuments).FirstAsync(x => x.Id == documentId);
        return new DocumentDto(d.Id, d.Key, d.Title, d.Url, d.Description, d.OwnerId, d.TaskId, d.RelatedDocuments.Select(r => r.RelatedDocumentId).ToList());
    }
}
