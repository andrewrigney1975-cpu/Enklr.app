namespace Enkl.Api.Auth;

/// <summary>One entry per ProjectMember row the user has; JSON-serialized into the "projects" JWT claim.</summary>
public record ProjectClaim(Guid ProjectId, string? Role);
