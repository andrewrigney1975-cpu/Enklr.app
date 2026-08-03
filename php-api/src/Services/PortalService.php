<?php

declare(strict_types=1);

namespace Enkl\Api\Services;

use Enkl\Api\Support\MemberPalette;
use Enkl\Api\Support\Uuid;
use PDO;

/**
 * Ported from Services/PortalService.cs. Backs Org-Admin authoring of Organisational Portals —
 * gated by OrgAdminMiddleware only (see routes.php), same cross-org isolation stance as
 * PortfolioService: every id a client supplies is independently re-validated against the caller's
 * own organisation id before anything is touched.
 */
final class PortalService
{
    private const PRIORITY_COLUMN_NAMES = ['Trivial', 'Low', 'Medium', 'High', 'Critical'];
    // Provisioned right after the 5 priority columns (Order 5-7) — status-tracking columns for the
    // actioner Project's own lifecycle, not priority-named, so they never collide with
    // executeActionNode's priority-field-driven column matching (only ever matches the 5 known
    // priority keys). "Completed"/"Abandoned" are both terminal (Done = true); "On Hold" stays
    // Done = false — a paused task is still active work, just not currently being worked.
    private const LIFECYCLE_COLUMNS = [['name' => 'On Hold', 'done' => 0], ['name' => 'Completed', 'done' => 1], ['name' => 'Abandoned', 'done' => 1]];

    public function __construct(private readonly PDO $db)
    {
    }

    public function list(string $organisationId): array
    {
        $stmt = $this->db->prepare('SELECT * FROM "Portals" WHERE "OrganisationId" = :orgId ORDER BY "Name"');
        $stmt->execute(['orgId' => $organisationId]);
        return array_map([self::class, 'toDto'], $stmt->fetchAll());
    }

    public function get(string $organisationId, string $portalId): ?array
    {
        $stmt = $this->db->prepare('SELECT * FROM "Portals" WHERE "Id" = :id AND "OrganisationId" = :orgId');
        $stmt->execute(['id' => $portalId, 'orgId' => $organisationId]);
        $row = $stmt->fetch();
        return $row === false ? null : self::toDto($row);
    }

