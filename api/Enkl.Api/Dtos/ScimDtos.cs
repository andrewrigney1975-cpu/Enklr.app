using System.Text.Json;

namespace Enkl.Api.Dtos;

// SCIM 2.0 (RFC 7643/7644) wire shapes for the Users endpoint. Property names rely entirely on the
// app's existing global camelCase JSON naming policy to land on SCIM's required attribute casing
// (UserName -> userName, DisplayName -> displayName, etc.) — no [JsonPropertyName] overrides needed.

public static class ScimSchemas
{
    public const string User = "urn:ietf:params:scim:schemas:core:2.0:User";
    public const string Group = "urn:ietf:params:scim:schemas:core:2.0:Group";
    public const string ListResponse = "urn:ietf:params:scim:api:messages:2.0:ListResponse";
    public const string PatchOp = "urn:ietf:params:scim:api:messages:2.0:PatchOp";
    public const string Error = "urn:ietf:params:scim:api:messages:2.0:Error";
}

public record ScimNameDto(string? Formatted, string? GivenName, string? FamilyName);
public record ScimEmailDto(string? Value, bool? Primary, string? Type);
public record ScimMetaDto(string ResourceType, DateTime Created, DateTime LastModified, string Location);

/// <summary>
/// Incoming POST/PUT body. Deliberately loose (every field nullable) — an IdP is free to send a
/// partial resource, and ScimUserService.ExtractEmail/ExtractDisplayName fall back sensibly when
/// fields are missing, same tolerance the SAML JIT-provisioning path already has for a sparse
/// assertion (see SamlService.JitProvisionUserAsync).
/// </summary>
public record ScimUserRequest(
    string[]? Schemas, string? Id, string? UserName, ScimNameDto? Name,
    string? DisplayName, List<ScimEmailDto>? Emails, bool? Active);

public record ScimUserResponse(
    string[] Schemas, string Id, string UserName, ScimNameDto? Name,
    string? DisplayName, List<ScimEmailDto> Emails, bool Active, ScimMetaDto Meta);

public record ScimListResponse<T>(string[] Schemas, int TotalResults, int StartIndex, int ItemsPerPage, List<T> Resources);

/// <summary>
/// Value is a raw JsonElement rather than a typed field because SCIM PATCH bodies come in two
/// common shapes ScimUserService.ApplyPatchOperations handles explicitly: Okta-style
/// {"op":"replace","path":"active","value":false} (a scalar under a specific path) and Azure
/// AD-style {"op":"Replace","value":{"active":false}} (an object of several attributes with no
/// path) — a strongly-typed Value couldn't represent both without its own union type.
/// </summary>
public record ScimPatchOperation(string Op, string? Path, JsonElement? Value);
public record ScimPatchRequest(string[]? Schemas, List<ScimPatchOperation> Operations);

// Groups map onto OrgTeam/OrgTeamMember (see ScimGroupService) — each member's Value is the SCIM
// User id (i.e. the app's User.Id.ToString(), same identifier ScimUserResponse.Id already uses).
public record ScimGroupMemberDto(string Value, string? Display);
public record ScimGroupRequest(string[]? Schemas, string? Id, string? ExternalId, string? DisplayName, List<ScimGroupMemberDto>? Members);
public record ScimGroupResponse(string[] Schemas, string Id, string? ExternalId, string DisplayName, List<ScimGroupMemberDto> Members, ScimMetaDto Meta);
