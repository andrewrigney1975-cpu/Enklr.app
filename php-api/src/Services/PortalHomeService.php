<?php

declare(strict_types=1);

namespace Enkl\Api\Services;

use PDO;

/**
 * Ported from Services/PortalHomeService.cs. The end-user-facing side of Organisational Portals —
 * deliberately gated by RequireAuthMiddleware only (no ProjectMember/OrgAdmin middleware — see
 * routes.php), since a Portal must be reachable by an org user who belongs to zero projects. Every
 * method here re-derives BOTH that the Portal is published AND that the caller actually has access
 * (via PortalAccessService), never trusting a client-supplied portalId/slug alone — a foreign/
 * nonexistent/unpublished/inaccessible Portal all return null identically, matching this codebase's
 * no-enumeration-oracle rule.
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
            'answer' => $e['Answer'], 'order' => (int) $e['Order'], 'nps' => (int) $e['Nps'],
        ], $entryStmt->fetchAll());

        return ['topics' => $topics, 'entries' => $entries];
    }

    /** Ported from PortalHomeService.VoteQaEntryNpsAsync. End-user thumbs-up/down voting — "up" is
     * +1, anything else is -1, no floor/ceiling, no per-user vote tracking (a simple tally, not a
     * persistent per-user ledger, per this feature's own deliberately minimal spec). Gated the same
     * way every other read/write here is: the Portal must be published AND the caller must actually
     * have an access grant for it. */
    public function voteQaEntryNps(string $organisationId, string $portalId, string $entryId, string $direction, string $userId): bool
    {
        if ($this->accessiblePortal($organisationId, $portalId, $userId) === null) {
            return false;
        }
        $delta = $direction === 'up' ? 1 : -1;
        $stmt = $this->db->prepare('UPDATE "PortalQaEntries" SET "Nps" = "Nps" + :delta WHERE "Id" = :id AND "PortalId" = :portalId');
        $stmt->execute(['delta' => $delta, 'id' => $entryId, 'portalId' => $portalId]);
        return $stmt->rowCount() > 0;
    }

    /** Re-fetches ONE of the caller's own submissions with its full AnswersJson — needed to actually
     * reopen a saved Draft with its previously-entered answers bound back into the form (the list
     * item "My requests" already has in hand never carries AnswersJson at all).
     * FormSubmissionService::get itself has no ownership check baked in (the normal ProjectMember-
     * scoped fill-out surface trusts any project member to read any submission in their own
     * project) — that trust boundary doesn't apply to a Portal-only user with no project membership
     * at all, so this method re-derives ownership explicitly: a submission that exists but was
     * submitted by someone else returns null here, identical to a nonexistent one. */
    public function getSubmission(string $organisationId, string $portalId, string $userId, string $submissionId, bool $callerIsOrgAdmin): ?array
    {
        $portal = $this->accessiblePortal($organisationId, $portalId, $userId);
        if ($portal === null) {
            return null;
        }
        $submissions = new FormSubmissionService($this->db);
        $submission = $submissions->get($portal['ProjectId'], $submissionId);
        if ($submission === null) {
            return null;
        }
        if ($submission['submittedByUserId'] === $userId) {
            return $submission;
        }

        // Not the submitter — only visible if the caller is currently a legitimate reviewer for it
        // (sitting at an Approval node whose gates they satisfy). Reuses listAwaitingMyAction's own
        // gate-evaluation rather than re-parsing the workflow graph here. Anyone else gets the same
        // null as a nonexistent submission — no enumeration oracle.
        $awaiting = $submissions->listAwaitingMyAction($portal['ProjectId'], $userId, $callerIsOrgAdmin);
        foreach ($awaiting as $a) {
            if ($a['id'] === $submissionId) {
                return $submission;
            }
        }
        return null;
    }

    /** Submissions against this Portal's own actioner Project currently awaiting the caller's
     * approval — the Portal-surface counterpart to ProjectFormsController's "submissions/awaiting-me",
     * needed because a Portal-configured approver is never a ProjectMember of the actioner Project
     * (deliberately created with zero members) and so has no route to that project-scoped endpoint
     * at all. Delegates straight into FormSubmissionService's own gate-evaluation logic — a Portal
     * submission is a completely ordinary FormSubmission underneath, just reached through a
     * different, membership-free front door. */
    public function listAwaitingMyAction(string $organisationId, string $portalId, string $userId, bool $callerIsOrgAdmin): ?array
    {
        $portal = $this->accessiblePortal($organisationId, $portalId, $userId);
        if ($portal === null) {
            return null;
        }
        return (new FormSubmissionService($this->db))->listAwaitingMyAction($portal['ProjectId'], $userId, $callerIsOrgAdmin);
    }

    /** Approve/reject a submission sitting at an Approval node in this Portal's actioner Project.
     * callerIsOrgAdmin is always false here for the same reason submitSubmission passes false — acting
     * through the Portal surface is never Org-Admin authority, regardless of the caller's real
     * IsOrgAdmin flag. */
    public function actOnApproval(string $organisationId, string $portalId, string $userId, string $submissionId, string $action, ?string $comment, bool $callerIsOrgAdmin): array
    {
        $portal = $this->accessiblePortal($organisationId, $portalId, $userId);
        if ($portal === null) {
            return ['ok' => false, 'error' => 'not_found', 'dto' => null];
        }
        $result = (new FormSubmissionService($this->db))->actOnApproval($portal['ProjectId'], $userId, $callerIsOrgAdmin, $submissionId, $action, $comment);
        // The controller broadcasts by real ProjectId, not the Portal's own id — see
        // PortalHomeController::notifyFormAction's own comment for why this has to ride along here.
        $result['projectId'] = $portal['ProjectId'];
        return $result;
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
        $result = (new FormSubmissionService($this->db))->submit($portal['ProjectId'], $userId, false, $submissionId);
        // The controller broadcasts by real ProjectId, not the Portal's own id — see
        // PortalHomeController::notifyFormAction's own comment for why this has to ride along here.
        $result['projectId'] = $portal['ProjectId'];
        return $result;
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
