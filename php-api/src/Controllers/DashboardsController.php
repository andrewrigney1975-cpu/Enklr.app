<?php

declare(strict_types=1);

namespace Enkl\Api\Controllers;

use Enkl\Api\Db\Database;
use Enkl\Api\Services\DashboardService;
use Psr\Http\Message\ResponseInterface as Response;
use Psr\Http\Message\ServerRequestInterface as Request;

/** Ported from Controllers/DashboardsController.cs. Read actions (list/get) are reachable by any
 * ProjectMember; every mutation is additionally ProjectAdminMiddleware-gated in routes.php (nested
 * admin sub-group, same shape Columns/Members already use). */
final class DashboardsController extends BaseController
{
    private function service(): DashboardService
    {
        return new DashboardService(Database::connection());
    }

    public function list(Request $request, Response $response, array $args): Response
    {
        return $this->json($response, $this->service()->list($args['projectId']));
    }

    public function get(Request $request, Response $response, array $args): Response
    {
        $result = $this->service()->get($args['projectId'], $args['dashboardId']);
        return $result === null ? $this->notFound($response) : $this->json($response, $result);
    }

    public function create(Request $request, Response $response, array $args): Response
    {
        $result = $this->service()->create($args['projectId'], $this->body($request));
        return $result === null ? $this->notFound($response) : $this->json($response, $result);
    }

    public function update(Request $request, Response $response, array $args): Response
    {
        $result = $this->service()->update($args['projectId'], $args['dashboardId'], $this->body($request));
        return $result === null ? $this->notFound($response) : $this->json($response, $result);
    }

    public function delete(Request $request, Response $response, array $args): Response
    {
        return $this->service()->delete($args['projectId'], $args['dashboardId']) ? $this->noContent($response) : $this->notFound($response);
    }

    public function createWidget(Request $request, Response $response, array $args): Response
    {
        $result = $this->service()->createWidget($args['projectId'], $args['dashboardId'], $this->body($request));
        return $result === null ? $this->notFound($response) : $this->json($response, $result);
    }

    public function updateWidget(Request $request, Response $response, array $args): Response
    {
        $result = $this->service()->updateWidget($args['projectId'], $args['dashboardId'], $args['widgetId'], $this->body($request));
        return $result === null ? $this->notFound($response) : $this->json($response, $result);
    }

    public function deleteWidget(Request $request, Response $response, array $args): Response
    {
        return $this->service()->deleteWidget($args['projectId'], $args['dashboardId'], $args['widgetId']) ? $this->noContent($response) : $this->notFound($response);
    }
}
