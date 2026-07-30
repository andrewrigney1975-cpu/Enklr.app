using Enkl.Api.Auth;
using Enkl.Api.Dtos;
using Enkl.Api.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace Enkl.Api.Controllers;

/// <summary>
/// The end-user-facing side of Organisational Portals — [Authorize] only at class level (no
/// ProjectMember/OrgAdmin policy), same shape as WhiteboardController/ChatController/ToDoController:
/// a Portal must be reachable by an org user who belongs to zero projects. See PortalHomeService's
/// own doc comment for the access-check guarantee every action here relies on.
/// </summary>
[ApiController]
[Authorize]
[Route("api/portals")]
public class PortalHomeController : ControllerBase
{
    private readonly PortalHomeService _home;

    public PortalHomeController(PortalHomeService home)
    {
        _home = home;
    }

    // Backs the side nav's "Portals" section — every published Portal in the caller's own org this
    // user actually has access to. GET, not the same route shape as GetBySlug below (no {slug}
    // segment), so the two never collide.
    [HttpGet]
    public async Task<IActionResult> ListAccessible()
    {
        return Ok(await _home.ListAccessibleAsync(User.OrgId(), User.UserId()));
    }

    [HttpGet("{slug}")]
    public async Task<IActionResult> GetBySlug(string slug)
    {
        var portal = await _home.GetBySlugAsync(User.OrgId(), slug, User.UserId());
        return portal is null ? NotFound() : Ok(portal);
    }

    [HttpGet("{portalId:guid}/forms")]
    public async Task<IActionResult> ListAvailableForms(Guid portalId)
    {
        var forms = await _home.ListAvailableFormsAsync(User.OrgId(), portalId, User.UserId());
        return forms is null ? NotFound() : Ok(forms);
    }

    [HttpGet("{portalId:guid}/submissions")]
    public async Task<IActionResult> ListMySubmissions(Guid portalId)
    {
        var submissions = await _home.ListMySubmissionsAsync(User.OrgId(), portalId, User.UserId());
        return submissions is null ? NotFound() : Ok(submissions);
    }

    [HttpGet("{portalId:guid}/qa")]
    public async Task<IActionResult> ListQa(Guid portalId)
    {
        var qa = await _home.ListQaAsync(User.OrgId(), portalId, User.UserId());
        return qa is null ? NotFound() : Ok(qa);
    }

    [HttpGet("{portalId:guid}/submissions/{submissionId:guid}")]
    public async Task<IActionResult> GetSubmission(Guid portalId, Guid submissionId)
    {
        var submission = await _home.GetSubmissionAsync(User.OrgId(), portalId, User.UserId(), submissionId);
        return submission is null ? NotFound() : Ok(submission);
    }

    [HttpPost("{portalId:guid}/submissions")]
    public async Task<IActionResult> CreateSubmission(Guid portalId, CreateFormSubmissionRequest request)
    {
        var submission = await _home.CreateSubmissionAsync(User.OrgId(), portalId, User.UserId(), request);
        return submission is null ? NotFound() : Ok(submission);
    }

    [HttpPut("{portalId:guid}/submissions/{submissionId:guid}")]
    public async Task<IActionResult> UpdateSubmission(Guid portalId, Guid submissionId, UpdateFormSubmissionRequest request)
    {
        var submission = await _home.UpdateSubmissionAsync(User.OrgId(), portalId, User.UserId(), submissionId, request);
        return submission is null ? NotFound() : Ok(submission);
    }

    [HttpDelete("{portalId:guid}/submissions/{submissionId:guid}")]
    public async Task<IActionResult> DeleteSubmission(Guid portalId, Guid submissionId)
    {
        var deleted = await _home.DeleteSubmissionAsync(User.OrgId(), portalId, User.UserId(), submissionId);
        return deleted ? NoContent() : NotFound();
    }

    [HttpPost("{portalId:guid}/submissions/{submissionId:guid}/submit")]
    public async Task<IActionResult> SubmitSubmission(Guid portalId, Guid submissionId)
    {
        var (ok, error, dto) = await _home.SubmitSubmissionAsync(User.OrgId(), portalId, User.UserId(), submissionId);
        if (!ok) return error == "not_found" ? NotFound() : BadRequest(new { message = error });
        return Ok(dto);
    }
}
