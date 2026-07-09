using Enkl.Api.Data;
using Enkl.Api.Domain.Entities;
using Enkl.Api.Dtos;
using Microsoft.EntityFrameworkCore;

namespace Enkl.Api.Services;

public class DecisionService
{
    private readonly AppDbContext _db;

    private static readonly HashSet<string> ValidTypes = new()
    {
        "strategy", "policy", "budgetary", "financial", "functional", "technical", "process", "operational"
    };

    public DecisionService(AppDbContext db)
    {
        _db = db;
    }

    public async Task<DecisionDto?> CreateAsync(Guid projectId, CreateDecisionRequest request)
    {
        var project = await _db.Projects.FirstOrDefaultAsync(p => p.Id == projectId);
        if (project is null) return null;

        var decision = new Decision
        {
            Id = Guid.NewGuid(), ProjectId = projectId, Key = await NextKeyAsync(projectId, project.Key),
            Title = request.Title, Description = request.Description,
            Type = ValidTypes.Contains(request.Type) ? request.Type : "operational",
            Status = request.Status is "open" or "in_review" or "completed" ? request.Status : "open",
            Outcome = request.Outcome, OwnerId = request.OwnerId, Approver = request.Approver, TaskId = request.TaskId,
            DateCreated = DateTime.UtcNow, DateLastModified = DateTime.UtcNow
        };
        _db.Decisions.Add(decision);
        await SetLinksAsync(decision, request.DocumentIds, request.RiskIds, request.PrincipleIds, request.ObjectiveIds);
        await _db.SaveChangesAsync();
        return await ToDtoAsync(decision.Id);
    }

    public async Task<DecisionDto?> UpdateAsync(Guid projectId, Guid decisionId, UpdateDecisionRequest request)
    {
        var decision = await _db.Decisions
            .Include(d => d.Documents).Include(d => d.Risks).Include(d => d.Principles).Include(d => d.Objectives)
            .FirstOrDefaultAsync(d => d.Id == decisionId && d.ProjectId == projectId);
        if (decision is null) return null;

        decision.Title = request.Title;
        decision.Description = request.Description;
        decision.Type = ValidTypes.Contains(request.Type) ? request.Type : "operational";
        decision.Status = request.Status is "open" or "in_review" or "completed" ? request.Status : "open";
        decision.Outcome = request.Outcome;
        decision.OwnerId = request.OwnerId;
        decision.Approver = request.Approver;
        decision.TaskId = request.TaskId;
        decision.DateLastModified = DateTime.UtcNow;

        _db.Set<DecisionDocument>().RemoveRange(decision.Documents);
        _db.Set<DecisionRisk>().RemoveRange(decision.Risks);
        _db.Set<DecisionPrinciple>().RemoveRange(decision.Principles);
        _db.Set<DecisionObjective>().RemoveRange(decision.Objectives);
        await SetLinksAsync(decision, request.DocumentIds, request.RiskIds, request.PrincipleIds, request.ObjectiveIds);

        await _db.SaveChangesAsync();
        return await ToDtoAsync(decision.Id);
    }

    public async Task<bool> DeleteAsync(Guid projectId, Guid decisionId)
    {
        var decision = await _db.Decisions.FirstOrDefaultAsync(d => d.Id == decisionId && d.ProjectId == projectId);
        if (decision is null) return false;

        _db.Decisions.Remove(decision);
        await _db.SaveChangesAsync();
        return true;
    }

    private async Task SetLinksAsync(Decision decision, List<Guid>? documentIds, List<Guid>? riskIds, List<Guid>? principleIds, List<Guid>? objectiveIds)
    {
        foreach (var id in (documentIds ?? new List<Guid>()).Distinct())
            if (await _db.Documents.AnyAsync(x => x.Id == id && x.ProjectId == decision.ProjectId))
                _db.Set<DecisionDocument>().Add(new DecisionDocument { DecisionId = decision.Id, DocumentId = id });
        foreach (var id in (riskIds ?? new List<Guid>()).Distinct())
            if (await _db.Risks.AnyAsync(x => x.Id == id && x.ProjectId == decision.ProjectId))
                _db.Set<DecisionRisk>().Add(new DecisionRisk { DecisionId = decision.Id, RiskId = id });
        foreach (var id in (principleIds ?? new List<Guid>()).Distinct())
            if (await _db.Principles.AnyAsync(x => x.Id == id && x.ProjectId == decision.ProjectId))
                _db.Set<DecisionPrinciple>().Add(new DecisionPrinciple { DecisionId = decision.Id, PrincipleId = id });
        foreach (var id in (objectiveIds ?? new List<Guid>()).Distinct())
            if (await _db.Objectives.AnyAsync(x => x.Id == id && x.ProjectId == decision.ProjectId))
                _db.Set<DecisionObjective>().Add(new DecisionObjective { DecisionId = decision.Id, ObjectiveId = id });
    }

    private async Task<string> NextKeyAsync(Guid projectId, string projectKey)
    {
        var count = await _db.Decisions.CountAsync(d => d.ProjectId == projectId);
        return $"{projectKey}-DEC-{(count + 1):D3}";
    }

    private async Task<DecisionDto> ToDtoAsync(Guid decisionId)
    {
        var d = await _db.Decisions
            .Include(x => x.Documents).Include(x => x.Risks).Include(x => x.Principles).Include(x => x.Objectives)
            .FirstAsync(x => x.Id == decisionId);
        return new DecisionDto(
            d.Id, d.Key, d.Title, d.Description, d.Type, d.Status, d.Outcome, d.OwnerId, d.Approver, d.TaskId,
            d.Documents.Select(x => x.DocumentId).ToList(), d.Risks.Select(x => x.RiskId).ToList(),
            d.Principles.Select(x => x.PrincipleId).ToList(), d.Objectives.Select(x => x.ObjectiveId).ToList());
    }
}
