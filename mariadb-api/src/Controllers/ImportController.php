<?php

declare(strict_types=1);

namespace Enkl\Api\Controllers;

use Enkl\Api\Db\Database;
use Enkl\Api\Services\ImportService;
use Enkl\Api\Services\MemberService;
use Enkl\Api\Services\OrganisationService;
use Psr\Http\Message\ResponseInterface as Response;
use Psr\Http\Message\ServerRequestInterface as Request;

/** Ported from Controllers/ImportController.cs — every action here requires OrgAdminMiddleware (see routes.php). */
final class ImportController extends BaseController
{
    private function service(): ImportService
    {
        $db = Database::connection();
        return new ImportService($db, new OrganisationService($db), new MemberService($db));
    }

    public function importOrganisationUsers(Request $request, Response $response): Response
    {
        $body = $this->body($request);
        $rows = is_array($body['rows'] ?? null) ? $body['rows'] : [];
        $dryRun = (bool) ($body['dryRun'] ?? false);
        $result = $this->service()->importOrganisationUsers($this->callerOrgId($request), $rows, $dryRun);
        return $this->json($response, $result);
    }

    public function importTeamMembers(Request $request, Response $response): Response
    {
        $body = $this->body($request);
        $rows = is_array($body['rows'] ?? null) ? $body['rows'] : [];
        $dryRun = (bool) ($body['dryRun'] ?? false);
        $result = $this->service()->importTeamMembers($this->callerOrgId($request), $rows, $dryRun);
        return $this->json($response, $result);
    }
}
