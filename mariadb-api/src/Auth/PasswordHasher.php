<?php

declare(strict_types=1);

namespace Enkl\Api\Auth;

/**
 * PHP's native password_hash()/password_verify() (PASSWORD_BCRYPT) produces/reads the exact same
 * $2y$ hash format as .NET's BCrypt.Net-Next — a password set via one API tier verifies correctly
 * against the other without any migration step, as long as both point at the same Users table.
 */
final class PasswordHasher
{
    // Security review (Low/Informational finding): pinned explicitly rather than left at
    // password_hash()'s implicit PASSWORD_BCRYPT default cost, so the actual work factor is
    // visible/reviewable here instead of depending on whatever PHP ships as its own default.
    // Matches vendor-portal/server/scripts/seed-admin.js's existing cost factor and .NET's
    // PasswordHasher.
    private const WORK_FACTOR = 12;

    // The password every implicitly-created User account (MemberService::create's "add a member by
    // name" path, MigrationService's import path) gets when the Organisation hasn't configured its
    // own default via Organisations."DefaultNewUserPasswordHash" — see each of those classes' own
    // resolveDefaultNewUserPasswordHash() method, the only consumers of this constant.
    // MustChangePassword is always set alongside it, so this being a known, documented literal is by
    // design, not a leak.
    public const GLOBAL_DEFAULT_NEW_USER_PASSWORD = 'EnklrTask9999!';

    public static function hash(string $plainTextPassword): string
    {
        return password_hash($plainTextPassword, PASSWORD_BCRYPT, ['cost' => self::WORK_FACTOR]);
    }

    public static function verify(string $plainTextPassword, string $hash): bool
    {
        return password_verify($plainTextPassword, $hash);
    }
}
