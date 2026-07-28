using Enkl.Api.Auth;
using Enkl.Api.Dtos;
using Enkl.Api.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace Enkl.Api.Controllers;

/// <summary>Project-member-facing surface for Enterprise Forms — read published forms available to
/// fill out, and manage the caller's own submission drafts. No authoring/CRUD on Forms themselves
/// lives here at all (mirrors ProjectStrategyController's own doc comment) — every Form write
/// happens through FormsController (OrgAdmin). Submit/approve actions land in Phase 4/5 once the
/// workflow engine exists to evaluate them; Phase 1 only has Draft CRUD.</summary>
[ApiController]
[Authorize(Policy = "ProjectMember")]
[Route("api/projects/{projectId:guid}/forms")]
public class ProjectFormsController : ControllerBase
{
    private readonly FormService _forms;
    private readonly FormSubmissionService _submissions;

    public ProjectFormsController(FormService forms, FormSubmissionService submissions)
    {
        _forms = forms;
        _submissions = submissions;
    }

    [HttpGet]
    public async Task<IActionResult> ListPublished()
    {
        return Ok(await _forms.ListPublishedAsync(User.OrgId()));
    }

    [HttpGet("submissions/mine")]
    public async Task<IActionResult> ListMySubmissions(Guid projectId)
    {
        return Ok(await _submissions.ListMineAsync(projectId, User.UserId()));
    }

    [HttpGet("submissions/{submissionId:guid}")]
    public async Task<IActionResult> GetSubmission(Guid projectId, Guid submissionId)
    {
        var result = await _submissions.GetAsync(projectId, User.UserId(), submissionId);
        return result is null ? NotFound() : Ok(result);
    }

    [HttpPost("submissions")]
    public async Task<IActionResult> CreateSubmission(Guid projectId, CreateFormSubmissionRequest request)
    {
        var result = await _submissions.CreateAsync(projectId, User.UserId(), request);
        return result is null ? NotFound() : Ok(result);
    }

    [HttpPut("submissions/{submissionId:guid}")]
    public async Task<IActionResult> UpdateSubmission(Guid projectId, Guid submissionId, UpdateFormSubmissionRequest request)
    {
        var result = await _submissions.UpdateAsync(projectId, User.UserId(), submissionId, request);
        return result is null ? NotFound() : Ok(result);
    }

    [HttpDelete("submissions/{submissionId:guid}")]
    public async Task<IActionResult> DeleteSubmission(Guid projectId, Guid submissionId)
    {
        return await _submissions.DeleteAsync(projectId, User.UserId(), submissionId) ? NoContent() : NotFound();
    }
}
