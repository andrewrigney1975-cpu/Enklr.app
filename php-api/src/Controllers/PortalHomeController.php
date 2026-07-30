<?php

declare(strict_types=1);

namespace Enkl\Api\Controllers;

use Enkl\Api\Db\Database;
use Enkl\Api\Services\PortalHomeService;
use Psr\Http\Message\ResponseInterface as Response;
use Psr\Http\Message\ServerRequestInterface as Request;

/**
 * Ported from Controllers/PortalHomeController.cs. The end-user-facing side of Organisational
 * Portals — gated by RequireAuthMiddleware only (no ProjectMember/OrgAdmin middleware, see
 * routes.php), same shape as WhiteboardController/ChatController/ToDoController: a Portal must be
 * reachable by an org user who belongs to zero projects. See PortalHomeService's own doc comment for
 * the access-check guarantee every action here relies on.
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
        return $this->json($response, $result['dto']);
    }
}
