using System.Security.Claims;
using System.Text.Json;
using Enkl.Api.Auth;
using Enkl.Api.Data;
using Enkl.Api.Domain;
using Enkl.Api.Dtos;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace Enkl.Api.Controllers;

[ApiController]
[Route("api/auth")]
public class AuthController : ControllerBase
{
    private readonly AppDbContext _db;
    private readonly JwtTokenService _jwt;
    private readonly SsoExchangeCodeStore _exchange;

    public AuthController(AppDbContext db, JwtTokenService jwt, SsoExchangeCodeStore exchange)
    {
        _db = db;
        _jwt = jwt;
        _exchange = exchange;
    }

    [HttpPost("login")]
    public async Task<ActionResult<LoginResponse>> Login(LoginRequest request)
    {
        var normalized = UsernameNormalizer.Normalize(request.Username);
        var user = await _db.Users.Include(u => u.Organisation).ThenInclude(o => o.SsoConfig)
            .FirstOrDefaultAsync(u => u.NormalizedUsername == normalized);
        if (user is null || !user.IsActive)
        {
            return Unauthorized(new { message = "Invalid username or password." });
        }
        if (user.Organisation.SsoConfig?.RequireSso == true)
        {
            return Unauthorized(new { message = "This organisation requires SSO sign-in. Use the \"Sign in with SSO\" option." });
        }
        // An SSO-only user (SAML JIT-provisioned or SCIM-created) never gets a local password hash —
        // tell them where to actually sign in rather than a generic "invalid password" that implies
        // retrying with a different password would help.
        if (user.PasswordHash is null)
        {
            return Unauthorized(new { message = "This account signs in via your organisation's SSO. Use the \"Sign in with SSO\" option." });
        }
        if (!PasswordHasher.Verify(request.Password, user.PasswordHash))
        {
            return Unauthorized(new { message = "Invalid username or password." });
        }

        var memberships = await _db.ProjectMembers.Where(m => m.UserId == user.Id).ToListAsync();
        var (token, expiresAt) = _jwt.GenerateToken(user, memberships);

        return Ok(new LoginResponse(token, expiresAt, new UserDto(user.Id, user.Username, user.DisplayName, user.MustChangePassword)));
    }

    /// <summary>
    /// Anonymous, minimal-disclosure org discovery for the login screen's "Sign in with SSO"
    /// affordance: the caller could have typed either a username or an email into that one field
    /// (the client can't tell which), so this tries both normalizations and returns only whether
    /// SSO is available — never anything about whether the identifier matched a real account, to
    /// avoid leaking account existence to an anonymous request.
    /// </summary>
    [AllowAnonymous]
    [HttpGet("sso-lookup")]
    public async Task<ActionResult<SsoLookupResponse>> SsoLookup([FromQuery] string identifier)
    {
        if (string.IsNullOrWhiteSpace(identifier)) return Ok(new SsoLookupResponse(false, null));

        var normalizedUsername = UsernameNormalizer.Normalize(identifier);
        var normalizedEmail = EmailAddressNormalizer.Normalize(identifier);
        var user = await _db.Users.Include(u => u.Organisation).ThenInclude(o => o.SsoConfig)
            .FirstOrDefaultAsync(u => u.NormalizedUsername == normalizedUsername || u.NormalizedEmailAddress == normalizedEmail);

        if (user?.Organisation.SsoConfig?.SamlEnabled == true)
        {
            return Ok(new SsoLookupResponse(true, user.OrganisationId));
        }
        return Ok(new SsoLookupResponse(false, null));
    }

    /// <summary>
    /// Trades the single-use code SamlController's ACS action redirected the browser with for the
    /// actual login response — see SsoExchangeCodeStore's own doc comment for why the token never
    /// rides in the redirect URL itself.
    /// </summary>
    [AllowAnonymous]
    [HttpPost("sso-exchange")]
    public ActionResult<SsoExchangeResponse> SsoExchange(SsoExchangeRequest request)
    {
        if (!_exchange.TryRedeem(request.Code, out var payload) || payload is null)
        {
            return Unauthorized(new { message = "This sign-in link has expired or was already used. Please sign in again." });
        }
        return Ok(JsonSerializer.Deserialize<SsoExchangeResponse>(payload));
    }

    [Authorize]
    [HttpPost("change-password")]
    public async Task<IActionResult> ChangePassword(ChangePasswordRequest request)
    {
        if (string.IsNullOrEmpty(request.NewPassword) || request.NewPassword.Length < 8)
        {
            return BadRequest(new { message = "New password must be at least 8 characters." });
        }

        var userId = Guid.Parse(User.FindFirstValue(ClaimTypes.NameIdentifier) ?? User.FindFirstValue("sub")!);
        var user = await _db.Users.FirstOrDefaultAsync(u => u.Id == userId);
        if (user is null || user.PasswordHash is null || !PasswordHasher.Verify(request.CurrentPassword, user.PasswordHash))
        {
            return Unauthorized(new { message = "Current password is incorrect." });
        }

        user.PasswordHash = PasswordHasher.Hash(request.NewPassword);
        user.MustChangePassword = false;
        await _db.SaveChangesAsync();

        return NoContent();
    }
}
