using System.Text.Json;
using Enkl.Api.Auth;
using Enkl.Api.Data;
using Enkl.Api.Domain;
using Enkl.Api.Domain.Entities;
using Enkl.Api.Dtos;
using ITfoxtec.Identity.Saml2;
using Microsoft.EntityFrameworkCore;

namespace Enkl.Api.Services;

public enum SamlAcsOutcome { Success, UserNotFound, UserInactive, JitDisabled }
public record SamlAcsResult(SamlAcsOutcome Outcome, string? ExchangeCode);

/// <summary>
/// SP-side SAML logic shared by SamlController's three actions. Kept separate from the controller
/// because building the AuthnRequest/reading the ACS response is tightly coupled to ITfoxtec's
/// HttpRequest/IActionResult binding helpers (see SamlController), while everything here — org
/// lookup, JIT provisioning, JWT issuance — is plain business logic, same split every other
/// controller/service pair in this codebase already follows.
/// </summary>
public class SamlService
{
    private readonly AppDbContext _db;
    private readonly IConfiguration _config;
    private readonly JwtTokenService _jwt;
    private readonly SsoExchangeCodeStore _exchange;

    public SamlService(AppDbContext db, IConfiguration config, JwtTokenService jwt, SsoExchangeCodeStore exchange)
    {
        _db = db;
        _config = config;
        _jwt = jwt;
        _exchange = exchange;
    }

    private string PublicBaseUrl => (_config["App:PublicBaseUrl"] ?? "").TrimEnd('/');

    public string SpEntityId(Guid orgId) => $"{PublicBaseUrl}/api/saml/{orgId}/metadata";
    public string AcsUrl(Guid orgId) => $"{PublicBaseUrl}/api/saml/{orgId}/acs";
    public string SuccessRedirectUrl(string exchangeCode) => $"{PublicBaseUrl}/?ssoCode={Uri.EscapeDataString(exchangeCode)}";
    public string ErrorRedirectUrl(string message) => $"{PublicBaseUrl}/?ssoError={Uri.EscapeDataString(message)}";

    public async Task<OrganisationSsoConfig?> GetEnabledConfigAsync(Guid orgId)
    {
        var cfg = await _db.OrganisationSsoConfigs.FirstOrDefaultAsync(c => c.OrganisationId == orgId);
        return cfg is { SamlEnabled: true } ? cfg : null;
    }

    public Saml2Configuration BuildSaml2Configuration(Guid orgId, OrganisationSsoConfig ssoConfig)
    {
        var spEntityId = SpEntityId(orgId);
        var config = new Saml2Configuration
        {
            Issuer = spEntityId,
            SingleSignOnDestination = new Uri(ssoConfig.IdpSsoUrl!),
            AllowedIssuer = ssoConfig.IdpEntityId
        };
        config.AllowedAudienceUris.Add(spEntityId);
        if (!string.IsNullOrEmpty(ssoConfig.IdpSigningCertificate) &&
            SamlCertificateHelper.TryParse(ssoConfig.IdpSigningCertificate, out var cert))
        {
            config.SignatureValidationCertificates.Add(cert!);
        }
        return config;
    }

    /// <summary>
    /// Resolves a validated assertion's NameID (email) to a User and, on success, a single-use
    /// exchange code the client trades for a real JWT (see SsoExchangeCodeStore). A signed
    /// assertion for a user of a DIFFERENT organisation is rejected as not-found even though email
    /// is globally unique — defense in depth against a misconfigured/malicious IdP asserting for
    /// this route's org.
    /// </summary>
    public async Task<SamlAcsResult> ProcessAssertionAsync(Guid orgId, OrganisationSsoConfig ssoConfig, string email, string? displayNameHint)
    {
        var normalizedEmail = EmailAddressNormalizer.Normalize(email);
        var user = await _db.Users.Include(u => u.Organisation)
            .FirstOrDefaultAsync(u => u.NormalizedEmailAddress == normalizedEmail);

        if (user is not null && user.OrganisationId != orgId)
        {
            user = null;
        }

        if (user is null)
        {
            if (!ssoConfig.SamlJitProvisioning) return new SamlAcsResult(SamlAcsOutcome.JitDisabled, null);
            user = await JitProvisionUserAsync(orgId, email, normalizedEmail, displayNameHint);
        }

        if (!user.IsActive) return new SamlAcsResult(SamlAcsOutcome.UserInactive, null);

        var memberships = await _db.ProjectMembers.Where(m => m.UserId == user.Id).ToListAsync();
        var (token, expiresAt) = _jwt.GenerateToken(user, memberships);
        var response = new SsoExchangeResponse(token, expiresAt, new UserDto(user.Id, user.Username, user.DisplayName, user.MustChangePassword));
        return new SamlAcsResult(SamlAcsOutcome.Success, _exchange.Issue(JsonSerializer.Serialize(response)));
    }

    private async Task<User> JitProvisionUserAsync(Guid orgId, string email, string normalizedEmail, string? displayNameHint)
    {
        var displayName = string.IsNullOrWhiteSpace(displayNameHint) ? email.Split('@')[0] : displayNameHint.Trim();
        if (displayName.Length > 200) displayName = displayName[..200];

        var baseUsername = UsernameNormalizer.Normalize(displayName.Length > 0 ? displayName : email);
        if (baseUsername.Length == 0) baseUsername = "user";
        var usernameToUse = await _db.Users.AnyAsync(u => u.NormalizedUsername == baseUsername)
            ? await ResolveUniqueUsernameAsync(baseUsername)
            : baseUsername;

        var user = new User
        {
            Id = Guid.NewGuid(),
            OrganisationId = orgId,
            Username = usernameToUse,
            NormalizedUsername = usernameToUse,
            EmailAddress = email,
            NormalizedEmailAddress = normalizedEmail,
            PasswordHash = null,
            DisplayName = displayName,
            MustChangePassword = false,
            IsOrgAdmin = false,
            IsActive = true,
            CreatedAt = DateTime.UtcNow
        };
        _db.Users.Add(user);
        await _db.SaveChangesAsync();
        // JwtTokenService.GenerateToken reads user.Organisation.Name for the orgName claim — the
        // found-user path gets this via .Include() above, so a freshly-created user needs the same
        // navigation loaded explicitly before it's handed to GenerateToken.
        await _db.Entry(user).Reference(u => u.Organisation).LoadAsync();
        return user;
    }

    private async Task<string> ResolveUniqueUsernameAsync(string baseUsername)
    {
        var candidate = baseUsername;
        var suffix = 1;
        while (await _db.Users.AnyAsync(u => u.NormalizedUsername == candidate))
        {
            candidate = $"{baseUsername}{++suffix}";
        }
        return candidate;
    }
}
