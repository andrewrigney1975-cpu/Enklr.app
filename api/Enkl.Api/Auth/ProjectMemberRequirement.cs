using Microsoft.AspNetCore.Authorization;

namespace Enkl.Api.Auth;

/// <summary>Satisfied when the caller's "projects" JWT claim contains the {projectId} route value.</summary>
public class ProjectMemberRequirement : IAuthorizationRequirement { }
