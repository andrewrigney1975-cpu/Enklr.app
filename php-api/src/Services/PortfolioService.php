<?php

declare(strict_types=1);

namespace Enkl\Api\Services;

use Enkl\Api\Support\Uuid;
use PDO;

/**
 * Ported from Services/PortfolioService.cs. Backs the Org-Admin-only Portfolio Dashboard — the
 * first feature in this API where an Org Admin can pull data from projects they aren't necessarily
 * a *member* of (every other endpoint is gated by ProjectMemberMiddleware). Every method here takes
 * the caller's organisation id and independently re-validates every requested project id against it
 * before touching any data — a project id that doesn't belong to the caller's own org is silently
 * dropped from the result, never surfaced as a distinguishable error, so a client can't use this to
 * probe whether some other org's project id exists. `$validProjectIds` (re-derived from the DB,
 * never the raw request) is the only thing every query below is scoped by.
 */
final class PortfolioService
{
    public function __construct(private readonly PDO $db)
    {
    }

    public function listProjects(string $organisationId): array
    {
        $stmt = $this->db->prepare('SELECT "Id", "Name", "Key", "StartDate", "EndDate", "Priority", "IsActive", "CategoryId" FROM "Projects" WHERE "OrganisationId" = :orgId ORDER BY "Name"');
        $stmt->execute(['orgId' => $organisationId]);
        return array_map(static fn(array $p): array => [
            'id' => $p['Id'], 'name' => $p['Name'], 'key' => $p['Key'],
            'startDate' => $p['StartDate'], 'endDate' => $p['EndDate'],
            'priority' => $p['Priority'], 'isActive' => (bool) $p['IsActive'], 'categoryId' => $p['CategoryId'],
        ], $stmt->fetchAll());
    }

    /**
     * Creates a Portfolio-Planner placeholder project. Deliberately does NOT add a ProjectMember row
     * and does NOT mint/return a fresh JWT, unlike ProjectService::create — an Org Admin sketching out
     * a portfolio of activities isn't necessarily a member of every one of them, mirroring why
     * updateProjectDates below already bypasses ProjectsController's ProjectMemberMiddleware-gated
     * PUT. IsActive is always false here; it can only ever become true via updateProjectActive, once
     * both dates are set.
     */
    public function createProject(string $organisationId, array $request): array
    {
        $name = trim((string) ($request['name'] ?? ''));
        if ($name === '') {
            $name = 'Untitled Project';
        }
        $requestedKey = $this->deriveProjectKey($request['key'] ?? null, $name);
        $uniqueKey = $this->resolveUniqueProjectKey($requestedKey, $organisationId);
        $priority = trim((string) ($request['priority'] ?? '')) !== '' ? $request['priority'] : 'medium';

        // A supplied categoryId must belong to the caller's own org, same re-validation stance as
        // every other id this class ever accepts from a client — a foreign-org id is silently dropped
        // to null rather than rejected with a distinguishable error.
        $categoryId = null;
        if (!empty($request['categoryId'])) {
            $catStmt = $this->db->prepare('SELECT 1 FROM "PortfolioCategories" WHERE "Id" = :id AND "OrganisationId" = :orgId');
            $catStmt->execute(['id' => $request['categoryId'], 'orgId' => $organisationId]);
            if ($catStmt->fetch() !== false) {
                $categoryId = $request['categoryId'];
            }
        }

        $projectId = Uuid::v4();
        $stmt = $this->db->prepare(<<<SQL
            INSERT INTO "Projects" ("Id", "OrganisationId", "Name", "Key", "Priority", "IsActive", "CategoryId", "StartDate", "EndDate", "DateCreated", "DateLastModified", "TaskCounter", "HeaderButtonVisibilityJson")
            VALUES (:id, :orgId, :name, :key, :priority, false, :categoryId, :start, :end, now(), now(), 1, '{}')
        SQL);
        $stmt->execute([
            'id' => $projectId, 'orgId' => $organisationId, 'name' => $name, 'key' => $uniqueKey,
            'priority' => $priority, 'categoryId' => $categoryId,
            'start' => $request['startDate'] ?? null, 'end' => $request['endDate'] ?? null,
        ]);

        return [
            'id' => $projectId, 'name' => $name, 'key' => $uniqueKey,
            'startDate' => $request['startDate'] ?? null, 'endDate' => $request['endDate'] ?? null,
            'priority' => $priority, 'isActive' => false, 'categoryId' => $categoryId,
        ];
    }

