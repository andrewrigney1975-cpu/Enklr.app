<?php

declare(strict_types=1);

namespace Enkl\Api\Services;

use Enkl\Api\Config\Config;
use Enkl\Api\Support\Log;
use PDO;
use PDOException;

/**
 * Ported from Services/AiAssistantService.cs — see that file's own doc comment for the tool-loop
 * shape and security model. Same "no SDK, raw HTTP against the documented Messages API" choice as the
 * .NET tier, via cURL (matching this tier's existing zero-HTTP-client-dependency style — no Guzzle in
 * composer.json).
 */
final class AiAssistantService
{
    private const PRIORITY_ORDER = ['trivial', 'low', 'medium', 'high', 'critical'];
    private const MAX_TOOL_LOOP_ITERATIONS = 6;

    // Default schedule window for sub-tasks with no Release to inherit dates from — see
    // resolveSubtaskWindow().
    private const DEFAULT_SUBTASK_WINDOW_DAYS = 14;

    // Cached per-process (this tier has no DI container to hang a singleton off, so a static is the
    // equivalent here - php-api/CLAUDE.md's own established style for this tier). Unlike the .NET
    // tier, this one is bare-metal-deployed (no Docker build step in prod, DEPLOYMENT-PHP.md), so the
    // repo root - and USER-GUIDE.md sitting in it - is always reachable relative to this file's own
    // path; no build-context plumbing needed here. Null (not thrown) if the file is ever missing, so
    // a stale/incomplete deploy never breaks the assistant itself, just omits that extra context.
    private static ?string $userGuideMarkdown = null;

    private static function userGuideMarkdown(): string
    {
        if (self::$userGuideMarkdown === null) {
            $path = dirname(__DIR__, 3) . '/USER-GUIDE.md';
            self::$userGuideMarkdown = is_file($path) ? (file_get_contents($path) ?: '') : '';
        }
        return self::$userGuideMarkdown;
    }

    public function __construct(private readonly PDO $db)
    {
    }

    /**
     * Reads Vendor Portal's own `vendor_feature_entitlements` table — a table this tier does not own
     * or migrate (Vendor Portal creates/writes it, same split as vendor_licenses/vendor_contracts).
     * Fails OPEN (treats the org as entitled) if the table doesn't exist at all - Vendor Portal only
     * ever runs against the Hosted/SaaS deployment model (SYSTEMS-INTEGRATOR-GUIDE.md §2); a Local or
     * Self-hosted deployment never has Vendor Portal running against its database, so this table
     * simply won't exist there, and that must never take AI Assistant away from those deployments.
     */
    public function isOrgEntitled(string $orgId, string $featureKey): bool
    {
        try {
            $stmt = $this->db->prepare('SELECT "enabled" FROM vendor_feature_entitlements WHERE org_id = :orgId AND feature_key = :featureKey');
            $stmt->execute(['orgId' => $orgId, 'featureKey' => $featureKey]);
            $row = $stmt->fetch();
            // No row for this (org, feature) = not entitled - see the migration's row-presence
            // semantics (root CLAUDE.md §9's entitlement section).
            return $row !== false && (bool) $row['enabled'];
        } catch (PDOException $e) {
            if ($e->getCode() === '42P01') {
                return true;
            }
            throw $e;
        }
    }

    /** Project-scoped convenience wrapper for the availability endpoint - null means the project
     * itself wasn't found (404), not an entitlement answer either way. */
    public function isProjectOrgEntitled(string $projectId, string $featureKey): ?bool
    {
        $stmt = $this->db->prepare('SELECT "OrganisationId" FROM "Projects" WHERE "Id" = :id');
        $stmt->execute(['id' => $projectId]);
        $orgId = $stmt->fetchColumn();
        if ($orgId === false) {
            return null;
        }
        return $this->isOrgEntitled($orgId, $featureKey);
    }

    /** @return array{reply: string, actions: array<int, array<string, mixed>>}|null */
    public function chat(string $projectId, array $request, string $callerUserId, bool $callerIsOrgAdmin): ?array
    {
        $stmt = $this->db->prepare('SELECT * FROM "Projects" WHERE "Id" = :id');
        $stmt->execute(['id' => $projectId]);
        $project = $stmt->fetch();
        if ($project === false) {
            return null;
        }

        if (!$this->isOrgEntitled($project['OrganisationId'], 'ai_assistant')) {
            throw new AiAssistantNotEntitledException();
        }

        $apiKey = Config::get('ANTHROPIC_API_KEY', '');
        if ($apiKey === null || $apiKey === '') {
            throw new \RuntimeException('ANTHROPIC_API_KEY is not configured — the AI assistant is unavailable until an API key is set.');
        }

        $columns = $this->fetchColumns($projectId);
        $members = $this->fetchMembers($projectId);
        $taskTypes = $this->fetchTaskTypes($projectId);
        $teams = $this->fetchTeams($projectId);

        // Only fetched for an Org Admin (the only caller create_project's tool actually lets through) —
        // an ordinary member's prompt stays exactly as small as it was before this feature existed.
        $orgTemplateNames = [];
        $orgProjectKeys = [];
        if ($callerIsOrgAdmin) {
            $tplStmt = $this->db->prepare('SELECT "Name" FROM "ProjectTemplates" WHERE "OrganisationId" = :orgId');
            $tplStmt->execute(['orgId' => $project['OrganisationId']]);
            $orgTemplateNames = array_column($tplStmt->fetchAll(), 'Name');

            $keyStmt = $this->db->prepare('SELECT "Key" FROM "Projects" WHERE "OrganisationId" = :orgId');
            $keyStmt->execute(['orgId' => $project['OrganisationId']]);
            $orgProjectKeys = array_column($keyStmt->fetchAll(), 'Key');
        }

        $systemPrompt = $this->buildSystemPrompt($project['Name'], $columns, $members, $taskTypes, $teams, $request['alertsSummary'] ?? null, $callerIsOrgAdmin, $orgTemplateNames, $orgProjectKeys);

        $messages = [];
        foreach (($request['messages'] ?? []) as $m) {
            $messages[] = ['role' => $m['role'], 'content' => $m['content']];
        }

        $actions = [];

        for ($iteration = 0; $iteration < self::MAX_TOOL_LOOP_ITERATIONS; $iteration++) {
            $body = [
                'model' => 'claude-sonnet-5',
                'max_tokens' => 2000,
                'system' => $systemPrompt,
                'messages' => $messages,
                'tools' => $this->toolDefinitions(),
                'output_config' => ['effort' => 'low'],
            ];

            $response = $this->callAnthropic($apiKey, $body);
            $stopReason = $response['stop_reason'] ?? null;
            $contentBlocks = $response['content'] ?? [];

            $toolUseBlocks = array_values(array_filter($contentBlocks, static fn(array $b) => ($b['type'] ?? null) === 'tool_use'));
            $replyText = implode('', array_map(
                static fn(array $b) => $b['text'] ?? '',
                array_filter($contentBlocks, static fn(array $b) => ($b['type'] ?? null) === 'text')
            ));

            if ($stopReason !== 'tool_use' || $toolUseBlocks === []) {
                return ['reply' => $replyText, 'actions' => $actions];
            }

            // Echo the assistant's turn (including tool_use blocks) back, then append one user turn
            // carrying every tool_result — parallel tool calls must return in a single message.
            $messages[] = ['role' => 'assistant', 'content' => $contentBlocks];

            $toolResults = [];
            foreach ($toolUseBlocks as $toolUse) {
                $toolName = $toolUse['name'];
                $toolUseId = $toolUse['id'];
                $input = $toolUse['input'] ?? [];

                [$resultText, $isError, $toolActions] = $this->executeTool($projectId, $project['OrganisationId'], $callerUserId, $callerIsOrgAdmin, $toolName, $input);
                foreach ($toolActions as $a) {
                    $actions[] = $a;
                }

                $toolResult = ['type' => 'tool_result', 'tool_use_id' => $toolUseId, 'content' => $resultText];
                if ($isError) {
                    $toolResult['is_error'] = true;
                }
                $toolResults[] = $toolResult;
            }

            $messages[] = ['role' => 'user', 'content' => $toolResults];
        }

        return ['reply' => "I wasn't able to finish that within the allotted number of steps — could you try a narrower request?", 'actions' => $actions];
    }

