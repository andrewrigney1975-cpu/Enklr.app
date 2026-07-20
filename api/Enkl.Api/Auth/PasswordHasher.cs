namespace Enkl.Api.Auth;

public static class PasswordHasher
{
    // Security review (Low/Informational finding): pinned explicitly rather than left at
    // BCrypt.Net-Next's implicit default, so the actual work factor is visible/reviewable here
    // instead of depending on whatever the library ships as its own default. Matches
    // vendor-portal/server/scripts/seed-admin.js's existing cost factor and PHP's PasswordHasher.
    private const int WorkFactor = 12;

    // The password every implicitly-created User account (MemberService.CreateAsync's "add a
    // member by name" path, MigrationEntityBuilder's import path) gets when the Organisation hasn't
    // configured its own default via Organisation.DefaultNewUserPasswordHash — see
    // OrganisationService.ResolveDefaultNewUserPasswordHashAsync, the one place this constant is
    // actually consumed. MustChangePassword is always set alongside it, so this being a known,
    // documented literal is by design, not a leak.
    public const string GlobalDefaultNewUserPassword = "EnklrTask9999!";

    public static string Hash(string plainTextPassword) => BCrypt.Net.BCrypt.HashPassword(plainTextPassword, WorkFactor);

    public static bool Verify(string plainTextPassword, string hash) => BCrypt.Net.BCrypt.Verify(plainTextPassword, hash);
}
