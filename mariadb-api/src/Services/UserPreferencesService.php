<?php

declare(strict_types=1);

namespace Enkl\Api\Services;

use Enkl\Api\Validation\ApiValidationException;
use PDO;

/**
 * Ported from php-api's Services/UserPreferencesService.php. Self-service read/write of the
 * one-per-User personalization row (avatar + header colour) — a plain UPSERT since the row is
 * created lazily on first save, same "SELECT existing, then INSERT-or-UPDATE" shape as
 * OrganisationSsoConfigService. No boolean columns here, so this tier's usual
 * PDO_MYSQL-returns-int-not-bool gotcha doesn't apply.
 */
final class UserPreferencesService
{
    // Matches storage.js's client-side MAX_AVATAR_BYTES = 200KB source-file cap; base64 inflates
    // that by ~4/3, so this is the server-side backstop against a tampered/bypassed client, not the
    // primary control.
    private const MAX_AVATAR_LENGTH = 280000;

    public function __construct(private readonly PDO $db)
    {
    }

    public function get(string $userId): array
    {
        $stmt = $this->db->prepare('SELECT "Avatar", "HeaderColour" FROM "UserPreferences" WHERE "UserId" = :id');
        $stmt->execute(['id' => $userId]);
        $row = $stmt->fetch();
        return $this->toDto($row === false ? null : $row);
    }

    /** @param array<string,mixed> $request */
    public function update(string $userId, array $request): array
    {
        $avatar = $request['avatar'] ?? null;
        $headerColour = $request['headerColour'] ?? null;

        if ($avatar !== null && strlen((string) $avatar) > self::MAX_AVATAR_LENGTH) {
            throw new ApiValidationException('Avatar image is too large.');
        }

        $stmt = $this->db->prepare('SELECT "UserId" FROM "UserPreferences" WHERE "UserId" = :id');
        $stmt->execute(['id' => $userId]);
        $exists = $stmt->fetch() !== false;

        if ($exists) {
            $this->db->prepare(<<<SQL
                UPDATE "UserPreferences" SET "Avatar" = :avatar, "HeaderColour" = :headerColour, "DateLastModified" = now()
                WHERE "UserId" = :id
            SQL)->execute(['avatar' => $avatar, 'headerColour' => $headerColour, 'id' => $userId]);
        } else {
            $this->db->prepare(<<<SQL
                INSERT INTO "UserPreferences" ("UserId", "Avatar", "HeaderColour", "DateLastModified")
                VALUES (:id, :avatar, :headerColour, now())
            SQL)->execute(['id' => $userId, 'avatar' => $avatar, 'headerColour' => $headerColour]);
        }

        return $this->toDto(['Avatar' => $avatar, 'HeaderColour' => $headerColour]);
    }

    /** @param array<string,mixed>|null $row */
    private function toDto(?array $row): array
    {
        return [
            'avatar' => $row['Avatar'] ?? null,
            'headerColour' => $row['HeaderColour'] ?? null,
        ];
    }
}
