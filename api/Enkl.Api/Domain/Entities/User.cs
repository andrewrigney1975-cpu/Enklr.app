namespace Enkl.Api.Domain.Entities;

public class User
{
    public Guid Id { get; set; }
    public Guid OrganisationId { get; set; }
    public Organisation Organisation { get; set; } = null!;
    public string Username { get; set; } = "";
    public string NormalizedUsername { get; set; } = "";
    public string? EmailAddress { get; set; }
    public string? NormalizedEmailAddress { get; set; }
    // Null for a user who only ever signs in via SSO (SAML JIT-provisioned or SCIM-created) — see
    // AuthController.Login, which rejects the password path with an SSO-specific message rather
    // than attempting to verify against a hash that was never set.
    public string? PasswordHash { get; set; }
    public string DisplayName { get; set; } = "";
    public bool MustChangePassword { get; set; }
    public bool IsOrgAdmin { get; set; }
    // Deprovisioning flag driven by SCIM (PATCH active:false) as well as manual admin action —
    // both the password and SAML login paths reject a User with IsActive = false.
    public bool IsActive { get; set; } = true;
    public DateTime CreatedAt { get; set; }

    public List<ProjectMember> ProjectMemberships { get; set; } = new();
}