    /**
     * Provisions a dedicated, membership-free actioner Project (via PortfolioService::createProject
     * — the same "OrgAdmin sketching something out isn't necessarily a member of it" reasoning that
     * method's own doc comment already gives) with 5 fixed priority columns (Trivial..Critical,
     * left-to-right via Order) followed by 3 fixed lifecycle columns (On Hold, Completed, Abandoned
     * — see LIFECYCLE_COLUMNS' own doc comment), then the Portal row referencing it — all wrapped in
     * one transaction
     * per this tier's standing convention (php-api/CLAUDE.md) for a service method that calls
     * another service's committing method, then writes again itself.
     */
    public function create(string $organisationId, string $callerUserId, array $request): array
    {
        $name = trim((string) ($request['name'] ?? ''));
        if ($name === '') {
            $name = 'Untitled Portal';
        }
        $baseSlug = PortalSlugResolver::deriveSlug($request['slug'] ?? null, $name);
        $uniqueSlug = PortalSlugResolver::resolveUniqueSlug($this->db, $baseSlug, $organisationId);

        $this->db->beginTransaction();
        try {
            $portfolio = new PortfolioService($this->db);
            $project = $portfolio->createProject($organisationId, ['name' => "{$name} (Portal)", 'priority' => 'medium']);

            $colStmt = $this->db->prepare(
                'INSERT INTO "Columns" ("Id", "ProjectId", "Name", "Done", "Order") VALUES (:id, :pid, :name, :done, :order)'
            );
            foreach (self::PRIORITY_COLUMN_NAMES as $i => $colName) {
                $colStmt->execute(['id' => Uuid::v4(), 'pid' => $project['id'], 'name' => $colName, 'done' => 0, 'order' => $i]);
            }
            foreach (self::LIFECYCLE_COLUMNS as $i => $col) {
                $colStmt->execute(['id' => Uuid::v4(), 'pid' => $project['id'], 'name' => $col['name'], 'done' => $col['done'], 'order' => count(self::PRIORITY_COLUMN_NAMES) + $i]);
            }

            // Every current Org Admin is auto-added as a Project Admin of the actioner Project — it's
            // membership-free by design (no ordinary org user should have to "join" it just to submit
            // a form through the Portal), but SOMEONE has to be able to open it, manage which
            // analysts/consultants can action raised tasks, and review/approve form submissions that
            // land there. A Portal's own Access grants govern who can use the Portal; this governs
            // who can administer its back-office project.
            $adminStmt = $this->db->prepare('SELECT "Id" FROM "Users" WHERE "OrganisationId" = :orgId AND "IsOrgAdmin" = true');
            $adminStmt->execute(['orgId' => $organisationId]);
            $orgAdminIds = array_column($adminStmt->fetchAll(), 'Id');
            $memberStmt = $this->db->prepare(
                'INSERT INTO "ProjectMembers" ("Id", "ProjectId", "UserId", "Color", "IsProjectAdmin") VALUES (:id, :pid, :uid, :color, true)'
            );
            foreach ($orgAdminIds as $i => $adminUserId) {
                $memberStmt->execute(['id' => Uuid::v4(), 'pid' => $project['id'], 'uid' => $adminUserId, 'color' => MemberPalette::colorForIndex($i)]);
            }

            $portalId = Uuid::v4();
            $stmt = $this->db->prepare(<<<SQL
                INSERT INTO "Portals" ("Id", "OrganisationId", "Name", "Slug", "Description", "IconName", "Status", "ProjectId", "CreatedByUserId", "DateCreated", "DateLastModified")
                VALUES (:id, :orgId, :name, :slug, :description, :iconName, 'draft', :projectId, :createdBy, now(), now())
            SQL);
            $stmt->execute([
                'id' => $portalId, 'orgId' => $organisationId, 'name' => $name, 'slug' => $uniqueSlug,
                'description' => $request['description'] ?? null, 'iconName' => $request['iconName'] ?? null,
                'projectId' => $project['id'], 'createdBy' => $callerUserId,
            ]);

            $this->db->commit();
        } catch (\Throwable $e) {
            if ($this->db->inTransaction()) {
                $this->db->rollBack();
            }
            throw $e;
        }

        return $this->get($organisationId, $portalId);
    }

    public function update(string $organisationId, string $portalId, array $request): ?array
    {
        $existing = $this->get($organisationId, $portalId);
        if ($existing === null) {
            return null;
        }

        $name = trim((string) ($request['name'] ?? ''));
        if ($name === '') {
            $name = $existing['name'];
        }

        $slug = $existing['slug'];
        if (!empty($request['slug']) || $name !== $existing['name']) {
            $baseSlug = PortalSlugResolver::deriveSlug($request['slug'] ?? null, $name);
            $slug = PortalSlugResolver::resolveUniqueSlug($this->db, $baseSlug, $organisationId, $portalId);
        }

        $stmt = $this->db->prepare(
            'UPDATE "Portals" SET "Name" = :name, "Slug" = :slug, "Description" = :description, "IconName" = :iconName, "DateLastModified" = now() WHERE "Id" = :id'
        );
        $stmt->execute(['name' => $name, 'slug' => $slug, 'description' => $request['description'] ?? null, 'iconName' => $request['iconName'] ?? null, 'id' => $portalId]);

        return $this->get($organisationId, $portalId);
    }

    public function publish(string $organisationId, string $portalId): ?array
    {
        if ($this->get($organisationId, $portalId) === null) {
            return null;
        }
        $stmt = $this->db->prepare(
            'UPDATE "Portals" SET "Status" = \'published\', "PublishedAt" = COALESCE("PublishedAt", now()), "DateLastModified" = now() WHERE "Id" = :id'
        );
        $stmt->execute(['id' => $portalId]);
        return $this->get($organisationId, $portalId);
    }

    public function archive(string $organisationId, string $portalId): ?array
    {
        if ($this->get($organisationId, $portalId) === null) {
            return null;
        }
        $stmt = $this->db->prepare('UPDATE "Portals" SET "Status" = \'archived\', "DateLastModified" = now() WHERE "Id" = :id');
        $stmt->execute(['id' => $portalId]);
        return $this->get($organisationId, $portalId);
    }

