using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using Enkl.Api.Data;
using Enkl.Api.Domain.Entities;
using Enkl.Api.Dtos;
using Microsoft.EntityFrameworkCore;
using Npgsql;

namespace Enkl.Api.Services;

/// <summary>
/// AI Assistant (v4 Phase 1) — a server-mediated Claude tool-use loop scoped to one project. The
/// Anthropic API key never reaches the frontend (CLAUDE.md's CSP/security posture forbids that for a
/// single-file, publicly-servable bundle); every request goes through this service instead, which
/// calls the Messages API directly over raw HTTP (no SDK dependency — see the plan's rationale: no C#
/// SDK skill reference was loaded, and raw HTTP against a stable, documented endpoint is safer than
/// guessing SDK type names).
///
/// Tool calls are re-validated against projectId server-side (find-by-title/key queries, column
/// lookups) rather than trusting anything Claude's tool input claims — same "never trust the client's
/// id list" discipline as the rest of this codebase (root CLAUDE.md §4), just applied to
/// model-generated input instead of directly-client-supplied input.
///
/// No conversation persistence yet (§ "Data model additions" in the plan) — the frontend resends the
/// running transcript each call, same as any stateless chat UI.
/// </summary>
public class AiAssistantService
{
    private static readonly string[] PriorityOrder = { "trivial", "low", "medium", "high", "critical" };
    private const int MaxToolLoopIterations = 6;

    // A shared, never-mutated empty list for the (near-universal) "this tool call produced no
    // board-mutating action" case — avoids allocating a fresh empty List<T> at every one of those
    // return sites, and avoids ever returning a bare `null` that a caller's `actions.AddRange(...)`
    // would NullReferenceException on.
    private static readonly List<AiAssistantActionDto> NoActions = new();

    // Default schedule window for sub-tasks with no Release to inherit dates from — see
    // ResolveSubtaskWindowAsync.
    private const int DefaultSubtaskWindowDays = 14;

    // Loaded once per process, not per-request - USER-GUIDE.md is a few KB, re-reading it from disk
    // on every chat call would be wasteful. Tries the Docker runtime layout first (copied next to the
    // DLL by the Dockerfile - see its own comment for why the build context had to move to the repo
    // root to reach it), then a couple of relative-to-repo-root candidates for a local `dotnet run`
    // (whose working directory is this project's own folder, not the container's /app). Empty string
    // (not null, not a thrown exception) if none of these exist - a missing guide file must never
    // break the assistant itself, just quietly omit that extra context from the system prompt.
    private static readonly Lazy<string> UserGuideMarkdown = new(() =>
    {
        string[] candidates =
        {
            Path.Combine(AppContext.BaseDirectory, "USER-GUIDE.md"),
            Path.Combine(AppContext.BaseDirectory, "..", "..", "..", "USER-GUIDE.md"),
            Path.Combine(Directory.GetCurrentDirectory(), "..", "..", "USER-GUIDE.md")
        };
        foreach (var path in candidates)
        {
            try
            {
                if (File.Exists(path)) return File.ReadAllText(path);
            }
            catch (IOException) { /* fall through to the next candidate */ }
        }
        return "";
    });

    private readonly AppDbContext _db;
    private readonly TaskService _tasks;
    private readonly IHttpClientFactory _httpClientFactory;
    private readonly IConfiguration _config;
    private readonly ILogger<AiAssistantService> _logger;

    public AiAssistantService(AppDbContext db, TaskService tasks, IHttpClientFactory httpClientFactory, IConfiguration config, ILogger<AiAssistantService> logger)
    {
        _db = db;
        _tasks = tasks;
        _httpClientFactory = httpClientFactory;
        _config = config;
        _logger = logger;
    }

    /// <summary>
    /// Reads Vendor Portal's own `vendor_feature_entitlements` table (org_id, feature_key, enabled) —
    /// a table this tier does not own/migrate, since Vendor Portal is the one that creates and writes
    /// it (same "vendor owns its own tables, main app just reads them" split as vendor_licenses/
    /// vendor_contracts). Fails OPEN (treats the org as entitled) if the table doesn't exist at all —
    /// Vendor Portal only ever runs against the Hosted/SaaS deployment model
    /// (SYSTEMS-INTEGRATOR-GUIDE.md §2); a Local or Self-hosted deployment never has Vendor Portal
    /// running against its database, so this table simply won't exist there, and that must never take
    /// AI Assistant away from those deployments.
    /// </summary>
    public async Task<bool> IsOrgEntitledAsync(Guid orgId, string featureKey)
    {
        try
        {
            var rows = await _db.Database
                .SqlQueryRaw<bool>(
                    "SELECT enabled FROM vendor_feature_entitlements WHERE org_id = {0} AND feature_key = {1}",
                    orgId, featureKey)
                .ToListAsync();
            // No row for this (org, feature) = not entitled - see the migration's row-presence
            // semantics (root CLAUDE.md §9's entitlement section).
            return rows.Count > 0 && rows[0];
        }
        catch (PostgresException ex) when (ex.SqlState == PostgresErrorCodes.UndefinedTable)
        {
            return true;
        }
    }

    /// <summary>Project-scoped convenience wrapper around <see cref="IsOrgEntitledAsync"/> for the
    /// availability endpoint - null means the project itself wasn't found (404), not an entitlement
    /// answer either way.</summary>
    public async Task<bool?> IsProjectOrgEntitledAsync(Guid projectId, string featureKey)
    {
        var orgId = await _db.Projects.AsNoTracking().Where(p => p.Id == projectId).Select(p => (Guid?)p.OrganisationId).FirstOrDefaultAsync();
        if (orgId is null) return null;
        return await IsOrgEntitledAsync(orgId.Value, featureKey);
    }

