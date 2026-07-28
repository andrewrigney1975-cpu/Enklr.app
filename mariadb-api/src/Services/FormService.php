<?php

declare(strict_types=1);

namespace Enkl\Api\Services;

use Enkl\Api\Support\Uuid;
use PDO;

/**
 * Ported from php-api/src/Services/FormService.php (itself ported from Services/FormService.cs).
 * One row per FORM VERSION — no separate parent "Form" table. Org-Admin-only authoring; the
 * read-only/published-list surface for project members is ProjectFormsController instead. Phase 1
 * scope: bare CRUD on a single Draft row — publish/clone-into-new-version (Phase 3) and the
 * Workflow builder (Phase 4) land in later passes, on top of this same table/service. No dialect
 * divergence from the Postgres tier — every statement here is plain ANSI SQL.
 */
final class FormService
{
    public function __construct(private readonly PDO $db)
    {
    }

    public function list(string $organisationId): array
    {
        $stmt = $this->db->prepare('SELECT * FROM "Forms" WHERE "OrganisationId" = :orgId ORDER BY "DateLastModified" DESC');
        $stmt->execute(['orgId' => $organisationId]);
        return array_map([self::class, 'toDto'], $stmt->fetchAll());
    }

    public function get(string $organisationId, string $formId): ?array
    {
        $stmt = $this->db->prepare('SELECT * FROM "Forms" WHERE "Id" = :id AND "OrganisationId" = :orgId');
        $stmt->execute(['id' => $formId, 'orgId' => $organisationId]);
        $row = $stmt->fetch();
        return $row !== false ? self::toDto($row) : null;
    }

    /** Every published Form version in this org — the set a project member is offered to fill out
     * (ProjectFormsController), regardless of which specific project they're in. Forms are org-scoped,
     * not project-scoped; the per-project gate is purely the "forms" App Setting, not a per-form
     * per-project opt-in. */
    public function listPublished(string $organisationId): array
    {
        $stmt = $this->db->prepare('SELECT * FROM "Forms" WHERE "OrganisationId" = :orgId AND "Status" = \'published\' ORDER BY "Name"');
        $stmt->execute(['orgId' => $organisationId]);
        return array_map([self::class, 'toDto'], $stmt->fetchAll());
    }

    public function create(string $organisationId, string $callerUserId, array $request): array
    {
        $name = trim((string) ($request['name'] ?? ''));
        if ($name === '') {
            $name = 'Untitled Form';
        }
        if (strlen($name) > 200) {
            $name = substr($name, 0, 200);
        }

        $formId = Uuid::v4();
        $formGroupId = Uuid::v4();
        $stmt = $this->db->prepare(<<<SQL
            INSERT INTO "Forms" ("Id", "OrganisationId", "FormGroupId", "Name", "Description", "VersionNumber", "Status", "FieldsJson", "CreatedByUserId", "DateCreated", "DateLastModified")
            VALUES (:id, :orgId, :formGroupId, :name, :description, 1, 'draft', :fieldsJson, :createdBy, now(), now())
        SQL);
        $stmt->execute([
            'id' => $formId, 'orgId' => $organisationId, 'formGroupId' => $formGroupId, 'name' => $name,
            'description' => $request['description'] ?? null, 'fieldsJson' => $request['fieldsJson'] ?? null,
            'createdBy' => $callerUserId,
        ]);

        return $this->get($organisationId, $formId) ?? [
            'id' => $formId, 'formGroupId' => $formGroupId, 'name' => $name, 'description' => $request['description'] ?? null,
            'versionNumber' => 1, 'status' => 'draft', 'fieldsJson' => $request['fieldsJson'] ?? null, 'workflowJson' => null,
            'dateCreated' => null, 'dateLastModified' => null, 'publishedAt' => null,
        ];
    }

    public function update(string $organisationId, string $formId, array $request): ?array
    {
        $stmt = $this->db->prepare('SELECT "Status" FROM "Forms" WHERE "Id" = :id AND "OrganisationId" = :orgId');
        $stmt->execute(['id' => $formId, 'orgId' => $organisationId]);
        $row = $stmt->fetch();
        if ($row === false) {
            return null;
        }
        // Only a Draft version may be edited in place — a Published version is what's actually live
        // for members to fill out, and an Archived one is historical.
        if ($row['Status'] !== 'draft') {
            return null;
        }

        $name = trim((string) ($request['name'] ?? ''));
        if ($name === '') {
            return null;
        }
        if (strlen($name) > 200) {
            $name = substr($name, 0, 200);
        }

        $stmt = $this->db->prepare(<<<SQL
            UPDATE "Forms" SET "Name" = :name, "Description" = :description, "FieldsJson" = :fieldsJson,
                "WorkflowJson" = :workflowJson, "DateLastModified" = now()
            WHERE "Id" = :id
        SQL);
        $stmt->execute([
            'name' => $name, 'description' => $request['description'] ?? null,
            'fieldsJson' => $request['fieldsJson'] ?? null, 'workflowJson' => $request['workflowJson'] ?? null,
            'id' => $formId,
        ]);

        return $this->get($organisationId, $formId);
    }

    public function delete(string $organisationId, string $formId): bool
    {
        $stmt = $this->db->prepare('SELECT "Status" FROM "Forms" WHERE "Id" = :id AND "OrganisationId" = :orgId');
        $stmt->execute(['id' => $formId, 'orgId' => $organisationId]);
        $row = $stmt->fetch();
        if ($row === false) {
            return false;
        }
        // Published/Archived versions may have real submissions against them (FormSubmissions.
        // FormVersionId is a Restrict FK) — reject here with a clear result rather than letting the
        // DB constraint violation surface as an unhandled error.
        if ($row['Status'] !== 'draft') {
            return false;
        }

        $this->db->prepare('DELETE FROM "Forms" WHERE "Id" = :id')->execute(['id' => $formId]);
        return true;
    }

    private static function toDto(array $f): array
    {
        return [
            'id' => $f['Id'], 'formGroupId' => $f['FormGroupId'], 'name' => $f['Name'], 'description' => $f['Description'],
            'versionNumber' => (int) $f['VersionNumber'], 'status' => $f['Status'],
            'fieldsJson' => $f['FieldsJson'], 'workflowJson' => $f['WorkflowJson'],
            'dateCreated' => $f['DateCreated'], 'dateLastModified' => $f['DateLastModified'], 'publishedAt' => $f['PublishedAt'],
        ];
    }
}
