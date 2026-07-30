<?php

declare(strict_types=1);

namespace Enkl\Api\Services;

use PDO;

/**
 * Ported from php-api/src/Services/PortalHomeService.php (itself ported from
 * Services/PortalHomeService.cs). The end-user-facing side of Organisational Portals —
 * deliberately gated by RequireAuthMiddleware only (no ProjectMember/OrgAdmin middleware — see
 * routes.php), since a Portal must be reachable by an org user who belongs to zero projects. Every
 * method here re-derives BOTH that the Portal is published AND that the caller actually has access
 * (via PortalAccessService), never trusting a client-supplied portalId/slug alone — a foreign/
 * nonexistent/unpublished/inaccessible Portal all return null identically, matching this codebase's
 * no-enumeration-oracle rule. No dialect divergence from the Postgres tier anywhere in this file.
 */
final class PortalHomeService
{
    public function __construct(private readonly PDO $db)
    {
    }

    public function getBySlug(string $organisationId, string $slug, string $userId): ?array
    {
        $portal = $this->accessiblePortalBySlug($organisationId, $slug, $userId);
        return $portal === null ? null : PortalService::toDto($portal);
    }

    /** Backs the side nav's "Portals" section — every published Portal in the caller's own org
     * that this user actually has access to. A plain per-candidate loop, not a single set-based
     * query — fine at this feature's expected scale (an org's total Portal count). */
    public function listAccessible(string $organisationId, string $userId): array
    {
        $stmt = $this->db->prepare('SELECT "Id", "Name", "Slug", "IconName" FROM "Portals" WHERE "OrganisationId" = :orgId AND "Status" = \'published\' ORDER BY "Name"');
        $stmt->execute(['orgId' => $organisationId]);
        $candidates = $stmt->fetchAll();

        $access = new PortalAccessService($this->db);
        $result = [];
        foreach ($candidates as $p) {
            if ($access->userHasPortalAccess($p['Id'], $userId)) {
                $result[] = ['id' => $p['Id'], 'name' => $p['Name'], 'slug' => $p['Slug'], 'iconName' => $p['IconName']];
            }
        }
        return $result;
    }

    public function listAvailableForms(string $organisationId, string $portalId, string $userId): ?array
    {
        if ($this->accessiblePortal($organisationId, $portalId, $userId) === null) {
            return null;
        }
        $stmt = $this->db->prepare('SELECT * FROM "PortalForms" WHERE "PortalId" = :portalId ORDER BY "Order"');
        $stmt->execute(['portalId' => $portalId]);
        return (new PortalService($this->db))->resolvePortalFormDtos($stmt->fetchAll());
    }

    /** The user's own submissions against this Portal's actioner Project, filtered down to just the
     * forms actually attached to this Portal — a direct query rather than reusing
     * FormSubmissionService::listMine, since that method has no FormGroupId-based filter. */
    public function listMySubmissions(string $organisationId, string $portalId, string $userId): ?array
    {
        $portal = $this->accessiblePortal($organisationId, $portalId, $userId);
        if ($portal === null) {
            return null;
        }

        $groupStmt = $this->db->prepare('SELECT "FormGroupId" FROM "PortalForms" WHERE "PortalId" = :portalId');
        $groupStmt->execute(['portalId' => $portalId]);
        $groupIds = array_column($groupStmt->fetchAll(), 'FormGroupId');
        if (count($groupIds) === 0) {
            return [];
        }

        $placeholders = implode(',', array_map(static fn($i) => ":g{$i}", array_keys($groupIds)));
        $stmt = $this->db->prepare(<<<SQL
            SELECT s.*, f."Name" AS "FormName", f."VersionNumber" AS "FormVersionNumber", f."WorkflowJson" AS "FormWorkflowJson",
                   u."DisplayName" AS "SubmittedByDisplayName"
            FROM "FormSubmissions" s
            JOIN "Forms" f ON f."Id" = s."FormVersionId"
            JOIN "Users" u ON u."Id" = s."SubmittedByUserId"
            WHERE s."ProjectId" = :pid AND s."SubmittedByUserId" = :uid AND f."FormGroupId" IN ({$placeholders})
            ORDER BY s."DateLastModified" DESC
        SQL);
        $params = ['pid' => $portal['ProjectId'], 'uid' => $userId];
        foreach ($groupIds as $i => $id) {
            $params["g{$i}"] = $id;
        }
        $stmt->execute($params);
        return array_map([FormSubmissionService::class, 'toListItemDto'], $stmt->fetchAll());
    }

