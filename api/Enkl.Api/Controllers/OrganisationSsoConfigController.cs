using System.Security.Claims;
using Enkl.Api.Dtos;
using Enkl.Api.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace Enkl.Api.Controllers;

/// <summary>Same OrgAdmin gating and CallerOrgId() idiom as OrganisationsController.</summary>
[ApiController]
[Authorize(Policy = "OrgAdmin")]
[Route("api/organisations/me/sso-config")]
public class OrganisationSsoConfigController : ControllerBase
{
    private readonly OrganisationSsoConfigService _ssoConfig;

    public OrganisationSsoConfigController(OrganisationSsoConfigService ssoConfig)
    {
        _ssoConfig = ssoConfig;
    }

    [HttpGet]
    public async Task<IActionResult> Get()
    {
        return Ok(await _ssoConfig.GetAsync(CallerOrgId()));
    }

    [HttpPut]
    public async Task<IActionResult> Update(UpdateSsoConfigRequest request)
    {
        return Ok(await _ssoConfig.UpdateAsync(CallerOrgId(), request));
    }

    [HttpPost("scim-token")]
    public async Task<IActionResult> GenerateScimToken()
    {
        return Ok(await _ssoConfig.GenerateScimTokenAsync(CallerOrgId()));
    }

    private Guid CallerOrgId() => Guid.Parse(User.FindFirstValue("orgId")!);
}
