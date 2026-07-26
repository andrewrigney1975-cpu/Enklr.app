<?php

declare(strict_types=1);

namespace Enkl\Api\Controllers;

use Enkl\Api\Db\Database;
use Enkl\Api\Services\DashboardService;
use Psr\Http\Message\ResponseInterface as Response;
use Psr\Http\Message\ServerRequestInterface as Request;

/** Ported from Controllers/OrgDashboardsController.cs. Gated by OrgAdminMiddleware ONLY (see
 * routes.php) — same "no ProjectMemberMiddleware" shape as PortfolioController.php, since an Org
 * Admin browsing every Dashboard in the org may not personally belong to every project in it. */
final class OrgDashboardsController extends BaseController
{
    private function service(): DashboardService
    {
        return new DashboardService(Database::connection());
    }

    public function list(Request $request, Response $response): Response
    {
        return $this->json($response, $this->service()->listForOrg($this->callerOrgId($request)));
    }
}
