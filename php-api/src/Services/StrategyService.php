<?php

declare(strict_types=1);

namespace Enkl\Api\Services;

use Enkl\Api\Support\Uuid;
use PDO;

/**
 * Ported from Services/StrategyService.cs. Strategy CRUD + activate — every method takes
 * organisationId first and filters by it, same cross-org-isolation discipline as PortfolioService.
 * Activating a Strategy is the one place IsActive is ever written (root CLAUDE.md §7's "one endpoint
 * owns the flag" rule) — flips every other Strategy in the same org to false in the same transaction.
 */
final class StrategyService
{
    public function __construct(private readonly PDO $db)
    {
    }

    public function list(string $organisationId): array
    {
        $stmt = $this->db->prepare('SELECT "Id", "Name", "IsActive", "SortOrder", "DateCreated" FROM "Strategies" WHERE "OrganisationId" = :orgId ORDER BY "SortOrder"');
        $stmt->execute(['orgId' => $organisationId]);
        return array_map([self::class, 'toDto'], $stmt->fetchAll());
    }

    public function getActive(string $organisationId): ?array
    {
        $stmt = $this->db->prepare('SELECT "Id", "Name", "IsActive", "SortOrder", "DateCreated" FROM "Strategies" WHERE "OrganisationId" = :orgId AND "IsActive" = true');
        $stmt->execute(['orgId' => $organisationId]);
        $row = $stmt->fetch();
        return $row !== false ? self::toDto($row) : null;
    }

    public function create(string $organisationId, array $request): array
    {
        $name = trim((string) ($request['name'] ?? ''));
        if ($name === '') {
            $name = 'Untitled Strategy';
        }
        if (strlen($name) > 150) {
            $name = substr($name, 0, 150);
        }

        $maxStmt = $this->db->prepare('SELECT MAX("SortOrder") FROM "Strategies" WHERE "OrganisationId" = :orgId');
        $maxStmt->execute(['orgId' => $organisationId]);
        $max = $maxStmt->fetchColumn();
        $sortOrder = ($max !== false && $max !== null) ? ((int) $max) + 1 : 0;

        $strategyId = Uuid::v4();
        $stmt = $this->db->prepare('INSERT INTO "Strategies" ("Id", "OrganisationId", "Name", "IsActive", "SortOrder", "DateCreated") VALUES (:id, :orgId, :name, false, :sortOrder, now())');
        $stmt->execute(['id' => $strategyId, 'orgId' => $organisationId, 'name' => $name, 'sortOrder' => $sortOrder]);

        $created = $this->getById($strategyId);
        return $created ?? ['id' => $strategyId, 'name' => $name, 'isActive' => false, 'sortOrder' => $sortOrder, 'dateCreated' => null];
    }

    public function update(string $organisationId, string $strategyId, array $request): ?array
    {
        $stmt = $this->db->prepare('SELECT 1 FROM "Strategies" WHERE "Id" = :id AND "OrganisationId" = :orgId');
        $stmt->execute(['id' => $strategyId, 'orgId' => $organisationId]);
        if ($stmt->fetch() === false) {
            return null;
        }

        $name = trim((string) ($request['name'] ?? ''));
        if ($name === '') {
            return null;
        }
        if (strlen($name) > 150) {
            $name = substr($name, 0, 150);
        }

        $this->db->prepare('UPDATE "Strategies" SET "Name" = :name WHERE "Id" = :id')->execute(['name' => $name, 'id' => $strategyId]);
        return $this->getById($strategyId);
    }

    /** The only place IsActive is ever written — flips every other Strategy in this org to false
     * first, then activates the requested one, in one transaction so a caller never observes (or a
     * crash mid-way never leaves) zero or two active Strategies at once. */
    public function activate(string $organisationId, string $strategyId): ?array
    {
        $stmt = $this->db->prepare('SELECT 1 FROM "Strategies" WHERE "Id" = :id AND "OrganisationId" = :orgId');
        $stmt->execute(['id' => $strategyId, 'orgId' => $organisationId]);
        if ($stmt->fetch() === false) {
            return null;
        }

        $this->db->beginTransaction();
        try {
            $this->db->prepare('UPDATE "Strategies" SET "IsActive" = false WHERE "OrganisationId" = :orgId AND "Id" != :id AND "IsActive" = true')
                ->execute(['orgId' => $organisationId, 'id' => $strategyId]);
            $this->db->prepare('UPDATE "Strategies" SET "IsActive" = true WHERE "Id" = :id')->execute(['id' => $strategyId]);
            $this->db->commit();
        } catch (\Throwable $e) {
            if ($this->db->inTransaction()) {
                $this->db->rollBack();
            }
            throw $e;
        }

        return $this->getById($strategyId);
    }

    /** Deletion is deliberate and confirmed with the user — cascades every Pillar/Enabler/Metric/
     * MetricEntry/ProjectPillarFulfilment row that hung off this Strategy. */
    public function delete(string $organisationId, string $strategyId): bool
    {
        $stmt = $this->db->prepare('DELETE FROM "Strategies" WHERE "Id" = :id AND "OrganisationId" = :orgId');
        $stmt->execute(['id' => $strategyId, 'orgId' => $organisationId]);
        return $stmt->rowCount() > 0;
    }

    private function getById(string $strategyId): ?array
    {
        $stmt = $this->db->prepare('SELECT "Id", "Name", "IsActive", "SortOrder", "DateCreated" FROM "Strategies" WHERE "Id" = :id');
        $stmt->execute(['id' => $strategyId]);
        $row = $stmt->fetch();
        return $row !== false ? self::toDto($row) : null;
    }

    private static function toDto(array $s): array
    {
        return [
            'id' => $s['Id'], 'name' => $s['Name'], 'isActive' => (bool) $s['IsActive'],
            'sortOrder' => (int) $s['SortOrder'], 'dateCreated' => $s['DateCreated'],
        ];
    }
}