    /** @return array{0: string, 1: bool, 2: array<int, array<string, mixed>>} */
    private function executeTool(string $projectId, string $orgId, string $callerUserId, bool $callerIsOrgAdmin, string $toolName, array $input): array
    {
        try {
            return match ($toolName) {
                'create_task' => $this->createTaskTool($projectId, $input),
                'create_subtasks' => $this->createSubtasksTool($projectId, $input),
                'update_task' => $this->updateTaskTool($projectId, $input),
                'get_task_details' => $this->getTaskDetailsTool($projectId, $input),
                'list_critical_tasks' => $this->listCriticalTasksTool($projectId, $input),
                'search_tasks' => $this->searchTasksTool($projectId, $input),
                'create_project' => $this->createProjectTool($orgId, $callerUserId, $callerIsOrgAdmin, $input),
                'list_available_forms' => $this->listAvailableFormsTool($projectId, $orgId, $callerUserId, $callerIsOrgAdmin),
                'get_form_fields' => $this->getFormFieldsTool($orgId, $input),
                'submit_form' => $this->submitFormTool($projectId, $orgId, $callerUserId, $callerIsOrgAdmin, $input),
                default => ["Unknown tool: {$toolName}", true, []],
            };
        } catch (\Throwable $e) {
            Log::channel()->warning('AI assistant tool failed', ['tool' => $toolName, 'projectId' => $projectId, 'error' => $e->getMessage()]);
            return ['That action failed: ' . $e->getMessage(), true, []];
        }
    }

    private function createTaskTool(string $projectId, array $input): array
    {
        $title = trim((string) ($input['title'] ?? ''));
        if ($title === '') {
            return ['A task title is required.', true, []];
        }

        [$column, $columnError] = $this->resolveColumn($projectId, $input['columnName'] ?? null);
        if ($columnError !== null) {
            return [$columnError, true, []];
        }

        [$assigneeProvided, $assigneeId, $assigneeError] = $this->resolveAssignee($projectId, $input, 'assigneeName');
        if ($assigneeError !== null) {
            return [$assigneeError, true, []];
        }

        [, $typeId, $typeError] = $this->resolveTaskType($projectId, $input, 'typeName');
        if ($typeError !== null) {
            return [$typeError, true, []];
        }

        [$parentProvided, $parent, $parentError] = $this->resolveParentTask($projectId, $input, 'parentTaskKey');
        if ($parentError !== null) {
            return [$parentError, true, []];
        }

        $priority = $this->normalizePriority($input['priority'] ?? null) ?? 'medium';
        $explicitStartDate = $this->parseDate($input['startDate'] ?? null);
        $explicitDueDate = $this->parseDate($input['dueDate'] ?? null);

        $startDate = $explicitStartDate;
        $dueDate = $explicitDueDate;
        if ($parentProvided && $parent !== null && ($explicitStartDate === null || $explicitDueDate === null)) {
            // A sub-task created against a parent, with no explicit dates of its own, is scheduled to
            // span the parent's linked Release (or a 2-week-from-today default) — see
            // resolveSubtaskWindow()'s own doc comment. A single sub-task created this way (as opposed
            // to create_subtasks' batch of several) gets the WHOLE window, since there are no siblings
            // to divide it with.
            [$windowStart, $windowEnd] = $this->resolveSubtaskWindow($parent);
            $startDate ??= $windowStart;
            $dueDate ??= $windowEnd;
        }

        $created = (new TaskService($this->db))->create($projectId, [
            'title' => $title,
            'description' => $input['description'] ?? null,
            'priority' => $priority,
            'columnId' => $column['Id'],
            // A sub-task inherits its parent's assignee/release/business value/cost "where available"
            // (i.e. only when the parent actually has one set) unless explicitly overridden here.
            'assigneeId' => $assigneeProvided ? $assigneeId : ($parentProvided && $parent !== null ? $parent['AssigneeId'] : null),
            'releaseId' => $parentProvided && $parent !== null ? $parent['ReleaseId'] : null,
            'typeId' => $typeId,
            'parentTaskId' => $parentProvided && $parent !== null ? $parent['Id'] : null,
            'startDate' => $startDate,
            'endDate' => $dueDate,
            'businessValue' => $parentProvided && $parent !== null ? $parent['BusinessValue'] : null,
            'taskCost' => $parentProvided && $parent !== null ? $parent['TaskCost'] : null,
        ]);

        if ($created === null) {
            return ['Could not create the task — the target column may no longer exist.', true, []];
        }

        $parentNote = $parentProvided && $parent !== null ? " as a sub-task of {$parent['Key']}" : '';
        return [
            "Created task {$created['key']}: \"{$created['title']}\" in column \"{$column['Name']}\"{$parentNote}.",
            false,
            [['type' => 'task_created', 'taskId' => $created['id'], 'taskKey' => $created['key'], 'title' => $created['title']]],
        ];
    }

    /** Batch sibling-aware counterpart to create_task's own single-item parentTaskKey path — the one
     * place "spread these N sub-tasks evenly across the parent's Release window" can actually be
     * computed, since create_task's own per-call resolution has no visibility into how many sibling
     * sub-tasks are being created alongside it. Each item can still override title (required),
     * description, priority, assigneeName, typeName, startDate, dueDate — an explicit date on a given
     * item always wins over its computed segment. */
    private function createSubtasksTool(string $projectId, array $input): array
    {
        $parentIdentifier = trim((string) ($input['parentTaskKey'] ?? ''));
        if ($parentIdentifier === '') {
            return ['A parentTaskKey is required.', true, []];
        }

        $parent = $this->findTask($projectId, $parentIdentifier);
        if ($parent === null) {
            return ["No task found matching \"{$parentIdentifier}\" to use as the parent.", true, []];
        }

        $items = $input['subtasks'] ?? null;
        if (!is_array($items) || $items === []) {
            return ['At least one sub-task is required in "subtasks".', true, []];
        }
        $items = array_values($items);

        [$windowStart, $windowEnd] = $this->resolveSubtaskWindow($parent);
        $segments = $this->splitWindowEvenly($windowStart, $windowEnd, count($items));

        $actions = [];
        $createdSummaries = [];
        foreach ($items as $i => $item) {
            if (!is_array($item)) {
                return ["Sub-task #" . ($i + 1) . " is not a valid object.", true, $actions];
            }
            $title = trim((string) ($item['title'] ?? ''));
            if ($title === '') {
                return ["Sub-task #" . ($i + 1) . " is missing a title.", true, $actions];
            }

            [$column, $columnError] = $this->resolveColumn($projectId, $item['columnName'] ?? null);
            if ($columnError !== null) {
                return [$columnError, true, $actions];
            }

            [$assigneeProvided, $assigneeIdOverride, $assigneeError] = $this->resolveAssignee($projectId, $item, 'assigneeName');
            if ($assigneeError !== null) {
                return [$assigneeError, true, $actions];
            }

            [$typeProvided, $typeId, $typeError] = $this->resolveTaskType($projectId, $item, 'typeName');
            if ($typeError !== null) {
                return [$typeError, true, $actions];
            }

            $priority = $this->normalizePriority($item['priority'] ?? null) ?? 'medium';
            $explicitStart = $this->parseDate($item['startDate'] ?? null);
            $explicitDue = $this->parseDate($item['dueDate'] ?? null);
            $segment = $segments[$i];

            $created = (new TaskService($this->db))->create($projectId, [
                'title' => $title,
                'description' => $item['description'] ?? null,
                'priority' => $priority,
                'columnId' => $column['Id'],
                'assigneeId' => $assigneeProvided ? $assigneeIdOverride : $parent['AssigneeId'],
                'releaseId' => $parent['ReleaseId'],
                'typeId' => $typeProvided ? $typeId : null,
                'parentTaskId' => $parent['Id'],
                'startDate' => $explicitStart ?? $segment[0],
                'endDate' => $explicitDue ?? $segment[1],
                'businessValue' => $parent['BusinessValue'],
                'taskCost' => $parent['TaskCost'],
            ]);

            if ($created === null) {
                return ["Could not create sub-task \"{$title}\" — the target column may no longer exist.", true, $actions];
            }

            $actions[] = ['type' => 'task_created', 'taskId' => $created['id'], 'taskKey' => $created['key'], 'title' => $created['title']];
            $createdSummaries[] = "{$created['key']} \"{$created['title']}\" ({$segment[0]} to {$segment[1]})";
        }

        $windowNote = $parent['ReleaseId'] !== null
            ? "its linked Release's dates"
            : 'a default 2-week window starting today (no Release dates to schedule against)';
        $count = count($actions);
        return [
            "Created {$count} sub-task(s) under {$parent['Key']}, spread evenly across {$windowNote}: " . implode('; ', $createdSummaries) . '.',
            false,
            $actions,
        ];
    }

