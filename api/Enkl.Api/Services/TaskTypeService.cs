using Enkl.Api.Data;
using Enkl.Api.Domain.Entities;
using Enkl.Api.Dtos;
using Enkl.Api.Validation;
using Microsoft.EntityFrameworkCore;

namespace Enkl.Api.Services;

public class TaskTypeService
{
    private readonly AppDbContext _db;

    public TaskTypeService(AppDbContext db)
    {
        _db = db;
    }

    public async Task<TaskTypeDto?> CreateAsync(Guid projectId, CreateTaskTypeRequest request)
    {
        var projectExists = await _db.Projects.AnyAsync(p => p.Id == projectId);
        if (!projectExists) return null;

        var type = new TaskType { Id = Guid.NewGuid(), ProjectId = projectId, Name = request.Name, IconName = FieldClamps.ValidIconNameOrNull(request.IconName) };
        _db.TaskTypes.Add(type);
        await _db.SaveChangesAsync();
        return ToDto(type);
    }

    public async Task<TaskTypeDto?> UpdateAsync(Guid projectId, Guid typeId, UpdateTaskTypeRequest request)
    {
        var type = await _db.TaskTypes.FirstOrDefaultAsync(t => t.Id == typeId && t.ProjectId == projectId);
        if (type is null) return null;

        type.Name = request.Name;
        type.IconName = FieldClamps.ValidIconNameOrNull(request.IconName);
        await _db.SaveChangesAsync();
        return ToDto(type);
    }

    public async Task<bool> DeleteAsync(Guid projectId, Guid typeId)
    {
        var type = await _db.TaskTypes.FirstOrDefaultAsync(t => t.Id == typeId && t.ProjectId == projectId);
        if (type is null) return false;

        _db.TaskTypes.Remove(type);
        await _db.SaveChangesAsync();
        return true;
    }

    private static TaskTypeDto ToDto(TaskType t) => new(t.Id, t.Name, t.IconName);
}