    public async Task<AiAssistantChatResponse?> ChatAsync(Guid projectId, AiAssistantChatRequest request)
    {
        var project = await _db.Projects.AsNoTracking().FirstOrDefaultAsync(p => p.Id == projectId);
        if (project is null) return null;

        if (!await IsOrgEntitledAsync(project.OrganisationId, "ai_assistant"))
        {
            throw new AiAssistantNotEntitledException();
        }

        var apiKey = _config["Anthropic:ApiKey"];
        if (string.IsNullOrWhiteSpace(apiKey))
        {
            throw new InvalidOperationException("Anthropic:ApiKey is not configured — the AI assistant is unavailable until an API key is set.");
        }

        var columns = await _db.Columns.AsNoTracking().Where(c => c.ProjectId == projectId).OrderBy(c => c.Order).ToListAsync();
        var members = await _db.ProjectMembers.AsNoTracking().Include(m => m.User).Where(m => m.ProjectId == projectId).ToListAsync();
        var taskTypes = await _db.TaskTypes.AsNoTracking().Where(t => t.ProjectId == projectId).ToListAsync();
        var teams = await _db.TeamsCommittees.AsNoTracking().Where(t => t.ProjectId == projectId && t.Type == "team").ToListAsync();
        var systemPrompt = BuildSystemPrompt(project.Name, columns, members, taskTypes, teams, request.AlertsSummary);

        var messages = new JsonArray();
        foreach (var m in request.Messages)
        {
            messages.Add(new JsonObject { ["role"] = m.Role, ["content"] = m.Content });
        }

        var actions = new List<AiAssistantActionDto>();
        var client = _httpClientFactory.CreateClient("Anthropic");
        client.DefaultRequestHeaders.Remove("x-api-key");
        client.DefaultRequestHeaders.Add("x-api-key", apiKey);
        if (!client.DefaultRequestHeaders.Contains("anthropic-version"))
        {
            client.DefaultRequestHeaders.Add("anthropic-version", "2023-06-01");
        }

        for (var iteration = 0; iteration < MaxToolLoopIterations; iteration++)
        {
            var body = new JsonObject
            {
                ["model"] = "claude-sonnet-5",
                ["max_tokens"] = 2000,
                ["system"] = systemPrompt,
                ["messages"] = JsonNode.Parse(messages.ToJsonString()),
                ["tools"] = BuildToolDefinitions(),
                ["output_config"] = new JsonObject { ["effort"] = "low" }
            };

            using var httpRequest = new HttpRequestMessage(HttpMethod.Post, "v1/messages")
            {
                Content = new StringContent(body.ToJsonString(), Encoding.UTF8, "application/json")
            };
            using var httpResponse = await client.SendAsync(httpRequest);
            var responseText = await httpResponse.Content.ReadAsStringAsync();

            if (!httpResponse.IsSuccessStatusCode)
            {
                _logger.LogError("Anthropic API returned {StatusCode}: {Body}", httpResponse.StatusCode, responseText);
                throw new InvalidOperationException("The AI assistant is temporarily unavailable. Please try again.");
            }

            var responseJson = JsonNode.Parse(responseText)!.AsObject();
            var stopReason = responseJson["stop_reason"]?.GetValue<string>();
            var contentBlocks = responseJson["content"]!.AsArray();

            var toolUseBlocks = contentBlocks.Where(b => b!["type"]!.GetValue<string>() == "tool_use").ToList();
            var replyText = string.Concat(contentBlocks
                .Where(b => b!["type"]!.GetValue<string>() == "text")
                .Select(b => b!["text"]!.GetValue<string>()));

            if (stopReason != "tool_use" || toolUseBlocks.Count == 0)
            {
                return new AiAssistantChatResponse(replyText, actions);
            }

            // Echo the assistant's turn (including tool_use blocks) back, then append one user turn
            // carrying every tool_result — parallel tool calls must return in a single message (per
            // the Claude API tool-use contract), never split across multiple.
            messages.Add(new JsonObject { ["role"] = "assistant", ["content"] = JsonNode.Parse(contentBlocks.ToJsonString()) });

            var toolResults = new JsonArray();
            foreach (var toolUse in toolUseBlocks)
            {
                var toolName = toolUse!["name"]!.GetValue<string>();
                var toolUseId = toolUse["id"]!.GetValue<string>();
                var input = toolUse["input"]!.AsObject();

                var (resultText, isError, toolActions) = await ExecuteToolAsync(projectId, toolName, input);
                actions.AddRange(toolActions);

                var toolResult = new JsonObject
                {
                    ["type"] = "tool_result",
                    ["tool_use_id"] = toolUseId,
                    ["content"] = resultText
                };
                if (isError) toolResult["is_error"] = true;
                toolResults.Add(toolResult);
            }

            messages.Add(new JsonObject { ["role"] = "user", ["content"] = JsonNode.Parse(toolResults.ToJsonString()) });
        }

        return new AiAssistantChatResponse("I wasn't able to finish that within the allotted number of steps — could you try a narrower request?", actions);
    }

