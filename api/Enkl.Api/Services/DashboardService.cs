using Enkl.Api.Data;
using Enkl.Api.Domain.Entities;
using Enkl.Api.Dtos;
using Microsoft.EntityFrameworkCore;

namespace Enkl.Api.Services;

public class DashboardService
{
    private readonly AppDbContext _db;

    public DashboardService(AppDbContext db)
    {
        _db = db;
    }

    public async Task<List<DashboardListItemDto>> ListAsync(Guid projectId)
    {
        return await _db.Dashboards.AsNoTracking()
            .Where(d => d.ProjectId == projectId)
            .OrderBy(d => d.Name)
            .Select(d => new DashboardListItemDto(d.Id, d.Name, d.Description, d.Widgets.Count, d.DateLastModified))
            .ToListAsync();
    }

    public async Task<DashboardDetailDto?> GetAsync(Guid projectId, Guid dashboardId)
    {
        var dashboard = await _db.Dashboards.AsNoTracking()
            .Include(d => d.Widgets)
            .FirstOrDefaultAsync(d => d.Id == dashboardId && d.ProjectId == projectId);
        return dashboard is null ? null : ToDetailDto(dashboard);
    }

    public async Task<DashboardDetailDto?> CreateAsync(Guid projectId, CreateDashboardRequest request)
    {
        var projectExists = await _db.Projects.AnyAsync(p => p.Id == projectId);
        if (!projectExists) return null;

        var now = DateTime.UtcNow;
        var dashboard = new Dashboard
        {
            Id = Guid.NewGuid(),
            ProjectId = projectId,
            Name = request.Name,
            Description = request.Description,
            DateCreated = now,
            DateLastModified = now
        };
        _db.Dashboards.Add(dashboard);
        await _db.SaveChangesAsync();
        return ToDetailDto(dashboard);
    }

    public async Task<DashboardDetailDto?> UpdateAsync(Guid projectId, Guid dashboardId, CreateDashboardRequest request)
    {
        var dashboard = await _db.Dashboards.Include(d => d.Widgets)
            .FirstOrDefaultAsync(d => d.Id == dashboardId && d.ProjectId == projectId);
        if (dashboard is null) return null;

        dashboard.Name = request.Name;
        dashboard.Description = request.Description;
        dashboard.DateLastModified = DateTime.UtcNow;
        await _db.SaveChangesAsync();
        return ToDetailDto(dashboard);
    }

    public async Task<bool> DeleteAsync(Guid projectId, Guid dashboardId)
    {
        var dashboard = await _db.Dashboards.FirstOrDefaultAsync(d => d.Id == dashboardId && d.ProjectId == projectId);
        if (dashboard is null) return false;

        _db.Dashboards.Remove(dashboard);
        await _db.SaveChangesAsync();
        return true;
    }

    /// <summary>Org-Admin-only cross-project browse (Controllers/OrgDashboardsController.cs) — a
    /// pure org-scoped read with no client-supplied id list to re-derive (unlike the Portfolio
    /// pattern's usual per-id re-validation), since the caller's own OrgId (from their JWT, never
    /// trusted from the client) is the only filter applied.</summary>
    public async Task<List<OrgDashboardListItemDto>> ListForOrgAsync(Guid organisationId)
    {
        return await _db.Dashboards.AsNoTracking()
            .Where(d => d.Project.OrganisationId == organisationId)
            .OrderBy(d => d.Project.Name).ThenBy(d => d.Name)
            .Select(d => new OrgDashboardListItemDto(
                d.Id, d.Name, d.Description, d.Widgets.Count, d.DateLastModified,
                d.ProjectId, d.Project.Name, d.Project.Key))
            .ToListAsync();
    }

    // ---- Widgets ------------------------------------------------------------------------------

    private async Task<Dashboard?> FindOwningDashboardAsync(Guid projectId, Guid dashboardId)
    {
        return await _db.Dashboards.FirstOrDefaultAsync(d => d.Id == dashboardId && d.ProjectId == projectId);
    }

    public async Task<DashboardWidgetDto?> CreateWidgetAsync(Guid projectId, Guid dashboardId, CreateDashboardWidgetRequest request)
    {
        var dashboard = await FindOwningDashboardAsync(projectId, dashboardId);
        if (dashboard is null) return null;

        var now = DateTime.UtcNow;
        var widget = new DashboardWidget
        {
            Id = Guid.NewGuid(),
            DashboardId = dashboardId,
            WidgetType = request.WidgetType,
            Title = request.Title,
            SavedQueryId = request.SavedQueryId,
            Width = request.Width,
            SortOrder = request.SortOrder,
            ConfigJson = request.ConfigJson,
            DateCreated = now,
            DateLastModified = now
        };
        _db.DashboardWidgets.Add(widget);
        dashboard.DateLastModified = now;
        await _db.SaveChangesAsync();
        return ToWidgetDto(widget);
    }

    public async Task<DashboardWidgetDto?> UpdateWidgetAsync(Guid projectId, Guid dashboardId, Guid widgetId, CreateDashboardWidgetRequest request)
    {
        var dashboard = await FindOwningDashboardAsync(projectId, dashboardId);
        if (dashboard is null) return null;

        var widget = await _db.DashboardWidgets.FirstOrDefaultAsync(w => w.Id == widgetId && w.DashboardId == dashboardId);
        if (widget is null) return null;

        widget.WidgetType = request.WidgetType;
        widget.Title = request.Title;
        widget.SavedQueryId = request.SavedQueryId;
        widget.Width = request.Width;
        widget.SortOrder = request.SortOrder;
        widget.ConfigJson = request.ConfigJson;
        widget.DateLastModified = DateTime.UtcNow;
        dashboard.DateLastModified = widget.DateLastModified;
        await _db.SaveChangesAsync();
        return ToWidgetDto(widget);
    }

    public async Task<bool> DeleteWidgetAsync(Guid projectId, Guid dashboardId, Guid widgetId)
    {
        var dashboard = await FindOwningDashboardAsync(projectId, dashboardId);
        if (dashboard is null) return false;

        var widget = await _db.DashboardWidgets.FirstOrDefaultAsync(w => w.Id == widgetId && w.DashboardId == dashboardId);
        if (widget is null) return false;

        _db.DashboardWidgets.Remove(widget);
        dashboard.DateLastModified = DateTime.UtcNow;
        await _db.SaveChangesAsync();
        return true;
    }

    private static DashboardDetailDto ToDetailDto(Dashboard d) => new(
        d.Id, d.Name, d.Description, d.DateCreated, d.DateLastModified,
        d.Widgets.OrderBy(w => w.SortOrder).Select(ToWidgetDto).ToList());

    private static DashboardWidgetDto ToWidgetDto(DashboardWidget w) => new(
        w.Id, w.WidgetType, w.Title, w.SavedQueryId, w.Width, w.SortOrder, w.ConfigJson);
}
