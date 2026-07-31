using Enkl.Api.Data;
using Enkl.Api.Domain.Entities;
using Enkl.Api.Dtos;
using Microsoft.EntityFrameworkCore;

namespace Enkl.Api.Services;

public class UserPreferencesService
{
    // Matches storage.js's client-side MAX_AVATAR_BYTES = 200KB source-file cap; base64 inflates
    // that by ~4/3, so this is the server-side backstop against a tampered/bypassed client, not the
    // primary control.
    private const int MaxAvatarLength = 280_000;

    private readonly AppDbContext _db;

    public UserPreferencesService(AppDbContext db)
    {
        _db = db;
    }

    public async Task<UserPreferencesDto> GetAsync(Guid userId)
    {
        var prefs = await _db.UserPreferences.AsNoTracking().FirstOrDefaultAsync(p => p.UserId == userId);
        return new UserPreferencesDto(prefs?.Avatar, prefs?.HeaderColour);
    }

    public async Task<UserPreferencesDto?> UpdateAsync(Guid userId, UpdateUserPreferencesRequest request)
    {
        if (request.Avatar is { Length: > MaxAvatarLength })
        {
            return null;
        }

        var prefs = await _db.UserPreferences.FirstOrDefaultAsync(p => p.UserId == userId);
        if (prefs is null)
        {
            prefs = new UserPreferences { UserId = userId };
            _db.UserPreferences.Add(prefs);
        }

        prefs.Avatar = request.Avatar;
        prefs.HeaderColour = request.HeaderColour;
        prefs.DateLastModified = DateTime.UtcNow;
        await _db.SaveChangesAsync();

        return new UserPreferencesDto(prefs.Avatar, prefs.HeaderColour);
    }
}
