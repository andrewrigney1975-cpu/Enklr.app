<?php

declare(strict_types=1);

namespace Enkl\Api\Services;

use Enkl\Api\Support\Uuid;
use PDO;

/**
 * Ported from php-api's Services/StrategyFulfilmentService.php (itself ported from
 * Services/StrategyFulfilmentService.cs). ProjectPillarFulfilment upsert (called from Portfolio
 * Planner's per-project Strategy modal) and the fulfilment-matrix read that feeds all three radar
 * views. Every project/strategy `IsActive` value read off a row is cast (bool) explicitly — PDO_MYSQL
 * returns TINYINT(1) as a plain PHP int, never a real bool (mariadb-api/CLAUDE.md §4.8).
 */
final class StrategyFulfilmentService
{
    public function __construct(private readonly PDO $db)
    {
    }

    /** Find-or-create upsert for one (Project, Pillar) pair. Both ids are independently re-validated
     * against the caller's org. Value is clamped 0-100. */
    public function upsert(string $organisationId, string $projectId, string $pillarId, array $request): ?array
    {
        $stmt = $this->db->prepare('SELECT 1 FROM "Projects" WHERE "Id" = :id AND "OrganisationId" = :orgId');
        $stmt->execute(['id' => $projectId, 'orgId' => $organisationId]);
        if ($stmt->fetch() === false) {
            return null;
        }

        $stmt = $this->db->prepare(<<<SQL
            SELECT 1 FROM "StrategyPillars" p JOIN "Strategies" s ON s."Id" = p."StrategyId"
            WHERE p."Id" = :id AND s."OrganisationId" = :orgId
        SQL);
        $stmt->execute(['id' => $pillarId, 'orgId' => $organisationId]);
        if ($stmt->fetch() === false) {
            return null;
        }

        $clamped = max(0, min(100, (int) round((float) ($request['fulfilmentPercent'] ?? 0))));

        $stmt = $this->db->prepare('SELECT "Id" FROM "ProjectPillarFulfilments" WHERE "ProjectId" = :pid AND "PillarId" = :pillarId');
        $stmt->execute(['pid' => $projectId, 'pillarId' => $pillarId]);
        $existingId = $stmt->fetchColumn();

        if ($existingId !== false) {
            $this->db->prepare('UPDATE "ProjectPillarFulfilments" SET "FulfilmentPercent" = :value, "DateLastModified" = now() WHERE "Id" = :id')
                ->execute(['value' => $clamped, 'id' => $existingId]);
        } else {
            $this->db->prepare('INSERT INTO "ProjectPillarFulfilments" ("Id", "ProjectId", "PillarId", "FulfilmentPercent", "DateLastModified") VALUES (:id, :pid, :pillarId, :value, now())')
                ->execute(['id' => Uuid::v4(), 'pid' => $projectId, 'pillarId' => $pillarId, 'value' => $clamped]);
        }

        return ['pillarId' => $pillarId, 'fulfilmentPercent' => $clamped];
    }

