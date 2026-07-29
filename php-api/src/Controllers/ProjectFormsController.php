<?php

declare(strict_types=1);

namespace Enkl\Api\Controllers;

use Enkl\Api\Db\Database;
use Enkl\Api\Realtime\Broadcaster;
use Enkl\Api\Services\FormService;
use Enkl\Api\Services\FormSubmissionService;
use Psr\Http\Message\ResponseInterface as Response;
use Psr\Http\Message\ServerRequestInterface as Request;

/**
 * Ported from Controllers/ProjectFormsController.cs. Project-member-facing surface for Enterprise
 * Forms — read published forms available to fill out, and manage the caller's own submission
 * drafts. No authoring/CRUD on Forms themselves lives here (mirrors ProjectStrategyController) —
 * every Form write happens through FormsController (OrgAdmin). Submit/approve actions land in
 * Phase 4/5; Phase 1 only has Draft CRUD.
 */
final class ProjectFormsController extends BaseController
{
    private function forms(): FormService
    {
        return new FormService(Database::connection());
    }

    private function submissions(): FormSubmissionService
    {
        return new FormSubmissionService(Database::connection());
    }

    public function listPublished(Request $request, Response $response): Response
    {
        return $this->json($response, $this->forms()->listPublished($this->callerOrgId($request)));
    }

    public function listMySubmissions(Request $request, Response $response, array $args): Response
    {
        return $this->json($response, $this->submissions()->listMine($args['projectId'], $this->callerUserId($request)));
    }

    public function listAwaitingMyAction(Request $request, Response $response, array $args): Response
    {
        return $this->json($response, $this->submissions()->listAwaitingMyAction($args['projectId'], $this->callerUserId($request), $this->callerIsOrgAdmin($request)));
    }

    public function getSubmission(Request $request, Response $response, array $args): Response
    {
        $result = $this->submissions()->get($args['projectId'], $args['submissionId']);
        return $result !== null ? $this->json($response, $result) : $this->notFound($response);
    }

    public function createSubmission(Request $request, Response $response, array $args): Response
    {
        $result = $this->submissions()->create($args['projectId'], $this->callerUserId($request), $this->body($request));
        return $result !== null ? $this->json($response, $result) : $this->notFound($response);
    }

    public function updateSubmission(Request $request, Response $response, array $args): Response
    {
        $result = $this->submissions()->update($args['projectId'], $this->callerUserId($request), $args['submissionId'], $this->body($request));
        return $result !== null ? $this->json($response, $result) : $this->notFound($response);
    }

    public function deleteSubmission(Request $request, Response $response, array $args): Response
    {
        $deleted = $this->submissions()->delete($args['projectId'], $this->callerUserId($request), $args['submissionId']);
        return $deleted ? $this->noContent($response) : $this->notFound($response);
    }

    public function submitSubmission(Request $request, Response $response, array $args): Response
    {
        $result = $this->submissions()->submit($args['projectId'], $this->callerUserId($request), $this->callerIsOrgAdmin($request), $args['submissionId']);
        if (!$result['ok']) {
            return $result['error'] === 'not_found' ? $this->notFound($response) : $this->json($response, ['message' => $result['error']], 400);
        }
        $this->notifyFormAction($result, $args['projectId']);
        return $this->json($response, $result['dto']);
    }

    public function actOnApproval(Request $request, Response $response, array $args): Response
    {
        $body = $this->body($request);
        $result = $this->submissions()->actOnApproval(
            $args['projectId'], $this->callerUserId($request), $this->callerIsOrgAdmin($request),
            $args['submissionId'], (string) ($body['action'] ?? ''), $body['comment'] ?? null
        );
        if (!$result['ok']) {
            return $result['error'] === 'not_found' ? $this->notFound($response) : $this->json($response, ['message' => $result['error']], 400);
        }
        $this->notifyFormAction($result, $args['projectId']);
        $this->notifyFormDecision($result, $args['projectId'], $body['comment'] ?? null);
        return $this->json($response, $result['dto']);
    }

    /** Broadcast ownership stays at the controller level (this tier's own convention — see
     * Controllers/TasksController.php); the service only decides WHO (FormSubmissionService's own
     * resolveNotifyTargets), never touches the Broadcaster itself. */
    private function notifyFormAction(array $result, string $projectId): void
    {
        $userIds = $result['notifyUserIds'] ?? [];
        if (count($userIds) === 0) {
            return;
        }
        $broadcaster = new Broadcaster(Database::connection());
        foreach ($userIds as $userId) {
            $broadcaster->broadcastFormActionRequired($userId, $projectId, $result['dto']['id'], $result['formName'] ?? '');
        }
    }

    /** Phase 7/8 — same broadcast-ownership split as notifyFormAction above, just for the final-
     * decision path's single, unconditional target (FormSubmissionService's own $decisionNotify,
     * computed inline since there's no gate-satisfaction "who" question to resolve here). Fires for
     * BOTH a rejection and the FINAL approval of a multi-step chain — never an intermediate one. */
    private function notifyFormDecision(array $result, string $projectId, ?string $comment): void
    {
        $target = $result['decisionNotify'] ?? null;
        if ($target === null) {
            return;
        }
        $broadcaster = new Broadcaster(Database::connection());
        $broadcaster->broadcastFormSubmissionDecided(
            $target['userId'], $projectId, $result['dto']['id'], $result['formName'] ?? '', $target['decision'], $target['displayName'], $comment
        );
    }
}