    /** Removes the Portal (cascades to its access grants/forms/topics/Q&A entries) but deliberately
     * leaves its actioner Project untouched. */
    public function delete(string $organisationId, string $portalId): bool
    {
        $stmt = $this->db->prepare('DELETE FROM "Portals" WHERE "Id" = :id AND "OrganisationId" = :orgId');
        $stmt->execute(['id' => $portalId, 'orgId' => $organisationId]);
        return $stmt->rowCount() > 0;
    }

    // ---- Access grants ----

    public function listAccessGrants(string $organisationId, string $portalId): ?array
    {
        if (!$this->ownsPortal($organisationId, $portalId)) {
            return null;
        }
        $stmt = $this->db->prepare('SELECT * FROM "PortalAccessGrants" WHERE "PortalId" = :portalId ORDER BY "DateCreated"');
        $stmt->execute(['portalId' => $portalId]);
        return array_map(static fn(array $g): array => [
            'id' => $g['Id'], 'kind' => $g['Kind'], 'value' => $g['Value'], 'dateCreated' => $g['DateCreated'],
        ], $stmt->fetchAll());
    }

    public function addAccessGrant(string $organisationId, string $portalId, array $request): ?array
    {
        if (!$this->ownsPortal($organisationId, $portalId)) {
            return null;
        }
        $kind = (string) ($request['kind'] ?? '');
        $value = (string) ($request['value'] ?? '');

        $targetValid = match ($kind) {
            'namedUser' => $this->exists('SELECT 1 FROM "Users" WHERE "Id" = :id AND "OrganisationId" = :orgId', $value, $organisationId),
            'orgTeam' => $this->exists('SELECT 1 FROM "OrgTeams" WHERE "Id" = :id AND "OrganisationId" = :orgId', $value, $organisationId),
            'teamCommittee' => $this->exists(
                'SELECT 1 FROM "TeamsCommittees" tc JOIN "Projects" p ON p."Id" = tc."ProjectId" WHERE tc."Id" = :id AND p."OrganisationId" = :orgId',
                $value, $organisationId
            ),
            // No specific target to validate — every current and future member of the caller's own
            // org is the target, by definition.
            'allOrgMembers' => true,
            default => false,
        };
        if (!$targetValid) {
            return null;
        }

        // The client-supplied value is irrelevant/ignored for this kind; forced to organisationId
        // itself so there's exactly one deterministic row per Portal (the existing
        // PortalId+Kind+Value unique index still dedupes it).
        $effectiveValue = $kind === 'allOrgMembers' ? $organisationId : $value;

        $stmt = $this->db->prepare('SELECT "Id", "DateCreated" FROM "PortalAccessGrants" WHERE "PortalId" = :portalId AND "Kind" = :kind AND "Value" = :value');
        $stmt->execute(['portalId' => $portalId, 'kind' => $kind, 'value' => $effectiveValue]);
        $existing = $stmt->fetch();
        if ($existing !== false) {
            return ['id' => $existing['Id'], 'kind' => $kind, 'value' => $effectiveValue, 'dateCreated' => $existing['DateCreated']];
        }

        $grantId = Uuid::v4();
        $insert = $this->db->prepare(
            'INSERT INTO "PortalAccessGrants" ("Id", "PortalId", "Kind", "Value", "DateCreated") VALUES (:id, :portalId, :kind, :value, now())'
        );
        $insert->execute(['id' => $grantId, 'portalId' => $portalId, 'kind' => $kind, 'value' => $effectiveValue]);

        $dateStmt = $this->db->prepare('SELECT "DateCreated" FROM "PortalAccessGrants" WHERE "Id" = :id');
        $dateStmt->execute(['id' => $grantId]);
        $dateCreated = $dateStmt->fetchColumn();

        return ['id' => $grantId, 'kind' => $kind, 'value' => $effectiveValue, 'dateCreated' => $dateCreated];
    }

    public function removeAccessGrant(string $organisationId, string $portalId, string $grantId): bool
    {
        if (!$this->ownsPortal($organisationId, $portalId)) {
            return false;
        }
        $stmt = $this->db->prepare('DELETE FROM "PortalAccessGrants" WHERE "Id" = :id AND "PortalId" = :portalId');
        $stmt->execute(['id' => $grantId, 'portalId' => $portalId]);
        return $stmt->rowCount() > 0;
    }

