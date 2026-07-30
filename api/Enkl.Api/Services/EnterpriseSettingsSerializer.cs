using System.Text.Json;
using Enkl.Api.Dtos;

namespace Enkl.Api.Services;

/// <summary>
/// Shared camelCase (de)serialization for Organisation.EnterpriseSettingsJson — the small subset of
/// App Settings' "Enterprise" category that applies org-WIDE (Forms & Workflow, Portfolio Planner,
/// Portals) rather than per-project like every other App Settings toggle. Same shape/convention as
/// ProjectSettingsSerializer, just a different (organisation-scoped) column and a much smaller field
/// set. Every field is opt-in (default false) — a missing/corrupted value must never silently turn
/// on a module no Org Admin has ever actually switched on.
/// </summary>
public static class EnterpriseSettingsSerializer
{
    private static readonly JsonSerializerOptions Options = new(JsonSerializerDefaults.Web);

    public static string Serialize(EnterpriseSettingsDto settings) => JsonSerializer.Serialize(settings, Options);

    public static EnterpriseSettingsDto Parse(string? json)
    {
        JsonDocument? doc = null;
        try
        {
            if (!string.IsNullOrWhiteSpace(json)) doc = JsonDocument.Parse(json);
        }
        catch (JsonException)
        {
            // Corrupted/garbled JSON falls through to defaults below, same as the client-side guard.
        }

        bool Get(string name)
        {
            if (doc is not null && doc.RootElement.TryGetProperty(name, out var val) &&
                (val.ValueKind == JsonValueKind.True || val.ValueKind == JsonValueKind.False))
            {
                return val.ValueKind == JsonValueKind.True;
            }
            return false;
        }

        var result = new EnterpriseSettingsDto(Get("forms"), Get("portfolioPlanner"), Get("portals"));
        doc?.Dispose();
        return result;
    }
}