    private function deriveProjectKey(?string $requestedKey, string $name): string
    {
        $trimmed = strtoupper(trim((string) $requestedKey));
        if ($trimmed !== '') {
            return mb_substr($trimmed, 0, 20);
        }
        $fromName = strtoupper(preg_replace('/[^A-Za-z]/', '', $name) ?? '');
        $fromName = mb_substr($fromName, 0, 4);
        return $fromName !== '' ? $fromName : 'PROJ';
    }

    // Scoped to the target Organisation, not global — same rule as ProjectService::resolveUniqueProjectKey.
    private function resolveUniqueProjectKey(string $baseKey, string $organisationId): string
    {
        $candidate = $baseKey;
        $suffix = 1;
        while (true) {
            $stmt = $this->db->prepare('SELECT 1 FROM "Projects" WHERE "Key" = :key AND "OrganisationId" = :orgId');
            $stmt->execute(['key' => $candidate, 'orgId' => $organisationId]);
            if ($stmt->fetch() === false) {
                return $candidate;
            }
            $suffix++;
            $candidate = $baseKey . $suffix;
        }
    }

    public function getAggregate(string $organisationId, array $requestedProjectIds): array
    {
        $validProjectIds = $this->validateProjectIds($organisationId, $requestedProjectIds);
        $orgUserCount = $this->countOrgUsers($organisationId);

        if (count($validProjectIds) === 0) {
            return [
                'members' => [], 'columns' => [], 'tasks' => [], 'releases' => [], 'risks' => [], 'decisions' => [],
                'startDate' => null, 'endDate' => null,
                'orgUserCount' => $orgUserCount, 'principleCount' => 0, 'objectiveCount' => 0,
                'documentCount' => 0, 'retrospectiveCount' => 0,
            ];
        }

        $members = [];
        $columns = [];
        $tasks = [];
        $releases = [];
        $risks = [];
        $decisions = [];
        $starts = [];
        $ends = [];
        $principleCount = 0;
        $objectiveCount = 0;
        $documentCount = 0;
        $retrospectiveCount = 0;

        $memberStmt = $this->db->prepare(<<<SQL
            SELECT m."Id", m."UserId", u."DisplayName", u."EmailAddress", m."Color", m."Role", m."ReportsToId"
            FROM "ProjectMembers" m JOIN "Users" u ON u."Id" = m."UserId"
            WHERE m."ProjectId" = :pid
        SQL);
        $columnStmt = $this->db->prepare('SELECT * FROM "Columns" WHERE "ProjectId" = :pid');
        $releaseStmt = $this->db->prepare('SELECT * FROM "Releases" WHERE "ProjectId" = :pid');
        $riskStmt = $this->db->prepare('SELECT r.*, p."Key" AS "ProjectKey" FROM "Risks" r JOIN "Projects" p ON p."Id" = r."ProjectId" WHERE r."ProjectId" = :pid');
        $decisionDocStmt = $this->db->prepare('SELECT "DocumentId" FROM "DecisionDocument" WHERE "DecisionId" = :id');
        $decisionRiskStmt = $this->db->prepare('SELECT "RiskId" FROM "DecisionRisk" WHERE "DecisionId" = :id');
        $decisionPrinStmt = $this->db->prepare('SELECT "PrincipleId" FROM "DecisionPrinciple" WHERE "DecisionId" = :id');
        $decisionObjStmt = $this->db->prepare('SELECT "ObjectiveId" FROM "DecisionObjective" WHERE "DecisionId" = :id');
        $decisionStmt = $this->db->prepare('SELECT * FROM "Decisions" WHERE "ProjectId" = :pid');
        $projectRangeStmt = $this->db->prepare('SELECT "StartDate", "EndDate" FROM "Projects" WHERE "Id" = :id');
        $principleCountStmt = $this->db->prepare('SELECT COUNT(*) FROM "Principles" WHERE "ProjectId" = :pid');
        $objectiveCountStmt = $this->db->prepare('SELECT COUNT(*) FROM "Objectives" WHERE "ProjectId" = :pid');
        $documentCountStmt = $this->db->prepare('SELECT COUNT(*) FROM "Documents" WHERE "ProjectId" = :pid');
        $retrospectiveCountStmt = $this->db->prepare('SELECT COUNT(*) FROM "Retrospectives" WHERE "ProjectId" = :pid');

        foreach ($validProjectIds as $projectId) {
            $memberStmt->execute(['pid' => $projectId]);
            foreach ($memberStmt->fetchAll() as $m) {
                $members[] = [
                    'id' => $m['Id'], 'userId' => $m['UserId'], 'displayName' => $m['DisplayName'],
                    'email' => $m['EmailAddress'], 'color' => $m['Color'], 'role' => $m['Role'], 'reportsToId' => $m['ReportsToId'],
                ];
            }

            $columnStmt->execute(['pid' => $projectId]);
            foreach ($columnStmt->fetchAll() as $c) {
                $columns[] = ['id' => $c['Id'], 'name' => $c['Name'], 'done' => (bool) $c['Done'], 'color' => $c['Color'], 'order' => (int) $c['Order']];
            }

            foreach (TaskService::fetchTaskDtos($this->db, $projectId) as $t) {
                $tasks[] = $t;
            }

            $releaseStmt->execute(['pid' => $projectId]);
            foreach ($releaseStmt->fetchAll() as $r) {
                $releases[] = [
                    'id' => $r['Id'], 'name' => $r['Name'], 'status' => $r['Status'], 'ownerId' => $r['OwnerId'],
                    'startDate' => $r['StartDate'], 'endDate' => $r['EndDate'],
                ];
            }

            $riskStmt->execute(['pid' => $projectId]);
            foreach ($riskStmt->fetchAll() as $r) {
                $risks[] = [
                    'id' => $r['Id'], 'key' => $r['Key'], 'title' => $r['Title'], 'description' => $r['Description'],
                    'likelihood' => (int) $r['Likelihood'], 'impact' => (int) $r['Impact'], 'mitigations' => $r['Mitigations'],
                    'ownerId' => $r['OwnerId'], 'taskId' => $r['TaskId'], 'status' => $r['Status'],
                    'dateToClose' => $r['DateToClose'], 'dateClosed' => $r['DateClosed'],
                    'projectId' => $r['ProjectId'], 'projectKey' => $r['ProjectKey'],
                ];
            }

            $decisionStmt->execute(['pid' => $projectId]);
            foreach ($decisionStmt->fetchAll() as $d) {
                $decisionDocStmt->execute(['id' => $d['Id']]);
                $decisionRiskStmt->execute(['id' => $d['Id']]);
                $decisionPrinStmt->execute(['id' => $d['Id']]);
                $decisionObjStmt->execute(['id' => $d['Id']]);
                $decisions[] = [
                    'id' => $d['Id'], 'key' => $d['Key'], 'title' => $d['Title'], 'description' => $d['Description'],
                    'type' => $d['Type'], 'status' => $d['Status'], 'outcome' => $d['Outcome'],
                    'ownerId' => $d['OwnerId'], 'approver' => $d['Approver'], 'taskId' => $d['TaskId'],
                    'documentIds' => $decisionDocStmt->fetchAll(PDO::FETCH_COLUMN),
                    'riskIds' => $decisionRiskStmt->fetchAll(PDO::FETCH_COLUMN),
                    'principleIds' => $decisionPrinStmt->fetchAll(PDO::FETCH_COLUMN),
                    'objectiveIds' => $decisionObjStmt->fetchAll(PDO::FETCH_COLUMN),
                ];
            }

            $projectRangeStmt->execute(['id' => $projectId]);
            $range = $projectRangeStmt->fetch();
            if ($range !== false) {
                if ($range['StartDate'] !== null) $starts[] = $range['StartDate'];
                if ($range['EndDate'] !== null) $ends[] = $range['EndDate'];
            }

            $principleCountStmt->execute(['pid' => $projectId]);
            $principleCount += (int) $principleCountStmt->fetchColumn();
            $objectiveCountStmt->execute(['pid' => $projectId]);
            $objectiveCount += (int) $objectiveCountStmt->fetchColumn();
            $documentCountStmt->execute(['pid' => $projectId]);
            $documentCount += (int) $documentCountStmt->fetchColumn();
            $retrospectiveCountStmt->execute(['pid' => $projectId]);
            $retrospectiveCount += (int) $retrospectiveCountStmt->fetchColumn();
        }

        sort($starts);
        rsort($ends);

        return [
            'members' => $members, 'columns' => $columns, 'tasks' => $tasks, 'releases' => $releases,
            'risks' => $risks, 'decisions' => $decisions,
            'startDate' => $starts[0] ?? null, 'endDate' => $ends[0] ?? null,
            'orgUserCount' => $orgUserCount, 'principleCount' => $principleCount, 'objectiveCount' => $objectiveCount,
            'documentCount' => $documentCount, 'retrospectiveCount' => $retrospectiveCount,
        ];
    }

