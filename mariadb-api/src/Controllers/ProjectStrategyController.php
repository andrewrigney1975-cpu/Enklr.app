<?php

declare(strict_types=1);

namespace Enkl\Api\Controllers;

use Enkl\Api\Db\Database;
use Enkl\Api\Services\StrategyFulfilmentService;
use Enkl\Api\Services\StrategyMetricService;
use Enkl\Api\Services\StrategyPillarService;
use Psr\Http\Message\ResponseInterface as Response;
use Psr\Http\Message\ServerRequestInterface as Request;

/**
 * Ported from php-api's Controllers/ProjectStrategyController.php (itself ported from
 * Controllers/ProjectStrategyController.cs). Read-only Strategy surface for regular project members
 * (ProjectMemberMiddleware, gated in routes.php). No CRUD lives here at all.
 */
final class ProjectStrategyController extends BaseController
{
    private function pillars(): StrategyPillarService
    {
        return new StrategyPillarService(Database::connection());
    }

    private function metrics(): StrategyMetricService
    {
        return new StrategyMetricService(Database::connection());
    }

    private function fulfilment(): StrategyFulfilmentService
    {
        return new StrategyFulfilmentService(Database::connection());
    }

    public function getTree(Request $request, Response $response, array $args): Response
    {
        $tree = $this->pillars()->getActivePillarTreeForProject($args['projectId']);
        return $tree !== null ? $this->json($response, $tree) : $this->notFound($response);
    }

    public function getMetricHistory(Request $request, Response $response, array $args): Response
    {
        $history = $this->metrics()->getHistoryForProject($args['projectId'], $args['metricId']);
        return $history !== null ? $this->json($response, $history) : $this->notFound($response);
    }

    public function getFulfilment(Request $request, Response $response, array $args): Response
    {
        $matrix = $this->fulfilment()->buildSingleProjectMatrix($args['projectId']);
        return $matrix !== null ? $this->json($response, $matrix) : $this->notFound($response);
    }
}
