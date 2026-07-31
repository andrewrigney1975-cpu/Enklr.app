<?php

declare(strict_types=1);

namespace Enkl\Api\Controllers;

use Enkl\Api\Db\Database;
use Enkl\Api\Services\PortalService;
use Psr\Http\Message\ResponseInterface as Response;
use Psr\Http\Message\ServerRequestInterface as Request;

/**
 * Ported from Controllers/PortalsController.cs. Org-Admin authoring of Organisational Portals —
 * gated by OrgAdminMiddleware only (see routes.php). See PortalService's own doc comment for the
 * cross-org isolation guarantee every action here relies on.
 */
final class PortalsController extends BaseController
{
    private function service(): PortalService
    {
        return new PortalService(Database::connection());
    }

    public function list(Request $request, Response $response): Response
    {
        return $this->json($response, $this->service()->list($this->callerOrgId($request)));
    }

    public function get(Request $request, Response $response, array $args): Response
    {
        $portal = $this->service()->get($this->callerOrgId($request), $args['portalId']);
        return $portal === null ? $this->notFound($response) : $this->json($response, $portal);
    }

    public function create(Request $request, Response $response): Response
    {
        $body = $this->body($request);
        $portal = $this->service()->create($this->callerOrgId($request), $this->callerUserId($request), $body);
        return $this->json($response, $portal);
    }

    public function update(Request $request, Response $response, array $args): Response
    {
        $body = $this->body($request);
        $portal = $this->service()->update($this->callerOrgId($request), $args['portalId'], $body);
        return $portal === null ? $this->notFound($response) : $this->json($response, $portal);
    }

    public function publish(Request $request, Response $response, array $args): Response
    {
        $portal = $this->service()->publish($this->callerOrgId($request), $args['portalId']);
        return $portal === null ? $this->notFound($response) : $this->json($response, $portal);
    }

    public function archive(Request $request, Response $response, array $args): Response
    {
        $portal = $this->service()->archive($this->callerOrgId($request), $args['portalId']);
        return $portal === null ? $this->notFound($response) : $this->json($response, $portal);
    }

    public function delete(Request $request, Response $response, array $args): Response
    {
        $deleted = $this->service()->delete($this->callerOrgId($request), $args['portalId']);
        return $deleted ? $this->noContent($response) : $this->notFound($response);
    }

    public function listAccessGrants(Request $request, Response $response, array $args): Response
    {
        $grants = $this->service()->listAccessGrants($this->callerOrgId($request), $args['portalId']);
        return $grants === null ? $this->notFound($response) : $this->json($response, $grants);
    }

    public function addAccessGrant(Request $request, Response $response, array $args): Response
    {
        $body = $this->body($request);
        $grant = $this->service()->addAccessGrant($this->callerOrgId($request), $args['portalId'], $body);
        return $grant === null ? $this->notFound($response) : $this->json($response, $grant);
    }

    public function removeAccessGrant(Request $request, Response $response, array $args): Response
    {
        $removed = $this->service()->removeAccessGrant($this->callerOrgId($request), $args['portalId'], $args['grantId']);
        return $removed ? $this->noContent($response) : $this->notFound($response);
    }

    // GET, not POST — a pure read, same MustChangePassword-gate-avoidance reasoning as
    // PortfolioController's own getAggregate/getActivity.
    public function previewAccess(Request $request, Response $response, array $args): Response
    {
        $userId = (string) ($request->getQueryParams()['userId'] ?? '');
        $hasAccess = $this->service()->previewUserHasAccess($args['portalId'], $userId);
        return $this->json($response, ['hasAccess' => $hasAccess]);
    }

    public function listForms(Request $request, Response $response, array $args): Response
    {
        $forms = $this->service()->listAttachedForms($this->callerOrgId($request), $args['portalId']);
        return $forms === null ? $this->notFound($response) : $this->json($response, $forms);
    }

    public function attachForm(Request $request, Response $response, array $args): Response
    {
        $body = $this->body($request);
        $form = $this->service()->attachForm($this->callerOrgId($request), $args['portalId'], $body);
        return $form === null ? $this->notFound($response) : $this->json($response, $form);
    }

    public function detachForm(Request $request, Response $response, array $args): Response
    {
        $removed = $this->service()->detachForm($this->callerOrgId($request), $args['portalId'], $args['portalFormId']);
        return $removed ? $this->noContent($response) : $this->notFound($response);
    }

    public function listTopics(Request $request, Response $response, array $args): Response
    {
        $topics = $this->service()->listTopics($this->callerOrgId($request), $args['portalId']);
        return $topics === null ? $this->notFound($response) : $this->json($response, $topics);
    }

    public function createTopic(Request $request, Response $response, array $args): Response
    {
        $body = $this->body($request);
        $topic = $this->service()->createTopic($this->callerOrgId($request), $args['portalId'], $body);
        return $topic === null ? $this->notFound($response) : $this->json($response, $topic);
    }

    public function updateTopic(Request $request, Response $response, array $args): Response
    {
        $body = $this->body($request);
        $topic = $this->service()->updateTopic($this->callerOrgId($request), $args['portalId'], $args['topicId'], $body);
        return $topic === null ? $this->notFound($response) : $this->json($response, $topic);
    }

    public function deleteTopic(Request $request, Response $response, array $args): Response
    {
        $removed = $this->service()->deleteTopic($this->callerOrgId($request), $args['portalId'], $args['topicId']);
        return $removed ? $this->noContent($response) : $this->notFound($response);
    }

    public function reorderTopic(Request $request, Response $response, array $args): Response
    {
        $body = $this->body($request);
        $ok = $this->service()->reorderTopic($this->callerOrgId($request), $args['portalId'], $args['topicId'], (string) ($body['direction'] ?? ''));
        return $ok ? $this->noContent($response) : $this->notFound($response);
    }

    public function listQaEntries(Request $request, Response $response, array $args): Response
    {
        $entries = $this->service()->listQaEntries($this->callerOrgId($request), $args['portalId']);
        return $entries === null ? $this->notFound($response) : $this->json($response, $entries);
    }

    public function createQaEntry(Request $request, Response $response, array $args): Response
    {
        $body = $this->body($request);
        $entry = $this->service()->createQaEntry($this->callerOrgId($request), $args['portalId'], $this->callerUserId($request), $body);
        return $entry === null ? $this->notFound($response) : $this->json($response, $entry);
    }

    public function updateQaEntry(Request $request, Response $response, array $args): Response
    {
        $body = $this->body($request);
        $entry = $this->service()->updateQaEntry($this->callerOrgId($request), $args['portalId'], $args['entryId'], $body);
        return $entry === null ? $this->notFound($response) : $this->json($response, $entry);
    }

    public function deleteQaEntry(Request $request, Response $response, array $args): Response
    {
        $removed = $this->service()->deleteQaEntry($this->callerOrgId($request), $args['portalId'], $args['entryId']);
        return $removed ? $this->noContent($response) : $this->notFound($response);
    }

    public function reorderQaEntry(Request $request, Response $response, array $args): Response
    {
        $body = $this->body($request);
        $ok = $this->service()->reorderQaEntry($this->callerOrgId($request), $args['portalId'], $args['entryId'], (string) ($body['direction'] ?? ''));
        return $ok ? $this->noContent($response) : $this->notFound($response);
    }
}