    private function updateTaskTool(string $projectId, array $input): array
    {
        $identifier = trim((string) ($input['taskIdentifier'] ?? ''));
        if ($identifier === '') {
            return ['A task identifier (title or key) is required.', true, []];
        }

        $task = $this->findTask($projectId, $identifier);
        if ($task === null) {
            return ["No task found matching \"{$identifier}\".", true, []];
        }

        $columnId = $task['ColumnId'];
        if (isset($input['columnName'])) {
            [$column, $columnError] = $this->resolveColumn($projectId, $input['columnName']);
            if ($columnError !== null) {
                return [$columnError, true, []];
            }
            $columnId = $column['Id'];
        }

        [$assigneeProvided, $assigneeId, $assigneeError] = $this->resolveAssignee($projectId, $input, 'assigneeName');
        if ($assigneeError !== null) {
            return [$assigneeError, true, []];
        }

        [$typeProvided, $typeId, $typeError] = $this->resolveTaskType($projectId, $input, 'typeName');
        if ($typeError !== null) {
            return [$typeError, true, []];
        }

        // Note: unlike create_task, updating an existing task's parent never auto-copies the new
        // parent's dates onto it — the task already has its own dates, and silently overwriting them
        // just because a parent link changed would be a surprising side effect for an edit that's
        // ostensibly just about the relationship.
        [$parentProvided, $parent, $parentError] = $this->resolveParentTask($projectId, $input, 'parentTaskKey', $task['Id']);
        if ($parentError !== null) {
            return [$parentError, true, []];
        }

        $depStmt = $this->db->prepare('SELECT "DependsOnTaskId" FROM "TaskDependencies" WHERE "TaskId" = :id');
        $depStmt->execute(['id' => $task['Id']]);
        $dependsOnTaskIds = $depStmt->fetchAll(PDO::FETCH_COLUMN);

        $updated = (new TaskService($this->db))->update($projectId, $task['Id'], [
            'title' => $input['title'] ?? $task['Title'],
            'description' => $input['description'] ?? $task['Description'],
            'priority' => $this->normalizePriority($input['priority'] ?? null) ?? $task['Priority'],
            'columnId' => $columnId,
            'assigneeId' => $assigneeProvided ? $assigneeId : $task['AssigneeId'],
            'releaseId' => $task['ReleaseId'],
            'typeId' => $typeProvided ? $typeId : $task['TypeId'],
            'parentTaskId' => $parentProvided ? ($parent['Id'] ?? null) : $task['ParentTaskId'],
            'dependsOnTaskIds' => $dependsOnTaskIds,
            'documentationUrl' => $task['DocumentationUrl'],
            'startDate' => $task['StartDate'],
            'endDate' => $this->parseDate($input['dueDate'] ?? null) ?? $task['EndDate'],
            'businessValue' => $task['BusinessValue'],
            'taskCost' => $task['TaskCost'],
            'progress' => $input['progress'] ?? $task['Progress'],
            'estimatedEffort' => $task['EstimatedEffort'],
            'actualEffort' => $task['ActualEffort'],
            'archived' => $task['Archived'],
        ], 'AI Assistant');

        if ($updated === null) {
            return ['Could not update the task.', true, []];
        }

        return [
            "Updated task {$updated['key']}: \"{$updated['title']}\".",
            false,
            [['type' => 'task_updated', 'taskId' => $updated['id'], 'taskKey' => $updated['key'], 'title' => $updated['title']]],
        ];
    }

    private function getTaskDetailsTool(string $projectId, array $input): array
    {
        $identifier = trim((string) ($input['taskIdentifier'] ?? ''));
        if ($identifier === '') {
            return ['A task identifier (title or key) is required.', true, []];
        }

        $task = $this->findTask($projectId, $identifier);
        if ($task === null) {
            return ["No task found matching \"{$identifier}\".", true, []];
        }

        $columnStmt = $this->db->prepare('SELECT "Name" FROM "Columns" WHERE "Id" = :id');
        $columnStmt->execute(['id' => $task['ColumnId']]);
        $columnName = $columnStmt->fetchColumn();

        $assigneeName = 'unassigned';
        if ($task['AssigneeId'] !== null) {
            $stmt = $this->db->prepare('SELECT u."DisplayName" FROM "ProjectMembers" m JOIN "Users" u ON u."Id" = m."UserId" WHERE m."Id" = :id');
            $stmt->execute(['id' => $task['AssigneeId']]);
            $assigneeName = $stmt->fetchColumn() ?: 'unassigned';
        }
        $typeName = 'none';
        if ($task['TypeId'] !== null) {
            $stmt = $this->db->prepare('SELECT "Name" FROM "TaskTypes" WHERE "Id" = :id');
            $stmt->execute(['id' => $task['TypeId']]);
            $typeName = $stmt->fetchColumn() ?: 'none';
        }

        $summary = "{$task['Key']}: \"{$task['Title']}\" — priority {$task['Priority']}, column \"{$columnName}\", " .
            "assignee {$assigneeName}, type {$typeName}, " .
            "progress {$task['Progress']}%, due " . ($task['EndDate'] ?? 'not set') . '.' .
            (($task['Description'] ?? '') !== '' ? " Description: {$task['Description']}" : '');

        return [$summary, false, []];
    }

    private function listCriticalTasksTool(string $projectId, array $input): array
    {
        $limit = max(1, min(20, (int) ($input['limit'] ?? 5)));

        $stmt = $this->db->prepare(<<<SQL
            SELECT t.*, c."Done" AS "ColumnDone" FROM "Tasks" t
            JOIN "Columns" c ON c."Id" = t."ColumnId"
            WHERE t."ProjectId" = :pid AND c."Done" = false AND t."Archived" = false
        SQL);
        $stmt->execute(['pid' => $projectId]);
        $openTasks = $stmt->fetchAll();

        if ($openTasks === []) {
            return ['There are no open tasks in this project.', false, []];
        }

        $ids = array_column($openTasks, 'Id');
        $placeholders = implode(',', array_fill(0, count($ids), '?'));
        $depStmt = $this->db->prepare(<<<SQL
            SELECT "DependsOnTaskId", COUNT(*) AS cnt FROM "TaskDependencies"
            WHERE "DependsOnTaskId" IN ({$placeholders})
            GROUP BY "DependsOnTaskId"
        SQL);
        $depStmt->execute($ids);
        $dependentCounts = array_column($depStmt->fetchAll(), 'cnt', 'DependsOnTaskId');

        usort($openTasks, function (array $a, array $b) use ($dependentCounts) {
            $pa = array_search($a['Priority'], self::PRIORITY_ORDER, true);
            $pb = array_search($b['Priority'], self::PRIORITY_ORDER, true);
            if ($pa !== $pb) {
                return $pb <=> $pa;
            }
            $da = (int) ($dependentCounts[$a['Id']] ?? 0);
            $db_ = (int) ($dependentCounts[$b['Id']] ?? 0);
            if ($da !== $db_) {
                return $db_ <=> $da;
            }
            return ($a['EndDate'] ?? '9999-12-31') <=> ($b['EndDate'] ?? '9999-12-31');
        });

        $ranked = array_slice($openTasks, 0, $limit);
        $lines = array_map(function (array $t) use ($dependentCounts) {
            $due = $t['EndDate'] ?? 'not set';
            $blocks = (int) ($dependentCounts[$t['Id']] ?? 0);
            return "{$t['Key']} \"{$t['Title']}\" — priority {$t['Priority']}, progress {$t['Progress']}%, due {$due}, blocks {$blocks} other task(s)";
        }, $ranked);

        return [implode("\n", $lines), false, []];
    }