    public function previewUserHasAccess(string $portalId, string $userId): bool
    {
        return (new PortalAccessService($this->db))->userHasPortalAccess($portalId, $userId);
    }

    // ---- Forms ----

    public function listAttachedForms(string $organisationId, string $portalId): ?array
    {
        if (!$this->ownsPortal($organisationId, $portalId)) {
            return null;
        }
        $stmt = $this->db->prepare('SELECT * FROM "PortalForms" WHERE "PortalId" = :portalId ORDER BY "Order"');
        $stmt->execute(['portalId' => $portalId]);
        return $this->resolvePortalFormDtos($stmt->fetchAll());
    }

    /** Re-validates FormGroupId resolves to a currently-published Form belonging to the caller's own
     * org before attaching it — Forms itself is untouched by this table. */
    public function attachForm(string $organisationId, string $portalId, array $request): ?array
    {
        if (!$this->ownsPortal($organisationId, $portalId)) {
            return null;
        }
        $formGroupId = (string) ($request['formGroupId'] ?? '');
        $order = (int) ($request['order'] ?? 0);

        $formStmt = $this->db->prepare('SELECT "Id", "Name", "Status", "FieldsJson" FROM "Forms" WHERE "FormGroupId" = :groupId AND "OrganisationId" = :orgId AND "Status" = \'published\'');
        $formStmt->execute(['groupId' => $formGroupId, 'orgId' => $organisationId]);
        $form = $formStmt->fetch();
        if ($form === false) {
            return null;
        }

        $existingStmt = $this->db->prepare('SELECT "Id" FROM "PortalForms" WHERE "PortalId" = :portalId AND "FormGroupId" = :groupId');
        $existingStmt->execute(['portalId' => $portalId, 'groupId' => $formGroupId]);
        $existingId = $existingStmt->fetchColumn();

        if ($existingId !== false) {
            $this->db->prepare('UPDATE "PortalForms" SET "Order" = :order WHERE "Id" = :id')->execute(['order' => $order, 'id' => $existingId]);
            return ['id' => $existingId, 'formGroupId' => $formGroupId, 'order' => $order, 'formName' => $form['Name'], 'formStatus' => $form['Status'], 'fieldsJson' => $form['FieldsJson'], 'formVersionId' => $form['Id']];
        }

        $portalFormId = Uuid::v4();
        $insert = $this->db->prepare(
            'INSERT INTO "PortalForms" ("Id", "PortalId", "FormGroupId", "Order", "DateCreated") VALUES (:id, :portalId, :groupId, :order, now())'
        );
        $insert->execute(['id' => $portalFormId, 'portalId' => $portalId, 'groupId' => $formGroupId, 'order' => $order]);

        return ['id' => $portalFormId, 'formGroupId' => $formGroupId, 'order' => $order, 'formName' => $form['Name'], 'formStatus' => $form['Status'], 'fieldsJson' => $form['FieldsJson'], 'formVersionId' => $form['Id']];
    }

    public function detachForm(string $organisationId, string $portalId, string $portalFormId): bool
    {
        if (!$this->ownsPortal($organisationId, $portalId)) {
            return false;
        }
        $stmt = $this->db->prepare('DELETE FROM "PortalForms" WHERE "Id" = :id AND "PortalId" = :portalId');
        $stmt->execute(['id' => $portalFormId, 'portalId' => $portalId]);
        return $stmt->rowCount() > 0;
    }

    public function resolvePortalFormDtos(array $portalForms): array
    {
        if (count($portalForms) === 0) {
            return [];
        }
        $groupIds = array_column($portalForms, 'FormGroupId');
        $placeholders = implode(',', array_map(static fn($i) => ":g{$i}", array_keys($groupIds)));
        $stmt = $this->db->prepare("SELECT \"Id\", \"FormGroupId\", \"Name\", \"Status\", \"FieldsJson\" FROM \"Forms\" WHERE \"Status\" = 'published' AND \"FormGroupId\" IN ({$placeholders})");
        $params = [];
        foreach ($groupIds as $i => $id) {
            $params["g{$i}"] = $id;
        }
        $stmt->execute($params);
        $published = [];
        foreach ($stmt->fetchAll() as $f) {
            $published[$f['FormGroupId']] = $f;
        }

        return array_map(static function (array $f) use ($published): array {
            $form = $published[$f['FormGroupId']] ?? null;
            return [
                'id' => $f['Id'], 'formGroupId' => $f['FormGroupId'], 'order' => (int) $f['Order'],
                'formName' => $form['Name'] ?? null, 'formStatus' => $form['Status'] ?? null,
                'fieldsJson' => $form['FieldsJson'] ?? null, 'formVersionId' => $form['Id'] ?? null,
            ];
        }, $portalForms);
    }

