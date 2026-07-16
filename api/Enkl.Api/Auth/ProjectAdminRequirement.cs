using Microsoft.AspNetCore.Authorization;

namespace Enkl.Api.Auth;

/// <summary>Satisfied when the caller has a live ProjectMembers row for the route's {projectId} with
/// IsProjectAdmin = true — see ProjectAdminAuthorizationHandler's own doc comment.</summary>
public class ProjectAdminRequirement : IAuthorizationRequirement { }
