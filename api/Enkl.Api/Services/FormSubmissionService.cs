using Enkl.Api.Data;
using Enkl.Api.Domain.Entities;
using Enkl.Api.Dtos;
using Microsoft.EntityFrameworkCore;

namespace Enkl.Api.Services;

/// <summary>Project-member-facing Draft management for Form submissions (see
/// Domain/Entities/FormSubmission.cs's own doc comment for the single-table-for-every-form-type
/// design). Phase 1 scope: create/edit/delete a Draft only — Submit (entering the workflow, engine
/// gate-checking, CurrentNodeId advancement) is Phase 4/5, once the workflow engine exists to
/// actually evaluate it.</summary>
public class FormSubmissionService
{
    private readonly AppDbContext _db;

    public FormSubmissionService(AppDbContext db)
    {
        _db = db;
    }

    public async Task<List<FormSubmissionDto>> ListMineAsync(Guid projectId, Guid callerUserId)
    {
        return await _db.FormSubmissions.AsNoTracking()
            .Where(s => s.ProjectId == projectId && s.SubmittedByUserId == callerUserId)
            .OrderByDescending(s => s.DateLastModified)
            .Select(s => new FormSubmissionDto(s.Id, s.FormVersionId, s.ProjectId, s.SubmittedByUserId, s.Status,
                s.CurrentNodeId, s.AnswersJson, s.ApprovalTrailJson, s.DateCreated, s.DateLastModified, s.DateSubmitted))
            .ToListAsync();
    }

    public async Task<FormSubmissionDto?> GetAsync(Guid projectId, Guid callerUserId, Guid submissionId)
    {
        var submission = await _db.FormSubmissions.AsNoTracking()
            .FirstOrDefaultAsync(s => s.Id == submissionId && s.ProjectId == projectId && s.SubmittedByUserId == callerUserId);
        return submission is null ? null : ToDto(submission);
    }

    /// <summary>Null return covers two cases identically (no enumeration oracle between "no such
    /// form" and "that form isn't published") — a submission can only ever be started against a
    /// currently-published version, never a Draft or Archived one.</summary>
    public async Task<FormSubmissionDto?> CreateAsync(Guid projectId, Guid callerUserId, CreateFormSubmissionRequest request)
    {
        var formVersionExists = await _db.Forms.AsNoTracking()
            .AnyAsync(f => f.Id == request.FormVersionId && f.Status == "published");
        if (!formVersionExists) return null;

        var now = DateTime.UtcNow;
        var submission = new FormSubmission
        {
            Id = Guid.NewGuid(),
            FormVersionId = request.FormVersionId,
            ProjectId = projectId,
            SubmittedByUserId = callerUserId,
            Status = "draft",
            AnswersJson = request.AnswersJson,
            DateCreated = now,
            DateLastModified = now
        };
        _db.FormSubmissions.Add(submission);
        await _db.SaveChangesAsync();
        return ToDto(submission);
    }

    public async Task<FormSubmissionDto?> UpdateAsync(Guid projectId, Guid callerUserId, Guid submissionId, UpdateFormSubmissionRequest request)
    {
        var submission = await _db.FormSubmissions.FirstOrDefaultAsync(s =>
            s.Id == submissionId && s.ProjectId == projectId && s.SubmittedByUserId == callerUserId);
        if (submission is null) return null;
        // Once submitted, only the workflow engine (Phase 4/5) may advance it further.
        if (submission.Status != "draft") return null;

        submission.AnswersJson = request.AnswersJson;
        submission.DateLastModified = DateTime.UtcNow;
        await _db.SaveChangesAsync();
        return ToDto(submission);
    }

    public async Task<bool> DeleteAsync(Guid projectId, Guid callerUserId, Guid submissionId)
    {
        var submission = await _db.FormSubmissions.FirstOrDefaultAsync(s =>
            s.Id == submissionId && s.ProjectId == projectId && s.SubmittedByUserId == callerUserId);
        if (submission is null) return false;
        if (submission.Status != "draft") return false;

        _db.FormSubmissions.Remove(submission);
        await _db.SaveChangesAsync();
        return true;
    }

    private static FormSubmissionDto ToDto(FormSubmission s) => new(
        s.Id, s.FormVersionId, s.ProjectId, s.SubmittedByUserId, s.Status, s.CurrentNodeId,
        s.AnswersJson, s.ApprovalTrailJson, s.DateCreated, s.DateLastModified, s.DateSubmitted);
}