    // ---- Q&A ----

    public function listTopics(string $organisationId, string $portalId): ?array
    {
        if (!$this->ownsPortal($organisationId, $portalId)) {
            return null;
        }
        $stmt = $this->db->prepare('SELECT * FROM "PortalTopics" WHERE "PortalId" = :portalId ORDER BY "Order"');
        $stmt->execute(['portalId' => $portalId]);
        return array_map(static fn(array $t): array => ['id' => $t['Id'], 'title' => $t['Title'], 'order' => (int) $t['Order']], $stmt->fetchAll());
    }

    public function createTopic(string $organisationId, string $portalId, array $request): ?array
    {
        if (!$this->ownsPortal($organisationId, $portalId)) {
            return null;
        }
        $topicId = Uuid::v4();
        $title = trim((string) ($request['title'] ?? ''));
        $order = (int) ($request['order'] ?? 0);
        $stmt = $this->db->prepare(
            'INSERT INTO "PortalTopics" ("Id", "PortalId", "Title", "Order", "DateCreated", "DateLastModified") VALUES (:id, :portalId, :title, :order, now(), now())'
        );
        $stmt->execute(['id' => $topicId, 'portalId' => $portalId, 'title' => $title, 'order' => $order]);
        return ['id' => $topicId, 'title' => $title, 'order' => $order];
    }

    public function updateTopic(string $organisationId, string $portalId, string $topicId, array $request): ?array
    {
        if (!$this->ownsPortal($organisationId, $portalId)) {
            return null;
        }
        $title = trim((string) ($request['title'] ?? ''));
        $order = (int) ($request['order'] ?? 0);
        $stmt = $this->db->prepare(
            'UPDATE "PortalTopics" SET "Title" = :title, "Order" = :order, "DateLastModified" = now() WHERE "Id" = :id AND "PortalId" = :portalId'
        );
        $stmt->execute(['title' => $title, 'order' => $order, 'id' => $topicId, 'portalId' => $portalId]);
        if ($stmt->rowCount() === 0) {
            return null;
        }
        return ['id' => $topicId, 'title' => $title, 'order' => $order];
    }

    public function deleteTopic(string $organisationId, string $portalId, string $topicId): bool
    {
        if (!$this->ownsPortal($organisationId, $portalId)) {
            return false;
        }
        $stmt = $this->db->prepare('DELETE FROM "PortalTopics" WHERE "Id" = :id AND "PortalId" = :portalId');
        $stmt->execute(['id' => $topicId, 'portalId' => $portalId]);
        return $stmt->rowCount() > 0;
    }

    /** Ported from PortalService.ReorderTopicAsync. Moves a Topic up/down among all of a Portal's
     * own topics — see applyReorder()'s own doc comment for the renumber-then-swap self-healing
     * this relies on. A Topic's own QaEntries are untouched by this — they stay tagged to this topic
     * via PortalTopicId regardless of the topic's Order, so they visually move WITH their topic for
     * free once the frontend groups entries under topics in topic-Order sequence. */
    public function reorderTopic(string $organisationId, string $portalId, string $topicId, string $direction): bool
    {
        if (!$this->ownsPortal($organisationId, $portalId)) {
            return false;
        }
        $stmt = $this->db->prepare('SELECT "Id" FROM "PortalTopics" WHERE "PortalId" = :portalId ORDER BY "Order", "DateCreated"');
        $stmt->execute(['portalId' => $portalId]);
        return $this->applyReorder(array_column($stmt->fetchAll(), 'Id'), $topicId, $direction, 'PortalTopics');
    }

