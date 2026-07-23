<?php

declare(strict_types=1);

namespace Enkl\Api\Services;

use Enkl\Api\Support\Uuid;
use PDO;

/**
 * Ported from Services/StrategyPillarService.cs. Pillar + Enabler CRUD combined in one class — same
 * don't-over-split judgment as the .NET tier. Every method re-validates ownership up the chain
 * (Pillar -> Strategy -> Organisation, Enabler -> Pillar -> Strategy -> Organisation) before touching
 * anything.
 */
final class StrategyPillarService
{
    public function __construct(private readonly PDO $db)
    {
    }

    private function strategyBelongsToOrg(string $organisationId, string $strategyId): bool
    {
        $stmt = $this->db->prepare('SELECT 1 FROM "Strategies" WHERE "Id" = :id AND "OrganisationId" = :orgId');
        $stmt->execute(['id' => $strategyId, 'orgId' => $organisationId]);
        return $stmt->fetch() !== false;
    }

    private function findOwnedPillar(string $organisationId, string $pillarId): ?array
    {
        $stmt = $this->db->prepare(<<<SQL
            SELECT p.* FROM "StrategyPillars" p
            JOIN "Strategies" s ON s."Id" = p."StrategyId"
            WHERE p."Id" = :id AND s."OrganisationId" = :orgId
        SQL);
        $stmt->execute(['id' => $pillarId, 'orgId' => $organisationId]);
        $row = $stmt->fetch();
        return $row !== false ? $row : null;
    }

    private function findOwnedEnabler(string $organisationId, string $enablerId): ?array
    {
        $stmt = $this->db->prepare(<<<SQL
            SELECT e.* FROM "StrategyEnablers" e
            JOIN "StrategyPillars" p ON p."Id" = e."PillarId"
            JOIN "Strategies" s ON s."Id" = p."StrategyId"
            WHERE e."Id" = :id AND s."OrganisationId" = :orgId
        SQL);
        $stmt->execute(['id' => $enablerId, 'orgId' => $organisationId]);
        $row = $stmt->fetch();
        return $row !== false ? $row : null;
    }

    // ---- Pillars ----

    public function createPillar(string $organisationId, string $strategyId, array $request): ?array
    {
        if (!$this->strategyBelongsToOrg($organisationId, $strategyId)) {
            return null;
        }

        $name = trim((string) ($request['name'] ?? ''));
        if ($name === '') {
            return null;
        }
        if (strlen($name) > 150) {
            $name = substr($name, 0, 150);
        }
        $description = trim((string) ($request['description'] ?? '')) !== '' ? trim((string) $request['description']) : null;

        $maxStmt = $this->db->prepare('SELECT MAX("SortOrder") FROM "StrategyPillars" WHERE "StrategyId" = :sid');
        $maxStmt->execute(['sid' => $strategyId]);
        $max = $maxStmt->fetchColumn();
        $sortOrder = ($max !== false && $max !== null) ? ((int) $max) + 1 : 0;

        $pillarId = Uuid::v4();
        $this->db->prepare('INSERT INTO "StrategyPillars" ("Id", "StrategyId", "Name", "Description", "SortOrder") VALUES (:id, :sid, :name, :description, :sortOrder)')
            ->execute(['id' => $pillarId, 'sid' => $strategyId, 'name' => $name, 'description' => $description, 'sortOrder' => $sortOrder]);

        return ['id' => $pillarId, 'strategyId' => $strategyId, 'name' => $name, 'description' => $description, 'sortOrder' => $sortOrder];
    }

    public function updatePillar(string $organisationId, string $pillarId, array $request): ?array
    {
        $pillar = $this->findOwnedPillar($organisationId, $pillarId);
        if ($pillar === null) {
            return null;
        }

        $name = trim((string) ($request['name'] ?? ''));
        if ($name === '') {
            return null;
        }
        if (strlen($name) > 150) {
            $name = substr($name, 0, 150);
        }
        $description = trim((string) ($request['description'] ?? '')) !== '' ? trim((string) $request['description']) : null;
        $sortOrder = (int) ($request['sortOrder'] ?? $pillar['SortOrder']);

        $this->db->prepare('UPDATE "StrategyPillars" SET "Name" = :name, "Description" = :description, "SortOrder" = :sortOrder WHERE "Id" = :id')
            ->execute(['name' => $name, 'description' => $description, 'sortOrder' => $sortOrder, 'id' => $pillarId]);

        return ['id' => $pillarId, 'strategyId' => $pillar['StrategyId'], 'name' => $name, 'description' => $description, 'sortOrder' => $sortOrder];
    }

