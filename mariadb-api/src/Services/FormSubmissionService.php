<?php

declare(strict_types=1);

namespace Enkl\Api\Services;

use Enkl\Api\Support\Uuid;
use PDO;

/**
 * Ported from php-api/src/Services/FormSubmissionService.php (itself ported from
 * Services/FormSubmissionService.cs). Project-member-facing Draft management + workflow progression
 * for Form submissions — single table for every form type. Phase 1: create/edit/delete a Draft only.
 * Phase 5 (this pass): Submit/Approve/Reject — a compact SERVER-SIDE re-implementation of
 * features/form-workflow-engine.js's gate/quorum logic (deny-by-default, never trusting a
 * client-claimed action). No dialect divergence from the Postgres tier anywhere in this file.
 */
final class FormSubmissionService
{
    public function __construct(private readonly PDO $db)
    {
    }

    public function listMine(string $projectId, string $callerUserId): array
    {
        $stmt = $this->db->prepare(<<<SQL
            SELECT s.*, f."Name" AS "FormName", f."VersionNumber" AS "FormVersionNumber", f."WorkflowJson" AS "FormWorkflowJson",
                   u."DisplayName" AS "SubmittedByDisplayName"
            FROM "FormSubmissions" s
            JOIN "Forms" f ON f."Id" = s."FormVersionId"
            JOIN "Users" u ON u."Id" = s."SubmittedByUserId"
            WHERE s."ProjectId" = :pid AND s."SubmittedByUserId" = :uid
            ORDER BY s."DateLastModified" DESC
        SQL);
        $stmt->execute(['pid' => $projectId, 'uid' => $callerUserId]);
        return array_map([self::class, 'toListItemDto'], $stmt->fetchAll());
    }

    /** Submissions in this project currently sitting at an Approval node whose gates the caller
     * satisfies — computed in memory (a plain SQL WHERE can't evaluate an opaque JSON workflow
     * graph), fine at this feature's expected scale. */
    public function listAwaitingMyAction(string $projectId, string $callerUserId, bool $callerIsOrgAdmin): array
    {
        $stmt = $this->db->prepare(<<<SQL
            SELECT s.*, f."Name" AS "FormName", f."VersionNumber" AS "FormVersionNumber", f."WorkflowJson" AS "FormWorkflowJson",
                   u."DisplayName" AS "SubmittedByDisplayName"
            FROM "FormSubmissions" s
            JOIN "Forms" f ON f."Id" = s."FormVersionId"
            JOIN "Users" u ON u."Id" = s."SubmittedByUserId"
            WHERE s."ProjectId" = :pid AND s."Status" = 'inProgress' AND s."CurrentNodeId" IS NOT NULL
        SQL);
        $stmt->execute(['pid' => $projectId]);
        $candidates = $stmt->fetchAll();
        if (count($candidates) === 0) {
            return [];
        }

        $user = $this->resolveActingUser($projectId, $callerUserId, $callerIsOrgAdmin);
        $result = [];
        foreach ($candidates as $s) {
            $node = self::findNode(self::parseWorkflow($s['FormWorkflowJson']), $s['CurrentNodeId']);
            if ($node === null || ($node['type'] ?? null) !== 'approval') {
                continue;
            }
            if (!self::satisfiesAny($node['approverGates'] ?? [], $user)) {
                continue;
            }
            $result[] = self::toListItemDto($s);
        }
        usort($result, fn(array $a, array $b) => strcmp((string) $b['dateLastModified'], (string) $a['dateLastModified']));
        return $result;
    }

    public function get(string $projectId, string $submissionId): ?array
    {
        $stmt = $this->db->prepare('SELECT * FROM "FormSubmissions" WHERE "Id" = :id AND "ProjectId" = :pid');
        $stmt->execute(['id' => $submissionId, 'pid' => $projectId]);
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

        return $this->get($projectId, $submissionId);
    }