    public function listQaEntries(string $organisationId, string $portalId): ?array
    {
        if (!$this->ownsPortal($organisationId, $portalId)) {
            return null;
        }
        $stmt = $this->db->prepare('SELECT * FROM "PortalQaEntries" WHERE "PortalId" = :portalId ORDER BY "Order"');
        $stmt->execute(['portalId' => $portalId]);
        return array_map([self::class, 'toQaEntryDto'], $stmt->fetchAll());
    }

    public function createQaEntry(string $organisationId, string $portalId, string $callerUserId, array $request): ?array
    {
        if (!$this->ownsPortal($organisationId, $portalId)) {
            return null;
        }
        $topicId = $request['portalTopicId'] ?? null;
        if ($topicId !== null && !$this->exists('SELECT 1 FROM "PortalTopics" WHERE "Id" = :id AND "PortalId" = :orgId', $topicId, $portalId)) {
            return null;
        }

        $entryId = Uuid::v4();
        $question = trim((string) ($request['question'] ?? ''));
        $answer = $request['answer'] ?? null;
        $order = (int) ($request['order'] ?? 0);
        $stmt = $this->db->prepare(<<<SQL
            INSERT INTO "PortalQaEntries" ("Id", "PortalId", "PortalTopicId", "Question", "Answer", "Order", "CreatedByUserId", "DateCreated", "DateLastModified")
            VALUES (:id, :portalId, :topicId, :question, :answer, :order, :createdBy, now(), now())
        SQL);
        $stmt->execute([
            'id' => $entryId, 'portalId' => $portalId, 'topicId' => $topicId, 'question' => $question,
            'answer' => $answer, 'order' => $order, 'createdBy' => $callerUserId,
        ]);
        return ['id' => $entryId, 'portalTopicId' => $topicId, 'question' => $question, 'answer' => $answer, 'order' => $order, 'nps' => 0];
    }

    public function updateQaEntry(string $organisationId, string $portalId, string $entryId, array $request): ?array
    {
        if (!$this->ownsPortal($organisationId, $portalId)) {
            return null;
        }
        $topicId = $request['portalTopicId'] ?? null;
        if ($topicId !== null && !$this->exists('SELECT 1 FROM "PortalTopics" WHERE "Id" = :id AND "PortalId" = :orgId', $topicId, $portalId)) {
            return null;
        }

        $question = trim((string) ($request['question'] ?? ''));
        $answer = $request['answer'] ?? null;
        $order = (int) ($request['order'] ?? 0);
        $stmt = $this->db->prepare(<<<SQL
            UPDATE "PortalQaEntries" SET "Question" = :question, "Answer" = :answer, "PortalTopicId" = :topicId, "Order" = :order, "DateLastModified" = now()
            WHERE "Id" = :id AND "PortalId" = :portalId
        SQL);
        $stmt->execute(['question' => $question, 'answer' => $answer, 'topicId' => $topicId, 'order' => $order, 'id' => $entryId, 'portalId' => $portalId]);
        if ($stmt->rowCount() === 0) {
            return null;
        }
        $npsStmt = $this->db->prepare('SELECT "Nps" FROM "PortalQaEntries" WHERE "Id" = :id');
        $npsStmt->execute(['id' => $entryId]);
        $nps = (int) $npsStmt->fetchColumn();
        return ['id' => $entryId, 'portalTopicId' => $topicId, 'question' => $question, 'answer' => $answer, 'order' => $order, 'nps' => $nps];
    }

    public function deleteQaEntry(string $organisationId, string $portalId, string $entryId): bool
    {
        if (!$this->ownsPortal($organisationId, $portalId)) {
            return false;
        }
        $stmt = $this->db->prepare('DELETE FROM "PortalQaEntries" WHERE "Id" = :id AND "PortalId" = :portalId');
        $stmt->execute(['id' => $entryId, 'portalId' => $portalId]);
        return $stmt->rowCount() > 0;
    }

