<?php

declare(strict_types=1);

namespace Enkl\Api\Controllers;

use Enkl\Api\Db\Database;
use Enkl\Api\Services\VendorService;
use Psr\Http\Message\ResponseInterface as Response;
use Psr\Http\Message\ServerRequestInterface as Request;

/** Ported from Controllers/VendorController.cs. Org-Admin-only "Manage Vendors" surface — CRUD plus
 * per-Vendor API key generate/revoke, same callerOrgId() idiom as OrganisationApiKeyController. */
final class VendorController extends BaseController
{
    private function service(): VendorService
    {
        return new VendorService(Database::connection());
    }

    public function list(Request $request, Response $response): Response
    {
        return $this->json($response, $this->service()->list($this->callerOrgId($request)));
    }

    public function get(Request $request, Response $response, array $args): Response
    {
        $result = $this->service()->get($this->callerOrgId($request), $args['vendorId']);
        return $result === null ? $this->notFound($response) : $this->json($response, $result);
    }

    public function create(Request $request, Response $response): Response
    {
        return $this->json($response, $this->service()->create($this->callerOrgId($request), $this->body($request)));
    }

    public function update(Request $request, Response $response, array $args): Response
    {
        $result = $this->service()->update($this->callerOrgId($request), $args['vendorId'], $this->body($request));
        return $result === null ? $this->notFound($response) : $this->json($response, $result);
    }

    public function delete(Request $request, Response $response, array $args): Response
    {
        $deleted = $this->service()->delete($this->callerOrgId($request), $args['vendorId']);
        return $deleted ? $this->noContent($response) : $this->notFound($response);
    }

    public function generateApiKey(Request $request, Response $response, array $args): Response
    {
        $result = $this->service()->generateApiKey($this->callerOrgId($request), $args['vendorId']);
        return $result === null ? $this->notFound($response) : $this->json($response, $result);
    }

    public function revokeApiKey(Request $request, Response $response, array $args): Response
    {
        $result = $this->service()->revokeApiKey($this->callerOrgId($request), $args['vendorId']);
        return $result === null ? $this->notFound($response) : $this->json($response, $result);
    }
}
