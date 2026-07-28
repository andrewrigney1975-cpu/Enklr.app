using Enkl.Api.Data;
using Enkl.Api.Domain.Entities;
using Enkl.Api.Dtos;
using Microsoft.EntityFrameworkCore;

namespace Enkl.Api.Services;

/// <summary>Org-Admin-only authoring of Form versions (see Domain/Entities/Form.cs's own doc
/// comment for why there's no separate parent "Form" entity). Phase 1: bare CRUD on a single Draft
/// row. Phase 3 (this pass): versioning — clone the latest version into a new Draft, publish a
/// Draft (demoting whichever version was previously Published to Archived). The Workflow builder
/// (Phase 4) lands in a later pass, on top of this same table/service.</summary>
public class FormService
{
    private readonly AppDbContext _db;

    public FormService(AppDbContext db)
    {
        _db = db;
    }

    public async Task<List<FormDto>> ListAsync(Guid organisationId)
    {
        return await _db.Forms.AsNoTracking()
            .Where(f => f.OrganisationId == organisationId)
            .OrderByDescending(f => f.DateLastModified)
            .Select(f => new FormDto(f.Id, f.FormGroupId, f.Name, f.Description, f.VersionNumber, f.Status,
                f.FieldsJson, f.WorkflowJson, f.DateCreated, f.DateLastModified, f.PublishedAt))
            .ToListAsync();
    }

    public async Task<FormDto?> GetAsync(Guid organisationId, Guid formId)
    {
        var form = await _db.Forms.AsNoTracking().FirstOrDefaultAsync(f => f.Id == formId && f.OrganisationId == organisationId);
        return form is null ? null : ToDto(form);
    }

    /// <summary>Every published Form version in this org — the set a project member is offered to
    /// fill out (ProjectFormsController), regardless of which specific project they're in. Forms are
    /// org-scoped, not project-scoped; the per-project gate is purely the "Forms" App Setting
    /// (whether this project has the module switched on at all), not a per-form per-project opt-in.</summary>
    public async Task<List<FormDto>> ListPublishedAsync(Guid organisationId)
    {
        return await _db.Forms.AsNoTracking()
            .Where(f => f.OrganisationId == organisationId && f.Status == "published")
            .OrderBy(f => f.Name)
            .Select(f => new FormDto(f.Id, f.FormGroupId, f.Name, f.Description, f.VersionNumber, f.Status,
                f.FieldsJson, f.WorkflowJson, f.DateCreated, f.DateLastModified, f.PublishedAt))
            .ToListAsync();
    }

    public async Task<FormDto> CreateAsync(Guid organisationId, Guid callerUserId, CreateFormRequest request)
    {
        var name = (request.Name ?? "").Trim();
        if (name.Length == 0) name = "Untitled Form";
        if (name.Length > 200) name = name[..200];

        var now = DateTime.UtcNow;
        var form = new Form
        {
            Id = Guid.NewGuid(),
            OrganisationId = organisationId,
            FormGroupId = Guid.NewGuid(),
            Name = name,
            Description = request.Description,
            VersionNumber = 1,
            Status = "draft",
            FieldsJson = request.FieldsJson,
            CreatedByUserId = callerUserId,
            DateCreated = now,
            DateLastModified = now
        };
        _db.Forms.Add(form);
        await _db.SaveChangesAsync();
        return ToDto(form);
    }

    public async Task<FormDto?> UpdateAsync(Guid organisationId, Guid formId, UpdateFormRequest request)
    {
        var form = await _db.Forms.FirstOrDefaultAsync(f => f.Id == formId && f.OrganisationId == organisationId);
        if (form is null) return null;
        // Only a Draft version may be edited in place — a Published version is what's actually live
        // for members to fill out, and an Archived one is historical; editing either would silently
        // rewrite what past/current submissions are measured against. Editing "the current form" for
        // real is done by cloning a new Draft version from it (Phase 3), not by mutating this row.
        if (form.Status != "draft") return null;

        var name = (request.Name ?? "").Trim();
        if (name.Length == 0) return null;
        if (name.Length > 200) name = name[..200];

        form.Name = name;
        form.Description = request.Description;
        form.FieldsJson = request.FieldsJson;
        form.WorkflowJson = request.WorkflowJson;
        form.DateLastModified = DateTime.UtcNow;
        await _db.SaveChangesAsync();
        return ToDto(form);
    }

