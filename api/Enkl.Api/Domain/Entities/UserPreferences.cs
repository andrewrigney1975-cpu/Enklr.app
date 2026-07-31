namespace Enkl.Api.Domain.Entities;

/// <summary>
/// One-per-User personalization settings row (UserId is both PK and FK, a strict 1:1) — same
/// "FK doubles as PK" shape as OrganisationSsoConfig. Both fields already existed purely
/// client-side/localStorage (see storage.js's getUserAvatar/getHeaderColor) with no cross-device
/// sync; this table is what makes them follow a signed-in user across browsers/devices instead.
/// Row is created lazily on first save — a user who's never touched My Preferences has no row here
/// at all, not a row with null columns.
/// </summary>
public class UserPreferences
{
    public Guid UserId { get; set; }
    public User User { get; set; } = null!;

    // Raw base64 data-URL string, same format storage.js has always used client-side. Capped at
    // MaxAvatarLength (see UserPreferencesService) — the client already enforces a 200KB source-file
    // cap before base64-encoding, this is the server-side backstop.
    public string? Avatar { get; set; }

    // Hex color string (e.g. "#0c2a52"), same format storage.js's getHeaderColor has always used.
    public string? HeaderColour { get; set; }

    public DateTime DateLastModified { get; set; }
}
