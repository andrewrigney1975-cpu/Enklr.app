using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using System.Text;
using System.Text.Json;
using Enkl.Api.Domain.Entities;
using Microsoft.IdentityModel.Tokens;

namespace Enkl.Api.Auth;

public class JwtTokenService
{
    private readonly IConfiguration _config;

    public JwtTokenService(IConfiguration config)
    {
        _config = config;
    }

    public (string Token, DateTime ExpiresAt) GenerateToken(User user, IEnumerable<ProjectMember> memberships)
    {
        var expiryHours = _config.GetValue<double?>("Jwt:ExpiryHours") ?? 8;
        var expiresAt = DateTime.UtcNow.AddHours(expiryHours);

        var projectsClaim = JsonSerializer.Serialize(
            memberships.Select(m => new ProjectClaim(m.ProjectId, m.Role)));

        var claims = new List<Claim>
        {
            new(JwtRegisteredClaimNames.Sub, user.Id.ToString()),
            new("username", user.Username),
            new("displayName", user.DisplayName),
            new("orgId", user.OrganisationId.ToString()),
            // Display-only (the header logo shows "<app title> - <org name>" once logged in — see
            // api.js's getOrgName()); never used for authorization, so it's fine that a rename after
            // token issuance shows stale until the next login/reissue.
            new("orgName", user.Organisation.Name),
            // String "true"/"false", not a bool ClaimValueType — ClaimsPrincipal.HasClaim/FindFirst
            // comparisons are simplest against plain string claim values.
            new("orgAdmin", user.IsOrgAdmin ? "true" : "false"),
            // Security review finding H2 — re-checked against the live User.SecurityStamp column on
            // every authenticated request (see Program.cs's revocation middleware); lets
            // deactivation/role changes/password changes invalidate already-issued tokens instead of
            // only ever checking signature/lifetime.
            new("securityStamp", user.SecurityStamp.ToString()),
            // Deliberately a plain string claim (not JsonClaimValueTypes.JsonArray) — that value type
            // makes the JWT handler expand the JSON array into multiple separate "projects" claims on
            // validation, so a single FindFirst/deserialize on read-back only ever sees one element.
            new("projects", projectsClaim)
        };

        var key = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(_config["Jwt:SigningKey"]!));
        var creds = new SigningCredentials(key, SecurityAlgorithms.HmacSha256);

        var token = new JwtSecurityToken(
            issuer: _config["Jwt:Issuer"],
            audience: _config["Jwt:Audience"],
            claims: claims,
            expires: expiresAt,
            signingCredentials: creds);

        return (new JwtSecurityTokenHandler().WriteToken(token), expiresAt);
    }
}