    private function searchTasksTool(string $projectId, array $input): array
    {
        $where = ['t."ProjectId" = :pid'];
        $params = ['pid' => $projectId];

        if (empty($input['includeArchived'])) {
            $where[] = 't."Archived" = false';
        }

        if (!empty($input['priority']) && in_array($input['priority'], self::PRIORITY_ORDER, true)) {
            $where[] = 't."Priority" = :priority';
            $params['priority'] = $input['priority'];
        }

        if (!empty($input['columnName'])) {
            [$column, $columnError] = $this->resolveColumn($projectId, $input['columnName']);
            if ($columnError !== null) {
                return [$columnError, true, []];
            }
            $where[] = 't."ColumnId" = :columnId';
            $params['columnId'] = $column['Id'];
        }

        if (!empty($input['typeName'])) {
            $types = $this->fetchTaskTypes($projectId);
            $typeMatch = null;
            foreach ($types as $t) {
                if (strcasecmp($t['Name'], $input['typeName']) === 0) {
                    $typeMatch = $t;
                    break;
                }
            }
            if ($typeMatch === null) {
                $names = $types === [] ? '(none defined for this project)' : implode(', ', array_column($types, 'Name'));
                return ["No task type named \"{$input['typeName']}\". Available: {$names}.", true, []];
            }
            $where[] = 't."TypeId" = :typeId';
            $params['typeId'] = $typeMatch['Id'];
        }

        if (array_key_exists('assigneeName', $input)) {
            $name = $input['assigneeName'];
            if ($name === null || trim((string) $name) === '' || strcasecmp((string) $name, 'unassigned') === 0 || strcasecmp((string) $name, 'none') === 0) {
                $where[] = 't."AssigneeId" IS NULL';
            } else {
                $members = $this->fetchMembers($projectId);
                $match = null;
                foreach ($members as $m) {
                    if (strcasecmp($m['DisplayName'], $name) === 0) {
                        $match = $m;
                        break;
                    }
                }
                if ($match === null) {
                    $names = implode(', ', array_column($members, 'DisplayName'));
                    return ["No project member named \"{$name}\". Available: {$names}.", true, []];
                }
                $where[] = 't."AssigneeId" = :assigneeId';
                $params['assigneeId'] = $match['Id'];
            }
        }

        if (!empty($input['teamName'])) {
            $teams = $this->fetchTeams($projectId);
            $teamMatch = null;
            foreach ($teams as $t) {
                if (strcasecmp($t['Name'], $input['teamName']) === 0) {
                    $teamMatch = $t;
                    break;
                }
            }
            if ($teamMatch === null) {
                $names = $teams === [] ? '(no teams defined for this project)' : implode(', ', array_column($teams, 'Name'));
                return ["No team named \"{$input['teamName']}\". Available: {$names}.", true, []];
            }
            $memberStmt = $this->db->prepare('SELECT "ProjectMemberId" FROM "TeamCommitteeMember" WHERE "TeamCommitteeId" = :id');
            $memberStmt->execute(['id' => $teamMatch['Id']]);
            $teamMemberIds = array_column($memberStmt->fetchAll(), 'ProjectMemberId');
            if ($teamMemberIds === []) {
                return ["No tasks matched those filters.", false, []];
            }
            $placeholders = implode(',', array_map(static fn($i) => ':tm' . $i, array_keys($teamMemberIds)));
            $where[] = "t.\"AssigneeId\" IN ({$placeholders})";
            foreach ($teamMemberIds as $i => $id) {
                $params['tm' . $i] = $id;
            }
        }

        $limit = max(1, min(25, (int) ($input['limit'] ?? 10)));
        $whereSql = implode(' AND ', $where);
        $stmt = $this->db->prepare(<<<SQL
            SELECT t.*, c."Name" AS "ColumnName" FROM "Tasks" t
            JOIN "Columns" c ON c."Id" = t."ColumnId"
            WHERE {$whereSql}
            ORDER BY t."EndDate" ASC NULLS LAST
            LIMIT {$limit}
        SQL);
        $stmt->execute($params);
        $results = $stmt->fetchAll();

        if ($results === []) {
            return ['No tasks matched those filters.', false, []];
        }

        $lines = array_map(static function (array $t) {
            $due = $t['EndDate'] ?? 'not set';
            return "{$t['Key']} \"{$t['Title']}\" — priority {$t['Priority']}, column \"{$t['ColumnName']}\", due {$due}";
        }, $results);

        return [implode("\n", $lines), false, []];
    }

    /** Ported from AiAssistantService.cs's CreateProjectToolAsync — see that method's own doc comment
     * for the full design (Org-Admin-only, reuses ProjectService::create directly rather than
     * re-implementing column/task-type seeding, then adds a fixed setup checklist plus whatever
     * domain-specific starter tasks the model itself drafted into "tasks"). */
    private function createProjectTool(string $orgId, string $callerUserId, bool $callerIsOrgAdmin, array $input): array
    {
        if (!$callerIsOrgAdmin) {
            return ['Only an Org Admin can create a new project this way. Ask an Org Admin, or use the app\'s own "New Project" button.', true, []];
        }

        $name = trim((string) ($input['name'] ?? ''));
        if ($name === '') {
            return ['A project name is required.', true, []];
        }

        $templateId = null;
        if (!empty($input['templateName'])) {
            $tplStmt = $this->db->prepare('SELECT "Id", "Name" FROM "ProjectTemplates" WHERE "OrganisationId" = :orgId');
            $tplStmt->execute(['orgId' => $orgId]);
            $templates = $tplStmt->fetchAll();
            $match = null;
            foreach ($templates as $t) {
                if (strcasecmp($t['Name'], (string) $input['templateName']) === 0) {
                    $match = $t;
                    break;
                }
            }
            if ($match === null) {
                $names = $templates === [] ? '(no templates defined for this organisation)' : implode(', ', array_column($templates, 'Name'));
                return ["No project template named \"{$input['templateName']}\". Available: {$names}.", true, []];
            }
            $templateId = $match['Id'];
        }

        $startDate = $this->parseDate($input['startDate'] ?? null);
        $endDate = $this->parseDate($input['endDate'] ?? null);

        $created = (new ProjectService($this->db))->create($callerUserId, [
            'name' => $name,
            'key' => $input['key'] ?? null,
            'startDate' => $startDate,
            'endDate' => $endDate,
            'templateId' => $templateId,
            'description' => $input['description'] ?? null,
        ]);

        if ($created === null) {
            return ['Could not create the project — please try again.', true, []];
        }

        $project = $created['project'];
        $actions = [[
            'type' => 'project_created', 'taskId' => null, 'taskKey' => null, 'title' => $project['name'],
            'projectId' => $project['id'], 'projectKey' => $project['key'],
            'projectToken' => $created['token'], 'projectTokenExpiresAt' => $created['tokenExpiresAt'],
        ]];

        // A malformed/empty template's columns would be the only way this project ends up with none —
        // ProjectService::create's own default (no-template) branch always seeds three, so this is a
        // pure defensive guard, not an expected path.
        $columns = $project['columns'];
        usort($columns, static fn(array $a, array $b) => $a['order'] <=> $b['order']);
        $firstOpenColumn = null;
        foreach ($columns as $c) {
            if (!$c['done']) {
                $firstOpenColumn = $c;
                break;
            }
        }
        $firstOpenColumn ??= $columns[0] ?? null;

        $setupSummaries = [];
        $domainSummaries = [];
        if ($firstOpenColumn !== null) {
            $columnId = $firstOpenColumn['id'];
            $taskService = new TaskService($this->db);

            if ($input['includeSetupTasks'] ?? true) {
                foreach ($this->buildSetupTaskTitles($startDate, $endDate) as $title) {
                    $setupTask = $taskService->create($project['id'], [
                        'title' => $title, 'description' => null, 'priority' => 'medium', 'columnId' => $columnId,
                    ]);
                    if ($setupTask === null) {
                        continue;
                    }
                    $actions[] = ['type' => 'task_created', 'taskId' => $setupTask['id'], 'taskKey' => $setupTask['key'], 'title' => $setupTask['title']];
                    $setupSummaries[] = $setupTask['key'];
                }
            }

            if (!empty($input['tasks']) && is_array($input['tasks'])) {
                foreach ($input['tasks'] as $item) {
                    if (!is_array($item)) {
                        continue;
                    }
                    $taskTitle = trim((string) ($item['title'] ?? ''));
                    if ($taskTitle === '') {
                        continue;
                    }
                    $domainTask = $taskService->create($project['id'], [
                        'title' => $taskTitle, 'description' => $item['description'] ?? null,
                        'priority' => $this->normalizePriority($item['priority'] ?? null) ?? 'medium',
                        'columnId' => $columnId,
                    ]);
                    if ($domainTask === null) {
                        continue;
                    }
                    $actions[] = ['type' => 'task_created', 'taskId' => $domainTask['id'], 'taskKey' => $domainTask['key'], 'title' => $domainTask['title']];
                    $domainSummaries[] = $domainTask['key'];
                }
            }
        }

        $warningNote = $created['warning'] !== null ? " ({$created['warning']})" : '';
        $setupNote = $setupSummaries !== [] ? ' Added ' . count($setupSummaries) . ' setup task(s): ' . implode(', ', $setupSummaries) . '.' : '';
        $domainNote = $domainSummaries !== [] ? ' Added ' . count($domainSummaries) . ' project task(s): ' . implode(', ', $domainSummaries) . '.' : '';
        return ["Created project {$project['key']}: \"{$project['name']}\"{$warningNote}.{$setupNote}{$domainNote}", false, $actions];
    }

