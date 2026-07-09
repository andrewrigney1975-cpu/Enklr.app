namespace Enkl.Api.Validation;

/// <summary>
/// Ported from wouldCreateCycle/wouldCreateParentCycle (src/js/utils.js). The client checks "would
/// adding this one edge create a cycle" interactively; the migration path instead has to validate an
/// entire freshly-imported graph/tree at once (untrusted input — see MigrationService), so these
/// operate over the whole adjacency/parent map rather than a single hypothetical edge.
/// </summary>
public static class CycleDetection
{
    /// <summary>General directed-graph cycle check — used for the Task dependency DAG.</summary>
    public static bool HasCycle(Dictionary<Guid, List<Guid>> adjacency)
    {
        var visiting = new HashSet<Guid>();
        var visited = new HashSet<Guid>();

        bool Dfs(Guid node)
        {
            if (visiting.Contains(node)) return true;
            if (visited.Contains(node)) return false;
            visiting.Add(node);
            if (adjacency.TryGetValue(node, out var deps))
            {
                foreach (var dep in deps)
                {
                    if (Dfs(dep)) return true;
                }
            }
            visiting.Remove(node);
            visited.Add(node);
            return false;
        }

        foreach (var node in adjacency.Keys)
        {
            if (Dfs(node)) return true;
        }
        return false;
    }

    /// <summary>
    /// Single-parent tree check — used for both the Sub-Tasks tree (Task.ParentTaskId) and the
    /// TeamCommittee tree (TeamCommittee.ParentId). A cycle exists if walking any node's parent
    /// chain revisits a node before reaching a null parent.
    /// </summary>
    public static bool HasParentCycle(Dictionary<Guid, Guid?> parentById)
    {
        foreach (var start in parentById.Keys)
        {
            var seen = new HashSet<Guid>();
            Guid? current = start;
            while (current.HasValue)
            {
                if (!seen.Add(current.Value)) return true;
                parentById.TryGetValue(current.Value, out var next);
                current = next;
            }
        }
        return false;
    }
}
