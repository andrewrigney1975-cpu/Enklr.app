<?php

declare(strict_types=1);

namespace Enkl\Api\Controllers;

use Enkl\Api\Db\Database;
use Enkl\Api\Services\StrategyFulfilmentService;
use Enkl\Api\Services\StrategyMetricService;
use Enkl\Api\Services\StrategyPillarService;
use Enkl\Api\Services\StrategyService;
use Psr\Http\Message\ResponseInterface as Response;
use Psr\Http\Message\ServerRequestInterface as Request;

/**
 * Ported from php-api's Controllers/StrategyController.php (itself ported from
 * Controllers/StrategyController.cs). Org-Admin-only management of Strategies/Pillars/Enablers/
 * Metrics + the fulfilment-matrix upsert and OrgAdmin-side read — gated by OrgAdminMiddleware ONLY
 * (see routes.php). The read-only ProjectMember surface lives in ProjectStrategyController instead.
 */
final class StrategyController extends BaseController
{
    private function strategies(): StrategyService
    {
        return new StrategyService(Database::connection());
    }

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

    public function list(Request $request, Response $response): Response
    {
        return $this->json($response, $this->strategies()->list($this->callerOrgId($request)));
    }

    public function getActive(Request $request, Response $response): Response
    {
        $active = $this->strategies()->getActive($this->callerOrgId($request));
        return $active !== null ? $this->json($response, $active) : $this->notFound($response);
    }

    public function create(Request $request, Response $response): Response
    {
        return $this->json($response, $this->strategies()->create($this->callerOrgId($request), $this->body($request)));
    }

    public function update(Request $request, Response $response, array $args): Response
    {
        $result = $this->strategies()->update($this->callerOrgId($request), $args['strategyId'], $this->body($request));
        return $result !== null ? $this->json($response, $result) : $this->notFound($response);
    }

    public function activate(Request $request, Response $response, array $args): Response
    {
        $result = $this->strategies()->activate($this->callerOrgId($request), $args['strategyId']);
        return $result !== null ? $this->json($response, $result) : $this->notFound($response);
    }

    public function delete(Request $request, Response $response, array $args): Response
    {
        $deleted = $this->strategies()->delete($this->callerOrgId($request), $args['strategyId']);
        return $deleted ? $this->noContent($response) : $this->notFound($response);
    }

    // Strategy ownership check happens implicitly: an empty tree for a foreign-org strategyId looks
    // identical to a real, empty own-org strategy — no enumeration oracle either way.
    public function getTree(Request $request, Response $response, array $args): Response
    {
        $strategies = $this->strategies()->list($this->callerOrgId($request));
        $owned = array_filter($strategies, static fn(array $s) => $s['id'] === $args['strategyId']);
        if (count($owned) === 0) {
            return $this->notFound($response);
        }
        return $this->json($response, $this->pillars()->getPillarTree($args['strategyId']));
    }

    public function createPillar(Request $request, Response $response, array $args): Response
    {
        $result = $this->pillars()->createPillar($this->callerOrgId($request), $args['strategyId'], $this->body($request));
        return $result !== null ? $this->json($response, $result) : $this->notFound($response);
    }

    public function updatePillar(Request $request, Response $response, array $args): Response
    {
        $result = $this->pillars()->updatePillar($this->callerOrgId($request), $args['pillarId'], $this->body($request));
        return $result !== null ? $this->json($response, $result) : $this->notFound($response);
    }

    public function deletePillar(Request $request, Response $response, array $args): Response
    {
        $deleted = $this->pillars()->deletePillar($this->callerOrgId($request), $args['pillarId']);
        return $deleted ? $this->noContent($response) : $this->notFound($response);
    }

    public function createEnabler(Request $request, Response $response, array $args): Response
    {
        $result = $this->pillars()->createEnabler($this->callerOrgId($request), $args['pillarId'], $this->body($request));
        return $result !== null ? $this->json($response, $result) : $this->notFound($response);
    }

    public function updateEnabler(Request $request, Response $response, array $args): Response
    {
        $result = $this->pillars()->updateEnabler($this->callerOrgId($request), $args['enablerId'], $this->body($request));
        return $result !== null ? $this->json($response, $result) : $this->notFound($response);
    }

    public function deleteEnabler(Request $request, Response $response, array $args): Response
    {
        $deleted = $this->pillars()->deleteEnabler($this->callerOrgId($request), $args['enablerId']);
        return $deleted ? $this->noContent($response) : $this->notFound($response);
    }

    public function createMetricOnPillar(Request $request, Response $response, array $args): Response
    {
        $result = $this->metrics()->create($this->callerOrgId($request), $args['pillarId'], null, $this->body($request));
        return $result !== null ? $this->json($response, $result) : $this->json($response, ['message' => 'Invalid metric request.'], 400);
    }

    public function createMetricOnEnabler(Request $request, Response $response, array $args): Response
    {
        $result = $this->metrics()->create($this->callerOrgId($request), null, $args['enablerId'], $this->body($request));
        return $result !== null ? $this->json($response, $result) : $this->json($response, ['message' => 'Invalid metric request.'], 400);
    }

    public function updateMetric(Request $request, Response $response, array $args): Response
    {
        $result = $this->metrics()->update($this->callerOrgId($request), $args['metricId'], $this->body($request));
        return $result !== null ? $this->json($response, $result) : $this->notFound($response);
    }

    public function deleteMetric(Request $request, Response $response, array $args): Response
    {
        $deleted = $this->metrics()->delete($this->callerOrgId($request), $args['metricId']);
        return $deleted ? $this->noContent($response) : $this->notFound($response);
    }

    public function recordMetricEntry(Request $request, Response $response, array $args): Response
    {
        $result = $this->metrics()->recordEntry($this->callerOrgId($request), $args['metricId'], $this->body($request));
        return $result !== null ? $this->json($response, $result) : $this->notFound($response);
    }

    public function getMetricHistory(Request $request, Response $response, array $args): Response
    {
        $result = $this->metrics()->getHistory($this->callerOrgId($request), $args['metricId']);
        return $result !== null ? $this->json($response, $result) : $this->notFound($response);
    }

    // GET, not POST — pure read, same MustChangePassword-gate-avoidance reasoning as
    // PortfolioController::getAggregate.
    public function getFulfilmentMatrix(Request $request, Response $response): Response
    {
        $query = $request->getQueryParams();
        $projectIds = array_values(array_filter(array_map('trim', explode(',', (string) ($query['projectIds'] ?? '')))));
        return $this->json($response, $this->fulfilment()->buildMatrix($this->callerOrgId($request), $projectIds));
    }

    // Logically nested under Portfolio Planner's own route namespace (the only place this is ever
    // written from) — see routes.php for the absolute path this is registered under.
    public function upsertFulfilment(Request $request, Response $response, array $args): Response
    {
        $result = $this->fulfilment()->upsert($this->callerOrgId($request), $args['projectId'], $args['pillarId'], $this->body($request));
        return $result !== null ? $this->json($response, $result) : $this->notFound($response);
    }
}