    public function deletePillar(string $organisationId, string $pillarId): bool
    {
        if ($this->findOwnedPillar($organisationId, $pillarId) === null) {
            return false;
        }
        $this->db->prepare('DELETE FROM "StrategyPillars" WHERE "Id" = :id')->execute(['id' => $pillarId]);
        return true;
    }

    // ---- Enablers ----

    public function createEnabler(string $organisationId, string $pillarId, array $request): ?array
    {
        if ($this->findOwnedPillar($organisationId, $pillarId) === null) {
            return null;
        }

        $name = trim((string) ($request['name'] ?? ''));
        if ($name === '') {
            return null;
        }
        if (strlen($name) > 150) {
            $name = substr($name, 0, 150);
        }
        $description = trim((string) ($request['description'] ?? '')) !== '' ? trim((string) $request['description']) : null;

        $maxStmt = $this->db->prepare('SELECT MAX("SortOrder") FROM "StrategyEnablers" WHERE "PillarId" = :pid');
        $maxStmt->execute(['pid' => $pillarId]);
        $max = $maxStmt->fetchColumn();
        $sortOrder = ($max !== false && $max !== null) ? ((int) $max) + 1 : 0;

        $enablerId = Uuid::v4();
        $this->db->prepare('INSERT INTO "StrategyEnablers" ("Id", "PillarId", "Name", "Description", "SortOrder") VALUES (:id, :pid, :name, :description, :sortOrder)')
            ->execute(['id' => $enablerId, 'pid' => $pillarId, 'name' => $name, 'description' => $description, 'sortOrder' => $sortOrder]);

        return ['id' => $enablerId, 'pillarId' => $pillarId, 'name' => $name, 'description' => $description, 'sortOrder' => $sortOrder];
    }

    public function updateEnabler(string $organisationId, string $enablerId, array $request): ?array
    {
        $enabler = $this->findOwnedEnabler($organisationId, $enablerId);
        if ($enabler === null) {
            return null;
        }

        $name = trim((string) ($request['name'] ?? ''));
        if ($name === '') {
            return null;
        }
        if (strlen($name) > 150) {
            $name = substr($name, 0, 150);
        }
        $description = trim((string) ($request['description'] ?? '')) !== '' ? trim((string) $request['description']) : null;
        $sortOrder = (int) ($request['sortOrder'] ?? $enabler['SortOrder']);

        $this->db->prepare('UPDATE "StrategyEnablers" SET "Name" = :name, "Description" = :description, "SortOrder" = :sortOrder WHERE "Id" = :id')
            ->execute(['name' => $name, 'description' => $description, 'sortOrder' => $sortOrder, 'id' => $enablerId]);

        return ['id' => $enablerId, 'pillarId' => $enabler['PillarId'], 'name' => $name, 'description' => $description, 'sortOrder' => $sortOrder];
    }

    public function deleteEnabler(string $organisationId, string $enablerId): bool
    {
        if ($this->findOwnedEnabler($organisationId, $enablerId) === null) {
            return false;
        }
        $this->db->prepare('DELETE FROM "StrategyEnablers" WHERE "Id" = :id')->execute(['id' => $enablerId]);
        return true;
    }

    // ---- Tree read (Pillars -> Enablers -> Metrics, plus Metrics directly on a Pillar) ----
    // Shared by StrategyController (OrgAdmin) and ProjectStrategyController (ProjectMember, read-only).

