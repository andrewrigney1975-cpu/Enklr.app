<?php

declare(strict_types=1);

namespace Enkl\Api\Auth;

use Enkl\Api\Db\Database;
use Psr\Http\Message\ResponseInterface;
use Psr\Http\Message\ServerRequestInterface;
use Psr\Http\Server\MiddlewareInterface;
use Psr\Http\Server\RequestHandlerInterface;
use Slim\Psr7\Response;
use Slim\Routing\RouteContext;

/**
 * Ported from Auth/ApiKeyAuthFilter.cs. Gates PublicQueryController behind a static,
 * per-Organisation bearer token — same shape as ScimAuthMiddleware (not a user JWT, applied INSTEAD
 * OF JwtAuthMiddleware/RequireAuthMiddleware for this route). Accepts EITHER the org-wide key
 * (OrganisationApiKeys) OR any active Vendor's own key (VendorIntegrations.ApiKeyHash, via "Manage
 * Vendors") — a Vendor key grants access to ANY published endpoint in its Organisation, identical
 * scope to the org-wide key, no per-query/per-vendor fine-grained restriction.
 *
 * Every failure mode here — savedQueryId doesn't exist, the query exists but ExposeViaApi=false,
 * the key is missing/wrong/disabled (whether checked as an org key or every candidate Vendor key),
 * or the key belongs to a different org than the query's project — returns the IDENTICAL 404, per
 * this codebase's standing no-enumeration-oracle rule.
 *
 * On success, the resolved SavedQuery row is attached to the request as an attribute so
 * PublicQueryController doesn't need a second lookup.
 */
final class ApiKeyAuthMiddleware implements MiddlewareInterface
{
    public const SAVED_QUERY_ATTRIBUTE = 'publicQuery.savedQuery';

    public function process(ServerRequestInterface $request, RequestHandlerInterface $handler): ResponseInterface
    {
        $savedQueryId = RouteContext::fromRequest($request)->getRoute()?->getArgument('savedQueryId');
        if ($savedQueryId === null) {
            return $this->notFound();
        }

        $authHeader = $request->getHeaderLine('Authorization');
        if (stripos($authHeader, 'bearer ') !== 0) {
            return $this->notFound();
        }
        $apiKey = trim(substr($authHeader, 7));
        if ($apiKey === '') {
            return $this->notFound();
        }

        $db = Database::connection();
        $stmt = $db->prepare(
            'SELECT q.*, p."OrganisationId" AS "OrganisationId" FROM "SavedQueries" q ' .
            'JOIN "Projects" p ON p."Id" = q."ProjectId" WHERE q."Id" = :id'
        );
        $stmt->execute(['id' => $savedQueryId]);
        $query = $stmt->fetch();

        if ($query === false || !(bool) $query['ExposeViaApi']) {
            return $this->notFound();
        }

        $organisationId = $query['OrganisationId'];
        $keyStmt = $db->prepare('SELECT * FROM "OrganisationApiKeys" WHERE "OrganisationId" = :id');
        $keyStmt->execute(['id' => $organisationId]);
        $orgKey = $keyStmt->fetch();

        $orgKeyMatches = $orgKey !== false && (bool) $orgKey['Enabled'] && !empty($orgKey['KeyHash']) &&
            PasswordHasher::verify($apiKey, $orgKey['KeyHash']);

        $matchedIntegrationId = null;
        if (!$orgKeyMatches) {
            // No exact-value lookup possible for a bcrypt hash — try every active Vendor's own
            // active key for this org. O(active-vendor-count) bcrypt verifies when neither the org
            // key nor an earlier candidate matches; bcrypt is deliberately slow, so this is the real
            // per-request cost of a bad/missing key here. Fine at this feature's expected scale (a
            // handful of vendors per org, not thousands) — revisit if that assumption stops holding.
            $vendorStmt = $db->prepare(
                'SELECT vi.* FROM "VendorIntegrations" vi JOIN "Vendors" v ON v."Id" = vi."VendorId" ' .
                'WHERE vi."IsActive" = true AND v."IsActive" = true AND v."OrganisationId" = :orgId'
            );
            $vendorStmt->execute(['orgId' => $organisationId]);
            foreach ($vendorStmt->fetchAll() as $candidate) {
                if (!empty($candidate['ApiKeyHash']) && PasswordHasher::verify($apiKey, $candidate['ApiKeyHash'])) {
                    $matchedIntegrationId = $candidate['Id'];
                    break;
                }
            }
        }

        if (!$orgKeyMatches && $matchedIntegrationId === null) {
            return $this->notFound();
        }

        // Lightweight usage audit trail, same convention/rationale as ScimTokenLastUsedAt — updates
        // whichever key actually matched.
        if ($orgKeyMatches) {
            $db->prepare('UPDATE "OrganisationApiKeys" SET "LastUsedAt" = now() WHERE "OrganisationId" = :id')
                ->execute(['id' => $organisationId]);
        } else {
            $db->prepare('UPDATE "VendorIntegrations" SET "LastUsedAt" = now() WHERE "Id" = :id')
                ->execute(['id' => $matchedIntegrationId]);
        }

        return $handler->handle($request->withAttribute(self::SAVED_QUERY_ATTRIBUTE, $query));
    }

    private function notFound(): ResponseInterface
    {
        $response = new Response(404);
        $response->getBody()->write(json_encode(['message' => 'Not found.']));
        return $response->withHeader('Content-Type', 'application/json');
    }
}
