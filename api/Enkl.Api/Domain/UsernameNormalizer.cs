using System.Text.RegularExpressions;

namespace Enkl.Api.Domain;

/// <summary>
/// Shared by login (to match a typed username against the stored NormalizedUsername) and the
/// migration dedup algorithm (to derive/match usernames from legacy Member names) — both must
/// use the exact same normalization or a migrated user could never log in with their own name.
/// </summary>
public static partial class UsernameNormalizer
{
    public static string Normalize(string name) => NonAlphanumeric().Replace(name.Trim().ToLowerInvariant(), "");

    [GeneratedRegex("[^a-z0-9]")]
    private static partial Regex NonAlphanumeric();
}
