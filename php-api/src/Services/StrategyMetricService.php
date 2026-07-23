<?php

declare(strict_types=1);

namespace Enkl\Api\Services;

use Enkl\Api\Support\Uuid;
use PDO;

/**
 * Ported from Services/StrategyMetricService.cs. Metric CRUD (enforcing the exactly-one-parent rule:
 * exactly one of PillarId/EnablerId non-null, app-layer only per this codebase's no-CHECK-constraints
 * convention) plus append-only StrategyMetricEntry recording/history.
 */
final class StrategyMetricService
{
    public function __construct(private readonly PDO $db)
    {
    }

    private function resolvePillarOrg(string $pillarId): ?string
    {
        $stmt = $this->db->prepare(<<<SQL
            SELECT s."OrganisationId" FROM "StrategyPillars" p
            JOIN "Strategies" s ON s."Id" = p."StrategyId"
            WHERE p."Id" = :id
        SQL);
        $stmt->execute(['id' => $pillarId]);
        $org = $stmt->fetchColumn();
        return $org !== false ? $org : null;
    }

    private function resolveEnablerOrg(string $enablerId): ?string
    {
        $stmt = $this->db->prepare(<<<SQL
            SELECT s."OrganisationId" FROM "StrategyEnablers" e
            JOIN "StrategyPillars" p ON p."Id" = e."PillarId"
            JOIN "Strategies" s ON s."Id" = p."StrategyId"
            WHERE e."Id" = :id
        SQL);
        $stmt->execute(['id' => $enablerId]);
        $org = $stmt->fetchColumn();
        return $org !== false ? $org : null;
    }

    private function findOwnedMetric(string $organisationId, string $metricId): ?array
    {
        $stmt = $this->db->prepare('SELECT * FROM "StrategyMetrics" WHERE "Id" = :id');
        $stmt->execute(['id' => $metricId]);
        $metric = $stmt->fetch();
        if ($metric === false) {
            return null;
        }

        $owningOrg = $metric['PillarId'] !== null
            ? $this->resolvePillarOrg($metric['PillarId'])
            : $this->resolveEnablerOrg($metric['EnablerId']);

        return $owningOrg === $organisationId ? $metric : null;
    }

    public function create(string $organisationId, ?string $pillarId, ?string $enablerId, array $request): ?array
    {
        // Exactly one parent — never both, never neither.
        if (($pillarId === null) === ($enablerId === null)) {
            return null;
        }

        if ($pillarId !== null) {
            if ($this->resolvePillarOrg($pillarId) !== $organisationId) {
                return null;
            }
        } else {
            if ($this->resolveEnablerOrg($enablerId) !== $organisationId) {
                return null;
            }
        }

        $name = trim((string) ($request['name'] ?? ''));
        if ($name === '') {
            return null;
        }
        if (strlen($name) > 150) {
            $name = substr($name, 0, 150);
        }
        $unitLabel = trim((string) ($request['unitLabel'] ?? '')) !== '' ? trim((string) $request['unitLabel']) : null;
        if ($unitLabel !== null && strlen($unitLabel) > 20) {
            $unitLabel = substr($unitLabel, 0, 20);
        }
        $targetValue = isset($request['targetValue']) && $request['targetValue'] !== null ? (float) $request['targetValue'] : null;

        $maxStmt = $this->db->prepare('SELECT MAX("SortOrder") FROM "StrategyMetrics" WHERE ' . ($pillarId !== null ? '"PillarId" = :parentId' : '"EnablerId" = :parentId'));
        $maxStmt->execute(['parentId' => $pillarId ?? $enablerId]);
        $max = $maxStmt->fetchColumn();
        $sortOrder = ($max !== false && $max !== null) ? ((int) $max) + 1 : 0;

        $metricId = Uuid::v4();
        $this->db->prepare('INSERT INTO "StrategyMetrics" ("Id", "PillarId", "EnablerId", "Name", "TargetValue", "UnitLabel", "SortOrder") VALUES (:id, :pillarId, :enablerId, :name, :targetValue, :unitLabel, :sortOrder)')
            ->execute(['id' => $metricId, 'pillarId' => $pillarId, 'enablerId' => $enablerId, 'name' => $name, 'targetValue' => $targetValue, 'unitLabel' => $unitLabel, 'sortOrder' => $sortOrder]);

        return ['id' => $metricId, 'pillarId' => $pillarId, 'enablerId' => $enablerId, 'name' => $name, 'targetValue' => $targetValue, 'unitLabel' => $unitLabel, 'sortOrder' => $sortOrder];
    }