    /** Fixed checklist added to every AI-created project (unless includeSetupTasks: false). The dates
     * item is only added when the caller didn't already supply both dates to create_project itself. */
    private function buildSetupTaskTitles(?string $startDate, ?string $endDate): array
    {
        $titles = [
            "Verify the board columns match your team's actual workflow",
            'Review App Settings for extended modules (Documents, Risks, Decisions, Health, Principles, Objectives, Teams & Committees, Workflow, Time Tracking, Change Auditing, Sub-Tasks, Retrospective, Strategy, Dashboards) and enable any that apply',
            'Confirm the project\'s team members are current — add or remove them via the Team modal',
        ];
        if ($startDate === null || $endDate === null) {
            $titles[] = "Set the project's start and end dates";
        }
        return $titles;
    }

    /** The set of Forms is org-wide and changes over time — deliberately NOT baked into the system
     * prompt (see buildSystemPrompt's own note), queried fresh on every call instead. Delegates
     * entirely to FormSubmissionService::getAuthorableForms, which already re-derives the caller's
     * own Author-gate satisfaction server-side — the model is never even offered a form it can't
     * actually submit. */
    private function listAvailableFormsTool(string $projectId, string $orgId, string $callerUserId, bool $callerIsOrgAdmin): array
    {
        $forms = (new FormSubmissionService($this->db))->getAuthorableForms($orgId, $projectId, $callerUserId, $callerIsOrgAdmin);
        if (count($forms) === 0) {
            return ['There are no Forms currently available for you to submit.', false, []];
        }

        $lines = array_map(static function (array $f) {
            $desc = ($f['description'] ?? '') !== '' ? ": {$f['description']}" : '';
            return "formId=\"{$f['formId']}\" — \"{$f['name']}\"{$desc}";
        }, $forms);
        return ["Available forms:\n" . implode("\n", $lines), false, []];
    }

    /** Re-resolves formId to its currently-published version EVERY call (never trusts an earlier
     * list_available_forms result — a different version may have been published since), then
     * describes every field's id/type/required-ness/options AND the exact value shape submit_form
     * expects for that field, so the model can construct a correct "answers" object rather than
     * guessing. Field ids (not labels) are what submit_form's own answers keys must be. */
    private function getFormFieldsTool(string $orgId, array $input): array
    {
        $formId = (string) ($input['formId'] ?? '');
        if ($formId === '') {
            return ['A valid formId is required — call list_available_forms first to get one.', true, []];
        }

        $form = (new FormSubmissionService($this->db))->getPublishedForm($orgId, $formId);
        if ($form === null) {
            return ['That form is no longer available (it may have been unpublished or archived) — call list_available_forms again.', true, []];
        }

        [$ok, $error, $fields] = FormAnswerValidator::describeFields($form['FieldsJson']);
        if (!$ok) {
            return [$error, true, []];
        }
        if (count($fields) === 0) {
            return ["\"{$form['Name']}\" (v{$form['VersionNumber']}) has no fields defined — you can submit it with submit_form using an empty answers object.", false, []];
        }

        $lines = array_map(function (array $f) {
            $req = !empty($f['required']) ? ', required' : ', optional';
            $shape = $this->fieldValueShapeDescription($f);
            $options = $f['options'] ?? null;
            $optionsNote = is_array($options) && count($options) > 0
                ? ' Options: ' . implode(', ', array_map(static fn(array $o) => "id=\"{$o['id']}\" (\"{$o['label']}\")", $options))
                : '';
            $help = !empty($f['helpText']) ? " ({$f['helpText']})" : '';
            return "- id=\"{$f['id']}\" \"{$f['label']}\"{$help} — type {$f['type']}{$req}. {$shape}{$optionsNote}";
        }, $fields);

        return ["\"{$form['Name']}\" (v{$form['VersionNumber']}) fields — use these exact ids as the keys of submit_form's \"answers\" object:\n" . implode("\n", $lines), false, []];
    }

    /** Plain-English instruction for exactly what JSON shape submit_form's "answers" value must be
     * for this field — mirrors features/form-answers.js's own documented AnswersJson storage shape so
     * the model constructs something FormAnswerValidator will actually accept first try. */
    private function fieldValueShapeDescription(array $f): string
    {
        $type = $f['type'] ?? '';
        $multiple = !empty($f['multiple']);
        $mutex = !empty($f['mutex']);
        $groupMode = $f['groupMode'] ?? null;

        if ($type === 'text' || $type === 'textarea') {
            return 'Answer with a plain string.';
        }
        if ($type === 'numeric') {
            return 'Answer with a number.';
        }
        if ($type === 'datetime') {
            return 'Answer with an ISO date string, e.g. "2026-08-04".';
        }
        if (($type === 'select' || $type === 'priority') && $multiple) {
            return 'Answer with an array of one or more option ids.';
        }
        if ($type === 'select' || $type === 'priority') {
            return 'Answer with exactly one option id (a plain string).';
        }
        if ($type === 'checkboxGroup' && $mutex) {
            return 'Answer with an array containing at most one option id.';
        }
        if ($type === 'checkboxGroup') {
            return 'Answer with an array of the selected option ids.';
        }
        if ($type === 'radio' && $groupMode === 'single') {
            return 'This is a yes/no field — answer true or false.';
        }
        if ($type === 'radio' && $groupMode === 'multiGroup') {
            return 'Answer with an array of the selected option ids.';
        }
        if ($type === 'radio') {
            return 'Answer with exactly one option id (a plain string).';
        }
        return 'Answer with the value as given.';
    }

    /** Validates the model-constructed "answers" object against the form's CURRENT published version
     * (re-resolved here too, in case it changed since a get_form_fields call earlier in the same
     * conversation), then reuses FormSubmissionService::create (Draft + answers) followed immediately
     * by submit() — deliberately NOT reimplementing the Author-gate check here even though
     * list_available_forms already pre-filtered for it: submit()'s own independent re-derivation is
     * the actual security boundary, same defense-in-depth every other cross-role check in this
     * codebase gets. If the workflow raised a Task on the way through, surfaces it as an ordinary
     * task_created action (same type/shape create_task's own action already uses) so the frontend's
     * existing board-refresh hook picks it up with no new frontend code needed. */
    private function submitFormTool(string $projectId, string $orgId, string $callerUserId, bool $callerIsOrgAdmin, array $input): array
    {
        $formId = (string) ($input['formId'] ?? '');
        if ($formId === '') {
            return ['A valid formId is required — call list_available_forms first to get one.', true, []];
        }

        $forms = new FormSubmissionService($this->db);
        $form = $forms->getPublishedForm($orgId, $formId);
        if ($form === null) {
            return ['That form is no longer available (it may have been unpublished or archived) — call list_available_forms again.', true, []];
        }

        $answers = is_array($input['answers'] ?? null) ? $input['answers'] : [];
        [$validated, $validationError, $answersJson] = FormAnswerValidator::validate($form['FieldsJson'], $answers);
        if (!$validated) {
            return ["Could not submit \"{$form['Name']}\": {$validationError}", true, []];
        }

        $draft = $forms->create($projectId, $callerUserId, ['formVersionId' => $form['Id'], 'answersJson' => $answersJson]);
        if ($draft === null) {
            return ['Could not start this submission — the form may no longer be published.', true, []];
        }

        $result = $forms->submit($projectId, $callerUserId, $callerIsOrgAdmin, $draft['id']);
        if (!$result['ok']) {
            $message = $result['error'] === 'not_found' ? 'Could not find the submission that was just created.' : $result['error'];
            return ["Could not submit \"{$form['Name']}\": {$message}", true, []];
        }

        $dto = $result['dto'];
        $actions = [];
        $taskNote = '';
        if (!empty($dto['raisedTaskId'])) {
            $taskStmt = $this->db->prepare('SELECT "Id", "Key", "Title" FROM "Tasks" WHERE "Id" = :id');
            $taskStmt->execute(['id' => $dto['raisedTaskId']]);
            $raisedTask = $taskStmt->fetch();
            if ($raisedTask !== false) {
                $actions[] = ['type' => 'task_created', 'taskId' => $raisedTask['Id'], 'taskKey' => $raisedTask['Key'], 'title' => $raisedTask['Title']];
                $taskNote = " This raised task {$raisedTask['Key']}: \"{$raisedTask['Title']}\".";
            }
        }

        return ["Submitted \"{$form['Name']}\" — status is now \"{$dto['status']}\".{$taskNote}", false, $actions];
    }

