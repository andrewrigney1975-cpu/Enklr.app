<?php

declare(strict_types=1);

namespace Enkl\Api\Controllers;

use Enkl\Api\Db\Database;
use Enkl\Api\Services\SavedQueryService;
use Psr\Http\Message\ResponseInterface as Response;
use Psr\Http\Message\ServerRequestInterface as Request;

/** Ported from Controllers/SavedQueriesController.cs. */
final class SavedQueriesController extends BaseController
{
    private function service(): SavedQueryService
    {
        return new SavedQueryService(Database::connection());
    }

    public function create(Request $request, Response $response, array $args): Response
    {
        $result = $this->service()->create($args['projectId'], $this->body($request));
        return $result === null ? $this->notFound($response) : $this->json($response, $result);
    }

    public function delete(Request $request, Response $response, array $args): Response
    {
        return $this->service()->delete($args['projectId'], $args['id']) ? $this->noContent($response) : $this->notFound($response);
    }
}