    public function listQa(string $organisationId, string $portalId, string $userId): ?array
    {
        if ($this->accessiblePortal($organisationId, $portalId, $userId) === null) {
            return null;
        }

        $topicStmt = $this->db->prepare('SELECT * FROM "PortalTopics" WHERE "PortalId" = :portalId ORDER BY "Order"');
        $topicStmt->execute(['portalId' => $portalId]);
        $topics = array_map(static fn(array $t): array => ['id' => $t['Id'], 'title' => $t['Title'], 'order' => (int) $t['Order']], $topicStmt->fetchAll());

        $entryStmt = $this->db->prepare('SELECT * FROM "PortalQaEntries" WHERE "PortalId" = :portalId ORDER BY "Order"');
        $entryStmt->execute(['portalId' => $portalId]);
        $entries = array_map(static fn(array $e): array => [
            'id' => $e['Id'], 'portalTopicId' => $e['PortalTopicId'], 'question' => $e['Question'],
            'answer' => $e['Answer'], 'order' => (int) $e['Order'],
        ], $entryStmt->fetchAll());

        return ['topics' => $topics, 'entries' => $entries];
    }

    /** Delegates into FormSubmissionService::create against the Portal's own actioner Project (which
     * takes a bare, un-authorized projectId — no ProjectMember policy a Portal-only user would never
     * satisfy) after re-validating both Portal access AND that the requested form version's
     * FormGroupId is actually attached to this Portal. */
    public function createSubmission(string $organisationId, string $portalId, string $userId, array $request): ?array
    {
        $portal = $this->accessiblePortal($organisationId, $portalId, $userId);
        if ($portal === null) {
            return null;
        }
        if (!$this->isFormAttached($portalId, (string) ($request['formVersionId'] ?? ''))) {
            return null;
        }
        return (new FormSubmissionService($this->db))->create($portal['ProjectId'], $userId, $request);
    }

    public function updateSubmission(string $organisationId, string $portalId, string $userId, string $submissionId, array $request): ?array
    {
        $portal = $this->accessiblePortal($organisationId, $portalId, $userId);
        if ($portal === null) {
            return null;
        }
        return (new FormSubmissionService($this->db))->update($portal['ProjectId'], $userId, $submissionId, $request);
    }

    public function deleteSubmission(string $organisationId, string $portalId, string $userId, string $submissionId): bool
    {
        $portal = $this->accessiblePortal($organisationId, $portalId, $userId);
        if ($portal === null) {
            return false;
        }
        return (new FormSubmissionService($this->db))->delete($portal['ProjectId'], $userId, $submissionId);
    }

    public function submitSubmission(string $organisationId, string $portalId, string $userId, string $submissionId): array
    {
        $portal = $this->accessiblePortal($organisationId, $portalId, $userId);
        if ($portal === null) {
            return ['ok' => false, 'error' => 'not_found', 'dto' => null];
        }
        // callerIsOrgAdmin: always false here — a Portal end user submitting a form is never acting
        // with Org-Admin authority through this surface, regardless of their real IsOrgAdmin flag.
        return (new FormSubmissionService($this->db))->submit($portal['ProjectId'], $userId, false, $submissionId);
    }

    private function isFormAttached(string $portalId, string $formVersionId): bool
    {
        $stmt = $this->db->prepare('SELECT "FormGroupId" FROM "Forms" WHERE "Id" = :id');
        $stmt->execute(['id' => $formVersionId]);
        $formGroupId = $stmt->fetchColumn();
        if ($formGroupId === false) {
            return false;
        }
        $stmt = $this->db->prepare('SELECT 1 FROM "PortalForms" WHERE "PortalId" = :portalId AND "FormGroupId" = :groupId');
        $stmt->execute(['portalId' => $portalId, 'groupId' => $formGroupId]);
        return $stmt->fetch() !== false;
    }

    private function accessiblePortal(string $organisationId, string $portalId, string $userId): ?array
    {
        $stmt = $this->db->prepare('SELECT * FROM "Portals" WHERE "Id" = :id AND "OrganisationId" = :orgId AND "Status" = \'published\'');
        $stmt->execute(['id' => $portalId, 'orgId' => $organisationId]);
        $portal = $stmt->fetch();
        if ($portal === false) {
            return null;
        }
        $hasAccess = (new PortalAccessService($this->db))->userHasPortalAccess($portalId, $userId);
        return $hasAccess ? $portal : null;
    }

    private function accessiblePortalBySlug(string $organisationId, string $slug, string $userId): ?array
    {
        $stmt = $this->db->prepare('SELECT * FROM "Portals" WHERE "OrganisationId" = :orgId AND "Slug" = :slug AND "Status" = \'published\'');
        $stmt->execute(['orgId' => $organisationId, 'slug' => $slug]);
        $portal = $stmt->fetch();
        if ($portal === false) {
            return null;
        }
        $hasAccess = (new PortalAccessService($this->db))->userHasPortalAccess($portal['Id'], $userId);
        return $hasAccess ? $portal : null;
    }
}
