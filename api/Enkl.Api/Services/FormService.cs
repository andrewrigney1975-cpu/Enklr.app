using Enkl.Api.Data;
using Enkl.Api.Domain.Entities;
using Enkl.Api.Dtos;
using Microsoft.EntityFrameworkCore;

namespace Enkl.Api.Services;

/// <summary>Org-Admin-only authoring of Form versions (see Domain/Entities/Form.cs's own doc
/// comment for why there's no separate parent "Form" entity). Phase 1 scope: bare CRUD on a single
/// Draft row — publish/clone-into-new-version (Phase 3) and the Workflow builder (Phase 4) land in
/// later passes, on top of this same table/service.</summary>
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
