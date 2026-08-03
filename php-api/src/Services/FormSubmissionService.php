<?php

declare(strict_types=1);

namespace Enkl\Api\Services;

use Enkl\Api\Support\Uuid;
use PDO;

/**
 * Ported from Services/FormSubmissionService.cs. Project-member-facing Draft management + workflow
 * progression for Form submissions — single table for every form type (see the entity's own
 * migration comment). Phase 1: create/edit/delete a Draft only. Phase 5 (this pass): Submit/Approve/
 * Reject — a compact SERVER-SIDE re-implementation of features/form-workflow-engine.js's gate/quorum
 * logic (deny-by-default, never trusting a client-claimed action), since this is the actual security
 * boundary — see FormSubmissionService.cs's own doc comment for why.
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
        $stmt = $this->db->prepare('SELECT s.*, f."WorkflowJson" AS "FormWorkflowJson", f."Name" AS "FormName", f."FieldsJson" AS "FormFieldsJson" FROM "FormSubmissions" s JOIN "Forms" f ON f."Id" = s."FormVersionId" WHERE s."Id" = :id AND s."ProjectId" = :pid AND s."SubmittedByUserId" = :uid');
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
        [$status, $currentNodeId, $nextNode, $raisedTaskId] = $this->applyNextNodeActions($graph, $nextNode, $trail, $row);

        // COALESCE, not overwrite — $raisedTaskId is only non-null when THIS call actually executed
        // a "raiseTaskInPortal" action node; a Draft's very first transition always starts from
        // RaisedTaskId=null anyway, but the same statement shape is used here as actOnApproval's own
        // (below) for consistency/reuse of the same reasoning.
        $stmt = $this->db->prepare('UPDATE "FormSubmissions" SET "ApprovalTrailJson" = :trail, "Status" = :status, "CurrentNodeId" = :nodeId, "RaisedTaskId" = COALESCE(:raisedTaskId, "RaisedTaskId"), "DateSubmitted" = now(), "DateLastModified" = now() WHERE "Id" = :id');
        $stmt->execute(['trail' => json_encode($trail), 'status' => $status, 'nodeId' => $currentNodeId, 'raisedTaskId' => $raisedTaskId, 'id' => $submissionId]);

        return [
            'ok' => true, 'error' => '', 'dto' => $this->get($projectId, $submissionId),
            // Always a fresh arrival — the submission is moving off the Author node onto nextNode
            // for the very first time.
            'notifyUserIds' => self::resolveNotifyTargets($nextNode, $trail, true), 'formName' => $row['FormName'],
        ];
    }

    /** Approve/Reject at the submission's own CurrentNodeId — see FormSubmissionService.cs's
     * ActOnApprovalAsync doc comment for the full quorum shape. Not scoped to the caller's own
     * submissions (an approver acts on someone ELSE's submission), unlike every Draft-management
     * method above. */
    public function actOnApproval(string $projectId, string $callerUserId, bool $callerIsOrgAdmin, string $submissionId, string $action, ?string $comment, ?string $closingNotes = null): array
    {
        if ($action !== 'approve' && $action !== 'reject') {
            return ['ok' => false, 'error' => 'Unknown action.', 'dto' => null];
        }

        $stmt = $this->db->prepare('SELECT s.*, f."WorkflowJson" AS "FormWorkflowJson", f."Name" AS "FormName", f."FieldsJson" AS "FormFieldsJson" FROM "FormSubmissions" s JOIN "Forms" f ON f."Id" = s."FormVersionId" WHERE s."Id" = :id AND s."ProjectId" = :pid');
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
        $raisedTaskId = null;
        $notifyNode = $node;
        // True only when this approval actually completed the CURRENT node's quorum and advanced to
        // a genuinely new node (a multi-step Approval chain) — a fresh arrival needing a full
        // fan-out there, same as submit()'s own first arrival. Stays false when quorum wasn't
        // complete and we're still re-checking $node itself after a partial approval — the "narrows
        // to one" case, not a fresh one.
        $notifyIsFreshArrival = false;
        $closingNotesToSave = null;
        if ($action === 'reject') {
            $status = 'rejected';
            if ($closingNotes !== null && trim($closingNotes) !== '') {
                $closingNotesToSave = $closingNotes;
            }
        } elseif (self::isApprovalComplete($node, $trail)) {
            $edge = self::outgoingEdge($graph, $node['id']);
            $nextNode = $edge !== null ? self::findNode($graph, $edge['toNodeId']) : null;
            [$status, $currentNodeId, $nextNode, $raisedTaskId] = $this->applyNextNodeActions($graph, $nextNode, $trail, $row);
            $notifyNode = $nextNode;
            $notifyIsFreshArrival = true;
            // Only the decisive approval (this node's own quorum just completed AND the graph landed
            // on an End node) records closing notes — an intermediate step in a multi-step Approval
            // chain has nothing final to close out yet.
            if ($status === 'approved' && $closingNotes !== null && trim($closingNotes) !== '') {
                $closingNotesToSave = $closingNotes;
            }
        }
        // else: quorum not yet complete — Status/CurrentNodeId unchanged, and resolveNotifyTargets
        // below re-checks the SAME node — its own ALL-mode branch is what notices the remaining-
        // approver count just dropped to one.

        // Phase 7/8: notify the original submitter of a FINAL decision, always and unconditionally —
        // no gate-satisfaction ambiguity to resolve here (unlike resolveNotifyTargets), skipped only
        // if the decider IS the submitter (a userType-gated approver acting on their own submission).
        // Reject is always final; approve is only final once $status actually became 'approved' — an
        // intermediate approval in a multi-step chain leaves $status 'inProgress' and doesn't notify.
        $decisionNotify = null;
        if (($action === 'reject' || $status === 'approved') && $row['SubmittedByUserId'] !== $callerUserId) {
            $decisionNotify = [
                'userId' => $row['SubmittedByUserId'], 'displayName' => $this->resolveDisplayName($callerUserId),
                'decision' => $action === 'reject' ? 'rejected' : 'approved',
            ];
        }

        $stmt = $this->db->prepare('UPDATE "FormSubmissions" SET "ApprovalTrailJson" = :trail, "Status" = :status, "CurrentNodeId" = :nodeId, "RaisedTaskId" = COALESCE(:raisedTaskId, "RaisedTaskId"), "ClosingNotes" = COALESCE(:closingNotes, "ClosingNotes"), "DateLastModified" = now() WHERE "Id" = :id');
        $stmt->execute(['trail' => json_encode($trail), 'status' => $status, 'nodeId' => $currentNodeId, 'raisedTaskId' => $raisedTaskId, 'closingNotes' => $closingNotesToSave, 'id' => $submissionId]);

        $stmt2 = $this->db->prepare('SELECT * FROM "FormSubmissions" WHERE "Id" = :id');
        $stmt2->execute(['id' => $submissionId]);
        return [
            'ok' => true, 'error' => '', 'dto' => self::toDto($stmt2->fetch()),
            'notifyUserIds' => $action === 'approve' ? self::resolveNotifyTargets($notifyNode, $trail, $notifyIsFreshArrival) : [],
            'decisionNotify' => $decisionNotify,
            'formName' => $row['FormName'],
        ];
    }

    /** Phase 6's SSE-push scope (a plain userType gate has no single "specific person" to target),
     * widened in Phase 9 for ALL-mode — see FormSubmissionService.cs's own NotifyIfNamedApproverNeeded
     * doc comment for the full reasoning (mirrored here exactly): fresh ANY-mode notifies every
     * namedUser gate; a FRESHLY-REACHED ALL-mode node ($isFreshArrival) fans out to every remaining
     * namedUser gate at once, not just the last one; a re-check of the SAME ALL-mode node after a
     * partial approval ($isFreshArrival false) only notifies once exactly one gate remains. Only
     * decides WHO to notify; the controller (this tier's own broadcast-ownership convention, see
     * Controllers/TasksController.php) is what actually calls Broadcaster. (Phase 7's rejection
     * notification has no equivalent "who" ambiguity to resolve — see actOnApproval's own
     * $decisionNotify, computed inline rather than via a second resolver like this one.)
     * @return string[] */
    private static function resolveNotifyTargets(?array $node, array $trail, bool $isFreshArrival): array
    {
        if ($node === null || ($node['type'] ?? null) !== 'approval') {
            return [];
        }
        if (($node['approvalMode'] ?? null) === 'all') {
            $satisfied = [];
            foreach ($trail as $e) {
                if (($e['nodeId'] ?? null) === $node['id'] && ($e['action'] ?? null) === 'approved') {
                    foreach (($e['satisfiedGateKeys'] ?? []) as $k) {
                        $satisfied[$k] = true;
                    }
                }
            }
            $remaining = array_values(array_filter($node['approverGates'] ?? [], fn(array $g) => !isset($satisfied[self::gateKey($g)])));
            if ($isFreshArrival) {
                return array_values(array_map(
                    fn(array $g) => (string) $g['value'],
                    array_filter($remaining, fn(array $g) => ($g['kind'] ?? null) === 'namedUser')
                ));
            }
            if (count($remaining) === 1 && ($remaining[0]['kind'] ?? null) === 'namedUser') {
                return [(string) $remaining[0]['value']];
            }
            return [];
        }
        return array_values(array_map(
            fn(array $g) => (string) $g['value'],
            array_filter($node['approverGates'] ?? [], fn(array $g) => ($g['kind'] ?? null) === 'namedUser')
        ));
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
        // An "action" node stays 'submitted' rather than jumping straight to 'inProgress' — nobody
        // has actually picked up the raised Task yet, so nothing is "In Review" until
        // markInReviewIfTaskAssigned (below) notices it get assigned. An Approval node genuinely IS
        // "In Review" the instant it's reached (a human gate is pending right now).
        if (($nextNode['type'] ?? null) === 'action') {
            return ['submitted', $nextNode['id']];
        }
        return ['inProgress', $nextNode['id']];
    }

    /** Applies one node transition's terminal-status logic (delegated to nextNodeState: null ->
     * 'submitted', an End node -> 'approved', anything else -> 'inProgress' pinned at that node). An
     * "action" node is executed (its side effect fires) the instant the graph transitions into it,
     * but — unlike the auto-continue-past-every-action-node behavior this method used to have — does
     * NOT auto-advance past itself afterward: it falls into the same 'inProgress' branch as an
     * Approval node, pausing the submission there. For "raiseTaskInPortal" specifically, that pause
     * is exactly the point — the submission stays paused until resumeIfLinkedTaskDone (below) notices
     * the raised Task land in a Done column and re-calls this same method with the action node's own
     * outgoing edge, walking the graph exactly one more step.
     * @return array{0: string, 1: ?string, 2: ?array, 3: ?string} [status, currentNodeId, nextNode,
     *   raisedTaskId] — raisedTaskId is non-null only when THIS call actually executed a
     *   "raiseTaskInPortal" action node; callers must COALESCE it against the existing DB value
     *   rather than overwrite unconditionally, so a call that doesn't hit an action node never wipes
     *   out an earlier pending raised-task link. */
    private function applyNextNodeActions(array $graph, ?array $nextNode, array &$trail, array $submissionRow): array
    {
        $raisedTaskId = null;
        if ($nextNode !== null && ($nextNode['type'] ?? null) === 'action') {
            $raisedTaskId = $this->executeActionNode($nextNode, $trail, $submissionRow);
        }
        [$status, $currentNodeId] = self::nextNodeState($nextNode);
        return [$status, $currentNodeId, $nextNode, $raisedTaskId];
    }

    /** The one action type implemented so far: raises a Task in the target Portal's own
     * auto-provisioned actioner Project, in whichever of its 5 fixed priority columns
     * (Trivial..Critical) config.priorityColumn names (case-insensitive; falls back to the lowest-
     * Order column if the name doesn't match any of them). The target Portal is resolved
     * dynamically first: if this submission's own ProjectId IS some Portal's actioner Project (i.e.
     * it was actually filled out through that Portal — PortalHomeService::createSubmission stamps
     * submissions with the Portal's own ProjectId at creation), that Portal always wins, regardless
     * of config.portalId — a Form attached to multiple Portals raises into wherever THIS submission
     * actually came from. Only when the submission's own project isn't any Portal's actioner
     * project at all (a "free floating" Form filled out directly against an ordinary project) does
     * config.portalId's org-admin-configured default apply. assigneeId resolves via
     * resolveActionAssignee — "assigned to the form's approver if known." Silently no-ops for any
     * unrecognized actionType or when neither resolution path yields a project (no origin Portal AND
     * no configured default, or a configured default Portal that's since been deleted) — a
     * misconfigured or since-deleted Portal must never break the whole Submit/Approve flow.
     * @return ?string The raised Task's own Id (stored on FormSubmissions.RaisedTaskId by the
     *   caller), or null when no task was actually raised. */
    private function executeActionNode(array $node, array &$trail, array $submissionRow): ?string
    {
        $actionType = $node['actionType'] ?? null;
        $config = $node['config'] ?? [];
        if ($actionType !== 'raiseTaskInPortal') {
            return null;
        }

        $originStmt = $this->db->prepare('SELECT "ProjectId" FROM "Portals" WHERE "ProjectId" = :pid');
        $originStmt->execute(['pid' => $submissionRow['ProjectId']]);
        $originPortal = $originStmt->fetch();

        $targetProjectId = $originPortal !== false ? $originPortal['ProjectId'] : null;
        if ($targetProjectId === null && ($config['portalId'] ?? null) !== null) {
            $defaultStmt = $this->db->prepare('SELECT "ProjectId" FROM "Portals" WHERE "Id" = :id');
            $defaultStmt->execute(['id' => $config['portalId']]);
            $defaultPortal = $defaultStmt->fetch();
            $targetProjectId = $defaultPortal !== false ? $defaultPortal['ProjectId'] : null;
        }
        if ($targetProjectId === null) {
            return null;
        }

        $colStmt = $this->db->prepare('SELECT "Id", "Name" FROM "Columns" WHERE "ProjectId" = :pid ORDER BY "Order"');
        $colStmt->execute(['pid' => $targetProjectId]);
        $columns = $colStmt->fetchAll();
        if (count($columns) === 0) {
            return null;
        }
        $priorityAnswer = self::resolvePriorityFieldAnswer($submissionRow['FormFieldsJson'] ?? null, $submissionRow['AnswersJson'] ?? null);
        $wantedName = strtolower((string) ($priorityAnswer ?? ($config['priorityColumn'] ?? '')));
        $column = null;
        foreach ($columns as $c) {
            if (strtolower((string) $c['Name']) === $wantedName) {
                $column = $c;
                break;
            }
        }
        $column ??= $columns[0];

        $assigneeId = self::resolveActionAssignee($config['assigneeGate'] ?? null, $trail);
        $title = trim((string) ($config['titleTemplate'] ?? ''));
        if ($title === '') {
            $title = ($submissionRow['FormName'] ?? 'Form') . ' — submission review';
        }

        $submitterStmt = $this->db->prepare('SELECT "DisplayName", "Username" FROM "Users" WHERE "Id" = :id');
        $submitterStmt->execute(['id' => $submissionRow['SubmittedByUserId']]);
        $submitter = $submitterStmt->fetch();
        $submitterLine = $submitter !== false ? ('**Submitted by:** ' . $submitter['DisplayName'] . ' (' . $submitter['Username'] . ')') : null;
        $answersBlock = self::buildAnswersDescription($submissionRow['FormFieldsJson'] ?? null, $submissionRow['AnswersJson'] ?? null);
        $description = implode("\n\n", array_filter([$submitterLine, $answersBlock], fn ($s) => $s !== null && $s !== ''));
        $description = $description === '' ? null : $description;

        $task = (new TaskService($this->db))->create($targetProjectId, [
            'title' => $title, 'description' => $description, 'columnId' => $column['Id'], 'assigneeId' => $assigneeId,
            'priority' => $priorityAnswer ?? 'medium',
        ]);

        $trail[] = [
            'nodeId' => $node['id'], 'actorUserId' => '00000000-0000-0000-0000-000000000000', 'action' => 'raisedTask',
            'satisfiedGateKeys' => [], 'comment' => $task['key'] ?? null, 'timestamp' => gmdate('Y-m-d\TH:i:s\Z'),
        ];

        return $task['id'] ?? null;
    }

    /** Called by TasksController right after ANY task update — cheap no-op for the overwhelming
     * majority of task moves (an indexed lookup on RaisedTaskId that finds nothing). When a Task
     * that a "raiseTaskInPortal" action node raised has landed in a Done column, resumes the paused
     * submission by walking exactly one more graph step from that action node's own outgoing edge
     * (see applyNextNodeActions' own doc comment for why this reuses that same method) — reaching
     * End marks the submission "completed", a distinct terminal status from a human's own "approved"
     * (the form is marked as complete via the linked Task, not a person — see the Portal frontend's
     * own stepper handling of this distinction); reaching another Approval node instead just moves
     * the pause to a human gate, same as any other Approval step; reaching another action node fires
     * and pauses again. Idempotent and safe to call unconditionally: no-ops when no submission is
     * currently paused on this Task, the Task's own column isn't Done, or the submission's current
     * node isn't actually an "action" node (defensive). Broadcast ownership stays at the controller
     * level (this tier's own convention) — returns null for a no-op, or ['projectId', 'submissionId',
     * 'formName', 'decisionNotify'] (the last only non-null once the walk actually reached
     * 'completed') for the controller to broadcast.
     *
     * Matches Status 'submitted' OR 'inProgress' — a task-raised submission may still be 'submitted'
     * if the raised Task was never explicitly assigned before landing in Done
     * (markInReviewIfTaskAssigned never fired); task-driven completion must work either way,
     * skipping the "In Review" gate entirely rather than requiring it. $closingNotes, if provided
     * (the raised Task's assignee filled it in on the same Done-column move), is transcribed onto
     * the submission only when this resume actually reaches the terminal 'completed' status below.
     *
     * @return ?array{projectId: string, submissionId: string, formName: string, decisionNotify: ?array}
     */
    public function resumeIfLinkedTaskDone(string $taskId, ?string $closingNotes = null): ?array
    {
        $stmt = $this->db->prepare(
            'SELECT s.*, f."WorkflowJson" AS "FormWorkflowJson", f."Name" AS "FormName" FROM "FormSubmissions" s
             JOIN "Forms" f ON f."Id" = s."FormVersionId" WHERE s."RaisedTaskId" = :tid AND s."Status" IN (\'submitted\', \'inProgress\')'
        );
        $stmt->execute(['tid' => $taskId]);
        $row = $stmt->fetch();
        if ($row === false) {
            return null;
        }

        $taskStmt = $this->db->prepare(
            'SELECT t."Key", c."Done" FROM "Tasks" t JOIN "Columns" c ON c."Id" = t."ColumnId" WHERE t."Id" = :id'
        );
        $taskStmt->execute(['id' => $taskId]);
        $task = $taskStmt->fetch();
        if ($task === false || !(bool) $task['Done']) {
            return null;
        }

        $graph = self::parseWorkflow($row['FormWorkflowJson']);
        $currentNode = self::findNode($graph, $row['CurrentNodeId']);
        if ($currentNode === null || ($currentNode['type'] ?? null) !== 'action') {
            return null;
        }

        $trail = self::parseTrail($row['ApprovalTrailJson']);
        $trail[] = [
            'nodeId' => $currentNode['id'], 'actorUserId' => '00000000-0000-0000-0000-000000000000', 'action' => 'taskCompleted',
            'satisfiedGateKeys' => [], 'comment' => $task['Key'], 'timestamp' => gmdate('Y-m-d\TH:i:s\Z'),
        ];

        $edge = self::outgoingEdge($graph, $currentNode['id']);
        $nextNode = $edge !== null ? self::findNode($graph, $edge['toNodeId']) : null;
        // No explicit transaction needed (same reasoning as submit()/actOnApproval() on this tier) —
        // applyNextNodeActions may call TaskService::create() (another action node further along the
        // graph), which already wraps itself in its own transaction; PDO has no native nested-
        // transaction support, so this method's own UPDATE below is independently atomic.
        [$status, $currentNodeId, , $raisedTaskId] = $this->applyNextNodeActions($graph, $nextNode, $trail, $row);
        // applyNextNodeActions sets 'approved' for reaching an End node — correct for a human's own
        // Approval action, but a task-driven resume reaching End means something distinct
        // ('completed', not approved by anyone) that the Portal frontend's stepper renders
        // differently. Only overrides in that exact case.
        $closingNotesToSave = null;
        if ($status === 'approved') {
            $status = 'completed';
            if ($closingNotes !== null && trim($closingNotes) !== '') {
                $closingNotesToSave = $closingNotes;
            }
        }

        $stmt = $this->db->prepare(
            'UPDATE "FormSubmissions" SET "ApprovalTrailJson" = :trail, "Status" = :status, "CurrentNodeId" = :nodeId,
             "RaisedTaskId" = COALESCE(:raisedTaskId, "RaisedTaskId"), "ClosingNotes" = COALESCE(:closingNotes, "ClosingNotes"),
             "DateLastModified" = now() WHERE "Id" = :id'
        );
        $stmt->execute([
            'trail' => json_encode($trail), 'status' => $status, 'nodeId' => $currentNodeId, 'raisedTaskId' => $raisedTaskId,
            'closingNotes' => $closingNotesToSave, 'id' => $row['Id'],
        ]);

        $decisionNotify = null;
        if ($status === 'completed') {
            $decisionNotify = ['userId' => $row['SubmittedByUserId'], 'displayName' => 'Task completed', 'decision' => 'completed'];
        }
        return ['projectId' => $row['ProjectId'], 'submissionId' => $row['Id'], 'formName' => $row['FormName'], 'decisionNotify' => $decisionNotify];
    }

    /** Called by TasksController right after ANY task update, alongside resumeIfLinkedTaskDone —
     * cheap no-op for the overwhelming majority of task updates (an indexed lookup on RaisedTaskId
     * that only matches a submission still sitting at 'submitted', i.e. its raised Task hasn't been
     * picked up yet). The moment that Task's AssigneeId is non-null, flips the submission to
     * 'inProgress' ("In Review" in the UI) and stamps InReviewAt. Only ever fires once: after the
     * flip, the query's own Status = 'submitted' predicate no longer matches, so a later
     * re-assignment is a silent no-op, same idempotency shape as resumeIfLinkedTaskDone. */
    public function markInReviewIfTaskAssigned(string $taskId): void
    {
        $stmt = $this->db->prepare('SELECT "Id" FROM "FormSubmissions" WHERE "RaisedTaskId" = :tid AND "Status" = \'submitted\'');
        $stmt->execute(['tid' => $taskId]);
        $row = $stmt->fetch();
        if ($row === false) {
            return;
        }

        $taskStmt = $this->db->prepare('SELECT "AssigneeId" FROM "Tasks" WHERE "Id" = :id');
        $taskStmt->execute(['id' => $taskId]);
        $task = $taskStmt->fetch();
        if ($task === false || $task['AssigneeId'] === null) {
            return;
        }

        $this->db->prepare(
            'UPDATE "FormSubmissions" SET "Status" = \'inProgress\', "InReviewAt" = now(), "DateLastModified" = now() WHERE "Id" = :id'
        )->execute(['id' => $row['Id']]);
    }

    /** Backs GET .../tasks/{taskId}/form-link — the cheap "is this Task linked to a raised Form
     * submission" check the frontend's Done-column-transition prompt uses. */
    public function getRaisedFromTaskId(string $projectId, string $taskId): ?string
    {
        $stmt = $this->db->prepare('SELECT "Id" FROM "FormSubmissions" WHERE "ProjectId" = :pid AND "RaisedTaskId" = :tid');
        $stmt->execute(['pid' => $projectId, 'tid' => $taskId]);
        $id = $stmt->fetchColumn();
        return $id !== false ? (string) $id : null;
    }

    private static function resolveActionAssignee(?array $gate, array $trail): ?string
    {
        if ($gate !== null && ($gate['kind'] ?? null) === 'namedUser' && !empty($gate['value'])) {
            return (string) $gate['value'];
        }
        // Default/"formApprover" behavior: the most recent approver in the trail, if any known yet.
        $lastApproval = null;
        foreach ($trail as $entry) {
            if (($entry['action'] ?? null) === 'approved') {
                $lastApproval = $entry;
            }
        }
        return $lastApproval['actorUserId'] ?? null;
    }

    /** Compiles every field's own label + entered answer (the submitted Form version's FieldsJson,
     * matched against the submission's own AnswersJson — a flat {fieldId: value} map, see
     * Domain/Entities/FormSubmission.cs's own doc comment) into a Markdown block for the raised
     * Task's Description — same "Label: value" shape features/form-answers.js's
     * renderAnswerReadOnlyHTML already renders for a submitted Form's read-only view, just as plain
     * Markdown text instead of HTML (Task.Description is rendered through this app's own Markdown
     * rich-text editor). An unanswered field still gets its own "— (no answer)" line, so the raised
     * task always reflects the full field list, not just whatever happened to be filled in.
     * Best-effort: any unparsable fieldsJson/answersJson simply yields no description rather than
     * throwing — a malformed field/answer must never block the whole raise-task action. */
    private static function buildAnswersDescription(?string $fieldsJson, ?string $answersJson): ?string
    {
        if ($fieldsJson === null || trim($fieldsJson) === '') {
            return null;
        }
        $fields = json_decode($fieldsJson, true);
        if (!is_array($fields) || count($fields) === 0) {
            return null;
        }

        $answers = [];
        if ($answersJson !== null && trim($answersJson) !== '') {
            $decoded = json_decode($answersJson, true);
            if (is_array($decoded)) {
                $answers = $decoded;
            }
        }

        $lines = [];
        foreach ($fields as $field) {
            $id = $field['id'] ?? null;
            if ($id === null || $id === '') {
                continue;
            }
            $label = $field['label'] ?? null;
            if ($label === null || trim((string) $label) === '') {
                $label = $id;
            }
            $value = array_key_exists($id, $answers) ? $answers[$id] : null;
            $lines[] = '**' . $label . ':** ' . self::formatAnswerValue($field, $value);
        }
        return count($lines) === 0 ? null : implode("\n\n", $lines);
    }

    private static function formatAnswerValue(array $field, mixed $value): string
    {
        if ($value === null) {
            return '—';
        }
        $type = $field['type'] ?? null;
        if ($type === 'radio' && ($field['groupMode'] ?? null) === 'single') {
            return $value === true ? 'Yes' : 'No';
        }
        if (is_array($value)) {
            if (count($value) === 0) {
                return '—';
            }
            return implode(', ', array_map(fn ($id) => self::optionLabel($field, (string) $id), $value));
        }
        if ($type === 'checkboxGroup' || $type === 'select' || $type === 'priority' || ($type === 'radio' && ($field['groupMode'] ?? null) !== 'single')) {
            return self::optionLabel($field, (string) $value);
        }
        return (string) $value;
    }

    private const KNOWN_PRIORITIES = ['trivial', 'low', 'medium', 'high', 'critical'];

    /** Looks for a "priority" field (see form-fields.js's own fixed-option field type) in the
     * submitted Form version and, if it has an answered value that's one of the 5 known priority
     * keys, returns it lowercased — matches Column "Name" case-insensitively for free (the Portal's
     * 5 fixed columns are literally named Trivial/Low/Medium/High/Critical), same convention
     * config.priorityColumn already relies on. Returns null for any form with no priority field, an
     * unanswered one, or an answer that isn't one of the 5 known keys — executeActionNode falls back
     * to the static config.priorityColumn/"medium" default in every one of those cases. */
    private static function resolvePriorityFieldAnswer(?string $fieldsJson, ?string $answersJson): ?string
    {
        if ($fieldsJson === null || trim($fieldsJson) === '' || $answersJson === null || trim($answersJson) === '') {
            return null;
        }
        $fields = json_decode($fieldsJson, true);
        if (!is_array($fields)) {
            return null;
        }
        $priorityField = null;
        foreach ($fields as $f) {
            if (($f['type'] ?? null) === 'priority') {
                $priorityField = $f;
                break;
            }
        }
        if ($priorityField === null) {
            return null;
        }

        $answers = json_decode($answersJson, true);
        if (!is_array($answers) || !array_key_exists($priorityField['id'], $answers)) {
            return null;
        }
        $raw = $answers[$priorityField['id']];
        if (!is_string($raw)) {
            return null;
        }
        $lower = strtolower($raw);
        return in_array($lower, self::KNOWN_PRIORITIES, true) ? $lower : null;
    }

    private static function optionLabel(array $field, string $optionId): string
    {
        foreach (($field['options'] ?? []) as $option) {
            if (($option['id'] ?? null) === $optionId) {
                $label = $option['label'] ?? null;
                return ($label === null || trim((string) $label) === '') ? $optionId : (string) $label;
            }
        }
        return $optionId;
    }

    private function resolveActingUser(string $projectId, string $userId, bool $callerIsOrgAdmin): array
    {
        $stmt = $this->db->prepare('SELECT 1 FROM "ProjectMembers" WHERE "ProjectId" = :pid AND "UserId" = :uid AND "IsProjectAdmin" = true');
        $stmt->execute(['pid' => $projectId, 'uid' => $userId]);
        return ['id' => $userId, 'isOrgAdmin' => $callerIsOrgAdmin, 'isProjectAdmin' => $stmt->fetch() !== false];
    }

    private function resolveDisplayName(string $userId): string
    {
        $stmt = $this->db->prepare('SELECT "DisplayName" FROM "Users" WHERE "Id" = :id');
        $stmt->execute(['id' => $userId]);
        $name = $stmt->fetchColumn();
        return $name !== false ? (string) $name : 'someone';
    }

    // public, not private — reused directly by PortalHomeService::listMySubmissions, which needs a
    // FormGroupId-filtered variant of listMine() this class doesn't otherwise expose. Matches the
    // .NET tier's identical internal-visibility change to FormSubmissionService.ToListItemDto.
    public static function toListItemDto(array $s): array
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
            'answersJson' => $s['AnswersJson'], 'approvalTrailJson' => $s['ApprovalTrailJson'], 'raisedTaskId' => $s['RaisedTaskId'],
            'inReviewAt' => $s['InReviewAt'], 'closingNotes' => $s['ClosingNotes'],
            'dateCreated' => $s['DateCreated'], 'dateLastModified' => $s['DateLastModified'], 'dateSubmitted' => $s['DateSubmitted'],
        ];
    }
}
