using System.Collections.Concurrent;
using System.Security.Cryptography;

namespace Enkl.Api.Auth;

/// <summary>
/// Hands the ACS callback a short-lived, single-use code to redirect the browser with instead of
/// the real JWT (+ the rest of the login response payload) — putting a bearer token directly in a
/// URL risks it leaking via browser history or a Referer header. The client's one call to
/// POST /api/auth/sso-exchange trades the code for that payload (see AuthController.SsoExchange).
/// In-memory and singleton is deliberate: a code only ever needs to survive the one redirect hop
/// within the same process that issued it, so there's no need for persistent storage, and losing
/// pending codes on a restart (an SSO login mid-flight) just means that one login retries. The
/// payload is an opaque string (SamlService JSON-serializes an SsoExchangeResponse into it) — this
/// store doesn't need to know its shape.
/// </summary>
public class SsoExchangeCodeStore
{
    private sealed record Entry(string Payload, DateTime ExpiresAt);

    private static readonly TimeSpan Ttl = TimeSpan.FromMinutes(2);
    private readonly ConcurrentDictionary<string, Entry> _codes = new();

    public string Issue(string payload)
    {
        PruneExpired();
        var code = Convert.ToBase64String(RandomNumberGenerator.GetBytes(32))
            .Replace('+', '-').Replace('/', '_').TrimEnd('=');
        _codes[code] = new Entry(payload, DateTime.UtcNow.Add(Ttl));
        return code;
    }

    /// <summary>Single-use: the code is removed on lookup regardless of whether it was still valid.</summary>
    public bool TryRedeem(string code, out string? payload)
    {
        payload = null;
        if (!_codes.TryRemove(code, out var entry)) return false;
        if (entry.ExpiresAt < DateTime.UtcNow) return false;
        payload = entry.Payload;
        return true;
    }

    private void PruneExpired()
    {
        var now = DateTime.UtcNow;
        foreach (var kvp in _codes)
        {
            if (kvp.Value.ExpiresAt < now) _codes.TryRemove(kvp.Key, out _);
        }
    }
}
