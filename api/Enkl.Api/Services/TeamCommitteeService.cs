using Enkl.Api.Data;
using Enkl.Api.Domain.Entities;
using Enkl.Api.Dtos;
using Enkl.Api.Validation;
using Microsoft.EntityFrameworkCore;

namespace Enkl.Api.Services;

public class TeamCommitteeService
{
    private readonly AppDbContext _db;

    public TeamCommitteeService(AppDbContext db)
    {
        _db = db;
    }

    public async Task<TeamCommitteeDto?> CreateAsync(Guid projectId, CreateTeamCommitteeRequest request)
    {
        var project = await _db.Projects.FirstOrDefaultAsync(p => p.Id == projectId);
        if (project is null) return null;

        var type = request.Type is "team" or "committee" ? request.Type : "team";
        var tc = new TeamCommittee
        {
            Id = Guid.NewGuid(), ProjectId = projectId, Key = await NextKeyAsync(projectId, project.Key, type),
            Name = request.Name, Description = request.Description, Type = type,
            ParentId = request.ParentId is { } p && await _db.TeamsCommittees.AnyAsync(t => t.Id == p && t.ProjectId == projectId) ? p : null,
            DateCreated = DateTime.UtcNow, DateLastModified = DateTime.UtcNow
        };
        _db.TeamsCommittees.Add(tc);
        await SetMembersAsync(tc, request.MemberIds);
        await _db.SaveChangesAsync();
        return await ToDtoAsync(tc.Id);
    }

    public async Task<TeamCommitteeDto?> UpdateAsync(Guid projectId, Guid id, UpdateTeamCommitteeRequest request)
    {
        var tc = await _db.TeamsCommittees.Include(t => t.Members).FirstOrDefaultAsync(t => t.Id == id && t.ProjectId == projectId);
        if (tc is null) return null;

        Guid? proposedParentId = request.ParentId;
        if (proposedParentId == id) proposedParentId = null;
        else if (proposedParentId is { } candidate && !await _db.TeamsCommittees.AnyAsync(t => t.Id == candidate && t.ProjectId == projectId))
        {
            proposedParentId = null;
        }
        else if (proposedParentId is { } candidate2 && await WouldCreateParentCycleAsync(projectId, id, candidate2))
        {
            throw new ApiValidationException("That parent would create a cycle in the Teams & Committees hierarchy.");
        }

        tc.Name = request.Name;
        tc.Description = request.Description;
        tc.Type = request.Type is "team" or "committee" ? request.Type : "team";
        tc.ParentId = proposedParentId;
        tc.DateLastModified = DateTime.UtcNow;

        _db.Set<TeamCommitteeMember>().RemoveRange(tc.Members);
        await SetMembersAsync(tc, request.MemberIds);

        await _db.SaveChangesAsync();
        return await ToDtoAsync(tc.Id);
    }

    public async Task<bool> DeleteAsync(Guid projectId, Guid id)
    {
        var tc = await _db.TeamsCommittees.FirstOrDefaultAsync(t => t.Id == id && t.ProjectId == projectId);
        if (tc is null) return false;

        // Mirrors mutations.js's deleteTeamCommittee: children are orphaned to top-level rather
        // than cascade-deleted (ParentId is Restrict, so this must happen before the delete).
        var children = await _db.TeamsCommittees.Where(t => t.ParentId == id).ToListAsync();
        foreach (var child in children) child.ParentId = null;

        _db.TeamsCommittees.Remove(tc);
        await _db.SaveChangesAsync();
        return true;
    }

    private async Task<bool> WouldCreateParentCycleAsync(Guid projectId, Guid id, Guid newParentId)
    {
        var parentById = await _db.TeamsCommittees
            .Where(t => t.ProjectId == projectId)
            .Select(t => new { t.Id, t.ParentId })
            .ToDictionaryAsync(t => t.Id, t => t.ParentId);
        parentById[id] = newParentId;
        return CycleDetection.HasParentCycle(parentById);
    }

    private async Task SetMembersAsync(TeamCommittee tc, List<Guid>? memberIds)
    {
        foreach (var id in (memberIds ?? new List<Guid>()).Distinct())
            if (await _db.ProjectMembers.AnyAsync(m => m.Id == id && m.ProjectId == tc.ProjectId))
                _db.Set<TeamCommitteeMember>().Add(new TeamCommitteeMember { TeamCommitteeId = tc.Id, ProjectMemberId = id });
    }

    private async Task<string> NextKeyAsync(Guid projectId, string projectKey, string type)
    {
        var count = await _db.TeamsCommittees.CountAsync(t => t.ProjectId == projectId);
        var prefix = type == "committee" ? "COMM" : "TEAM";
        return $"{projectKey}-{prefix}-{(count + 1):D3}";
    }

    private async Task<TeamCommitteeDto> ToDtoAsync(Guid id)
    {
        var tc = await _db.TeamsCommittees.Include(x => x.Members).FirstAsync(x => x.Id == id);
        return new TeamCommitteeDto(tc.Id, tc.Key, tc.Name, tc.Description, tc.Type, tc.ParentId, tc.Members.Select(x => x.ProjectMemberId).ToList());
    }
}