    public function getActivity(string $organisationId, array $requestedProjectIds, string $start, string $end): array
    {
        $validProjectIds = $this->validateProjectIds($organisationId, $requestedProjectIds);
        if (count($validProjectIds) === 0) {
            return ['created' => [], 'edited' => [], 'done' => []];
        }

        $placeholders = implode(',', array_map(static fn(int $i): string => ":pid{$i}", array_keys($validProjectIds)));
        // Half-open [start, endExclusive) so the end date's own day is fully included — computed in
        // PHP since a bound string param can't have an interval added to it directly in SQL, same
        // convention as the .NET side.
        $endExclusive = (new \DateTimeImmutable($end))->modify('+1 day')->format('Y-m-d');
        $params = ['start' => $start, 'endExclusive' => $endExclusive];
        foreach ($validProjectIds as $i => $id) {
            $params["pid{$i}"] = $id;
        }

        $created = $this->fetchDailyBuckets(
            "SELECT date_trunc('day', \"DateCreated\") AS day, COUNT(*)::int AS n FROM \"Tasks\" " .
            "WHERE \"ProjectId\" IN ({$placeholders}) AND \"DateCreated\" >= :start AND \"DateCreated\" < :endExclusive " .
            "GROUP BY 1 ORDER BY 1",
            $params
        );
        $edited = $this->fetchDailyBuckets(
            "SELECT date_trunc('day', \"DateLastModified\") AS day, COUNT(*)::int AS n FROM \"Tasks\" " .
            "WHERE \"ProjectId\" IN ({$placeholders}) AND \"DateLastModified\" >= :start AND \"DateLastModified\" < :endExclusive " .
            "AND \"DateLastModified\" <> \"DateCreated\" GROUP BY 1 ORDER BY 1",
            $params
        );
        $done = $this->fetchDailyBuckets(
            "SELECT date_trunc('day', \"DateDone\") AS day, COUNT(*)::int AS n FROM \"Tasks\" " .
            "WHERE \"ProjectId\" IN ({$placeholders}) AND \"DateDone\" >= :start AND \"DateDone\" < :endExclusive " .
            "GROUP BY 1 ORDER BY 1",
            $params
        );

        return ['created' => $created, 'edited' => $edited, 'done' => $done];
    }