    private function findTask(string $projectId, string $identifier): ?array
    {
        $stmt = $this->db->prepare('SELECT * FROM "Tasks" WHERE "ProjectId" = :pid AND LOWER("Key") = LOWER(:key)');
        $stmt->execute(['pid' => $projectId, 'key' => $identifier]);
        $byKey = $stmt->fetch();
        if ($byKey !== false) {
            return $byKey;
        }

        $stmt = $this->db->prepare('SELECT * FROM "Tasks" WHERE "ProjectId" = :pid AND "Title" ILIKE :title LIMIT 1');
        $stmt->execute(['pid' => $projectId, 'title' => '%' . $identifier . '%']);
        $byTitle = $stmt->fetch();
        return $byTitle === false ? null : $byTitle;
    }

    /** @return array{0: ?array, 1: ?string} */
    private function resolveColumn(string $projectId, ?string $columnName): array
    {
        $columns = $this->fetchColumns($projectId);
        if ($columns === []) {
            return [null, 'This project has no columns.'];
        }

        if ($columnName === null || trim($columnName) === '') {
            foreach ($columns as $c) {
                if (!$c['Done']) {
                    return [$c, null];
                }
            }
            return [$columns[0], null];
        }

        foreach ($columns as $c) {
            if (strcasecmp($c['Name'], $columnName) === 0) {
                return [$c, null];
            }
        }
        $names = implode(', ', array_column($columns, 'Name'));
        return [null, "No column named \"{$columnName}\". Available columns: {$names}."];
    }

    private function fetchColumns(string $projectId): array
    {
        $stmt = $this->db->prepare('SELECT * FROM "Columns" WHERE "ProjectId" = :pid ORDER BY "Order" ASC');
        $stmt->execute(['pid' => $projectId]);
        return $stmt->fetchAll();
    }

    private function fetchMembers(string $projectId): array
    {
        $stmt = $this->db->prepare('SELECT m."Id", u."DisplayName" FROM "ProjectMembers" m JOIN "Users" u ON u."Id" = m."UserId" WHERE m."ProjectId" = :pid');
        $stmt->execute(['pid' => $projectId]);
        return $stmt->fetchAll();
    }

    private function fetchTaskTypes(string $projectId): array
    {
        $stmt = $this->db->prepare('SELECT "Id", "Name" FROM "TaskTypes" WHERE "ProjectId" = :pid');
        $stmt->execute(['pid' => $projectId]);
        return $stmt->fetchAll();
    }

    private function fetchTeams(string $projectId): array
    {
        $stmt = $this->db->prepare('SELECT "Id", "Name" FROM "TeamsCommittees" WHERE "ProjectId" = :pid AND "Type" = \'team\'');
        $stmt->execute(['pid' => $projectId]);
        return $stmt->fetchAll();
    }

    /** Tri-state, mirroring AiAssistantService.cs's ResolveAssigneeAsync: [provided, id, error].
     * Provided=false means the key was absent from the tool input (keep the existing value);
     * provided=true + id=null means an explicit clear ("none"/"unassigned"/empty); error is non-null
     * only when a name was given but didn't match any project member. */
    private function resolveAssignee(string $projectId, array $input, string $key): array
    {
        if (!array_key_exists($key, $input)) {
            return [false, null, null];
        }
        $name = $input[$key];
        if ($name === null || trim((string) $name) === '' || in_array(strtolower((string) $name), ['none', 'unassigned'], true)) {
            return [true, null, null];
        }

        $members = $this->fetchMembers($projectId);
        foreach ($members as $m) {
            if (strcasecmp($m['DisplayName'], (string) $name) === 0) {
                return [true, $m['Id'], null];
            }
        }
        $names = implode(', ', array_column($members, 'DisplayName'));
        return [true, null, "No project member named \"{$name}\". Available: {$names}."];
    }

    /** Same tri-state shape as resolveAssignee(), for TaskType. */
    private function resolveTaskType(string $projectId, array $input, string $key): array
    {
        if (!array_key_exists($key, $input)) {
            return [false, null, null];
        }
        $name = $input[$key];
        if ($name === null || trim((string) $name) === '' || strtolower((string) $name) === 'none') {
            return [true, null, null];
        }

        $types = $this->fetchTaskTypes($projectId);
        foreach ($types as $t) {
            if (strcasecmp($t['Name'], (string) $name) === 0) {
                return [true, $t['Id'], null];
            }
        }
        $names = $types === [] ? '(none defined for this project)' : implode(', ', array_column($types, 'Name'));
        return [true, null, "No task type named \"{$name}\". Available: {$names}."];
    }

    /** Same tri-state shape as resolveAssignee(), resolving a parent task by key or title (same
     * lookup findTask() uses) rather than to just an id, since create_task's date-inheritance also
     * needs the parent's own dates. "none" explicitly clears an existing parent link. $excludeTaskId
     * (update_task only) rejects a task naming itself as its own parent with a clear message rather
     * than falling through to TaskService's own generic cycle-detection failure. */
    private function resolveParentTask(string $projectId, array $input, string $key, ?string $excludeTaskId = null): array
    {
        if (!array_key_exists($key, $input)) {
            return [false, null, null];
        }
        $identifier = $input[$key];
        if ($identifier === null || trim((string) $identifier) === '' || strtolower((string) $identifier) === 'none') {
            return [true, null, null];
        }

        $parent = $this->findTask($projectId, (string) $identifier);
        if ($parent === null) {
            return [true, null, "No task found matching \"{$identifier}\" to use as the parent."];
        }
        if ($excludeTaskId !== null && $parent['Id'] === $excludeTaskId) {
            return [true, null, 'A task cannot be its own parent.'];
        }
        return [true, $parent, null];
    }

    /** The date range new sub-tasks should be scheduled across when no explicit dates of their own
     * are given: the parent's linked Release's own dates, if it has one with both dates set;
     * otherwise a fixed self::DEFAULT_SUBTASK_WINDOW_DAYS-day window starting today.
     * @return array{0: string, 1: string} [startDate, endDate] as 'YYYY-MM-DD' strings */
    private function resolveSubtaskWindow(array $parent): array
    {
        if ($parent['ReleaseId'] !== null) {
            $stmt = $this->db->prepare('SELECT "StartDate", "EndDate" FROM "Releases" WHERE "Id" = :id');
            $stmt->execute(['id' => $parent['ReleaseId']]);
            $release = $stmt->fetch();
            if ($release !== false && $release['StartDate'] !== null && $release['EndDate'] !== null && $release['EndDate'] >= $release['StartDate']) {
                return [$release['StartDate'], $release['EndDate']];
            }
        }

        $today = new \DateTimeImmutable('today');
        return [$today->format('Y-m-d'), $today->modify('+' . self::DEFAULT_SUBTASK_WINDOW_DAYS . ' days')->format('Y-m-d')];
    }

    /** Splits [windowStart, windowEnd] into $count contiguous, non-overlapping segments covering the
     * whole window (the last segment is snapped exactly to windowEnd to absorb any rounding
     * remainder) — used to spread several sub-tasks evenly across their parent's Release (or the
     * default window) so that, together, "all the sub-tasks fit within the dates of the release". A
     * single-day (or inverted) window, or count === 1, degenerates safely to every segment equalling
     * the whole window.
     * @return array<int, array{0: string, 1: string}> */
    private function splitWindowEvenly(string $windowStart, string $windowEnd, int $count): array
    {
        $start = new \DateTimeImmutable($windowStart);
        $end = new \DateTimeImmutable($windowEnd);
        $totalDays = max(0, (int) $start->diff($end)->days);

        $segments = [];
        for ($i = 0; $i < $count; $i++) {
            $segStart = $start->modify('+' . intdiv($totalDays * $i, $count) . ' days');
            $segEnd = $i === $count - 1 ? $end : $start->modify('+' . intdiv($totalDays * ($i + 1), $count) . ' days');
            if ($segEnd < $segStart) {
                $segEnd = $segStart;
            }
            $segments[] = [$segStart->format('Y-m-d'), $segEnd->format('Y-m-d')];
        }
        return $segments;
    }

