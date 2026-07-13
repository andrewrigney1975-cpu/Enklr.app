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
 * Ported from Program.cs's named rate-limiting policies (security review finding H1) — same
 * per-client-IP sliding-window shape, but DB-backed rather than in-memory: a PHP-FPM worker holds no
 * state between requests (same reasoning as 007_add_exchange_codes.sql's own note), so an in-memory
 * counter would only ever see the requests one worker happened to handle.
 *
 * `RateLimitHits` has no separate "policy" column, just PartitionKey — so the policy name is folded
 * into the partition key itself (see clientIp()'s caller below) to keep policies from sharing a
 * counter just because they happen to come from the same IP, mirroring how .NET's named
 * RateLimitPartition policies never share state with each other even for the same partition key.
 *
 * Default (no constructor args) reproduces the original "auth" policy exactly (10/min) for every
 * existing bare `RateLimitMiddleware::class` call site in routes.php — pass an already-constructed
 * instance (e.g. `new RateLimitMiddleware('telemetry', 30)`) for a route needing a different policy.
 */
final class RateLimitMiddleware implements MiddlewareInterface
{
    private const WINDOW_SECONDS = 60;

    public function __construct(
        private readonly string $policyName = 'auth',
        private readonly int $permitLimit = 10
    ) {
    }

    public function process(ServerRequestInterface $request, RequestHandlerInterface $handler): ResponseInterface
    {
        $partitionKey = $this->policyName . ':' . $this->clientIp($request);
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

        if ($count >= $this->permitLimit) {
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
