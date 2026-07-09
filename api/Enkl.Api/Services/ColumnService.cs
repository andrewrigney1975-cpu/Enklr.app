using Enkl.Api.Data;
using Enkl.Api.Domain.Entities;
using Enkl.Api.Dtos;
using Microsoft.EntityFrameworkCore;

namespace Enkl.Api.Services;

public class ColumnService
{
    private readonly AppDbContext _db;

    public ColumnService(AppDbContext db)
    {
        _db = db;
    }

    public async Task<ColumnDto> CreateAsync(Guid projectId, CreateColumnRequest request)
    {
        var nextOrder = await _db.Columns.Where(c => c.ProjectId == projectId).CountAsync();
        var column = new Column
        {
            Id = Guid.NewGuid(),
            ProjectId = projectId,
            Name = request.Name,
            Done = request.Done,
            Color = request.Color,
            Order = nextOrder
        };
        _db.Columns.Add(column);
        await _db.SaveChangesAsync();
        return new ColumnDto(column.Id, column.Name, column.Done, column.Color, column.Order);
    }

    public async Task<ColumnDto?> UpdateAsync(Guid projectId, Guid columnId, UpdateColumnRequest request)
    {
        var column = await _db.Columns.FirstOrDefaultAsync(c => c.Id == columnId && c.ProjectId == projectId);
        if (column is null) return null;

        column.Name = request.Name;
        column.Done = request.Done;
        column.Color = request.Color;
        column.Order = request.Order;
        await _db.SaveChangesAsync();
        return new ColumnDto(column.Id, column.Name, column.Done, column.Color, column.Order);
    }

    public async Task<bool> DeleteAsync(Guid projectId, Guid columnId)
    {
        var column = await _db.Columns.FirstOrDefaultAsync(c => c.Id == columnId && c.ProjectId == projectId);
        if (column is null) return false;

        _db.Columns.Remove(column);
        await _db.SaveChangesAsync();
        return true;
    }
}
