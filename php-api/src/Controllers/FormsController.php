<?php

declare(strict_types=1);

namespace Enkl\Api\Controllers;

use Enkl\Api\Db\Database;
use Enkl\Api\Services\FormService;
use Psr\Http\Message\ResponseInterface as Response;
use Psr\Http\Message\ServerRequestInterface as Request;

/**
 * Ported from Controllers/FormsController.cs. Org-Admin-only authoring of Enterprise Forms
 * (versions) — gated by OrgAdminMiddleware ONLY (see routes.php), same shape as StrategyController.
 * The read-only project-member surface lives in ProjectFormsController instead.
 */
final class FormsController extends BaseController
{
    private function forms(): FormService
    {
        return new FormService(Database::connection());
    }

    public function list(Request $request, Response $response): Response
    {
        return $this->json($response, $this->forms()->list($this->callerOrgId($request)));
    }

    public function get(Request $request, Response $response, array $args): Response
    {
        $result = $this->forms()->get($this->callerOrgId($request), $args['formId']);
        return $result !== null ? $this->json($response, $result) : $this->notFound($response);
    }

    public function create(Request $request, Response $response): Response
    {
        $result = $this->forms()->create($this->callerOrgId($request), $this->callerUserId($request), $this->body($request));
        return $this->json($response, $result);
    }

    public function update(Request $request, Response $response, array $args): Response
    {
        $result = $this->forms()->update($this->callerOrgId($request), $args['formId'], $this->body($request));
        return $result !== null ? $this->json($response, $result) : $this->notFound($response);
    }

    public function delete(Request $request, Response $response, array $args): Response
    {
        $deleted = $this->forms()->delete($this->callerOrgId($request), $args['formId']);
        return $deleted ? $this->noContent($response) : $this->notFound($response);
    }
}
