<?php

declare(strict_types=1);

namespace Enkl\Api\Auth;

use Enkl\Api\Db\Database;
use Psr\Http\Message\ResponseInterface;
use Psr\Http\Message\ServerRequestInterface;
use Psr\Http\Server\MiddlewareInterface;
use Psr\Http\Server\RequestHandlerInterface;
use Slim\Psr7\Response;

/**
 * Ported from Program.cs's MustChangePassword-enforcement middleware (security review finding C4):
 * the flag was being set at account creation (e.g. MigrationService's default "enklUserPassword"
 * accounts) and returned in the login response, but nothing previously stopped an account from being
 * used indefinitely without ever actually changing it. Only mutating requests (POST/PUT/PATCH/DELETE)
 * are blocked — reads still work so a signed-in client isn't broken while the change-password prompt
 * is up — and it's a live DB read, not a JWT claim, since the token never carries this flag and would
 * go stale the instant it's cleared anyway. /api/auth/change-password is the one exempted mutating
 * route — it's the only way to ever clear the flag.
 *
 * Registered at app level in routes.php, added BEFORE JwtAuthMiddleware so it runs AFTER it (Slim's
 * middleware stack is LIFO — the last ->add() call is outermost/runs first).
 */
final class MustChangePasswordMiddleware implements MiddlewareInterface
{
    private const MUTATING_METHODS = ['POST', 'PUT', 'PATCH', 'DELETE'];

    public function process(ServerRequestInterface $request, RequestHandlerInterface $handler): ResponseInterface
    {
        $isMutating = in_array(strtoupper($request->getMethod()), self::MUTATING_METHODS, true);
        $isChangePasswordRoute = str_starts_with($request->getUri()->getPath(), '/api/auth/change-password');
        $claims = $request->getAttribute('jwtClaims');

        if ($isMutating && !$isChangePasswordRoute && $claims !== null && isset($claims->sub)) {
            $stmt = Database::connection()->prepare('SELECT "MustChangePassword" FROM "Users" WHERE "Id" = :id');
            $stmt->execute(['id' => (string) $claims->sub]);
            $mustChangePassword = $stmt->fetchColumn();

            if ($mustChangePassword !== false && (bool) $mustChangePassword) {
                $response = new Response(403);
                $response->getBody()->write(json_encode([
                    'code' => 'must_change_password',
                    'message' => 'You must change your password before making further changes.',
                ]));
                return $response->withHeader('Content-Type', 'application/json');
            }
        }

        return $handler->handle($request);
    }
}
