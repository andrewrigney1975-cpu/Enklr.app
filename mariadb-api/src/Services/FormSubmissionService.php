<?php

declare(strict_types=1);

namespace Enkl\Api\Services;

use Enkl\Api\Support\Uuid;
use PDO;

/**
 * Ported from php-api/src/Services/FormSubmissionService.php (itself ported from
 * Services/FormSubmissionService.cs). Project-member-facing Draft management for Form submissions —
 * single table for every form type. Phase 1 scope: create/edit/delete a Draft only — Submit is
 * Phase 4/5. No dialect divergence from the Postgres tier.
 */
final class FormSubmissionService
{
    public function __construct(private readonly PDO $db)
    {
    }

    public function listMine(string $projectId, string $callerUserId): array
    {
        $stmt = $this->db->prepare('SELECT * FROM "FormSubmissions" WHERE "ProjectId" = :pid AND "SubmittedByUserId" = :uid ORDER BY "DateLastModified" DESC');
        $stmt->execute(['pid' => $projectId, 'uid' => $callerUserId]);
        return array_map([self::class, 'toDto'], $stmt->fetchAll());
    }

    public function get(string $projectId, string $callerUserId, string $submissionId): ?array
    {
        $stmt = $this->db->prepare('SELECT * FROM "FormSubmissions" WHERE "Id" = :id AND "ProjectId" = :pid AND "SubmittedByUserId" = :uid');
        $stmt->execute(['id' => $submissionId, 'pid' => $projectId, 'uid' => $callerUserId]);
        $row = $stmt->fetch();
        return $row !== false ? self::toDto($row) : null;
    }

    /** Null return covers two cases identically (no enumeration oracle between "no such form" and
     * "that form isn't published") — a submission can only ever be started against a currently-
     * published version, never a Draft or Archived one. */
    public function create(string $projectId, string $callerUserId, array $request): ?array
    {
        $formVersionId = (string) ($request['formVersionId'] ?? '');
        $stmt = $this->db->prepare('SELECT 1 FROM "Forms" WHERE "Id" = :id AND "Status" = \'published\'');
        $stmt->execute(['id' => $formVersionId]);
        if ($stmt->fetch() === false) {
            return null;
        }

        $submissionId = Uuid::v4();
        $stmt = $this->db->prepare(<<<SQL
            INSERT INTO "FormSubmissions" ("Id", "FormVersionId", "ProjectId", "SubmittedByUserId", "Status", "AnswersJson", "DateCreated", "DateLastModified")
            VALUES (:id, :formVersionId, :pid, :uid, 'draft', :answersJson, now(), now())
        SQL);
        $stmt->execute([
            'id' => $submissionId, 'formVersionId' => $formVersionId, 'pid' => $projectId, 'uid' => $callerUserId,
            'answersJson' => $request['answersJson'] ?? null,
        ]);

        return $this->get($projectId, $callerUserId, $submissionId);
    }

    public function update(string $projectId, string $callerUserId, string $submissionId, array $request): ?array
    {
        $stmt = $this->db->prepare('SELECT "Status" FROM "FormSubmissions" WHERE "Id" = :id AND "ProjectId" = :pid AND "SubmittedByUserId" = :uid');
        $stmt->execute(['id' => $submissionId, 'pid' => $projectId, 'uid' => $callerUserId]);
        $row = $stmt->fetch();
        if ($row === false) {
            return null;
        }
        // Once submitted, only the workflow engine (Phase 4/5) may advance it further.
        if ($row['Status'] !== 'draft') {
            return null;
        }

        $stmt = $this->db->prepare('UPDATE "FormSubmissions" SET "AnswersJson" = :answersJson, "DateLastModified" = now() WHERE "Id" = :id');
        $stmt->execute(['answersJson' => $request['answersJson'] ?? null, 'id' => $submissionId]);

        return $this->get($projectId, $callerUserId, $submissionId);
    }

    public function delete(string $projectId, string $callerUserId, string $submissionId): bool
    {
        $stmt = $this->db->prepare('SELECT "Status" FROM "FormSubmissions" WHERE "Id" = :id AND "ProjectId" = :pid AND "SubmittedByUserId" = :uid');
        $stmt->execute(['id' => $submissionId, 'pid' => $projectId, 'uid' => $callerUserId]);
        $row = $stmt->fetch();
        if ($row === false || $row['Status'] !== 'draft') {
            return false;
        }

        $this->db->prepare('DELETE FROM "FormSubmissions" WHERE "Id" = :id')->execute(['id' => $submissionId]);
        return true;
    }

    private static function toDto(array $s): array
    {
        return [
            'id' => $s['Id'], 'formVersionId' => $s['FormVersionId'], 'projectId' => $s['ProjectId'],
            'submittedByUserId' => $s['SubmittedByUserId'], 'status' => $s['Status'], 'currentNodeId' => $s['CurrentNodeId'],
            'answersJson' => $s['AnswersJson'], 'approvalTrailJson' => $s['ApprovalTrailJson'],
            'dateCreated' => $s['DateCreated'], 'dateLastModified' => $s['DateLastModified'], 'dateSubmitted' => $s['DateSubmitted'],
        ];
    }
}
