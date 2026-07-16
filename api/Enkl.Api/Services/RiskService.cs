using Enkl.Api.Data;
using Enkl.Api.Domain.Entities;
using Enkl.Api.Dtos;
using Microsoft.EntityFrameworkCore;

namespace Enkl.Api.Services;

public class RiskService
{
    private readonly AppDbContext _db;

    public RiskService(AppDbContext db)
    {
        _db = db;
    }

    public async Task<RiskDto?> CreateAsync(Guid projectId, CreateRiskRequest request)
    {
        var project = await _db.Projects.AsNoTracking().FirstOrDefaultAsync(p => p.Id == projectId);
        if (project is null) return null;

        var risk = new Risk
        {
            Id = Guid.NewGuid(), ProjectId = projectId, Key = await NextKeyAsync(projectId, project.Key),
            Title = request.Title, Description = request.Description,
            Likelihood = Math.Clamp(request.Likelihood, 1, 5), Impact = Math.Clamp(request.Impact, 1, 5),
            Mitigations = request.Mitigations, OwnerId = request.OwnerId, TaskId = request.TaskId,
            Status = request.Status is "new" or "in_review" or "closed" ? request.Status : "new",
            DateToClose = request.DateToClose, DateClosed = request.DateClosed,
            DateCreated = DateTime.UtcNow, DateLastModified = DateTime.UtcNow
        };
        _db.Risks.Add(risk);
        await SetLinksAsync(risk, request.DocumentIds, request.PrincipleIds, request.ObjectiveIds);
        await _db.SaveChangesAsync();
        return await ToDtoAsync(risk.Id);
    }

    public async Task<RiskDto?> UpdateAsync(Guid projectId, Guid riskId, UpdateRiskRequest request)
    {
        var risk = await _db.Risks
            .Include(r => r.Documents).Include(r => r.Principles).Include(r => r.Objectives)
            .FirstOrDefaultAsync(r => r.Id == riskId && r.ProjectId == projectId);
        if (risk is null) return null;

        risk.Title = request.Title;
        risk.Description = request.Description;
        risk.Likelihood = Math.Clamp(request.Likelihood, 1, 5);
        risk.Impact = Math.Clamp(request.Impact, 1, 5);
        risk.Mitigations = request.Mitigations;
        risk.OwnerId = request.OwnerId;
        risk.TaskId = request.TaskId;
        risk.Status = request.Status is "new" or "in_review" or "closed" ? request.Status : "new";
        risk.DateToClose = request.DateToClose;
        risk.DateClosed = request.DateClosed;
        risk.DateLastModified = DateTime.UtcNow;

        _db.Set<RiskDocument>().RemoveRange(risk.Documents);
        _db.Set<RiskPrinciple>().RemoveRange(risk.Principles);
        _db.Set<RiskObjective>().RemoveRange(risk.Objectives);
        await SetLinksAsync(risk, request.DocumentIds, request.PrincipleIds, request.ObjectiveIds);

        await _db.SaveChangesAsync();
        return await ToDtoAsync(risk.Id);
    }

    public async Task<bool> DeleteAsync(Guid projectId, Guid riskId)
    {
        var risk = await _db.Risks.FirstOrDefaultAsync(r => r.Id == riskId && r.ProjectId == projectId);
        if (risk is null) return false;

        _db.Risks.Remove(risk);
        await _db.SaveChangesAsync();
        return true;
    }

    private async Task SetLinksAsync(Risk risk, List<Guid>? documentIds, List<Guid>? principleIds, List<Guid>? objectiveIds)
    {
        foreach (var id in (documentIds ?? new List<Guid>()).Distinct())
            if (await _db.Documents.AnyAsync(d => d.Id == id && d.ProjectId == risk.ProjectId))
                _db.Set<RiskDocument>().Add(new RiskDocument { RiskId = risk.Id, DocumentId = id });
        foreach (var id in (principleIds ?? new List<Guid>()).Distinct())
            if (await _db.Principles.AnyAsync(p => p.Id == id && p.ProjectId == risk.ProjectId))
                _db.Set<RiskPrinciple>().Add(new RiskPrinciple { RiskId = risk.Id, PrincipleId = id });
        foreach (var id in (objectiveIds ?? new List<Guid>()).Distinct())
            if (await _db.Objectives.AnyAsync(o => o.Id == id && o.ProjectId == risk.ProjectId))
                _db.Set<RiskObjective>().Add(new RiskObjective { RiskId = risk.Id, ObjectiveId = id });
    }

    private async Task<string> NextKeyAsync(Guid projectId, string projectKey)
    {
        var count = await _db.Risks.CountAsync(r => r.ProjectId == projectId);
        return $"{projectKey}-RISK-{(count + 1):D3}";
    }

    private async Task<RiskDto> ToDtoAsync(Guid riskId)
    {
        var r = await _db.Risks.AsNoTracking().Include(x => x.Documents).Include(x => x.Principles).Include(x => x.Objectives).FirstAsync(x => x.Id == riskId);
        return new RiskDto(
            r.Id, r.Key, r.Title, r.Description, r.Likelihood, r.Impact, r.Mitigations, r.OwnerId, r.TaskId,
            r.Status, r.DateToClose, r.DateClosed,
            r.Documents.Select(x => x.DocumentId).ToList(), r.Principles.Select(x => x.PrincipleId).ToList(), r.Objectives.Select(x => x.ObjectiveId).ToList());
    }
}
