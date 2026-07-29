<?php

declare(strict_types=1);

namespace Enkl\Api\Services;

use Enkl\Api\Support\Uuid;
use PDO;

/**
 * Ported from Services/FormService.cs. One row per FORM VERSION — no separate parent "Form" table
 * (see that file's own doc comment for why). Org-Admin-only authoring; the read-only/published-list
 * surface for project members is ProjectFormsController instead. Phase 1: bare CRUD on a single
 * Draft row. Phase 3 (this pass): versioning — clone the latest version into a new Draft, publish a
 * Draft (demoting whichever version was previously Published to Archived). The Workflow builder
 * (Phase 4) lands in a later pass, on top of this same table/service.
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

    /** Every version of one form, oldest-to-newest — the version-history list a "New version from
     * this one" / publish UI is built from. */
    public function listVersions(string $organisationId, string $formGroupId): ?array
    {
        $stmt = $this->db->prepare('SELECT * FROM "Forms" WHERE "OrganisationId" = :orgId AND "FormGroupId" = :formGroupId ORDER BY "VersionNumber" ASC');
        $stmt->execute(['orgId' => $organisationId, 'formGroupId' => $formGroupId]);
        $rows = $stmt->fetchAll();
        if (count($rows) === 0) {
            return null;
        }
        return array_map(static fn(array $f) => [
            'id' => $f['Id'], 'versionNumber' => (int) $f['VersionNumber'], 'status' => $f['Status'],
            'dateCreated' => $f['DateCreated'], 'dateLastModified' => $f['DateLastModified'], 'publishedAt' => $f['PublishedAt'],
        ], $rows);
    }

    /** Clones the latest version of a form (by VersionNumber, regardless of its own Status) into a
     * brand-new Draft row — a plain deep copy of FieldsJson/WorkflowJson with the SAME field/node
     * ids preserved (no id-remap needed, see FormService.cs's own doc comment on CloneAsync for
     * why this differs from the Board-Column Workflow's clone). */
    public function clone(string $organisationId, string $formGroupId, string $callerUserId): ?array
    {
        $stmt = $this->db->prepare('SELECT * FROM "Forms" WHERE "OrganisationId" = :orgId AND "FormGroupId" = :formGroupId ORDER BY "VersionNumber" DESC LIMIT 1');
        $stmt->execute(['orgId' => $organisationId, 'formGroupId' => $formGroupId]);
        $latest = $stmt->fetch();
        if ($latest === false) {
            return null;
        }

        $newId = Uuid::v4();
        $stmt = $this->db->prepare(<<<SQL
            INSERT INTO "Forms" ("Id", "OrganisationId", "FormGroupId", "Name", "Description", "VersionNumber", "Status", "FieldsJson", "WorkflowJson", "CreatedByUserId", "DateCreated", "DateLastModified")
            VALUES (:id, :orgId, :formGroupId, :name, :description, :versionNumber, 'draft', :fieldsJson, :workflowJson, :createdBy, now(), now())
        SQL);
        $stmt->execute([
            'id' => $newId, 'orgId' => $organisationId, 'formGroupId' => $formGroupId,
            'name' => $latest['Name'], 'description' => $latest['Description'],
            'versionNumber' => ((int) $latest['VersionNumber']) + 1,
            'fieldsJson' => $latest['FieldsJson'], 'workflowJson' => $latest['WorkflowJson'],
            'createdBy' => $callerUserId,
        ]);

        return $this->get($organisationId, $newId);
    }

    /** Publishes a Draft version, demoting whichever OTHER version of the same FormGroupId is
     * currently Published to Archived, inside one transaction — same "one endpoint owns the flag"
     * shape as StrategyService::activate. */
    public function publish(string $organisationId, string $formId): ?array
    {
        $stmt = $this->db->prepare('SELECT "FormGroupId", "Status" FROM "Forms" WHERE "Id" = :id AND "OrganisationId" = :orgId');
        $stmt->execute(['id' => $formId, 'orgId' => $organisationId]);
        $row = $stmt->fetch();
        if ($row === false || $row['Status'] !== 'draft') {
            return null;
        }

        $this->db->beginTransaction();
        try {
            $this->db->prepare('UPDATE "Forms" SET "Status" = \'archived\' WHERE "OrganisationId" = :orgId AND "FormGroupId" = :formGroupId AND "Status" = \'published\'')
                ->execute(['orgId' => $organisationId, 'formGroupId' => $row['FormGroupId']]);
            $this->db->prepare('UPDATE "Forms" SET "Status" = \'published\', "PublishedAt" = now(), "DateLastModified" = now() WHERE "Id" = :id')
                ->execute(['id' => $formId]);
            $this->db->commit();
        } catch (\Throwable $e) {
            if ($this->db->inTransaction()) {
                $this->db->rollBack();
            }
            throw $e;
        }

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
