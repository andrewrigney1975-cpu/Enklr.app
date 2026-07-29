using Enkl.Api.Auth;
using Enkl.Api.Dtos;
using Enkl.Api.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace Enkl.Api.Controllers;

/// <summary>Org-Admin-only authoring of Enterprise Forms (versions) — mirrors StrategyController's
/// shape (whole-class OrgAdmin, org-scoped route) rather than ProjectTemplate's single-controller/
/// per-action-override shape: Forms are entirely Org-Admin-authored, with no ordinary project member
/// ever creating/editing one — the read-only project-member surface lives in
/// ProjectFormsController instead, same split as ProjectStrategyController.</summary>
[ApiController]
[Authorize(Policy = "OrgAdmin")]
[Route("api/organisations/me/forms")]
public class FormsController : ControllerBase
{
    private readonly FormService _forms;

    public FormsController(FormService forms)
    {
        _forms = forms;
    }

    [HttpGet]
    public async Task<IActionResult> List()
    {
        return Ok(await _forms.ListAsync(User.OrgId()));
    }

    [HttpGet("{formId:guid}")]
    public async Task<IActionResult> Get(Guid formId)
    {
        var result = await _forms.GetAsync(User.OrgId(), formId);
        return result is null ? NotFound() : Ok(result);
    }

    [HttpPost]
    public async Task<IActionResult> Create(CreateFormRequest request)
    {
        return Ok(await _forms.CreateAsync(User.OrgId(), User.UserId(), request));
    }

    [HttpPut("{formId:guid}")]
    public async Task<IActionResult> Update(Guid formId, UpdateFormRequest request)
    {
        var result = await _forms.UpdateAsync(User.OrgId(), formId, request);
        return result is null ? NotFound() : Ok(result);
    }

    [HttpDelete("{formId:guid}")]
    public async Task<IActionResult> Delete(Guid formId)
    {
        return await _forms.DeleteAsync(User.OrgId(), formId) ? NoContent() : NotFound();
    }

    [HttpGet("groups/{formGroupId:guid}/versions")]
    public async Task<IActionResult> ListVersions(Guid formGroupId)
    {
        var result = await _forms.ListVersionsAsync(User.OrgId(), formGroupId);
        return result is null ? NotFound() : Ok(result);
    }

    [HttpPost("groups/{formGroupId:guid}/versions")]
    public async Task<IActionResult> Clone(Guid formGroupId)
    {
        var result = await _forms.CloneAsync(User.OrgId(), formGroupId, User.UserId());
        return result is null ? NotFound() : Ok(result);
    }

    [HttpPost("{formId:guid}/publish")]
    public async Task<IActionResult> Publish(Guid formId)
    {
        var result = await _forms.PublishAsync(User.OrgId(), formId);
        return result is null ? NotFound() : Ok(result);
    }
}
