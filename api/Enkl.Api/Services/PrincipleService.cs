using Enkl.Api.Data;
using Enkl.Api.Domain.Entities;
using Enkl.Api.Dtos;
using Microsoft.EntityFrameworkCore;

namespace Enkl.Api.Services;

public class PrincipleService
{
    private readonly AppDbContext _db;

    public PrincipleService(AppDbContext db)
    {
        _db = db;
    }

    public async Task<PrincipleDto?> CreateAsync(Guid projectId, CreatePrincipleRequest request)
    {
        var project = await _db.Projects.FirstOrDefaultAsync(p => p.Id == projectId);
        if (project is null) return null;

        var principle = new Principle
        {
            Id = Guid.NewGuid(), ProjectId = projectId, Key = await NextKeyAsync(projectId, project.Key),
            Title = request.Title, Description = request.Description, DocumentUrl = request.DocumentUrl,
            DateCreated = DateTime.UtcNow, DateLastModified = DateTime.UtcNow
        };
        _db.Principles.Add(principle);
        await _db.SaveChangesAsync();
        return ToDto(principle);
    }

    public async Task<PrincipleDto?> UpdateAsync(Guid projectId, Guid principleId, UpdatePrincipleRequest request)
    {
        var principle = await _db.Principles.FirstOrDefaultAsync(p => p.Id == principleId && p.ProjectId == projectId);
        if (principle is null) return null;

        principle.Title = request.Title;
        principle.Description = request.Description;
        principle.DocumentUrl = request.DocumentUrl;
        principle.DateLastModified = DateTime.UtcNow;
        await _db.SaveChangesAsync();
        return ToDto(principle);
    }

    public async Task<bool> DeleteAsync(Guid projectId, Guid principleId)
    {
        var principle = await _db.Principles.FirstOrDefaultAsync(p => p.Id == principleId && p.ProjectId == projectId);
        if (principle is null) return false;

        _db.Principles.Remove(principle);
        await _db.SaveChangesAsync();
        return true;
    }

    private async Task<string> NextKeyAsync(Guid projectId, string projectKey)
    {
        var count = await _db.Principles.CountAsync(p => p.ProjectId == projectId);
        return $"{projectKey}-PRIN-{(count + 1):D3}";
    }

    private static PrincipleDto ToDto(Principle p) => new(p.Id, p.Key, p.Title, p.Description, p.DocumentUrl);
}