    public function update(string $projectId, string $callerUserId, string $submissionId, array $request): ?array
    {
        $stmt = $this->db->prepare('SELECT "Status" FROM "FormSubmissions" WHERE "Id" = :id AND "ProjectId" = :pid AND "SubmittedByUserId" = :uid');
        $stmt->execute(['id' => $submissionId, 'pid' => $projectId, 'uid' => $callerUserId]);
        $row = $stmt->fetch();
        if ($row === false || $row['Status'] !== 'draft') {
            return null;
        }

        $stmt = $this->db->prepare('UPDATE "FormSubmissions" SET "AnswersJson" = :answersJson, "DateLastModified" = now() WHERE "Id" = :id');
        $stmt->execute(['answersJson' => $request['answersJson'] ?? null, 'id' => $submissionId]);

        return $this->get($projectId, $submissionId);
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

    /** Moves a Draft into the workflow — see FormSubmissionService.cs's SubmitAsync doc comment for
     * the full transition shape (Start must lead to an Author node; the caller must satisfy its
     * gates; the submission then advances to whatever follows). Returns ['ok'=>bool, 'error'=>?string,
     * 'dto'=>?array] rather than throwing, matching this tier's existing multi-value-return
     * convention for a validated-failure (vs. a genuine exception) elsewhere in this codebase. */
    public function submit(string $projectId, string $callerUserId, bool $callerIsOrgAdmin, string $submissionId): array
    {
        $stmt = $this->db->prepare('SELECT s.*, f."WorkflowJson" AS "FormWorkflowJson" FROM "FormSubmissions" s JOIN "Forms" f ON f."Id" = s."FormVersionId" WHERE s."Id" = :id AND s."ProjectId" = :pid AND s."SubmittedByUserId" = :uid');
        $stmt->execute(['id' => $submissionId, 'pid' => $projectId, 'uid' => $callerUserId]);
        $row = $stmt->fetch();
        if ($row === false) {
            return ['ok' => false, 'error' => 'not_found', 'dto' => null];
        }
        if ($row['Status'] !== 'draft') {
            return ['ok' => false, 'error' => 'Only a Draft submission may be submitted.', 'dto' => null];
        }

        $graph = self::parseWorkflow($row['FormWorkflowJson']);
        $start = self::findStart($graph);
        $firstEdge = $start !== null ? self::outgoingEdge($graph, $start['id']) : null;
        $authorNode = $firstEdge !== null ? self::findNode($graph, $firstEdge['toNodeId']) : null;
        if ($authorNode === null || ($authorNode['type'] ?? null) !== 'author') {
            return ['ok' => false, 'error' => "This form's workflow isn't configured to accept submissions yet.", 'dto' => null];
        }

        $user = $this->resolveActingUser($projectId, $callerUserId, $callerIsOrgAdmin);
        if (!self::satisfiesAny($authorNode['authorGates'] ?? [], $user)) {
            return ['ok' => false, 'error' => 'You are not permitted to submit this form.', 'dto' => null];
        }

        $trail = self::parseTrail($row['ApprovalTrailJson']);
        $trail[] = [
            'nodeId' => $authorNode['id'], 'actorUserId' => $callerUserId, 'action' => 'authored',
            'satisfiedGateKeys' => self::matchingGateKeys($authorNode['authorGates'] ?? [], $user),
            'comment' => null, 'timestamp' => gmdate('Y-m-d\TH:i:s\Z'),
        ];

        $nextEdge = self::outgoingEdge($graph, $authorNode['id']);
        $nextNode = $nextEdge !== null ? self::findNode($graph, $nextEdge['toNodeId']) : null;
        [$status, $currentNodeId] = self::nextNodeState($nextNode);

        $stmt = $this->db->prepare('UPDATE "FormSubmissions" SET "ApprovalTrailJson" = :trail, "Status" = :status, "CurrentNodeId" = :nodeId, "DateSubmitted" = now(), "DateLastModified" = now() WHERE "Id" = :id');
        $stmt->execute(['trail' => json_encode($trail), 'status' => $status, 'nodeId' => $currentNodeId, 'id' => $submissionId]);

        return ['ok' => true, 'error' => '', 'dto' => $this->get($projectId, $submissionId)];
    }

    /** Approve/Reject at the submission's own CurrentNodeId — see FormSubmissionService.cs's
     * ActOnApprovalAsync doc comment for the full quorum shape. Not scoped to the caller's own
     * submissions (an approver acts on someone ELSE's submission), unlike every Draft-management
     * method above. */
    public function actOnApproval(string $projectId, string $callerUserId, bool $callerIsOrgAdmin, string $submissionId, string $action, ?string $comment): array
    {
        if ($action !== 'approve' && $action !== 'reject') {
            return ['ok' => false, 'error' => 'Unknown action.', 'dto' => null];
        }

        $stmt = $this->db->prepare('SELECT s.*, f."WorkflowJson" AS "FormWorkflowJson" FROM "FormSubmissions" s JOIN "Forms" f ON f."Id" = s."FormVersionId" WHERE s."Id" = :id AND s."ProjectId" = :pid');
        $stmt->execute(['id' => $submissionId, 'pid' => $projectId]);
        $row = $stmt->fetch();
        if ($row === false) {
            return ['ok' => false, 'error' => 'not_found', 'dto' => null];
        }
        if ($row['CurrentNodeId'] === null) {
            return ['ok' => false, 'error' => 'This submission is not awaiting approval.', 'dto' => null];
        }

        $graph = self::parseWorkflow($row['FormWorkflowJson']);
        $node = self::findNode($graph, $row['CurrentNodeId']);
        if ($node === null || ($node['type'] ?? null) !== 'approval') {
            return ['ok' => false, 'error' => 'This submission is not awaiting approval.', 'dto' => null];
        }

        $user = $this->resolveActingUser($projectId, $callerUserId, $callerIsOrgAdmin);
        if (!self::satisfiesAny($node['approverGates'] ?? [], $user)) {
            return ['ok' => false, 'error' => 'You are not permitted to act on this submission.', 'dto' => null];
        }

        $trail = self::parseTrail($row['ApprovalTrailJson']);
        $entryAction = $action === 'approve' ? 'approved' : 'rejected';
        $trail[] = [
            'nodeId' => $node['id'], 'actorUserId' => $callerUserId, 'action' => $entryAction,
            'satisfiedGateKeys' => self::matchingGateKeys($node['approverGates'] ?? [], $user),
            'comment' => $comment, 'timestamp' => gmdate('Y-m-d\TH:i:s\Z'),
        ];

        $status = $row['Status'];
        $currentNodeId = $row['CurrentNodeId'];
        if ($action === 'reject') {
            $status = 'rejected';
        } elseif (self::isApprovalComplete($node, $trail)) {
            $edge = self::outgoingEdge($graph, $node['id']);
            $nextNode = $edge !== null ? self::findNode($graph, $edge['toNodeId']) : null;
            [$status, $currentNodeId] = self::nextNodeState($nextNode);
        }

        $stmt = $this->db->prepare('UPDATE "FormSubmissions" SET "ApprovalTrailJson" = :trail, "Status" = :status, "CurrentNodeId" = :nodeId, "DateLastModified" = now() WHERE "Id" = :id');
        $stmt->execute(['trail' => json_encode($trail), 'status' => $status, 'nodeId' => $currentNodeId, 'id' => $submissionId]);

        $stmt2 = $this->db->prepare('SELECT * FROM "FormSubmissions" WHERE "Id" = :id');
        $stmt2->execute(['id' => $submissionId]);
        return ['ok' => true, 'error' => '', 'dto' => self::toDto($stmt2->fetch())];
    }

    // ---- Workflow graph helpers — mirror features/form-workflow-engine.js's own shape exactly ----

    private static function parseWorkflow(?string $json): array
    {
        if ($json === null || trim($json) === '') {
            return ['nodes' => [], 'edges' => []];
        }
        $parsed = json_decode($json, true);
        if (!is_array($parsed)) {
            return ['nodes' => [], 'edges' => []];
        }
        return ['nodes' => is_array($parsed['nodes'] ?? null) ? $parsed['nodes'] : [], 'edges' => is_array($parsed['edges'] ?? null) ? $parsed['edges'] : []];
    }
    private static function parseTrail(?string $json): array
    {
        if ($json === null || trim($json) === '') {
            return [];
        }
        $parsed = json_decode($json, true);
        return is_array($parsed) ? $parsed : [];
    }
    private static function findNode(array $graph, ?string $id): ?array
    {
        if ($id === null) {
            return null;
        }
        foreach ($graph['nodes'] as $n) {
            if (($n['id'] ?? null) === $id) {
                return $n;
            }
        }
        return null;
    }
    private static function findStart(array $graph): ?array
    {
        foreach ($graph['nodes'] as $n) {
            if (($n['type'] ?? null) === 'start') {
                return $n;
            }
        }
        return null;
    }
    private static function outgoingEdge(array $graph, string $nodeId): ?array
    {
        foreach ($graph['edges'] as $e) {
            if (($e['fromNodeId'] ?? null) === $nodeId) {
                return $e;
            }
        }
        return null;
    }
    private static function gateKey(array $gate): string
    {
        return ($gate['kind'] ?? '') . ':' . ($gate['value'] ?? '');
    }

    /** 'teamMember' is satisfied unconditionally — the caller already passed
     * ProjectMemberMiddleware to reach this controller at all, so every caller of this service is
     * already at least a Team Member of the project. */
    private static function gateSatisfied(array $gate, array $user): bool
    {
        if (($gate['kind'] ?? null) === 'namedUser') {
            return ($gate['value'] ?? null) === $user['id'];
        }
        if (($gate['kind'] ?? null) === 'userType') {
            $value = $gate['value'] ?? null;
            if ($value === 'orgAdmin') {
                return $user['isOrgAdmin'];
            }
            if ($value === 'projectAdmin') {
                return $user['isProjectAdmin'] || $user['isOrgAdmin'];
            }
            if ($value === 'teamMember') {
                return true;
            }
        }
        return false;
    }
    private static function matchingGateKeys(array $gates, array $user): array
    {
        $keys = [];
        foreach ($gates as $g) {
            if (self::gateSatisfied($g, $user)) {
                $keys[] = self::gateKey($g);
            }
        }
        return $keys;
    }
    private static function satisfiesAny(array $gates, array $user): bool
    {
        return count(self::matchingGateKeys($gates, $user)) > 0;
    }
    private static function isApprovalComplete(array $node, array $trail): bool
    {
        $entries = array_filter($trail, fn($t) => ($t['nodeId'] ?? null) === $node['id'] && ($t['action'] ?? null) === 'approved');
        if (($node['approvalMode'] ?? null) === 'all') {
            $required = array_map([self::class, 'gateKey'], $node['approverGates'] ?? []);
            if (count($required) === 0) {
                return false;
            }
            $satisfied = [];
            foreach ($entries as $e) {
                foreach (($e['satisfiedGateKeys'] ?? []) as $k) {
                    $satisfied[$k] = true;
                }
            }
            foreach ($required as $k) {
                if (!isset($satisfied[$k])) {
                    return false;
                }
            }
            return true;
        }
        return count($entries) > 0;
    }
    /** @return array{0: string, 1: ?string} [status, currentNodeId] */
    private static function nextNodeState(?array $nextNode): array
    {
        if ($nextNode === null) {
            return ['submitted', null];
        }
        if (($nextNode['type'] ?? null) === 'end') {
            return ['approved', $nextNode['id']];
        }
        return ['inProgress', $nextNode['id']];
    }

    private function resolveActingUser(string $projectId, string $userId, bool $callerIsOrgAdmin): array
    {
        $stmt = $this->db->prepare('SELECT 1 FROM "ProjectMembers" WHERE "ProjectId" = :pid AND "UserId" = :uid AND "IsProjectAdmin" = true');
        $stmt->execute(['pid' => $projectId, 'uid' => $userId]);
        return ['id' => $userId, 'isOrgAdmin' => $callerIsOrgAdmin, 'isProjectAdmin' => $stmt->fetch() !== false];
    }

    private static function toListItemDto(array $s): array
    {
        $node = self::findNode(self::parseWorkflow($s['FormWorkflowJson']), $s['CurrentNodeId']);
        return [
            'id' => $s['Id'], 'formVersionId' => $s['FormVersionId'], 'formName' => $s['FormName'],
            'versionNumber' => (int) $s['FormVersionNumber'], 'status' => $s['Status'], 'currentNodeId' => $s['CurrentNodeId'],
            'currentNodeLabel' => $node['label'] ?? null, 'submittedByUserId' => $s['SubmittedByUserId'],
            'submittedByDisplayName' => $s['SubmittedByDisplayName'],
            'dateCreated' => $s['DateCreated'], 'dateLastModified' => $s['DateLastModified'], 'dateSubmitted' => $s['DateSubmitted'],
        ];
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
