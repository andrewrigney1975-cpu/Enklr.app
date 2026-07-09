using System.Text.Json;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http;

namespace Enkl.Api.Auth;

/// <summary>
/// Reads the route's {projectId} and checks it against the JWT's "projects" claim, decoded once per
/// request. Membership is embedded in the token rather than re-queried from the DB — see the plan's
/// note on the re-issue-on-membership-change trade-off this implies.
/// </summary>
public class ProjectMemberAuthorizationHandler : AuthorizationHandler<ProjectMemberRequirement>
{
    private readonly IHttpContextAccessor _httpContextAccessor;

    public ProjectMemberAuthorizationHandler(IHttpContextAccessor httpContextAccessor)
    {
        _httpContextAccessor = httpContextAccessor;
    }

    protected override Task HandleRequirementAsync(AuthorizationHandlerContext context, ProjectMemberRequirement requirement)
    {
        var httpContext = _httpContextAccessor.HttpContext;
        var routeProjectId = httpContext?.Request.RouteValues["projectId"] as string;

        if (routeProjectId is null || !Guid.TryParse(routeProjectId, out var projectId))
        {
            return Task.CompletedTask;
        }

        var projectsClaim = context.User.FindFirst("projects")?.Value;
        if (projectsClaim is null)
        {
            return Task.CompletedTask;
        }

        var memberships = JsonSerializer.Deserialize<List<ProjectClaim>>(projectsClaim) ?? new();
        if (memberships.Any(m => m.ProjectId == projectId))
        {
            context.Succeed(requirement);
        }

        return Task.CompletedTask;
    }
}
