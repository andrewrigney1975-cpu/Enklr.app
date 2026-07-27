<?php

declare(strict_types=1);

namespace Enkl\Api\Services;

use Enkl\Api\Support\Uuid;
use PDO;

/** Ported from Services/ReleaseService.cs. */
final class ReleaseService
{
    private const VALID_STATUSES = ['pending', 'in_progress', 'deployed'];

    public function __construct(private readonly PDO $db)
    {
    }

    public function create(string $projectId, array $request): ?array
    {
        $stmt = $this->db->prepare('SELECT 1 FROM "Projects" WHERE "Id" = :id');
        $stmt->execute(['id' => $projectId]);
        if ($stmt->fetch() === false) {
            return null;
        }

        $id = Uuid::v4();
        $status = in_array($request['status'] ?? null, self::VALID_STATUSES, true) ? $request['status'] : 'pending';
        $color = self::resolveColor($request['color'] ?? null);
        $stmt = $this->db->prepare(<<<SQL
            INSERT INTO "Releases" ("Id", "ProjectId", "Name", "Status", "OwnerId", "StartDate", "EndDate", "Color", "DateCreated", "DateLastModified")
            VALUES (:id, :pid, :name, :status, :ownerId, :start, :end, :color, now(), now())
        SQL);
        $stmt->execute([
            'id' => $id, 'pid' => $projectId, 'name' => $request['name'] ?? '', 'status' => $status,
            'ownerId' => $request['ownerId'] ?? null, 'start' => $request['startDate'] ?? null, 'end' => $request['endDate'] ?? null,
            'color' => $color,
        ]);

        return ['id' => $id, 'name' => $request['name'] ?? '', 'status' => $status, 'ownerId' => $request['ownerId'] ?? null, 'startDate' => $request['startDate'] ?? null, 'endDate' => $request['endDate'] ?? null, 'releaseNotes' => null, 'color' => $color];
    }

    public function update(string $projectId, string $releaseId, array $request): ?array
    {
        $stmt = $this->db->prepare('SELECT "ReleaseNotes" FROM "Releases" WHERE "Id" = :id AND "ProjectId" = :pid');
        $stmt->execute(['id' => $releaseId, 'pid' => $projectId]);
        $existing = $stmt->fetch();
        if ($existing === false) {
            return null;
        }

        $status = in_array($request['status'] ?? null, self::VALID_STATUSES, true) ? $request['status'] : 'pending';
        $color = self::resolveColor($request['color'] ?? null);
        $stmt = $this->db->prepare(<<<SQL
            UPDATE "Releases" SET "Name" = :name, "Status" = :status, "OwnerId" = :ownerId,
                "StartDate" = :start, "EndDate" = :end, "Color" = :color, "DateLastModified" = now()
            WHERE "Id" = :id
        SQL);
        $stmt->execute([
            'name' => $request['name'] ?? '', 'status' => $status, 'ownerId' => $request['ownerId'] ?? null,
            'start' => $request['startDate'] ?? null, 'end' => $request['endDate'] ?? null, 'color' => $color, 'id' => $releaseId,
        ]);

        return ['id' => $releaseId, 'name' => $request['name'] ?? '', 'status' => $status, 'ownerId' => $request['ownerId'] ?? null, 'startDate' => $request['startDate'] ?? null, 'endDate' => $request['endDate'] ?? null, 'releaseNotes' => $existing['ReleaseNotes'], 'color' => $color];
    }

    /** The ONLY write path for ReleaseNotes — gated by the controller's own ProjectAdminMiddleware
     * sub-group, never via create()/update() above (see root CLAUDE.md §7's
     * "one-endpoint-owns-the-field" convention). */
    public function updateNotes(string $projectId, string $releaseId, ?string $releaseNotes): ?array
    {
        $stmt = $this->db->prepare('SELECT "Id", "Name", "Status", "OwnerId", "StartDate", "EndDate", "Color" FROM "Releases" WHERE "Id" = :id AND "ProjectId" = :pid');
        $stmt->execute(['id' => $releaseId, 'pid' => $projectId]);
        $row = $stmt->fetch();
        if ($row === false) {
            return null;
        }

        $update = $this->db->prepare('UPDATE "Releases" SET "ReleaseNotes" = :notes, "DateLastModified" = now() WHERE "Id" = :id');
        $update->execute(['notes' => $releaseNotes, 'id' => $releaseId]);

        return [
            'id' => $row['Id'], 'name' => $row['Name'], 'status' => $row['Status'], 'ownerId' => $row['OwnerId'],
            'startDate' => $row['StartDate'], 'endDate' => $row['EndDate'], 'releaseNotes' => $releaseNotes,
            'color' => $row['Color'],
        ];
    }

    public function delete(string $projectId, string $releaseId): bool
    {
        // Tasks.ReleaseId is already SetNull, so removing the row is enough — no explicit unassign
        // loop needed, mirrors mutations.js's deleteRelease.
        $stmt = $this->db->prepare('DELETE FROM "Releases" WHERE "Id" = :id AND "ProjectId" = :pid');
        $stmt->execute(['id' => $releaseId, 'pid' => $projectId]);
        return $stmt->rowCount() > 0;
    }

    /** Falls back to the default grey for anything not a plain #rgb/#rrggbb hex string — same
     * "invalid input collapses to the safe default" convention as every other defensively-parsed
     * field in this app (root CLAUDE.md §1). */
    private static function resolveColor(?string $color): string
    {
        return $color !== null && preg_match('/^#[0-9a-fA-F]{3}([0-9a-fA-F]{3})?$/', $color) === 1 ? $color : '#cccccc';
    }
}
