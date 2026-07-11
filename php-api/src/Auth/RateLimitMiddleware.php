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
 * Ported from Program.cs's "auth" rate-limiting policy (security review finding H1) — same limit
 * (10 requests/minute per client IP), but DB-backed rather than in-memory: a PHP-FPM worker holds no
 * state between requests (same reasoning as 007_add_exchange_codes.sql's own note), so an in-memory
 * counter would only ever see the requests one worker happened to handle. Applied per-route in
 * routes.php to login/change-password/sso-lookup/sso-exchange/migration, mirroring exactly which
 * .NET actions carry [EnableRateLimiting("auth")].
 */
final class RateLimitMiddleware implements MiddlewareInterface
{
    private const PERMIT_LIMIT = 10;
    private const WINDOW_SECONDS = 60;

    public function process(ServerRequestInterface $request, RequestHandlerInterface $handler): ResponseInterface
    {
        $partitionKey = $this->clientIp($request);
        $db = Database::connection();

        // Opportunistic prune, same lazy-prune convention as ExchangeCodes/SsoExchangeCodeService —
        // no separate cron/cleanup job needed for a table that's naturally self-limiting in size.
        $db->prepare('DELETE FROM "RateLimitHits" WHERE "OccurredAt" < now() - make_interval(secs => :window)')
            ->execute(['window' => self::WINDOW_SECONDS]);

        $countStmt = $db->prepare(
            'SELECT COUNT(*) FROM "RateLimitHits" WHERE "PartitionKey" = :key AND "OccurredAt" > now() - make_interval(secs => :window)'
        );
        $countStmt->execute(['key' => $partitionKey, 'window' => self::WINDOW_SECONDS]);
        $count = (int) $countStmt->fetchColumn();

        if ($count >= self::PERMIT_LIMIT) {
            $response = new Response(429);
            $response->getBody()->write(json_encode(['message' => 'Too many attempts. Please wait a moment and try again.']));
            return $response->withHeader('Content-Type', 'application/json');
        }

        $db->prepare('INSERT INTO "RateLimitHits" ("PartitionKey") VALUES (:key)')->execute(['key' => $partitionKey]);

        return $handler->handle($request);
    }

    /**
     * Prefers X-Forwarded-For's first (original client) entry — this tier is only ever reached
     * through the same nginx as the .NET tier (web/nginx.conf), which now forwards it (see that
     * file's own H4 note) — falling back to the raw connection address if the header is absent
     * (e.g. a direct request during local development).
     */
    private function clientIp(ServerRequestInterface $request): string
    {
        $forwardedFor = $request->getHeaderLine('X-Forwarded-For');
        if ($forwardedFor !== '') {
            return trim(explode(',', $forwardedFor)[0]);
        }
        $server = $request->getServerParams();
        return (string) ($server['REMOTE_ADDR'] ?? 'unknown');
    }
}
