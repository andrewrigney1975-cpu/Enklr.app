<?php

declare(strict_types=1);

namespace Enkl\Api\Controllers;

use Enkl\Api\Db\Database;
use Enkl\Api\Services\UserPreferencesService;
use Psr\Http\Message\ResponseInterface as Response;
use Psr\Http\Message\ServerRequestInterface as Request;

/** Ported from Controllers/UsersController.cs. Self-service, current-user-only — every signed-in
 * user manages their own preferences, so this route is RequireAuthMiddleware only (no
 * OrgAdminMiddleware/ProjectMemberMiddleware, unlike OrganisationsController's routes which are all
 * OrgAdmin-gated over OTHER users). */
final class UsersController extends BaseController
{
    private function service(): UserPreferencesService
    {
        return new UserPreferencesService(Database::connection());
    }

    public function getPreferences(Request $request, Response $response): Response
    {
        return $this->json($response, $this->service()->get($this->callerUserId($request)));
    }

    public function updatePreferences(Request $request, Response $response): Response
    {
        return $this->json($response, $this->service()->update($this->callerUserId($request), $this->body($request)));
    }
}
