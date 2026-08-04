using Enkl.Api.Auth;
using Enkl.Api.Dtos;
using Enkl.Api.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace Enkl.Api.Controllers;

/// <summary>
/// Org-Admin-only "Manage Vendors" surface — CRUD plus per-Vendor API key generate/revoke, nested
/// under api/organisations/me same as OrganisationApiKeyController/OrganisationAnnouncementsController.
/// Every id re-derived against User.OrgId(), never client-supplied.
/// </summary>
[ApiController]
[Authorize(Policy = "OrgAdmin")]
[Route("api/organisations/me/vendors")]
public class VendorController : ControllerBase
{
    private readonly VendorService _vendors;

    public VendorController(VendorService vendors)
    {
        _vendors = vendors;
    }

    [HttpGet]
    public async Task<IActionResult> List()
    {
        return Ok(await _vendors.ListAsync(User.OrgId()));
    }

    [HttpGet("{vendorId:guid}")]
    public async Task<IActionResult> Get(Guid vendorId)
    {
        var result = await _vendors.GetAsync(User.OrgId(), vendorId);
        return result is null ? NotFound() : Ok(result);
    }

    [HttpPost]
    public async Task<IActionResult> Create(CreateVendorRequest request)
    {
        return Ok(await _vendors.CreateAsync(User.OrgId(), request));
    }

    [HttpPut("{vendorId:guid}")]
    public async Task<IActionResult> Update(Guid vendorId, UpdateVendorRequest request)
    {
        var result = await _vendors.UpdateAsync(User.OrgId(), vendorId, request);
        return result is null ? NotFound() : Ok(result);
    }

    [HttpDelete("{vendorId:guid}")]
    public async Task<IActionResult> Delete(Guid vendorId)
    {
        var deleted = await _vendors.DeleteAsync(User.OrgId(), vendorId);
        return deleted ? NoContent() : NotFound();
    }

    [HttpPost("{vendorId:guid}/api-key")]
    public async Task<IActionResult> GenerateApiKey(Guid vendorId)
    {
        var result = await _vendors.GenerateApiKeyAsync(User.OrgId(), vendorId);
        return result is null ? NotFound() : Ok(result);
    }

    [HttpDelete("{vendorId:guid}/api-key")]
    public async Task<IActionResult> RevokeApiKey(Guid vendorId)
    {
        var result = await _vendors.RevokeApiKeyAsync(User.OrgId(), vendorId);
        return result is null ? NotFound() : Ok(result);
    }
}
