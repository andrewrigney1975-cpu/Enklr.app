using Enkl.Api.Domain.Entities;
using Enkl.Api.Dtos;
using Enkl.Api.Validation;

namespace Enkl.Api.Services;

/// <summary>
/// ARCHITECTURE-REVIEW.md finding 2.1: split out of MigrationService.cs — the "is this externally
/// supplied DAG/tree actually acyclic" seam, run as MigrateAsync's Phase 3, after every row has been
/// created and wired but before SaveChangesAsync commits. An externally-supplied export is untrusted
/// input — validated the exact same way the client-side wouldCreateCycle/wouldCreateParentCycle guard
/// checks interactive edits (src/js/utils.js). Pure/stateless — takes only already-built entity maps,
/// no AppDbContext, so it needs no DI registration; MigrationService calls it directly.
/// </summary>
public static class MigrationHierarchyValidator
{
    public static void ValidateNoCycles(
        List<ImportTaskNodeDto> flatTasks, Dictionary<string, TaskItem> taskByKey,
        List<ImportTeamCommitteeDto>? teamsCommittees, Dictionary<string, TeamCommittee> teamCommitteeByOldId)
    {
        var adjacency = new Dictionary<Guid, List<Guid>>();
        foreach (var t in flatTasks)
        {
            if (!taskByKey.TryGetValue(t.Key, out var task)) continue;
            var deps = new List<Guid>();
            foreach (var depKey in t.DependsOn ?? new List<string>())
                if (taskByKey.TryGetValue(depKey, out var depTask)) deps.Add(depTask.Id);
            adjacency[task.Id] = deps;
        }
        if (CycleDetection.HasCycle(adjacency))
        {
            throw new ApiValidationException("The imported task dependency graph contains a cycle.");
        }

        var taskParentById = flatTasks
            .Where(t => taskByKey.ContainsKey(t.Key))
            .ToDictionary(
                t => taskByKey[t.Key].Id,
                t => t.ParentKey is not null && taskByKey.TryGetValue(t.ParentKey, out var p) ? (Guid?)p.Id : null);
        if (CycleDetection.HasParentCycle(taskParentById))
        {
            throw new ApiValidationException("The imported sub-task hierarchy contains a cycle.");
        }

        var committeeParentById = (teamsCommittees ?? new List<ImportTeamCommitteeDto>())
            .Where(tc => teamCommitteeByOldId.ContainsKey(tc.Id))
            .ToDictionary(
                tc => teamCommitteeByOldId[tc.Id].Id,
                tc => tc.ParentId is not null && teamCommitteeByOldId.TryGetValue(tc.ParentId, out var p) ? (Guid?)p.Id : null);
        if (CycleDetection.HasParentCycle(committeeParentById))
        {
            throw new ApiValidationException("The imported Teams & Committees hierarchy contains a cycle.");
        }
    }
}