    private function normalizePriority(?string $priority): ?string
    {
        if ($priority === null) {
            return null;
        }
        $lower = strtolower($priority);
        return in_array($lower, self::PRIORITY_ORDER, true) ? $lower : 'medium';
    }

    private function parseDate(?string $date): ?string
    {
        if ($date === null || $date === '') {
            return null;
        }
        $parsed = \DateTime::createFromFormat('Y-m-d', $date);
        return $parsed !== false ? $date : null;
    }

    private function buildSystemPrompt(string $projectName, array $columns, array $members, array $taskTypes, array $teams, ?string $alertsSummary, bool $callerIsOrgAdmin, array $orgTemplateNames, array $orgProjectKeys): string
    {
        $columnList = implode(', ', array_map(
            static fn(array $c) => '"' . $c['Name'] . '"' . ($c['Done'] ? ' (done)' : ''),
            $columns
        ));
        $memberList = $members === [] ? '(none)' : implode(', ', array_map(
            static fn(array $m) => '"' . $m['DisplayName'] . '"',
            $members
        ));
        $typeList = $taskTypes === [] ? '(none defined)' : implode(', ', array_map(
            static fn(array $t) => '"' . $t['Name'] . '"',
            $taskTypes
        ));
        $teamList = $teams === [] ? '(none defined)' : implode(', ', array_map(
            static fn(array $t) => '"' . $t['Name'] . '"',
            $teams
        ));

        $prompt = "You are the AI assistant embedded in the Enkl project management app, working within the project \"{$projectName}\".\n" .
            "Its board columns, in order, are: {$columnList}.\n" .
            "Its project members (valid assignee names) are: {$memberList}.\n" .
            "Its task types (valid type names) are: {$typeList}.\n" .
            "Its teams (valid team names) are: {$teamList}.\n" .
            "Use the provided tools to create tasks, edit tasks, look up task details, search/filter tasks by priority, " .
            "assignee, team, type, or column, and list the most critical open tasks. " .
            "You can link a task as a sub-task of another via parentTaskKey on create_task/update_task. When asked to break an " .
            "existing task's description down into MULTIPLE sub-tasks, look up the parent with get_task_details first, then use " .
            "create_subtasks (not several separate create_task calls) so all of them get scheduled evenly across the parent's " .
            "linked Release's dates (or a 2-week window from today if it has none) — each sub-task also inherits the parent's " .
            "assignee, release, business value, and task cost automatically. Use create_task's own parentTaskKey directly only " .
            "when linking or creating just a single sub-task. " .
            "When a request is ambiguous (e.g. which task, which column, which member), ask a brief clarifying question rather than guessing destructively.\n";

        if ($callerIsOrgAdmin) {
            $templateList = $orgTemplateNames === [] ? '(none defined in this organisation)' : implode(', ', array_map(static fn(string $t) => "\"{$t}\"", $orgTemplateNames));
            $keyList = $orgProjectKeys === [] ? '(none yet)' : implode(', ', $orgProjectKeys);
            $prompt .= "\nYou can also create a brand-new sibling project (via create_project), since you are an Org Admin. Before calling it:\n" .
                "- If the user hasn't described what the project is for, ask for a short description first. Use it to draft a small " .
                "set of domain-specific starter tasks (create_project's own \"tasks\" input) inspired by that description — this tool creates " .
                "exactly the tasks you give it, it does not invent them itself. A fixed setup-task checklist (verify columns, review App " .
                "Settings for extended modules, confirm team members are current) is added automatically regardless.\n" .
                "- If the user names a specific existing template, pass its exact name as templateName so its columns/task " .
                "types/settings are reused instead of the plain default columns. Templates in this org: {$templateList}. If they ask for a " .
                "template that doesn't match one of these, say so rather than guessing a close name.\n" .
                "- Only pass \"key\" if the user explicitly wants a specific project key; otherwise omit it and a short key is " .
                "derived from the project name automatically. Existing keys in this org (avoid suggesting a duplicate): {$keyList}.\n" .
                "- If the user hasn't mentioned a start or end date, ask for them before calling create_project rather than guessing.\n";
        }

        $prompt .= "\nThe organisation may also have Enterprise Forms the user can submit (e.g. an expense claim, an access " .
            "request). You do NOT know in advance which forms exist or what fields they have — never guess a form name or a " .
            "field's shape. When the user wants to submit/fill out a form: call list_available_forms to see what's actually " .
            "available to them right now, then get_form_fields for the specific one to get its real field ids/types/options " .
            "and the exact answer shape each field expects. Gather the answers conversationally (ask about missing required " .
            "fields one or a few at a time, don't demand everything in one message). Before calling submit_form, summarize " .
            "the answers back to the user in plain language and get an explicit go-ahead — submitting can immediately trigger " .
            "a real workflow action, so never submit speculatively or without that confirmation.\n";

        $prompt .= "Keep replies short and conversational — this is a chat-style assistant, not a report generator.\n";

        if ($alertsSummary !== null && trim($alertsSummary) !== '') {
            $prompt .= "Current alerts for this project (computed client-side, already up to date): {$alertsSummary}\n";
        }

        $guide = self::userGuideMarkdown();
        if ($guide !== '') {
            $prompt .= "\nThe following is this app's own User Guide - use it to answer 'how do I...'/'what is...' " .
                "questions about the app's features accurately, in addition to your own tool-based abilities above. " .
                "Don't quote it verbatim at length; summarize in your own conversational voice.\n" . $guide . "\n";
        }

        return $prompt;
    }