    /** OrgAdmin matrix read across a client-supplied project-id list — re-derives which ids actually
     * belong to the caller's org before touching anything. An empty/omitted list means "every project
     * in the org." */
    public function buildMatrix(string $organisationId, array $requestedProjectIds): array
    {
        $stmt = $this->db->prepare('SELECT "Id", "Name", "IsActive", "SortOrder", "DateCreated" FROM "Strategies" WHERE "OrganisationId" = :orgId AND "IsActive" = 1');
        $stmt->execute(['orgId' => $organisationId]);
        $strategyRow = $stmt->fetch();

        if ($strategyRow === false) {
            return ['activeStrategy' => null, 'pillars' => [], 'projects' => [], 'aggregate' => []];
        }
        $activeStrategy = [
            'id' => $strategyRow['Id'], 'name' => $strategyRow['Name'], 'isActive' => true,
            'sortOrder' => (int) $strategyRow['SortOrder'], 'dateCreated' => $strategyRow['DateCreated'],
        ];

        $pillarStmt = $this->db->prepare('SELECT "Id", "StrategyId", "Name", "Description", "SortOrder" FROM "StrategyPillars" WHERE "StrategyId" = :sid ORDER BY "SortOrder"');
        $pillarStmt->execute(['sid' => $strategyRow['Id']]);
        $pillarRows = $pillarStmt->fetchAll();
        $pillars = array_map(static fn(array $p): array => [
            'id' => $p['Id'], 'strategyId' => $p['StrategyId'], 'name' => $p['Name'], 'description' => $p['Description'], 'sortOrder' => (int) $p['SortOrder'],
        ], $pillarRows);
        $pillarIds = array_column($pillarRows, 'Id');

        $requestedProjectIds = array_values(array_filter($requestedProjectIds, static fn($id): bool => is_string($id) && $id !== ''));
        if (count($requestedProjectIds) > 0) {
            $ph = implode(',', array_map(static fn(int $i): string => ":id{$i}", array_keys($requestedProjectIds)));
            $params = ['orgId' => $organisationId];
            foreach ($requestedProjectIds as $i => $id) {
                $params["id{$i}"] = $id;
            }
            $projectStmt = $this->db->prepare("SELECT \"Id\", \"Key\", \"Name\", \"IsActive\" FROM \"Projects\" WHERE \"OrganisationId\" = :orgId AND \"Id\" IN ({$ph})");
            $projectStmt->execute($params);
        } else {
            $projectStmt = $this->db->prepare('SELECT "Id", "Key", "Name", "IsActive" FROM "Projects" WHERE "OrganisationId" = :orgId');
            $projectStmt->execute(['orgId' => $organisationId]);
        }
        $projectRows = $projectStmt->fetchAll();
        $projectIds = array_column($projectRows, 'Id');

        $fulfilments = [];
        if (count($projectIds) > 0 && count($pillarIds) > 0) {
            $pPh = implode(',', array_map(static fn(int $i): string => ":pid{$i}", array_keys($projectIds)));
            $plPh = implode(',', array_map(static fn(int $i): string => ":plid{$i}", array_keys($pillarIds)));
            $params = [];
            foreach ($projectIds as $i => $id) {
                $params["pid{$i}"] = $id;
            }
            foreach ($pillarIds as $i => $id) {
                $params["plid{$i}"] = $id;
            }
            $fStmt = $this->db->prepare("SELECT \"ProjectId\", \"PillarId\", \"FulfilmentPercent\" FROM \"ProjectPillarFulfilments\" WHERE \"ProjectId\" IN ({$pPh}) AND \"PillarId\" IN ({$plPh})");
            $fStmt->execute($params);
            $fulfilments = $fStmt->fetchAll();
        }

        $projects = array_map(static function (array $p) use ($fulfilments): array {
            $rowFulfilment = [];
            foreach ($fulfilments as $f) {
                if ($f['ProjectId'] === $p['Id']) {
                    $rowFulfilment[$f['PillarId']] = (int) $f['FulfilmentPercent'];
                }
            }
            return ['projectId' => $p['Id'], 'projectKey' => $p['Key'], 'projectName' => $p['Name'], 'isActive' => (bool) $p['IsActive'], 'fulfilment' => $rowFulfilment];
        }, $projectRows);

        // Aggregate excludes projects with no value set for a given pillar — averaging only over
        // projects that actually have an opinion on that pillar, never counting an absence as 0.
        $aggregate = [];
        foreach ($pillarIds as $pillarId) {
            $values = array_map(static fn(array $f) => (int) $f['FulfilmentPercent'], array_filter($fulfilments, static fn(array $f) => $f['PillarId'] === $pillarId));
            if (count($values) > 0) {
                $aggregate[$pillarId] = array_sum($values) / count($values);
            }
        }

        return ['activeStrategy' => $activeStrategy, 'pillars' => $pillars, 'projects' => $projects, 'aggregate' => $aggregate];
    }

    /** Same shaped payload as buildMatrix, scoped to exactly one project — used by
     * ProjectStrategyController's read-only surface. */
    public function buildSingleProjectMatrix(string $projectId): ?array
    {
        $stmt = $this->db->prepare('SELECT "OrganisationId" FROM "Projects" WHERE "Id" = :id');
        $stmt->execute(['id' => $projectId]);
        $organisationId = $stmt->fetchColumn();
        if ($organisationId === false) {
            return null;
        }

        return $this->buildMatrix($organisationId, [$projectId]);
    }
}
