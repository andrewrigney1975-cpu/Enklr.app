<?php

declare(strict_types=1);

namespace Enkl\Api\Controllers;

use Enkl\Api\Db\Database;
use Enkl\Api\Realtime\Broadcaster;
use Enkl\Api\Services\PortalHomeService;
use Psr\Http\Message\ResponseInterface as Response;
use Psr\Http\Message\ServerRequestInterface as Request;

/**
 * Ported from php-api/src/Controllers/PortalHomeController.php (itself ported from
 * Controllers/PortalHomeController.cs). The end-user-facing side of Organisational Portals — gated
 * by RequireAuthMiddleware only (no ProjectMember/OrgAdmin middleware, see routes.php), same shape
 * as WhiteboardController/ChatController/ToDoController: a Portal must be reachable by an org user
 * who belongs to zero projects. See PortalHomeService's own doc comment for the access-check
 * guarantee every action here relies on.
 */
final class PortalHomeController extends BaseController
{
    private function service(): PortalHomeService
    {
        return new PortalHomeService(Database::connection());
    }

    public function listAccessible(Request $request, Response $response): Response
    {
        return $this->json($response, $this->service()->listAccessible($this->callerOrgId($request), $this->callerUserId($request)));
    }

    public function getBySlug(Request $request, Response $response, array $args): Response
    {
        $portal = $this->service()->getBySlug($this->callerOrgId($request), $args['slug'], $this->callerUserId($request));
        return $portal === null ? $this->notFound($response) : $this->json($response, $portal);
    }

    public function listAvailableForms(Request $request, Response $response, array $args): Response
    {
        $forms = $this->service()->listAvailableForms($this->callerOrgId($request), $args['portalId'], $this->callerUserId($request));
        return $forms === null ? $this->notFound($response) : $this->json($response, $forms);
    }

    public function listMySubmissions(Request $request, Response $response, array $args): Response
    {
        $submissions = $this->service()->listMySubmissions($this->callerOrgId($request), $args['portalId'], $this->callerUserId($request));
        return $submissions === null ? $this->notFound($response) : $this->json($response, $submissions);
    }

    public function listQa(Request $request, Response $response, array $args): Response
    {
        $qa = $this->service()->listQa($this->callerOrgId($request), $args['portalId'], $this->callerUserId($request));
        return $qa === null ? $this->notFound($response) : $this->json($response, $qa);
    }

    public function voteQaEntryNps(Request $request, Response $response, array $args): Response
    {
        $body = $this->body($request);
        $ok = $this->service()->voteQaEntryNps($this->callerOrgId($request), $args['portalId'], $args['entryId'], (string) ($body['direction'] ?? ''), $this->callerUserId($request));
        return $ok ? $this->noContent($response) : $this->notFound($response);
    }

    public function getSubmission(Request $request, Response $response, array $args): Response
    {
        $submission = $this->service()->getSubmission($this->callerOrgId($request), $args['portalId'], $this->callerUserId($request), $args['submissionId'], $this->callerIsOrgAdmin($request));
        return $submission === null ? $this->notFound($response) : $this->json($response, $submission);
    }

    public function createSubmission(Request $request, Response $response, array $args): Response
    {
        $body = $this->body($request);
        $submission = $this->service()->createSubmission($this->callerOrgId($request), $args['portalId'], $this->callerUserId($request), $body);
        return $submission === null ? $this->notFound($response) : $this->json($response, $submission);
    }

    public function updateSubmission(Request $request, Response $response, array $args): Response
    {
        $body = $this->body($request);
        $submission = $this->service()->updateSubmission($this->callerOrgId($request), $args['portalId'], $this->callerUserId($request), $args['submissionId'], $body);
        return $submission === null ? $this->notFound($response) : $this->json($response, $submission);
    }

    public function deleteSubmission(Request $request, Response $response, array $args): Response
    {
        $deleted = $this->service()->deleteSubmission($this->callerOrgId($request), $args['portalId'], $this->callerUserId($request), $args['submissionId']);
        return $deleted ? $this->noContent($response) : $this->notFound($response);
    }

    public function submitSubmission(Request $request, Response $response, array $args): Response
    {
        $result = $this->service()->submitSubmission($this->callerOrgId($request), $args['portalId'], $this->callerUserId($request), $args['submissionId']);
        if (!$result['ok']) {
            return $result['error'] === 'not_found' ? $this->notFound($response) : $this->json($response, ['message' => $result['error']], 400);
        }
        $this->notifyFormAction($result, $result['projectId']);
        return $this->json($response, $result['dto']);
    }

    public function listAwaitingMyAction(Request $request, Response $response, array $args): Response
    {
        $result = $this->service()->listAwaitingMyAction($this->callerOrgId($request), $args['portalId'], $this->callerUserId($request), $this->callerIsOrgAdmin($request));
        return $result === null ? $this->notFound($response) : $this->json($response, $result);
    }

    public function actOnApproval(Request $request, Response $response, array $args): Response
    {
        $body = $this->body($request);
        $result = $this->service()->actOnApproval(
            $this->callerOrgId($request), $args['portalId'], $this->callerUserId($request),
            $args['submissionId'], (string) ($body['action'] ?? ''), $body['comment'] ?? null, $this->callerIsOrgAdmin($request),
            $body['closingNotes'] ?? null
        );
        if (!$result['ok']) {
            return $result['error'] === 'not_found' ? $this->notFound($response) : $this->json($response, ['message' => $result['error']], 400);
        }
        $this->notifyFormAction($result, $result['projectId']);
        $this->notifyFormDecision($result, $result['projectId'], $body['comment'] ?? null);
        return $this->json($response, $result['dto']);
    }

    /** Broadcast ownership stays at the controller level (this tier's own convention — see
     * ProjectFormsController's identically-named private methods; duplicated here rather than
     * shared). Broadcasts by the Portal's real actioner ProjectId (PortalHomeService rides it along
     * in $result['projectId']), never the Portal's own id — clients are subscribed per real Project. */
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