    public function getPillarTree(string $strategyId): array
    {
        $pillarStmt = $this->db->prepare('SELECT * FROM "StrategyPillars" WHERE "StrategyId" = :sid ORDER BY "SortOrder"');
        $pillarStmt->execute(['sid' => $strategyId]);
        $pillars = $pillarStmt->fetchAll();
        $pillarIds = array_column($pillars, 'Id');

        $enablers = [];
        if (count($pillarIds) > 0) {
            $placeholders = implode(',', array_map(static fn(int $i): string => ":pid{$i}", array_keys($pillarIds)));
            $stmt = $this->db->prepare("SELECT * FROM \"StrategyEnablers\" WHERE \"PillarId\" IN ({$placeholders}) ORDER BY \"SortOrder\"");
            $params = [];
            foreach ($pillarIds as $i => $id) {
                $params["pid{$i}"] = $id;
            }
            $stmt->execute($params);
            $enablers = $stmt->fetchAll();
        }
        $enablerIds = array_column($enablers, 'Id');

        $metrics = [];
        if (count($pillarIds) > 0 || count($enablerIds) > 0) {
            $conditions = [];
            $params = [];
            if (count($pillarIds) > 0) {
                $ph = implode(',', array_map(static fn(int $i): string => ":pid{$i}", array_keys($pillarIds)));
                $conditions[] = "\"PillarId\" IN ({$ph})";
                foreach ($pillarIds as $i => $id) {
                    $params["pid{$i}"] = $id;
                }
            }
            if (count($enablerIds) > 0) {
                $ph = implode(',', array_map(static fn(int $i): string => ":eid{$i}", array_keys($enablerIds)));
                $conditions[] = "\"EnablerId\" IN ({$ph})";
                foreach ($enablerIds as $i => $id) {
                    $params["eid{$i}"] = $id;
                }
            }
            $stmt = $this->db->prepare('SELECT * FROM "StrategyMetrics" WHERE ' . implode(' OR ', $conditions) . ' ORDER BY "SortOrder"');
            $stmt->execute($params);
            $metrics = $stmt->fetchAll();
        }

        $metricDto = static fn(array $m): array => [
            'id' => $m['Id'], 'pillarId' => $m['PillarId'], 'enablerId' => $m['EnablerId'], 'name' => $m['Name'],
            'targetValue' => $m['TargetValue'] !== null ? (float) $m['TargetValue'] : null,
            'unitLabel' => $m['UnitLabel'], 'sortOrder' => (int) $m['SortOrder'],
        ];
        $metricsFor = static fn(string $key, string $value): array =>
            array_values(array_map($metricDto, array_filter($metrics, static fn(array $m) => $m[$key] === $value)));

        return array_map(static function (array $p) use ($enablers, $metricsFor, $metricDto): array {
            $pillarEnablers = array_values(array_filter($enablers, static fn(array $e) => $e['PillarId'] === $p['Id']));
            return [
                'id' => $p['Id'], 'name' => $p['Name'], 'description' => $p['Description'], 'sortOrder' => (int) $p['SortOrder'],
                'metrics' => $metricsFor('PillarId', $p['Id']),
                'enablers' => array_map(static fn(array $e) => [
                    'id' => $e['Id'], 'name' => $e['Name'], 'description' => $e['Description'], 'sortOrder' => (int) $e['SortOrder'],
                    'metrics' => $metricsFor('EnablerId', $e['Id']),
                ], $pillarEnablers),
            ];
        }, $pillars);
    }

    /** ProjectMember-readable variant — resolves the project's own org, then that org's active
     * Strategy, then the tree; null means either the project doesn't exist or the org has no active
     * Strategy yet (both collapse to "nothing to show", no enumeration oracle needed on this
     * read-only, non-sensitive surface). */
    public function getActivePillarTreeForProject(string $projectId): ?array
    {
        $stmt = $this->db->prepare('SELECT "OrganisationId" FROM "Projects" WHERE "Id" = :id');
        $stmt->execute(['id' => $projectId]);
        $organisationId = $stmt->fetchColumn();
        if ($organisationId === false) {
            return null;
        }

        $stmt = $this->db->prepare('SELECT "Id" FROM "Strategies" WHERE "OrganisationId" = :orgId AND "IsActive" = true');
        $stmt->execute(['orgId' => $organisationId]);
        $strategyId = $stmt->fetchColumn();
        if ($strategyId === false) {
            return null;
        }

        return $this->getPillarTree($strategyId);
    }
}