    private function fetchDailyBuckets(string $sql, array $params): array
    {
        $stmt = $this->db->prepare($sql);
        $stmt->execute($params);
        return array_map(static fn(array $row): array => [
            'date' => substr((string) $row['day'], 0, 10),
            'count' => (int) $row['n'],
        ], $stmt->fetchAll());
    }

    /**
     * Backs the Timeline chart's click-to-edit modal and drag-to-schedule bars. Its own endpoint
     * rather than reusing ProjectsController's PUT /projects/{id} — that one requires
     * ProjectMemberMiddleware, which an Org Admin scheduling a project they don't personally belong
     * to would fail. OrgAdmin + org-ownership check only, same as every other method here. Either
     * date may be null to clear it (reverting the project back to the "no dates" state).
     */
    public function updateProjectDates(string $organisationId, string $projectId, ?string $startDate, ?string $endDate): bool
    {
        $stmt = $this->db->prepare('UPDATE "Projects" SET "StartDate" = :start, "EndDate" = :end, "DateLastModified" = now() WHERE "Id" = :id AND "OrganisationId" = :orgId');
        $stmt->execute(['start' => $startDate, 'end' => $endDate, 'id' => $projectId, 'orgId' => $organisationId]);
        return $stmt->rowCount() > 0;
    }

