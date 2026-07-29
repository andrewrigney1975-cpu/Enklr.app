<?php

declare(strict_types=1);

namespace Enkl\Api\Services;

use PDO;

/**
 * Ported from php-api/src/Services/PortalSlugResolver.php (itself ported from
 * Services/PortalSlugResolver.cs). Mirrors the project-key derive-then-uniquify shape for Portal
 * Slug instead of Project Key — a human-readable, hashbang-routable (#!/portal/<slug>) identifier,
 * unique per Organisation. No dialect divergence from the Postgres tier anywhere in this file.
 */
final class PortalSlugResolver
{
    public static function deriveSlug(?string $requestedSlug, string $name): string
    {
        $fromRequested = self::slugify($requestedSlug ?? '');
        if ($fromRequested !== '') {
            return self::truncate($fromRequested);
        }
        $fromName = self::slugify($name);
        return self::truncate($fromName !== '' ? $fromName : 'portal');
    }

    public static function resolveUniqueSlug(PDO $db, string $baseSlug, string $organisationId, ?string $excludePortalId = null): string
    {
        $sql = 'SELECT 1 FROM "Portals" WHERE "Slug" = :slug AND "OrganisationId" = :orgId'
            . ($excludePortalId !== null ? ' AND "Id" != :excludeId' : '');
        $candidate = $baseSlug;
        $suffix = 1;
        while (true) {
            $params = ['slug' => $candidate, 'orgId' => $organisationId];
            if ($excludePortalId !== null) {
                $params['excludeId'] = $excludePortalId;
            }
            $stmt = $db->prepare($sql);
            $stmt->execute($params);
            if ($stmt->fetch() === false) {
                return $candidate;
            }
            $suffix++;
            $candidate = "{$baseSlug}-{$suffix}";
        }
    }

    private static function slugify(string $value): string
    {
        $lowered = mb_strtolower(trim($value));
        $withDashes = preg_replace('/[^a-z0-9]+/', '-', $lowered) ?? '';
        return trim($withDashes, '-');
    }

    private static function truncate(string $slug): string
    {
        return mb_strlen($slug) > 80 ? rtrim(mb_substr($slug, 0, 80), '-') : $slug;
    }
}
