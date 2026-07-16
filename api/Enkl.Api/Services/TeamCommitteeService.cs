using Enkl.Api.Data;
using Enkl.Api.Domain.Entities;
using Enkl.Api.Dtos;
using Enkl.Api.Validation;
using Microsoft.EntityFrameworkCore;

namespace Enkl.Api.Services;

public class TeamCommitteeService
{
    // Mirrors MEMBER_PALETTE in src/js/config.js / MemberService's own copy exactly, so a
    // ProjectMember created here as a side effect of "apply to project" lands on the same color a
    // manually-added one would.
    private static readonly string[] MemberPalette =
    {
        "#0052CC", "#00875A", "#FF8B00", "#974DE2", "#DE350B",
        "#006644", "#5243AA", "#B04632", "#1B5E20", "#8777D9"
    };

    private readonly AppDbContext _db;

    public TeamCommitteeService(AppDbContext db)
    {
        _db = db;
    }

    public async Task<TeamCommitteeDto?> CreateAsync(Guid projectId, CreateTeamCommitteeRequest request)
    {
        var project = await _db.Projects.AsNoTracking().FirstOrDefaultAsync(p => p.Id == projectId);
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

    /// <summary>
    /// The manual, non-SCIM half of the "SCIM groups translate to teams" design: projects an
    /// Organisation-scoped OrgTeam's current membership into this project's TeamCommittee, creating
    /// ProjectMember rows for anyone not already on the project. Deliberately an apply/snapshot, not
    /// a live sync — re-running it is safe to do repeatedly (e.g. after the OrgTeam's membership
    /// changes at the IdP): it only ever adds people who are missing, and never removes someone from
    /// the TeamCommittee who was added manually or whose OrgTeam membership was later revoked. The
    /// link to re-find the same TeamCommittee across runs is TeamCommittee.SourceOrgTeamId, not name
    /// matching (see that field's own doc comment for why).
    /// </summary>
    public async Task<ApplyOrgTeamResultDto?> ApplyOrgTeamAsync(Guid projectId, Guid orgTeamId)
    {
        var project = await _db.Projects.AsNoTracking().FirstOrDefaultAsync(p => p.Id == projectId);
        if (project is null) return null;

        var orgTeam = await _db.OrgTeams.AsNoTracking().Include(t => t.Members).ThenInclude(m => m.User)
            .FirstOrDefaultAsync(t => t.Id == orgTeamId && t.OrganisationId == project.OrganisationId);
        if (orgTeam is null) return null;

        var warnings = new List<string>();
        if (orgTeam.Members.Count == 0)
        {
            warnings.Add($"\"{orgTeam.Name}\" has no members yet — nothing to apply.");
        }

        var tc = await _db.TeamsCommittees.FirstOrDefaultAsync(t => t.ProjectId == projectId && t.SourceOrgTeamId == orgTeamId);
        if (tc is null)
        {
            tc = new TeamCommittee
            {
                Id = Guid.NewGuid(),
                ProjectId = projectId,
                Key = await NextKeyAsync(projectId, project.Key, "team"),
                Name = orgTeam.Name,
                Type = "team",
                SourceOrgTeamId = orgTeam.Id,
                DateCreated = DateTime.UtcNow,
                DateLastModified = DateTime.UtcNow
            };
            _db.TeamsCommittees.Add(tc);
        }
        else
        {
            tc.DateLastModified = DateTime.UtcNow;
        }

        var memberCount = await _db.ProjectMembers.CountAsync(m => m.ProjectId == projectId);
        foreach (var orgTeamMember in orgTeam.Members)
        {
            var projectMember = await _db.ProjectMembers.AsNoTracking().FirstOrDefaultAsync(m => m.ProjectId == projectId && m.UserId == orgTeamMember.UserId);
            if (projectMember is null)
            {
                projectMember = new ProjectMember
                {
                    Id = Guid.NewGuid(),
                    ProjectId = projectId,
                    UserId = orgTeamMember.UserId,
                    Color = MemberPalette[memberCount % MemberPalette.Length]
                };
                _db.ProjectMembers.Add(projectMember);
                memberCount++;
            }

            if (!await _db.Set<TeamCommitteeMember>().AnyAsync(m => m.TeamCommitteeId == tc.Id && m.ProjectMemberId == projectMember.Id))
            {
                _db.Set<TeamCommitteeMember>().Add(new TeamCommitteeMember { TeamCommitteeId = tc.Id, ProjectMemberId = projectMember.Id });
            }
        }

        await _db.SaveChangesAsync();
        return new ApplyOrgTeamResultDto(await ToDtoAsync(tc.Id), warnings);
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
        var tc = await _db.TeamsCommittees.AsNoTracking().Include(x => x.Members).FirstAsync(x => x.Id == id);
        return new TeamCommitteeDto(tc.Id, tc.Key, tc.Name, tc.Description, tc.Type, tc.ParentId, tc.Members.Select(x => x.ProjectMemberId).ToList());
    }
}