    /**
     * The only place Project.IsActive is ever written. Deactivating (true -> false) never needs
     * dates; activating (false -> true) is rejected unless the row's CURRENTLY PERSISTED StartDate
     * and EndDate are both already set — never trusting a client-supplied dates+active combo in the
     * same request. Returns 'ok'|'not_found'|'missing_dates', matching PortfolioController.cs's
     * PortfolioActivationResult 3-way result.
     */
    public function updateProjectActive(string $organisationId, string $projectId, bool $isActive): string
    {
        $stmt = $this->db->prepare('SELECT "StartDate", "EndDate" FROM "Projects" WHERE "Id" = :id AND "OrganisationId" = :orgId');
        $stmt->execute(['id' => $projectId, 'orgId' => $organisationId]);
        $project = $stmt->fetch();
        if ($project === false) {
            return 'not_found';
        }

        if ($isActive && ($project['StartDate'] === null || $project['EndDate'] === null)) {
            return 'missing_dates';
        }

        $updateStmt = $this->db->prepare('UPDATE "Projects" SET "IsActive" = :active, "DateLastModified" = now() WHERE "Id" = :id');
        $updateStmt->execute(['active' => $isActive, 'id' => $projectId]);
        return 'ok';
    }

    /**
     * Re-validates BOTH the project id and the category id against the caller's org before linking
     * them — a request pairing a legitimate own-org project with another org's category id fails
     * closed (treated as not-found), never silently cross-linked.
     */
    public function updateProjectCategory(string $organisationId, string $projectId, ?string $categoryId): bool
    {
        $stmt = $this->db->prepare('SELECT 1 FROM "Projects" WHERE "Id" = :id AND "OrganisationId" = :orgId');
        $stmt->execute(['id' => $projectId, 'orgId' => $organisationId]);
        if ($stmt->fetch() === false) {
            return false;
        }

        if ($categoryId !== null) {
            $catStmt = $this->db->prepare('SELECT 1 FROM "PortfolioCategories" WHERE "Id" = :id AND "OrganisationId" = :orgId');
            $catStmt->execute(['id' => $categoryId, 'orgId' => $organisationId]);
            if ($catStmt->fetch() === false) {
                return false;
            }
        }

        $updateStmt = $this->db->prepare('UPDATE "Projects" SET "CategoryId" = :categoryId, "DateLastModified" = now() WHERE "Id" = :id');
        $updateStmt->execute(['categoryId' => $categoryId, 'id' => $projectId]);
        return true;
    }

    public function listCategories(string $organisationId): array
    {
        $stmt = $this->db->prepare('SELECT "Id", "Name", "SortOrder" FROM "PortfolioCategories" WHERE "OrganisationId" = :orgId ORDER BY "SortOrder"');
        $stmt->execute(['orgId' => $organisationId]);
        return array_map(static fn(array $c): array => [
            'id' => $c['Id'], 'name' => $c['Name'], 'sortOrder' => (int) $c['SortOrder'],
        ], $stmt->fetchAll());
    }