    private function toolDefinitions(): array
    {
        return [
            [
                'name' => 'create_task',
                'description' => 'Create a new task on the board. Call this whenever the user asks to create/add a task.',
                'input_schema' => [
                    'type' => 'object',
                    'properties' => [
                        'title' => ['type' => 'string', 'description' => 'The task title.'],
                        'description' => ['type' => 'string'],
                        'priority' => ['type' => 'string', 'enum' => self::PRIORITY_ORDER],
                        'columnName' => ['type' => 'string', 'description' => 'Which board column to place it in. Omit to use the first non-done column.'],
                        'assigneeName' => ['type' => 'string', 'description' => 'Display name of the project member to assign this task to. Must match one of the project\'s members.'],
                        'typeName' => ['type' => 'string', 'description' => 'Name of the task type. Must match one of the project\'s defined task types.'],
                        'startDate' => ['type' => 'string', 'description' => 'ISO date (YYYY-MM-DD), optional.'],
                        'dueDate' => ['type' => 'string', 'description' => 'ISO date (YYYY-MM-DD), optional.'],
                        'parentTaskKey' => ['type' => 'string', 'description' => 'Key or title of an existing task to make this a sub-task of. The new sub-task inherits the parent\'s assignee, release, business value, and task cost where the parent has them set, and (unless startDate/dueDate are also given here) is scheduled across the parent\'s linked Release\'s dates, or a 2-week window from today if there\'s no Release. For creating SEVERAL sub-tasks under the same parent at once, prefer create_subtasks instead, which spreads them evenly across that same window.'],
                    ],
                    'required' => ['title'],
                ],
            ],
            [
                'name' => 'create_subtasks',
                'description' => 'Create several sub-tasks under one existing parent task in a single call — the preferred tool whenever asked to draft/break down a task\'s description into multiple sub-tasks, since it schedules all of them evenly across the parent\'s Release window (or a 2-week default) instead of each independently guessing at dates. Each sub-task inherits the parent\'s assignee, release, business value, and task cost where the parent has them set.',
                'input_schema' => [
                    'type' => 'object',
                    'properties' => [
                        'parentTaskKey' => ['type' => 'string', 'description' => 'Key or title of the existing task these are sub-tasks of.'],
                        'subtasks' => [
                            'type' => 'array',
                            'description' => 'One entry per sub-task to create, in the order they should be scheduled across the window.',
                            'items' => [
                                'type' => 'object',
                                'properties' => [
                                    'title' => ['type' => 'string'],
                                    'description' => ['type' => 'string'],
                                    'priority' => ['type' => 'string', 'enum' => self::PRIORITY_ORDER],
                                    'columnName' => ['type' => 'string'],
                                    'assigneeName' => ['type' => 'string', 'description' => 'Overrides the inherited assignee for just this sub-task.'],
                                    'typeName' => ['type' => 'string'],
                                    'startDate' => ['type' => 'string', 'description' => 'ISO date (YYYY-MM-DD). Overrides the auto-computed segment for just this sub-task.'],
                                    'dueDate' => ['type' => 'string', 'description' => 'ISO date (YYYY-MM-DD). Overrides the auto-computed segment for just this sub-task.'],
                                ],
                                'required' => ['title'],
                            ],
                        ],
                    ],
                    'required' => ['parentTaskKey', 'subtasks'],
                ],
            ],
            [
                'name' => 'update_task',
                'description' => 'Edit an existing task — change its title, description, priority, column, due date, or progress. Only the fields you provide are changed.',
                'input_schema' => [
                    'type' => 'object',
                    'properties' => [
                        'taskIdentifier' => ['type' => 'string', 'description' => "The task's key (e.g. PROJ-12) or title/part of its title."],
                        'title' => ['type' => 'string'],
                        'description' => ['type' => 'string'],
                        'priority' => ['type' => 'string', 'enum' => self::PRIORITY_ORDER],
                        'columnName' => ['type' => 'string'],
                        'assigneeName' => ['type' => 'string', 'description' => 'Display name of the project member to assign. Pass "none"/"unassigned" to clear the assignee.'],
                        'typeName' => ['type' => 'string', 'description' => 'Name of the task type. Pass "none" to clear it.'],
                        'dueDate' => ['type' => 'string', 'description' => 'ISO date (YYYY-MM-DD).'],
                        'progress' => ['type' => 'integer', 'description' => '0-100.'],
                        'parentTaskKey' => ['type' => 'string', 'description' => 'Key or title of an existing task to make this a sub-task of. Pass "none" to unlink it from its current parent. Does not change this task\'s own dates.'],
                    ],
                    'required' => ['taskIdentifier'],
                ],
            ],
            [
                'name' => 'get_task_details',
                'description' => "Look up a single task's current details by key or title.",
                'input_schema' => [
                    'type' => 'object',
                    'properties' => ['taskIdentifier' => ['type' => 'string']],
                    'required' => ['taskIdentifier'],
                ],
            ],
            [
                'name' => 'list_critical_tasks',
                'description' => "List the most critical open tasks in this project, ranked by priority, how many other tasks depend on them, and due date. Use this to answer questions like 'what should I work on next' or 'what's most critical'.",
                'input_schema' => [
                    'type' => 'object',
                    'properties' => ['limit' => ['type' => 'integer', 'description' => 'How many tasks to return, default 5.']],
                ],
            ],
            [
                'name' => 'search_tasks',
                'description' => "Search/filter this project's tasks by any combination of priority, assignee, team, task type, and/or column. Use this to answer questions like 'what are Bob's high priority tasks' or 'show me tasks assigned to the Design team'. All filters are optional - omit a filter to not narrow by it.",
                'input_schema' => [
                    'type' => 'object',
                    'properties' => [
                        'priority' => ['type' => 'string', 'enum' => self::PRIORITY_ORDER],
                        'assigneeName' => ['type' => 'string', 'description' => 'Display name of a project member. Pass "unassigned" for tasks with no assignee.'],
                        'teamName' => ['type' => 'string', 'description' => 'Name of a Team (from Teams & Committees) - matches tasks whose assignee belongs to that team.'],
                        'typeName' => ['type' => 'string', 'description' => 'Name of a task type.'],
                        'columnName' => ['type' => 'string'],
                        'includeArchived' => ['type' => 'boolean', 'description' => 'Default false.'],
                        'limit' => ['type' => 'integer', 'description' => 'How many tasks to return, default 10, max 25.'],
                    ],
                ],
            ],
            [
                'name' => 'create_project',
                'description' => 'Create a brand-new sibling project (Org Admin only — the tool itself refuses otherwise). Seeds it with either a named template\'s columns/task types/settings, or the app\'s own default To Do/In Progress/Done columns, then adds a fixed project-setup checklist plus any domain-specific starter tasks you draft into "tasks".',
                'input_schema' => [
                    'type' => 'object',
                    'properties' => [
                        'name' => ['type' => 'string', 'description' => 'The new project\'s name.'],
                        'key' => ['type' => 'string', 'description' => 'Optional short project key. Omit to auto-derive one from the name.'],
                        'description' => ['type' => 'string', 'description' => 'A short description of what the project is for — also stored on the project itself.'],
                        'startDate' => ['type' => 'string', 'description' => 'ISO date (YYYY-MM-DD).'],
                        'endDate' => ['type' => 'string', 'description' => 'ISO date (YYYY-MM-DD).'],
                        'templateName' => ['type' => 'string', 'description' => 'Name of an existing project template to seed columns/task types/settings from. Must match one of this org\'s templates exactly. Omit for the default columns.'],
                        'includeSetupTasks' => ['type' => 'boolean', 'description' => 'Whether to add the fixed project-setup checklist (verify columns, review App Settings, confirm team members). Default true.'],
                        'tasks' => [
                            'type' => 'array',
                            'description' => 'Domain-specific starter tasks to create in the new project, drafted by you from the project\'s description. Omit or leave empty if none apply.',
                            'items' => [
                                'type' => 'object',
                                'properties' => [
                                    'title' => ['type' => 'string'],
                                    'description' => ['type' => 'string'],
                                    'priority' => ['type' => 'string', 'enum' => self::PRIORITY_ORDER],
                                ],
                                'required' => ['title'],
                            ],
                        ],
                    ],
                    'required' => ['name'],
                ],
            ],
            [
                'name' => 'list_available_forms',
                'description' => 'List the org\'s currently-published Forms you are personally allowed to submit right now. Call this FIRST whenever the user wants to submit/fill out a form and hasn\'t already named a specific one you already have the formId for — the set of forms changes over time, so always call this fresh rather than assuming a form from earlier in the conversation still exists or is still the one meant.',
                'input_schema' => ['type' => 'object', 'properties' => new \stdClass()],
            ],
            [
                'name' => 'get_form_fields',
                'description' => 'Get the exact field list (ids, types, required-ness, valid options) for one Form, by formId (from list_available_forms). ALWAYS call this before submit_form, even if you already saw this form\'s fields earlier in the conversation — the published version can change between turns, and this always returns the current one.',
                'input_schema' => [
                    'type' => 'object',
                    'properties' => ['formId' => ['type' => 'string', 'description' => 'The formId from list_available_forms.']],
                    'required' => ['formId'],
                ],
            ],
            [
                'name' => 'submit_form',
                'description' => 'Submit a Form with the gathered answers. Before calling this, always summarize the answers you\'re about to submit back to the user in plain language and get an explicit go-ahead — this can immediately trigger real workflow actions (e.g. raising a task, notifying an approver) and is not something to do speculatively. Each key in "answers" must be a real field id from get_form_fields, with a value in exactly the shape that field\'s own description specifies.',
                'input_schema' => [
                    'type' => 'object',
                    'properties' => [
                        'formId' => ['type' => 'string', 'description' => 'The formId from list_available_forms / get_form_fields.'],
                        'answers' => ['type' => 'object', 'description' => 'Map of field id -> answer value, per get_form_fields\' own per-field value-shape instructions.'],
                    ],
                    'required' => ['formId', 'answers'],
                ],
            ],
        ];
    }

    private function callAnthropic(string $apiKey, array $body): array
    {
        $ch = curl_init('https://api.anthropic.com/v1/messages');
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_POST => true,
            CURLOPT_POSTFIELDS => json_encode($body, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE),
            CURLOPT_HTTPHEADER => [
                'Content-Type: application/json',
                'x-api-key: ' . $apiKey,
                'anthropic-version: 2023-06-01',
            ],
            CURLOPT_TIMEOUT => 60,
        ]);
        $responseBody = curl_exec($ch);
        $statusCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
        $curlError = curl_error($ch);
        curl_close($ch);

        if ($responseBody === false || $curlError !== '') {
            Log::channel()->error('Anthropic API request failed', ['error' => $curlError]);
            throw new \RuntimeException('The AI assistant is temporarily unavailable. Please try again.');
        }

        $decoded = json_decode((string) $responseBody, true);
        if ($statusCode < 200 || $statusCode >= 300 || !is_array($decoded)) {
            Log::channel()->error('Anthropic API returned an error', ['statusCode' => $statusCode, 'body' => $responseBody]);
            throw new \RuntimeException('The AI assistant is temporarily unavailable. Please try again.');
        }

        return $decoded;
    }
}

/** Thrown by AiAssistantService::chat() when the calling org's Vendor Portal entitlement for
 * "ai_assistant" is off - caught in AiAssistantController and mapped to 403, distinct from the
 * null/404 "project not found" case. */
final class AiAssistantNotEntitledException extends \RuntimeException
{
}
