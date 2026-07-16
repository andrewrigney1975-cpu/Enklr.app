using Enkl.Api.Data;
using Enkl.Api.Domain.Entities;
using Enkl.Api.Dtos;
using Microsoft.EntityFrameworkCore;

namespace Enkl.Api.Services;

public class ObjectiveService
{
    private readonly AppDbContext _db;

    public ObjectiveService(AppDbContext db)
    {
        _db = db;
    }

    public async Task<ObjectiveDto?> CreateAsync(Guid projectId, CreateObjectiveRequest request)
    {
        var project = await _db.Projects.AsNoTracking().FirstOrDefaultAsync(p => p.Id == projectId);
        if (project is null) return null;

        var objective = new Objective
        {
            Id = Guid.NewGuid(), ProjectId = projectId, Key = await NextKeyAsync(projectId, project.Key),
            Title = request.Title, Description = request.Description,
            DateCreated = DateTime.UtcNow, DateLastModified = DateTime.UtcNow
        };
        _db.Objectives.Add(objective);
        await SetPrinciplesAsync(objective, request.PrincipleIds);
        await _db.SaveChangesAsync();
        return await ToDtoAsync(objective.Id);
    }

    public async Task<ObjectiveDto?> UpdateAsync(Guid projectId, Guid objectiveId, UpdateObjectiveRequest request)
    {
        var objective = await _db.Objectives.Include(o => o.Principles).FirstOrDefaultAsync(o => o.Id == objectiveId && o.ProjectId == projectId);
        if (objective is null) return null;

        objective.Title = request.Title;
        objective.Description = request.Description;
        objective.DateLastModified = DateTime.UtcNow;

        _db.Set<ObjectivePrinciple>().RemoveRange(objective.Principles);
        await SetPrinciplesAsync(objective, request.PrincipleIds);

        await _db.SaveChangesAsync();
        return await ToDtoAsync(objective.Id);
    }

    public async Task<bool> DeleteAsync(Guid projectId, Guid objectiveId)
    {
        var objective = await _db.Objectives.FirstOrDefaultAsync(o => o.Id == objectiveId && o.ProjectId == projectId);
        if (objective is null) return false;

        _db.Objectives.Remove(objective);
        await _db.SaveChangesAsync();
        return true;
    }

    private async Task SetPrinciplesAsync(Objective objective, List<Guid>? principleIds)
    {
        foreach (var id in (principleIds ?? new List<Guid>()).Distinct())
            if (await _db.Principles.AnyAsync(p => p.Id == id && p.ProjectId == objective.ProjectId))
                _db.Set<ObjectivePrinciple>().Add(new ObjectivePrinciple { ObjectiveId = objective.Id, PrincipleId = id });
    }

    private async Task<string> NextKeyAsync(Guid projectId, string projectKey)
    {
        var count = await _db.Objectives.CountAsync(o => o.ProjectId == projectId);
        return $"{projectKey}-OBJ-{(count + 1):D3}";
    }

    private async Task<ObjectiveDto> ToDtoAsync(Guid objectiveId)
    {
        var o = await _db.Objectives.AsNoTracking().Include(x => x.Principles).FirstAsync(x => x.Id == objectiveId);
        return new ObjectiveDto(o.Id, o.Key, o.Title, o.Description, o.Principles.Select(x => x.PrincipleId).ToList());
    }
}
