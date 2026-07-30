using Enkl.Api.Auth;
using Enkl.Api.Dtos;
using Enkl.Api.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace Enkl.Api.Controllers;

/// <summary>
/// Org-Admin authoring of Organisational Portals — OrgAdmin policy only, no ProjectMember
/// requirement, same shape as PortfolioController. See PortalService's own doc comment for the
/// cross-org isolation guarantee every action here relies on.
/// </summary>
[ApiController]
[Authorize(Policy = "OrgAdmin")]
[Route("api/organisations/me/portals")]
public class PortalsController : ControllerBase
{
    private readonly PortalService _portals;

    public PortalsController(PortalService portals)
    {
        _portals = portals;
    }

    [HttpGet]
    public async Task<IActionResult> List() => Ok(await _portals.ListAsync(User.OrgId()));

    [HttpGet("{portalId:guid}")]
    public async Task<IActionResult> Get(Guid portalId)
    {
        var portal = await _portals.GetAsync(User.OrgId(), portalId);
        return portal is null ? NotFound() : Ok(portal);
    }

    [HttpPost]
    public async Task<IActionResult> Create(CreatePortalRequest request) =>
        Ok(await _portals.CreateAsync(User.OrgId(), User.UserId(), request));

    [HttpPut("{portalId:guid}")]
    public async Task<IActionResult> Update(Guid portalId, UpdatePortalRequest request)
    {
        var portal = await _portals.UpdateAsync(User.OrgId(), portalId, request);
        return portal is null ? NotFound() : Ok(portal);
    }

    [HttpPost("{portalId:guid}/publish")]
    public async Task<IActionResult> Publish(Guid portalId)
    {
        var portal = await _portals.PublishAsync(User.OrgId(), portalId);
        return portal is null ? NotFound() : Ok(portal);
    }

    [HttpPost("{portalId:guid}/archive")]
    public async Task<IActionResult> Archive(Guid portalId)
    {
        var portal = await _portals.ArchiveAsync(User.OrgId(), portalId);
        return portal is null ? NotFound() : Ok(portal);
    }

    [HttpDelete("{portalId:guid}")]
    public async Task<IActionResult> Delete(Guid portalId)
    {
        var deleted = await _portals.DeleteAsync(User.OrgId(), portalId);
        return deleted ? NoContent() : NotFound();
    }

    [HttpGet("{portalId:guid}/access-grants")]
    public async Task<IActionResult> ListAccessGrants(Guid portalId)
    {
        var grants = await _portals.ListAccessGrantsAsync(User.OrgId(), portalId);
        return grants is null ? NotFound() : Ok(grants);
    }

    [HttpPost("{portalId:guid}/access-grants")]
    public async Task<IActionResult> AddAccessGrant(Guid portalId, CreatePortalAccessGrantRequest request)
    {
        var grant = await _portals.AddAccessGrantAsync(User.OrgId(), portalId, request);
        return grant is null ? NotFound() : Ok(grant);
    }

    [HttpDelete("{portalId:guid}/access-grants/{grantId:guid}")]
    public async Task<IActionResult> RemoveAccessGrant(Guid portalId, Guid grantId)
    {
        var removed = await _portals.RemoveAccessGrantAsync(User.OrgId(), portalId, grantId);
        return removed ? NoContent() : NotFound();
    }

    // GET, not POST — a pure read, same MustChangePassword-gate-avoidance reasoning as
    // PortfolioController's own GetAggregate/GetActivity.
    [HttpGet("{portalId:guid}/preview-access")]
    public async Task<IActionResult> PreviewAccess(Guid portalId, [FromQuery] Guid userId) =>
        Ok(new { hasAccess = await _portals.PreviewUserHasAccessAsync(portalId, userId) });

    [HttpGet("{portalId:guid}/forms")]
    public async Task<IActionResult> ListForms(Guid portalId)
    {
        var forms = await _portals.ListAttachedFormsAsync(User.OrgId(), portalId);
        return forms is null ? NotFound() : Ok(forms);
    }

    [HttpPost("{portalId:guid}/forms")]
    public async Task<IActionResult> AttachForm(Guid portalId, AttachPortalFormRequest request)
    {
        var form = await _portals.AttachFormAsync(User.OrgId(), portalId, request);
        return form is null ? NotFound() : Ok(form);
    }

    [HttpDelete("{portalId:guid}/forms/{portalFormId:guid}")]
    public async Task<IActionResult> DetachForm(Guid portalId, Guid portalFormId)
    {
        var removed = await _portals.DetachFormAsync(User.OrgId(), portalId, portalFormId);
        return removed ? NoContent() : NotFound();
    }

    [HttpGet("{portalId:guid}/topics")]
    public async Task<IActionResult> ListTopics(Guid portalId)
    {
        var topics = await _portals.ListTopicsAsync(User.OrgId(), portalId);
        return topics is null ? NotFound() : Ok(topics);
    }

    [HttpPost("{portalId:guid}/topics")]
    public async Task<IActionResult> CreateTopic(Guid portalId, CreatePortalTopicRequest request)
    {
        var topic = await _portals.CreateTopicAsync(User.OrgId(), portalId, request);
        return topic is null ? NotFound() : Ok(topic);
    }

    [HttpPut("{portalId:guid}/topics/{topicId:guid}")]
    public async Task<IActionResult> UpdateTopic(Guid portalId, Guid topicId, UpdatePortalTopicRequest request)
    {
        var topic = await _portals.UpdateTopicAsync(User.OrgId(), portalId, topicId, request);
        return topic is null ? NotFound() : Ok(topic);
    }

    [HttpDelete("{portalId:guid}/topics/{topicId:guid}")]
    public async Task<IActionResult> DeleteTopic(Guid portalId, Guid topicId)
    {
        var removed = await _portals.DeleteTopicAsync(User.OrgId(), portalId, topicId);
        return removed ? NoContent() : NotFound();
    }

    [HttpGet("{portalId:guid}/qa-entries")]
    public async Task<IActionResult> ListQaEntries(Guid portalId)
    {
        var entries = await _portals.ListQaEntriesAsync(User.OrgId(), portalId);
        return entries is null ? NotFound() : Ok(entries);
    }

    [HttpPost("{portalId:guid}/qa-entries")]
    public async Task<IActionResult> CreateQaEntry(Guid portalId, CreatePortalQaEntryRequest request)
    {
        var entry = await _portals.CreateQaEntryAsync(User.OrgId(), portalId, User.UserId(), request);
        return entry is null ? NotFound() : Ok(entry);
    }

    [HttpPut("{portalId:guid}/qa-entries/{entryId:guid}")]
    public async Task<IActionResult> UpdateQaEntry(Guid portalId, Guid entryId, UpdatePortalQaEntryRequest request)
    {
        var entry = await _portals.UpdateQaEntryAsync(User.OrgId(), portalId, entryId, request);
        return entry is null ? NotFound() : Ok(entry);
    }

    [HttpDelete("{portalId:guid}/qa-entries/{entryId:guid}")]
    public async Task<IActionResult> DeleteQaEntry(Guid portalId, Guid entryId)
    {
        var removed = await _portals.DeleteQaEntryAsync(User.OrgId(), portalId, entryId);
        return removed ? NoContent() : NotFound();
    }
}