    /** Ported from PortalService.ReorderQaEntryAsync. Moves an entry up/down among its own siblings
     * only — same PortalTopicId (including the ungrouped/null bucket) — matching how the admin Q&A
     * tab groups entries under topic headers; an entry never reorders across topics this way (moving
     * it to a different topic is what updateQaEntry's own portalTopicId field is for). */
    public function reorderQaEntry(string $organisationId, string $portalId, string $entryId, string $direction): bool
    {
        if (!$this->ownsPortal($organisationId, $portalId)) {
            return false;
        }
        $lookup = $this->db->prepare('SELECT "PortalTopicId" FROM "PortalQaEntries" WHERE "Id" = :id AND "PortalId" = :portalId');
        $lookup->execute(['id' => $entryId, 'portalId' => $portalId]);
        $row = $lookup->fetch();
        if ($row === false) {
            return false;
        }

        if ($row['PortalTopicId'] === null) {
            $stmt = $this->db->prepare('SELECT "Id" FROM "PortalQaEntries" WHERE "PortalId" = :portalId AND "PortalTopicId" IS NULL ORDER BY "Order", "DateCreated"');
            $stmt->execute(['portalId' => $portalId]);
        } else {
            $stmt = $this->db->prepare('SELECT "Id" FROM "PortalQaEntries" WHERE "PortalId" = :portalId AND "PortalTopicId" = :topicId ORDER BY "Order", "DateCreated"');
            $stmt->execute(['portalId' => $portalId, 'topicId' => $row['PortalTopicId']]);
        }
        return $this->applyReorder(array_column($stmt->fetchAll(), 'Id'), $entryId, $direction, 'PortalQaEntries');
    }

    /** Shared swap-with-neighbor logic for both reorder methods above — `$ids` must already be
     * sorted in the caller's intended current order. Renumbers every row to 0..n-1 first (so
     * stale/duplicate Order values from before this feature existed self-heal — new topics/entries
     * are always created with Order=0, see createTopic/createQaEntry above, unchanged by this
     * feature), then swaps the target with its "up"/"down" neighbor. Returns false without writing
     * anything if the target isn't in the list or is already at the edge in that direction — the
     * frontend already disables the button at the edges, so this is just a safety no-op, not a
     * user-facing error path. `$table` is always one of the two literal strings passed by this
     * class's own two call sites, never client-supplied — safe to interpolate directly since PDO
     * can't parameterize identifiers. */
    private function applyReorder(array $ids, string $targetId, string $direction, string $table): bool
    {
        $index = array_search($targetId, $ids, true);
        if ($index === false) {
            return false;
        }
        $swapIndex = $direction === 'up' ? $index - 1 : $index + 1;
        if ($swapIndex < 0 || $swapIndex >= count($ids)) {
            return false;
        }

        [$ids[$index], $ids[$swapIndex]] = [$ids[$swapIndex], $ids[$index]];

        $this->db->beginTransaction();
        try {
            $stmt = $this->db->prepare("UPDATE \"{$table}\" SET \"Order\" = :order, \"DateLastModified\" = now() WHERE \"Id\" = :id");
            foreach ($ids as $i => $id) {
                $stmt->execute(['order' => $i, 'id' => $id]);
            }
            $this->db->commit();
        } catch (\Throwable $e) {
            if ($this->db->inTransaction()) {
                $this->db->rollBack();
            }
            throw $e;
        }
        return true;
    }

    private function ownsPortal(string $organisationId, string $portalId): bool
    {
        return $this->exists('SELECT 1 FROM "Portals" WHERE "Id" = :id AND "OrganisationId" = :orgId', $portalId, $organisationId);
    }

    private function exists(string $sql, string $id, string $scopeId): bool
    {
        $stmt = $this->db->prepare($sql);
        $stmt->execute(['id' => $id, 'orgId' => $scopeId]);
        return $stmt->fetch() !== false;
    }

    // public, not private — reused directly by PortalHomeService::getBySlug.
    public static function toDto(array $p): array
    {
        return [
            'id' => $p['Id'], 'name' => $p['Name'], 'slug' => $p['Slug'], 'description' => $p['Description'],
            'iconName' => $p['IconName'], 'status' => $p['Status'], 'projectId' => $p['ProjectId'],
            'dateCreated' => $p['DateCreated'], 'dateLastModified' => $p['DateLastModified'], 'publishedAt' => $p['PublishedAt'],
        ];
    }

    private static function toQaEntryDto(array $e): array
    {
        return [
            'id' => $e['Id'], 'portalTopicId' => $e['PortalTopicId'], 'question' => $e['Question'],
            'answer' => $e['Answer'], 'order' => (int) $e['Order'], 'nps' => (int) $e['Nps'],
        ];
    }
}
