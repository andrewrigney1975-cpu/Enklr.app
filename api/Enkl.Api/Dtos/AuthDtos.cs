namespace Enkl.Api.Dtos;

public record LoginRequest(string Username, string Password);

public record LoginResponse(string Token, DateTime ExpiresAt, UserDto User);

public record UserDto(Guid Id, string Username, string DisplayName, bool MustChangePassword, string? Avatar, string? HeaderColour);

public record ChangePasswordRequest(string CurrentPassword, string NewPassword);

public record UserPreferencesDto(string? Avatar, string? HeaderColour);

public record UpdateUserPreferencesRequest(string? Avatar, string? HeaderColour);