    /// <summary>Every version of one form, oldest-to-newest — the version-history list a "New
    /// version from this one" / publish UI is built from.</summary>
    public async Task<List<FormVersionSummaryDto>?> ListVersionsAsync(Guid organisationId, Guid formGroupId)
    {
        var versions = await _db.Forms.AsNoTracking()
            .Where(f => f.OrganisationId == organisationId && f.FormGroupId == formGroupId)
            .OrderBy(f => f.VersionNumber)
            .Select(f => new FormVersionSummaryDto(f.Id, f.VersionNumber, f.Status, f.DateCreated, f.DateLastModified, f.PublishedAt))
            .ToListAsync();
        return versions.Count == 0 ? null : versions;
    }

    /// <summary>Clones the latest version of a form (by VersionNumber, regardless of its own
    /// Status) into a brand-new Draft row — a plain deep copy of FieldsJson/WorkflowJson with the
    /// SAME field/node ids preserved. Unlike the Board-Column Workflow's own clone
    /// (RemapWorkflowColumnIds), no id-remap is needed here: a Form Workflow's nodes are
    /// self-contained inside their own JSON blob, not keyed against an external per-project id
    /// space, so the clone is safe to edit immediately with no remap step. Preserving field ids
    /// also means a past submission's AnswersJson keys stay meaningful when displayed against
    /// whichever version they were actually submitted against (never against the new clone).</summary>
    public async Task<FormDto?> CloneAsync(Guid organisationId, Guid formGroupId, Guid callerUserId)
    {
        var latest = await _db.Forms
            .Where(f => f.OrganisationId == organisationId && f.FormGroupId == formGroupId)
            .OrderByDescending(f => f.VersionNumber)
            .FirstOrDefaultAsync();
        if (latest is null) return null;

        var now = DateTime.UtcNow;
        var clone = new Form
        {
            Id = Guid.NewGuid(),
            OrganisationId = organisationId,
            FormGroupId = formGroupId,
            Name = latest.Name,
            Description = latest.Description,
            VersionNumber = latest.VersionNumber + 1,
            Status = "draft",
            FieldsJson = latest.FieldsJson,
            WorkflowJson = latest.WorkflowJson,
            CreatedByUserId = callerUserId,
            DateCreated = now,
            DateLastModified = now
        };
        _db.Forms.Add(clone);
        await _db.SaveChangesAsync();
        return ToDto(clone);
    }

    /// <summary>Publishes a Draft version, demoting whichever OTHER version of the same
    /// FormGroupId is currently Published to Archived, in the same transaction — same
    /// "one endpoint owns the flag" shape as StrategyService.ActivateAsync. Only one version per
    /// FormGroupId may ever be Published at a time; that's the row ProjectFormsController offers
    /// to members to fill out.</summary>
    public async Task<FormDto?> PublishAsync(Guid organisationId, Guid formId)
    {
        var form = await _db.Forms.FirstOrDefaultAsync(f => f.Id == formId && f.OrganisationId == organisationId);
        if (form is null || form.Status != "draft") return null;

        await using var tx = await _db.Database.BeginTransactionAsync();
        var currentlyPublished = await _db.Forms
            .Where(f => f.OrganisationId == organisationId && f.FormGroupId == form.FormGroupId && f.Status == "published")
            .ToListAsync();
        foreach (var other in currentlyPublished) other.Status = "archived";

        form.Status = "published";
        form.PublishedAt = DateTime.UtcNow;
        form.DateLastModified = form.PublishedAt.Value;
        await _db.SaveChangesAsync();
        await tx.CommitAsync();

        return ToDto(form);
    }

    public async Task<bool> DeleteAsync(Guid organisationId, Guid formId)
    {
        var form = await _db.Forms.FirstOrDefaultAsync(f => f.Id == formId && f.OrganisationId == organisationId);
        if (form is null) return false;
        // Published/Archived versions may have real submissions against them (FormSubmission.
        // FormVersionId is a Restrict FK) — reject with a clear result here rather than letting an
        // unhandled DB exception surface for the same case.
        if (form.Status != "draft") return false;

        _db.Forms.Remove(form);
        await _db.SaveChangesAsync();
        return true;
    }

    private static FormDto ToDto(Form f) => new(
        f.Id, f.FormGroupId, f.Name, f.Description, f.VersionNumber, f.Status,
        f.FieldsJson, f.WorkflowJson, f.DateCreated, f.DateLastModified, f.PublishedAt);
}