    public function update(string $organisationId, string $metricId, array $request): ?array
    {
        $metric = $this->findOwnedMetric($organisationId, $metricId);
        if ($metric === null) {
            return null;
        }

        $name = trim((string) ($request['name'] ?? ''));
        if ($name === '') {
            return null;
        }
        if (strlen($name) > 150) {
            $name = substr($name, 0, 150);
        }
        $unitLabel = trim((string) ($request['unitLabel'] ?? '')) !== '' ? trim((string) $request['unitLabel']) : null;
        if ($unitLabel !== null && strlen($unitLabel) > 20) {
            $unitLabel = substr($unitLabel, 0, 20);
        }
        $targetValue = isset($request['targetValue']) && $request['targetValue'] !== null ? (float) $request['targetValue'] : null;
        $sortOrder = (int) ($request['sortOrder'] ?? $metric['SortOrder']);

        $this->db->prepare('UPDATE "StrategyMetrics" SET "Name" = :name, "TargetValue" = :targetValue, "UnitLabel" = :unitLabel, "SortOrder" = :sortOrder WHERE "Id" = :id')
            ->execute(['name' => $name, 'targetValue' => $targetValue, 'unitLabel' => $unitLabel, 'sortOrder' => $sortOrder, 'id' => $metricId]);

        return ['id' => $metricId, 'pillarId' => $metric['PillarId'], 'enablerId' => $metric['EnablerId'], 'name' => $name, 'targetValue' => $targetValue, 'unitLabel' => $unitLabel, 'sortOrder' => $sortOrder];
    }

    public function delete(string $organisationId, string $metricId): bool
    {
        if ($this->findOwnedMetric($organisationId, $metricId) === null) {
            return false;
        }
        $this->db->prepare('DELETE FROM "StrategyMetrics" WHERE "Id" = :id')->execute(['id' => $metricId]);
        return true;
    }

    // ---- Metric entries (append-only time series) ----

    public function recordEntry(string $organisationId, string $metricId, array $request): ?array
    {
        if ($this->findOwnedMetric($organisationId, $metricId) === null) {
            return null;
        }

        $entryId = Uuid::v4();
        $value = (float) ($request['value'] ?? 0);
        $note = trim((string) ($request['note'] ?? '')) !== '' ? trim((string) $request['note']) : null;

        $this->db->prepare('INSERT INTO "StrategyMetricEntries" ("Id", "MetricId", "RecordedAt", "Value", "Note") VALUES (:id, :metricId, now(), :value, :note)')
            ->execute(['id' => $entryId, 'metricId' => $metricId, 'value' => $value, 'note' => $note]);

        $stmt = $this->db->prepare('SELECT "RecordedAt" FROM "StrategyMetricEntries" WHERE "Id" = :id');
        $stmt->execute(['id' => $entryId]);
        $recordedAt = $stmt->fetchColumn();

        return ['id' => $entryId, 'metricId' => $metricId, 'recordedAt' => $recordedAt, 'value' => $value, 'note' => $note];
    }

    public function getHistory(string $organisationId, string $metricId): ?array
    {
        if ($this->findOwnedMetric($organisationId, $metricId) === null) {
            return null;
        }
        return $this->fetchHistory($metricId);
    }

    /** ProjectMember-readable variant — resolves the project's own org first (the caller has no
     * organisationId of their own, only a projectId ProjectMemberMiddleware already verified they
     * belong to), then re-uses the same ownership-checked getHistory. */
    public function getHistoryForProject(string $projectId, string $metricId): ?array
    {
        $stmt = $this->db->prepare('SELECT "OrganisationId" FROM "Projects" WHERE "Id" = :id');
        $stmt->execute(['id' => $projectId]);
        $organisationId = $stmt->fetchColumn();
        if ($organisationId === false) {
            return null;
        }
        return $this->getHistory($organisationId, $metricId);
    }

    private function fetchHistory(string $metricId): array
    {
        $stmt = $this->db->prepare('SELECT "Id", "MetricId", "RecordedAt", "Value", "Note" FROM "StrategyMetricEntries" WHERE "MetricId" = :id ORDER BY "RecordedAt"');
        $stmt->execute(['id' => $metricId]);
        return array_map(static fn(array $e): array => [
            'id' => $e['Id'], 'metricId' => $e['MetricId'], 'recordedAt' => $e['RecordedAt'],
            'value' => (float) $e['Value'], 'note' => $e['Note'],
        ], $stmt->fetchAll());
    }
}