    private async Task<(string ResultText, bool IsError, List<AiAssistantActionDto> Actions)> ExecuteToolAsync(Guid projectId, string toolName, JsonObject input)
    {
        try
        {
            return toolName switch
            {
                "create_task" => await CreateTaskToolAsync(projectId, input),
                "create_subtasks" => await CreateSubtasksToolAsync(projectId, input),
                "update_task" => await UpdateTaskToolAsync(projectId, input),
                "get_task_details" => await GetTaskDetailsToolAsync(projectId, input),
                "list_critical_tasks" => await ListCriticalTasksToolAsync(projectId, input),
                "search_tasks" => await SearchTasksToolAsync(projectId, input),
                _ => ($"Unknown tool: {toolName}", true, new List<AiAssistantActionDto>())
            };
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "AI assistant tool {ToolName} failed for project {ProjectId}", toolName, projectId);
            return ("That action failed: " + ex.Message, true, new List<AiAssistantActionDto>());
        }
    }

    private async Task<(string, bool, List<AiAssistantActionDto>)> CreateTaskToolAsync(Guid projectId, JsonObject input)
    {
        var title = input["title"]?.GetValue<string>();
        if (string.IsNullOrWhiteSpace(title)) return ("A task title is required.", true, NoActions);

        var (column, columnError) = await ResolveColumnAsync(projectId, input["columnName"]?.GetValue<string>());
        if (columnError is not null) return (columnError, true, NoActions);

        var (assigneeProvided, assigneeId, assigneeError) = await ResolveAssigneeAsync(projectId, input, "assigneeName");
        if (assigneeError is not null) return (assigneeError, true, NoActions);

        var (_, typeId, typeError) = await ResolveTaskTypeAsync(projectId, input, "typeName");
        if (typeError is not null) return (typeError, true, NoActions);

        var (parentProvided, parent, parentError) = await ResolveParentTaskAsync(projectId, input, "parentTaskKey");
        if (parentError is not null) return (parentError, true, NoActions);

        var priority = NormalizePriority(input["priority"]?.GetValue<string>());
        var explicitStartDate = ParseDate(input["startDate"]?.GetValue<string>());
        var explicitDueDate = ParseDate(input["dueDate"]?.GetValue<string>());

        DateOnly? startDate = explicitStartDate;
        DateOnly? dueDate = explicitDueDate;
        if (parentProvided && parent is not null && (explicitStartDate is null || explicitDueDate is null))
        {
            // A sub-task created against a parent, with no explicit dates of its own, is scheduled to
            // span the parent's linked Release (or a 2-week-from-today default when there's no Release
            // or the Release has no dates of its own) — see ResolveSubtaskWindowAsync's own doc
            // comment. A single sub-task created this way (as opposed to create_subtasks' batch of
            // several) gets the WHOLE window, since there are no siblings to divide it with.
            var (windowStart, windowEnd) = await ResolveSubtaskWindowAsync(parent);
            startDate ??= windowStart;
            dueDate ??= windowEnd;
        }

        var created = await _tasks.CreateAsync(projectId, new CreateTaskRequest(
            Title: title, Description: input["description"]?.GetValue<string>(), Priority: priority ?? "medium",
            ColumnId: column!.Id,
            // A sub-task inherits its parent's assignee/release/business value/cost "where available"
            // (i.e. only when the parent actually has one set) unless explicitly overridden here.
            AssigneeId: assigneeProvided ? assigneeId : (parentProvided ? parent?.AssigneeId : null),
            ReleaseId: parentProvided ? parent?.ReleaseId : null,
            TypeId: typeId,
            ParentTaskId: parentProvided ? parent?.Id : null,
            DependsOnTaskIds: null, StartDate: startDate, EndDate: dueDate,
            BusinessValue: parentProvided ? parent?.BusinessValue : null,
            TaskCost: parentProvided ? parent?.TaskCost : null));

        if (created is null) return ("Could not create the task — the target column may no longer exist.", true, NoActions);

        var parentNote = parentProvided && parent is not null ? $" as a sub-task of {parent.Key}" : "";
        return ($"Created task {created.Key}: \"{created.Title}\" in column \"{column.Name}\"{parentNote}.", false,
            new List<AiAssistantActionDto> { new("task_created", created.Id, created.Key, created.Title) });
    }

    /// <summary>Batch sibling-aware counterpart to create_task's own single-item parentTaskKey path —
    /// the one place "spread these N sub-tasks evenly across the parent's Release window" can actually
    /// be computed, since create_task's own per-call resolution has no visibility into how many
    /// sibling sub-tasks are being created alongside it. Each item can still override title (required),
    /// description, priority, assigneeName, typeName, startDate, dueDate — an explicit date on a given
    /// item always wins over its computed segment.</summary>
    private async Task<(string, bool, List<AiAssistantActionDto>)> CreateSubtasksToolAsync(Guid projectId, JsonObject input)
    {
        var parentIdentifier = input["parentTaskKey"]?.GetValue<string>();
        if (string.IsNullOrWhiteSpace(parentIdentifier)) return ("A parentTaskKey is required.", true, NoActions);

        var parent = await FindTaskAsync(projectId, parentIdentifier);
        if (parent is null) return ($"No task found matching \"{parentIdentifier}\" to use as the parent.", true, NoActions);

        if (input["subtasks"] is not JsonArray itemsNode || itemsNode.Count == 0)
        {
            return ("At least one sub-task is required in \"subtasks\".", true, NoActions);
        }

        var (windowStart, windowEnd) = await ResolveSubtaskWindowAsync(parent);
        var segments = SplitWindowEvenly(windowStart, windowEnd, itemsNode.Count);

        var actions = new List<AiAssistantActionDto>();
        var createdSummaries = new List<string>();
        for (var i = 0; i < itemsNode.Count; i++)
        {
            if (itemsNode[i] is not JsonObject item)
            {
                return ($"Sub-task #{i + 1} is not a valid object.", true, actions);
            }

            var title = item["title"]?.GetValue<string>();
            if (string.IsNullOrWhiteSpace(title)) return ($"Sub-task #{i + 1} is missing a title.", true, actions);

            var (column, columnError) = await ResolveColumnAsync(projectId, item["columnName"]?.GetValue<string>());
            if (columnError is not null) return (columnError, true, actions);

            var (assigneeProvided, assigneeIdOverride, assigneeError) = await ResolveAssigneeAsync(projectId, item, "assigneeName");
            if (assigneeError is not null) return (assigneeError, true, actions);

            var (typeProvided, typeId, typeError) = await ResolveTaskTypeAsync(projectId, item, "typeName");
            if (typeError is not null) return (typeError, true, actions);

            var priority = NormalizePriority(item["priority"]?.GetValue<string>());
            var explicitStart = ParseDate(item["startDate"]?.GetValue<string>());
            var explicitDue = ParseDate(item["dueDate"]?.GetValue<string>());
            var segment = segments[i];

            var created = await _tasks.CreateAsync(projectId, new CreateTaskRequest(
                Title: title, Description: item["description"]?.GetValue<string>(), Priority: priority ?? "medium",
                ColumnId: column!.Id,
                AssigneeId: assigneeProvided ? assigneeIdOverride : parent.AssigneeId,
                ReleaseId: parent.ReleaseId,
                TypeId: typeProvided ? typeId : null,
                ParentTaskId: parent.Id,
                DependsOnTaskIds: null,
                StartDate: explicitStart ?? segment.Start, EndDate: explicitDue ?? segment.End,
                BusinessValue: parent.BusinessValue, TaskCost: parent.TaskCost));

            if (created is null) return ($"Could not create sub-task \"{title}\" — the target column may no longer exist.", true, actions);

            actions.Add(new AiAssistantActionDto("task_created", created.Id, created.Key, created.Title));
            createdSummaries.Add($"{created.Key} \"{created.Title}\" ({segment.Start:yyyy-MM-dd} to {segment.End:yyyy-MM-dd})");
        }

        var windowNote = parent.ReleaseId is not null ? "its linked Release's dates" : "a default 2-week window starting today (no Release dates to schedule against)";
        return ($"Created {actions.Count} sub-task(s) under {parent.Key}, spread evenly across {windowNote}: {string.Join("; ", createdSummaries)}.", false, actions);
    }

    private async Task<(string, bool, List<AiAssistantActionDto>)> UpdateTaskToolAsync(Guid projectId, JsonObject input)
    {
        var identifier = input["taskIdentifier"]?.GetValue<string>();
        if (string.IsNullOrWhiteSpace(identifier)) return ("A task identifier (title or key) is required.", true, NoActions);

        var task = await FindTaskAsync(projectId, identifier);
        if (task is null) return ($"No task found matching \"{identifier}\".", true, NoActions);

        Guid columnId = task.ColumnId;
        if (input["columnName"]?.GetValue<string>() is { } columnName)
        {
            var (column, columnError) = await ResolveColumnAsync(projectId, columnName);
            if (columnError is not null) return (columnError, true, NoActions);
            columnId = column!.Id;
        }

        var (assigneeProvided, assigneeId, assigneeError) = await ResolveAssigneeAsync(projectId, input, "assigneeName");
        if (assigneeError is not null) return (assigneeError, true, NoActions);

        var (typeProvided, typeId, typeError) = await ResolveTaskTypeAsync(projectId, input, "typeName");
        if (typeError is not null) return (typeError, true, NoActions);

        // Note: unlike create_task, updating an existing task's parent never auto-copies the new
        // parent's dates onto it — the task already has its own dates, and silently overwriting them
        // just because a parent link changed would be a surprising side effect for an edit that's
        // ostensibly just about the relationship.
        var (parentProvided, parent, parentError) = await ResolveParentTaskAsync(projectId, input, "parentTaskKey", excludeTaskId: task.Id);
        if (parentError is not null) return (parentError, true, NoActions);

        var updated = await _tasks.UpdateAsync(projectId, task.Id, new UpdateTaskRequest(
            Title: input["title"]?.GetValue<string>() ?? task.Title,
            Description: input["description"]?.GetValue<string>() ?? task.Description,
            Priority: NormalizePriority(input["priority"]?.GetValue<string>()) ?? task.Priority,
            ColumnId: columnId,
            AssigneeId: assigneeProvided ? assigneeId : task.AssigneeId,
            ReleaseId: task.ReleaseId,
            TypeId: typeProvided ? typeId : task.TypeId,
            ParentTaskId: parentProvided ? parent?.Id : task.ParentTaskId,
            DependsOnTaskIds: task.Dependencies.Select(d => d.DependsOnTaskId).ToList(),
            DocumentationUrl: task.DocumentationUrl, StartDate: task.StartDate,
            EndDate: ParseDate(input["dueDate"]?.GetValue<string>()) ?? task.EndDate,
            BusinessValue: task.BusinessValue, TaskCost: task.TaskCost,
            Progress: input["progress"]?.GetValue<int?>() ?? task.Progress,
            EstimatedEffort: task.EstimatedEffort, ActualEffort: task.ActualEffort, Archived: task.Archived),
            changedByDisplayName: "AI Assistant");

        if (updated is null) return ("Could not update the task.", true, NoActions);

        return ($"Updated task {updated.Key}: \"{updated.Title}\".", false,
            new List<AiAssistantActionDto> { new("task_updated", updated.Id, updated.Key, updated.Title) });
    }

    private async Task<(string, bool, List<AiAssistantActionDto>)> GetTaskDetailsToolAsync(Guid projectId, JsonObject input)
    {
        var identifier = input["taskIdentifier"]?.GetValue<string>();
        if (string.IsNullOrWhiteSpace(identifier)) return ("A task identifier (title or key) is required.", true, NoActions);

        var task = await FindTaskAsync(projectId, identifier);
        if (task is null) return ($"No task found matching \"{identifier}\".", true, NoActions);

        var column = await _db.Columns.AsNoTracking().FirstOrDefaultAsync(c => c.Id == task.ColumnId);
        var assigneeName = task.AssigneeId.HasValue
            ? await _db.ProjectMembers.AsNoTracking().Include(m => m.User).Where(m => m.Id == task.AssigneeId).Select(m => m.User.DisplayName).FirstOrDefaultAsync()
            : null;
        var typeName = task.TypeId.HasValue
            ? await _db.TaskTypes.AsNoTracking().Where(t => t.Id == task.TypeId).Select(t => t.Name).FirstOrDefaultAsync()
            : null;

        var summary = $"{task.Key}: \"{task.Title}\" — priority {task.Priority}, column \"{column?.Name}\", " +
            $"assignee {assigneeName ?? "unassigned"}, type {typeName ?? "none"}, " +
            $"progress {task.Progress}%, due {(task.EndDate.HasValue ? task.EndDate.Value.ToString("yyyy-MM-dd") : "not set")}." +
            (string.IsNullOrWhiteSpace(task.Description) ? "" : $" Description: {task.Description}");

        return (summary, false, NoActions);
    }

    private async Task<(string, bool, List<AiAssistantActionDto>)> ListCriticalTasksToolAsync(Guid projectId, JsonObject input)
    {
        var limit = Math.Clamp(input["limit"]?.GetValue<int?>() ?? 5, 1, 20);

        var openTasks = await _db.Tasks
            .AsNoTracking()
            .Include(t => t.Column)
            .Where(t => t.ProjectId == projectId && !t.Column.Done && !t.Archived)
            .ToListAsync();

        var dependentCounts = await _db.TaskDependencies
            .Where(d => openTasks.Select(t => t.Id).Contains(d.DependsOnTaskId))
            .GroupBy(d => d.DependsOnTaskId)
            .Select(g => new { TaskId = g.Key, Count = g.Count() })
            .ToDictionaryAsync(x => x.TaskId, x => x.Count);

        var ranked = openTasks
            .OrderByDescending(t => Array.IndexOf(PriorityOrder, t.Priority))
            .ThenByDescending(t => dependentCounts.GetValueOrDefault(t.Id, 0))
            .ThenBy(t => t.EndDate ?? DateOnly.MaxValue)
            .Take(limit)
            .Select(t => $"{t.Key} \"{t.Title}\" — priority {t.Priority}, progress {t.Progress}%, " +
                $"due {(t.EndDate.HasValue ? t.EndDate.Value.ToString("yyyy-MM-dd") : "not set")}, " +
                $"blocks {dependentCounts.GetValueOrDefault(t.Id, 0)} other task(s)")
            .ToList();

        if (ranked.Count == 0) return ("There are no open tasks in this project.", false, NoActions);
        return (string.Join("\n", ranked), false, NoActions);
    }

    private async Task<(string, bool, List<AiAssistantActionDto>)> SearchTasksToolAsync(Guid projectId, JsonObject input)
    {
        var query = _db.Tasks.AsNoTracking().Include(t => t.Column).Where(t => t.ProjectId == projectId);

        var includeArchived = input["includeArchived"]?.GetValue<bool?>() ?? false;
        if (!includeArchived) query = query.Where(t => !t.Archived);

        var priority = NormalizePriority(input["priority"]?.GetValue<string>());
        if (priority is not null) query = query.Where(t => t.Priority == priority);

        if (input["columnName"]?.GetValue<string>() is { } columnName)
        {
            var (column, columnError) = await ResolveColumnAsync(projectId, columnName);
            if (columnError is not null) return (columnError, true, NoActions);
            query = query.Where(t => t.ColumnId == column!.Id);
        }

        if (input["typeName"]?.GetValue<string>() is { } typeNameFilter)
        {
            var types = await _db.TaskTypes.AsNoTracking().Where(t => t.ProjectId == projectId).ToListAsync();
            var typeMatch = types.FirstOrDefault(t => string.Equals(t.Name, typeNameFilter, StringComparison.OrdinalIgnoreCase));
            if (typeMatch is null)
            {
                var names = types.Count == 0 ? "(none defined for this project)" : string.Join(", ", types.Select(t => t.Name));
                return ($"No task type named \"{typeNameFilter}\". Available: {names}.", true, NoActions);
            }
            query = query.Where(t => t.TypeId == typeMatch.Id);
        }

        if (input.ContainsKey("assigneeName"))
        {
            var name = input["assigneeName"]?.GetValue<string>();
            if (string.IsNullOrWhiteSpace(name) || name.Equals("unassigned", StringComparison.OrdinalIgnoreCase) || name.Equals("none", StringComparison.OrdinalIgnoreCase))
            {
                query = query.Where(t => t.AssigneeId == null);
            }
            else
            {
                var members = await _db.ProjectMembers.AsNoTracking().Include(m => m.User).Where(m => m.ProjectId == projectId).ToListAsync();
                var match = members.FirstOrDefault(m => string.Equals(m.User.DisplayName, name, StringComparison.OrdinalIgnoreCase));
                if (match is null)
                {
                    var names = string.Join(", ", members.Select(m => m.User.DisplayName));
                    return ($"No project member named \"{name}\". Available: {names}.", true, NoActions);
                }
                query = query.Where(t => t.AssigneeId == match.Id);
            }
        }

        if (input["teamName"]?.GetValue<string>() is { } teamNameFilter)
        {
            var teams = await _db.TeamsCommittees.AsNoTracking().Include(tc => tc.Members).Where(tc => tc.ProjectId == projectId && tc.Type == "team").ToListAsync();
            var teamMatch = teams.FirstOrDefault(t => string.Equals(t.Name, teamNameFilter, StringComparison.OrdinalIgnoreCase));
            if (teamMatch is null)
            {
                var names = teams.Count == 0 ? "(no teams defined for this project)" : string.Join(", ", teams.Select(t => t.Name));
                return ($"No team named \"{teamNameFilter}\". Available: {names}.", true, NoActions);
            }
            var teamMemberIds = teamMatch.Members.Select(m => m.ProjectMemberId).ToList();
            query = query.Where(t => t.AssigneeId != null && teamMemberIds.Contains(t.AssigneeId.Value));
        }

        var limit = Math.Clamp(input["limit"]?.GetValue<int?>() ?? 10, 1, 25);
        var results = await query.OrderBy(t => t.EndDate ?? DateOnly.MaxValue).Take(limit).ToListAsync();

        if (results.Count == 0) return ("No tasks matched those filters.", false, NoActions);

        var lines = results.Select(t => $"{t.Key} \"{t.Title}\" — priority {t.Priority}, column \"{t.Column.Name}\", " +
            $"due {(t.EndDate.HasValue ? t.EndDate.Value.ToString("yyyy-MM-dd") : "not set")}");
        return (string.Join("\n", lines), false, NoActions);
    }

    private async Task<TaskItem?> FindTaskAsync(Guid projectId, string identifier)
    {
        var normalized = identifier.Trim();
        var byKey = await _db.Tasks.Include(t => t.Dependencies)
            .FirstOrDefaultAsync(t => t.ProjectId == projectId && t.Key.ToLower() == normalized.ToLower());
        if (byKey is not null) return byKey;

        return await _db.Tasks.Include(t => t.Dependencies)
            .Where(t => t.ProjectId == projectId && EF.Functions.ILike(t.Title, $"%{normalized}%"))
            .FirstOrDefaultAsync();
    }

    private async Task<(Column? Column, string? Error)> ResolveColumnAsync(Guid projectId, string? columnName)
    {
        var columns = await _db.Columns.AsNoTracking().Where(c => c.ProjectId == projectId).OrderBy(c => c.Order).ToListAsync();
        if (columns.Count == 0) return (null, "This project has no columns.");

        if (string.IsNullOrWhiteSpace(columnName))
        {
            return (columns.FirstOrDefault(c => !c.Done) ?? columns[0], null);
        }

        var match = columns.FirstOrDefault(c => string.Equals(c.Name, columnName, StringComparison.OrdinalIgnoreCase));
        if (match is null)
        {
            return (null, $"No column named \"{columnName}\". Available columns: {string.Join(", ", columns.Select(c => c.Name))}.");
        }
        return (match, null);
    }

    /// <summary>Tri-state: Provided=false means the caller's tool input didn't include this key at all
    /// (keep whatever the task already has); Provided=true + Id=null means an explicit clear ("none"/
    /// "unassigned"/empty string); Provided=true + Id set means a resolved match. Error is non-null
    /// only when a name was given but didn't match any project member.</summary>
    private async Task<(bool Provided, Guid? Id, string? Error)> ResolveAssigneeAsync(Guid projectId, JsonObject input, string key)
    {
        if (!input.ContainsKey(key)) return (false, null, null);
        var name = input[key]?.GetValue<string>();
        if (string.IsNullOrWhiteSpace(name) || name.Equals("none", StringComparison.OrdinalIgnoreCase) || name.Equals("unassigned", StringComparison.OrdinalIgnoreCase))
        {
            return (true, null, null);
        }

        var members = await _db.ProjectMembers.AsNoTracking().Include(m => m.User).Where(m => m.ProjectId == projectId).ToListAsync();
        var match = members.FirstOrDefault(m => string.Equals(m.User.DisplayName, name, StringComparison.OrdinalIgnoreCase));
        if (match is null)
        {
            var names = string.Join(", ", members.Select(m => m.User.DisplayName));
            return (true, null, $"No project member named \"{name}\". Available: {names}.");
        }
        return (true, match.Id, null);
    }

    /// <summary>Same tri-state shape as <see cref="ResolveAssigneeAsync"/>, for TaskType.</summary>
    private async Task<(bool Provided, Guid? Id, string? Error)> ResolveTaskTypeAsync(Guid projectId, JsonObject input, string key)
    {
        if (!input.ContainsKey(key)) return (false, null, null);
        var name = input[key]?.GetValue<string>();
        if (string.IsNullOrWhiteSpace(name) || name.Equals("none", StringComparison.OrdinalIgnoreCase))
        {
            return (true, null, null);
        }

        var types = await _db.TaskTypes.AsNoTracking().Where(t => t.ProjectId == projectId).ToListAsync();
        var match = types.FirstOrDefault(t => string.Equals(t.Name, name, StringComparison.OrdinalIgnoreCase));
        if (match is null)
        {
            var names = types.Count == 0 ? "(none defined for this project)" : string.Join(", ", types.Select(t => t.Name));
            return (true, null, $"No task type named \"{name}\". Available: {names}.");
        }
        return (true, match.Id, null);
    }

    /// <summary>Same tri-state shape as <see cref="ResolveAssigneeAsync"/>, resolving a parent task by
    /// key or title (same lookup <see cref="FindTaskAsync"/> uses) rather than to just an id, since
    /// callers need the parent's own dates too (create_task's date-inheritance). "none" explicitly
    /// clears an existing parent link. <paramref name="excludeTaskId"/> (update_task only) rejects a
    /// task naming itself as its own parent with a clear message, rather than letting it fall through
    /// to TaskService's own cycle-detection generic failure.</summary>
    private async Task<(bool Provided, TaskItem? Parent, string? Error)> ResolveParentTaskAsync(Guid projectId, JsonObject input, string key, Guid? excludeTaskId = null)
    {
        if (!input.ContainsKey(key)) return (false, null, null);
        var identifier = input[key]?.GetValue<string>();
        if (string.IsNullOrWhiteSpace(identifier) || identifier.Equals("none", StringComparison.OrdinalIgnoreCase))
        {
            return (true, null, null);
        }

        var parent = await FindTaskAsync(projectId, identifier);
        if (parent is null) return (true, null, $"No task found matching \"{identifier}\" to use as the parent.");
        if (excludeTaskId is { } selfId && parent.Id == selfId) return (true, null, "A task cannot be its own parent.");
        return (true, parent, null);
    }

    /// <summary>The date range new sub-tasks should be scheduled across when no explicit dates of
    /// their own are given: the parent's linked Release's own dates, if it has one with both dates
    /// set; otherwise a fixed <see cref="DefaultSubtaskWindowDays"/>-day window starting today.</summary>
    private async Task<(DateOnly Start, DateOnly End)> ResolveSubtaskWindowAsync(TaskItem parent)
    {
        if (parent.ReleaseId is { } releaseId)
        {
            var release = await _db.Releases.AsNoTracking().FirstOrDefaultAsync(r => r.Id == releaseId);
            if (release is { StartDate: { } releaseStart, EndDate: { } releaseEnd } && releaseEnd >= releaseStart)
            {
                return (releaseStart, releaseEnd);
            }
        }

        var today = DateOnly.FromDateTime(DateTime.UtcNow);
        return (today, today.AddDays(DefaultSubtaskWindowDays));
    }

    /// <summary>Splits [<paramref name="windowStart"/>, <paramref name="windowEnd"/>] into
    /// <paramref name="count"/> contiguous, non-overlapping segments covering the whole window (the
    /// last segment is snapped exactly to windowEnd to absorb any rounding remainder) — used to spread
    /// several sub-tasks evenly across their parent's Release (or the default window) so that,
    /// together, "all the sub-tasks fit within the dates of the release". A single-day (or inverted)
    /// window, or count == 1, degenerates safely to every segment equalling the whole window.</summary>
    private static List<(DateOnly Start, DateOnly End)> SplitWindowEvenly(DateOnly windowStart, DateOnly windowEnd, int count)
    {
        var segments = new List<(DateOnly, DateOnly)>(count);
        var totalDays = Math.Max(0, windowEnd.DayNumber - windowStart.DayNumber);
        for (var i = 0; i < count; i++)
        {
            var segStart = windowStart.AddDays(totalDays * i / count);
            var segEnd = i == count - 1 ? windowEnd : windowStart.AddDays(totalDays * (i + 1) / count);
            if (segEnd < segStart) segEnd = segStart;
            segments.Add((segStart, segEnd));
        }
        return segments;
    }

    private static string? NormalizePriority(string? priority) =>
        priority is not null && PriorityOrder.Contains(priority.ToLowerInvariant()) ? priority.ToLowerInvariant() : (priority is null ? null : "medium");

    private static DateOnly? ParseDate(string? date) =>
        date is not null && DateOnly.TryParse(date, out var parsed) ? parsed : null;

    private static string BuildSystemPrompt(string projectName, List<Column> columns, List<ProjectMember> members, List<TaskType> taskTypes, List<TeamCommittee> teams, string? alertsSummary)
    {
        var columnList = string.Join(", ", columns.Select(c => $"\"{c.Name}\"{(c.Done ? " (done)" : "")}"));
        var memberList = members.Count == 0 ? "(none)" : string.Join(", ", members.Select(m => $"\"{m.User.DisplayName}\""));
        var typeList = taskTypes.Count == 0 ? "(none defined)" : string.Join(", ", taskTypes.Select(t => $"\"{t.Name}\""));
        var teamList = teams.Count == 0 ? "(none defined)" : string.Join(", ", teams.Select(t => $"\"{t.Name}\""));
        var sb = new StringBuilder();
        sb.AppendLine($"You are the AI assistant embedded in the Enkl project management app, working within the project \"{projectName}\".");
        sb.AppendLine($"Its board columns, in order, are: {columnList}.");
        sb.AppendLine($"Its project members (valid assignee names) are: {memberList}.");
        sb.AppendLine($"Its task types (valid type names) are: {typeList}.");
        sb.AppendLine($"Its teams (valid team names) are: {teamList}.");
        sb.AppendLine("Use the provided tools to create tasks, edit tasks, look up task details, search/filter tasks by priority, " +
            "assignee, team, type, or column, and list the most critical open tasks. " +
            "You can link a task as a sub-task of another via parentTaskKey on create_task/update_task. When asked to break an " +
            "existing task's description down into MULTIPLE sub-tasks, look up the parent with get_task_details first, then use " +
            "create_subtasks (not several separate create_task calls) so all of them get scheduled evenly across the parent's " +
            "linked Release's dates (or a 2-week window from today if it has none) — each sub-task also inherits the parent's " +
            "assignee, release, business value, and task cost automatically. Use create_task's own parentTaskKey directly only " +
            "when linking or creating just a single sub-task. " +
            "When a request is ambiguous (e.g. which task, which column, which member), ask a brief clarifying question rather than guessing destructively.");
        sb.AppendLine("Keep replies short and conversational — this is a chat-style assistant, not a report generator.");
        if (!string.IsNullOrWhiteSpace(alertsSummary))
        {
            sb.AppendLine("Current alerts for this project (computed client-side, already up to date): " + alertsSummary);
        }
        if (!string.IsNullOrEmpty(UserGuideMarkdown.Value))
        {
            sb.AppendLine();
            sb.AppendLine("The following is this app's own User Guide - use it to answer 'how do I...'/'what is...' " +
                "questions about the app's features accurately, in addition to your own tool-based abilities above. " +
                "Don't quote it verbatim at length; summarize in your own conversational voice.");
            sb.AppendLine(UserGuideMarkdown.Value);
        }
        return sb.ToString();
    }

    private static JsonArray BuildToolDefinitions() => new()
    {
        new JsonObject
        {
            ["name"] = "create_task",
            ["description"] = "Create a new task on the board. Call this whenever the user asks to create/add a task.",
            ["input_schema"] = new JsonObject
            {
                ["type"] = "object",
                ["properties"] = new JsonObject
                {
                    ["title"] = new JsonObject { ["type"] = "string", ["description"] = "The task title." },
                    ["description"] = new JsonObject { ["type"] = "string" },
                    ["priority"] = new JsonObject { ["type"] = "string", ["enum"] = new JsonArray { "trivial", "low", "medium", "high", "critical" } },
                    ["columnName"] = new JsonObject { ["type"] = "string", ["description"] = "Which board column to place it in. Omit to use the first non-done column." },
                    ["assigneeName"] = new JsonObject { ["type"] = "string", ["description"] = "Display name of the project member to assign this task to. Must match one of the project's members." },
                    ["typeName"] = new JsonObject { ["type"] = "string", ["description"] = "Name of the task type. Must match one of the project's defined task types." },
                    ["startDate"] = new JsonObject { ["type"] = "string", ["description"] = "ISO date (YYYY-MM-DD), optional." },
                    ["dueDate"] = new JsonObject { ["type"] = "string", ["description"] = "ISO date (YYYY-MM-DD), optional." },
                    ["parentTaskKey"] = new JsonObject { ["type"] = "string", ["description"] = "Key or title of an existing task to make this a sub-task of. The new sub-task inherits the parent's assignee, release, business value, and task cost where the parent has them set, and (unless startDate/dueDate are also given here) is scheduled across the parent's linked Release's dates, or a 2-week window from today if there's no Release. For creating SEVERAL sub-tasks under the same parent at once, prefer create_subtasks instead, which spreads them evenly across that same window." }
                },
                ["required"] = new JsonArray { "title" }
            }
        },
        new JsonObject
        {
            ["name"] = "create_subtasks",
            ["description"] = "Create several sub-tasks under one existing parent task in a single call — the preferred tool whenever asked to draft/break down a task's description into multiple sub-tasks, since it schedules all of them evenly across the parent's Release window (or a 2-week default) instead of each independently guessing at dates. Each sub-task inherits the parent's assignee, release, business value, and task cost where the parent has them set.",
            ["input_schema"] = new JsonObject
            {
                ["type"] = "object",
                ["properties"] = new JsonObject
                {
                    ["parentTaskKey"] = new JsonObject { ["type"] = "string", ["description"] = "Key or title of the existing task these are sub-tasks of." },
                    ["subtasks"] = new JsonObject
                    {
                        ["type"] = "array",
                        ["description"] = "One entry per sub-task to create, in the order they should be scheduled across the window.",
                        ["items"] = new JsonObject
                        {
                            ["type"] = "object",
                            ["properties"] = new JsonObject
                            {
                                ["title"] = new JsonObject { ["type"] = "string" },
                                ["description"] = new JsonObject { ["type"] = "string" },
                                ["priority"] = new JsonObject { ["type"] = "string", ["enum"] = new JsonArray { "trivial", "low", "medium", "high", "critical" } },
                                ["columnName"] = new JsonObject { ["type"] = "string" },
                                ["assigneeName"] = new JsonObject { ["type"] = "string", ["description"] = "Overrides the inherited assignee for just this sub-task." },
                                ["typeName"] = new JsonObject { ["type"] = "string" },
                                ["startDate"] = new JsonObject { ["type"] = "string", ["description"] = "ISO date (YYYY-MM-DD). Overrides the auto-computed segment for just this sub-task." },
                                ["dueDate"] = new JsonObject { ["type"] = "string", ["description"] = "ISO date (YYYY-MM-DD). Overrides the auto-computed segment for just this sub-task." }
                            },
                            ["required"] = new JsonArray { "title" }
                        }
                    }
                },
                ["required"] = new JsonArray { "parentTaskKey", "subtasks" }
            }
        },
        new JsonObject
        {
            ["name"] = "update_task",
            ["description"] = "Edit an existing task — change its title, description, priority, column, due date, or progress. Only the fields you provide are changed.",
            ["input_schema"] = new JsonObject
            {
                ["type"] = "object",
                ["properties"] = new JsonObject
                {
                    ["taskIdentifier"] = new JsonObject { ["type"] = "string", ["description"] = "The task's key (e.g. PROJ-12) or title/part of its title." },
                    ["title"] = new JsonObject { ["type"] = "string" },
                    ["description"] = new JsonObject { ["type"] = "string" },
                    ["priority"] = new JsonObject { ["type"] = "string", ["enum"] = new JsonArray { "trivial", "low", "medium", "high", "critical" } },
                    ["columnName"] = new JsonObject { ["type"] = "string" },
                    ["assigneeName"] = new JsonObject { ["type"] = "string", ["description"] = "Display name of the project member to assign. Pass \"none\"/\"unassigned\" to clear the assignee." },
                    ["typeName"] = new JsonObject { ["type"] = "string", ["description"] = "Name of the task type. Pass \"none\" to clear it." },
                    ["dueDate"] = new JsonObject { ["type"] = "string", ["description"] = "ISO date (YYYY-MM-DD)." },
                    ["progress"] = new JsonObject { ["type"] = "integer", ["description"] = "0-100." },
                    ["parentTaskKey"] = new JsonObject { ["type"] = "string", ["description"] = "Key or title of an existing task to make this a sub-task of. Pass \"none\" to unlink it from its current parent. Does not change this task's own dates." }
                },
                ["required"] = new JsonArray { "taskIdentifier" }
            }
        },
        new JsonObject
        {
            ["name"] = "get_task_details",
            ["description"] = "Look up a single task's current details by key or title.",
            ["input_schema"] = new JsonObject
            {
                ["type"] = "object",
                ["properties"] = new JsonObject
                {
                    ["taskIdentifier"] = new JsonObject { ["type"] = "string" }
                },
                ["required"] = new JsonArray { "taskIdentifier" }
            }
        },
        new JsonObject
        {
            ["name"] = "list_critical_tasks",
            ["description"] = "List the most critical open tasks in this project, ranked by priority, how many other tasks depend on them, and due date. Use this to answer questions like 'what should I work on next' or 'what's most critical'.",
            ["input_schema"] = new JsonObject
            {
                ["type"] = "object",
                ["properties"] = new JsonObject
                {
                    ["limit"] = new JsonObject { ["type"] = "integer", ["description"] = "How many tasks to return, default 5." }
                }
            }
        },
        new JsonObject
        {
            ["name"] = "search_tasks",
            ["description"] = "Search/filter this project's tasks by any combination of priority, assignee, team, task type, and/or column. Use this to answer questions like 'what are Bob's high priority tasks' or 'show me tasks assigned to the Design team'. All filters are optional - omit a filter to not narrow by it.",
            ["input_schema"] = new JsonObject
            {
                ["type"] = "object",
                ["properties"] = new JsonObject
                {
                    ["priority"] = new JsonObject { ["type"] = "string", ["enum"] = new JsonArray { "trivial", "low", "medium", "high", "critical" } },
                    ["assigneeName"] = new JsonObject { ["type"] = "string", ["description"] = "Display name of a project member. Pass \"unassigned\" for tasks with no assignee." },
                    ["teamName"] = new JsonObject { ["type"] = "string", ["description"] = "Name of a Team (from Teams & Committees) - matches tasks whose assignee belongs to that team." },
                    ["typeName"] = new JsonObject { ["type"] = "string", ["description"] = "Name of a task type." },
                    ["columnName"] = new JsonObject { ["type"] = "string" },
                    ["includeArchived"] = new JsonObject { ["type"] = "boolean", ["description"] = "Default false." },
                    ["limit"] = new JsonObject { ["type"] = "integer", ["description"] = "How many tasks to return, default 10, max 25." }
                }
            }
        }
    };
}

/// <summary>Thrown by AiAssistantService.ChatAsync when the calling org's Vendor Portal entitlement
/// for "ai_assistant" is off - caught in AiAssistantController and mapped to 403, distinct from the
/// null/404 "project not found" case (root CLAUDE.md §4's no-enumeration-oracle rule still applies
/// between those two, but a caller who is genuinely a project member of a real, entitlement-revoked
/// project needs an actionable 403, not a misleading 404).</summary>
public class AiAssistantNotEntitledException : Exception { }
