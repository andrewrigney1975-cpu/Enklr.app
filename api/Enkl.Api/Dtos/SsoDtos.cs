namespace Enkl.Api.Dtos;

// Discovery: keyed off whatever the login screen's identifier field currently holds (username or
// email — the client can't tell which before submitting), so the caller learns only whether SSO is
// available and which org it's for — never anything about whether the identifier itself matches a
// real account, to avoid leaking account existence to an anonymous caller.
public record SsoLookupResponse(bool SsoAvailable, Guid? OrganisationId);

public record SsoExchangeRequest(string Code);

// EmailAddress/IsOrgAdmin/etc. aren't needed by the client past login — mirrors LoginResponse's
// existing UserDto shape.
public record SsoExchangeResponse(string Token, DateTime ExpiresAt, UserDto User);

/// <summary>
/// Never echoes IdpSigningCertificate or the SCIM token hash back to the browser — HasIdpSigningCertificate
/// /HasScimToken are the only signal the admin UI gets about whether one is already configured.
/// SpEntityId/SpAcsUrl/SpMetadataUrl are derived, read-only, and exist purely so the OrgAdmin can
/// copy them into their IdP's SP configuration screen.
/// </summary>
public record SsoConfigDto(
    bool SamlEnabled, string? IdpEntityId, string? IdpSsoUrl, bool HasIdpSigningCertificate,
    bool SamlJitProvisioning, bool RequireSso,
    string SpEntityId, string SpAcsUrl, string SpMetadataUrl,
    bool ScimEnabled, bool HasScimToken, string ScimBaseUrl);

/// <summary>
/// IdpSigningCertificate is optional here on purpose: null/empty leaves whatever certificate is
/// already stored untouched, since SsoConfigDto never sends the actual certificate back to the
/// browser for the admin to resubmit unchanged. Send a non-empty value only to replace it.
/// </summary>
public record UpdateSsoConfigRequest(
    bool SamlEnabled, string? IdpEntityId, string? IdpSsoUrl, string? IdpSigningCertificate,
    bool SamlJitProvisioning, bool RequireSso, bool ScimEnabled);

/// <summary>The raw bearer token, shown to the OrgAdmin exactly once — see
/// OrganisationSsoConfig.ScimBearerTokenHash's own comment for why it's never retrievable again.</summary>
public record GenerateScimTokenResponse(string Token);

// Read-only summary for the "SSO & Provisioning" modal's Org Teams section — SCIM/the IdP owns
// this data (see OrgTeam's own doc comment), so there's no corresponding create/update DTO; the
// only mutating action available from this app's own UI is TeamCommitteeService.ApplyOrgTeamAsync.
public record OrgTeamMemberSummaryDto(Guid UserId, string DisplayName);
public record OrgTeamSummaryDto(Guid Id, string Name, List<OrgTeamMemberSummaryDto> Members);
