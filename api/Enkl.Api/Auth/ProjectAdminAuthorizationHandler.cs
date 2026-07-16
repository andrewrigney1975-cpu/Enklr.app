using Enkl.Api.Data;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http;
using Microsoft.EntityFrameworkCore;

namespace Enkl.Api.Auth;

/// <summary>
/// Gates the Project Administrator role: adding/editing/deleting columns, changing a project's App
/// Settings, managing its Workflow, and managing its team members (including who else is a Project
/// Admin). Reads the route's {projectId} and checks a LIVE "ProjectMembers" row for
/// IsProjectAdmin = true, the same "server-side re-validation, never trust the client's embedded
/// claim" idiom ProjectMemberAuthorizationHandler already uses (ARCHITECTURE-REVIEW.md finding 2.4) —
/// the JWT's "projects" claim does carry an IsProjectAdmin flag per entry (JwtTokenService.cs), but
/// only for the frontend's own client-side "what to show" decisions (api.js's isProjectAdmin()),
/// never for authorization itself, so a promotion/demotion takes effect on the very next request
/// rather than waiting for the next login/token refresh.
///
/// Registered as a Singleton (Program.cs — IAuthorizationHandler instances are shared across
/// requests), so AppDbContext (scoped) can't be constructor-injected directly; IServiceScopeFactory
/// resolves a fresh scoped instance per check instead, matching ProjectMemberAuthorizationHandler.
/// </summary>
public class ProjectAdminAuthorizationHandler : AuthorizationHandler<ProjectAdminRequirement>
{
    private readonly IHttpContextAccessor _httpContextAccessor;
    private readonly IServiceScopeFactory _scopeFactory;

    public ProjectAdminAuthorizationHandler(IHttpContextAccessor httpContextAccessor, IServiceScopeFactory scopeFactory)
    {
        _httpContextAccessor = httpContextAccessor;
        _scopeFactory = scopeFactory;
    }

    protected override async Task HandleRequirementAsync(AuthorizationHandlerContext context, ProjectAdminRequirement requirement)
    {
        var httpContext = _httpContextAccessor.HttpContext;
        var routeProjectId = httpContext?.Request.RouteValues["projectId"] as string;

        if (routeProjectId is null || !Guid.TryParse(routeProjectId, out var projectId))
        {
            return;
        }

        var userId = context.User.TryUserId();
        if (userId is null)
        {
            return;
        }

        using var scope = _scopeFactory.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var isProjectAdmin = await db.ProjectMembers
            .AsNoTracking()
            .AnyAsync(m => m.ProjectId == projectId && m.UserId == userId && m.IsProjectAdmin);

        if (isProjectAdmin)
        {
            context.Succeed(requirement);
        }
    }
}