    public function createCategory(string $organisationId, string $name): array
    {
        $trimmedName = trim($name) !== '' ? trim($name) : 'Untitled Category';
        $maxStmt = $this->db->prepare('SELECT MAX("SortOrder") FROM "PortfolioCategories" WHERE "OrganisationId" = :orgId');
        $maxStmt->execute(['orgId' => $organisationId]);
        $maxSortOrder = $maxStmt->fetchColumn();
        $sortOrder = ($maxSortOrder !== false && $maxSortOrder !== null) ? ((int) $maxSortOrder) + 1 : 0;

        $categoryId = Uuid::v4();
        $stmt = $this->db->prepare('INSERT INTO "PortfolioCategories" ("Id", "OrganisationId", "Name", "SortOrder") VALUES (:id, :orgId, :name, :sortOrder)');
        $stmt->execute(['id' => $categoryId, 'orgId' => $organisationId, 'name' => $trimmedName, 'sortOrder' => $sortOrder]);

        return ['id' => $categoryId, 'name' => $trimmedName, 'sortOrder' => $sortOrder];
    }

    public function updateCategory(string $organisationId, string $categoryId, string $name): ?array
    {
        $stmt = $this->db->prepare('SELECT "Name", "SortOrder" FROM "PortfolioCategories" WHERE "Id" = :id AND "OrganisationId" = :orgId');
        $stmt->execute(['id' => $categoryId, 'orgId' => $organisationId]);
        $category = $stmt->fetch();
        if ($category === false) {
            return null;
        }

        $newName = trim($name) !== '' ? trim($name) : $category['Name'];
        $updateStmt = $this->db->prepare('UPDATE "PortfolioCategories" SET "Name" = :name WHERE "Id" = :id');
        $updateStmt->execute(['name' => $newName, 'id' => $categoryId]);

        return ['id' => $categoryId, 'name' => $newName, 'sortOrder' => (int) $category['SortOrder']];
    }

    /** Deleting a category is a pure DB-level SetNull cascade (see migration 013) — no
     * application-side fan-out needed to un-categorize its projects. */
    public function deleteCategory(string $organisationId, string $categoryId): bool
    {
        $stmt = $this->db->prepare('DELETE FROM "PortfolioCategories" WHERE "Id" = :id AND "OrganisationId" = :orgId');
        $stmt->execute(['id' => $categoryId, 'orgId' => $organisationId]);
        return $stmt->rowCount() > 0;
    }

    public function updateCategorySortOrder(string $organisationId, string $categoryId, int $sortOrder): bool
    {
        $stmt = $this->db->prepare('UPDATE "PortfolioCategories" SET "SortOrder" = :sortOrder WHERE "Id" = :id AND "OrganisationId" = :orgId');
        $stmt->execute(['sortOrder' => $sortOrder, 'id' => $categoryId, 'orgId' => $organisationId]);
        return $stmt->rowCount() > 0;
    }

    /** The one place a client-supplied project id list is trusted at all: re-derived against the
     * caller's own organisation, so every subsequent query only ever touches project ids proven to
     * belong to the caller's org. */
    private function validateProjectIds(string $organisationId, array $requestedProjectIds): array
    {
        $requestedProjectIds = array_values(array_filter($requestedProjectIds, static fn($id): bool => is_string($id) && $id !== ''));
        if (count($requestedProjectIds) === 0) {
            return [];
        }

        $placeholders = implode(',', array_map(static fn(int $i): string => ":id{$i}", array_keys($requestedProjectIds)));
        $stmt = $this->db->prepare("SELECT \"Id\" FROM \"Projects\" WHERE \"OrganisationId\" = :orgId AND \"Id\" IN ({$placeholders})");
        $params = ['orgId' => $organisationId];
        foreach ($requestedProjectIds as $i => $id) {
            $params["id{$i}"] = $id;
        }
        $stmt->execute($params);
        return $stmt->fetchAll(PDO::FETCH_COLUMN);
    }

    private function countOrgUsers(string $organisationId): int
    {
        $stmt = $this->db->prepare('SELECT COUNT(*) FROM "Users" WHERE "OrganisationId" = :orgId AND "IsActive" = true');
        $stmt->execute(['orgId' => $organisationId]);
        return (int) $stmt->fetchColumn();
    }
}
