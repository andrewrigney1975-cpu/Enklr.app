namespace Enkl.Api.Auth;

/// <summary>One entry per ProjectMember row the user has; JSON-serialized into the "projects" JWT
/// claim. IsProjectAdmin is display-only client-side (api.js's isProjectAdmin()) — the server always
/// re-checks a live ProjectMembers row (ProjectAdminAuthorizationHandler), never this claim, for
/// authorization itself.</summary>
public record ProjectClaim(Guid ProjectId, string? Role, bool IsProjectAdmin);
