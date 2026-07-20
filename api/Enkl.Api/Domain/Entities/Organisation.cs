namespace Enkl.Api.Domain.Entities;

public class Organisation
{
    public Guid Id { get; set; }
    public string Name { get; set; } = "";
    public string NormalizedName { get; set; } = "";
    public DateTime CreatedAt { get; set; }

    // Nullable — an OrgAdmin hasn't necessarily set a custom one. Stores the bcrypt HASH of the
    // chosen password, never the plaintext, so the org's default is never persisted or retrievable
    // in the clear (same principle as every other password in this app) — reused directly as a new
    // User's PasswordHash at creation time (see UserFactory.DefaultPasswordHashAsync), never
    // re-hashed. Falls back to a hash of AuthConstants.GlobalDefaultNewUserPassword when null.
    public string? DefaultNewUserPasswordHash { get; set; }

    public List<User> Users { get; set; } = new();
    public List<Project> Projects { get; set; } = new();
    public List<ProjectTemplate> ProjectTemplates { get; set; } = new();
    public List<OrgTeam> OrgTeams { get; set; } = new();

    // 1:1 — may be null until an OrgAdmin first opens the SSO & Provisioning settings screen.
    public OrganisationSsoConfig? SsoConfig { get; set; }

    // 1:1 — may be null until an OrgAdmin first generates a public API key.
    public OrganisationApiKey? ApiKey { get; set; }
}
