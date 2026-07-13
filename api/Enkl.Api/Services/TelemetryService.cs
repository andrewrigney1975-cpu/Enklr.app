using Enkl.Api.Data;
using Enkl.Api.Domain.Entities;

namespace Enkl.Api.Services;

/// <summary>
/// Backs the anonymous Real User Monitoring beacon (TelemetryController) — every method here is
/// reachable with no authentication at all, so validation here is data-quality hygiene (silently
/// drop anything implausible), not a security boundary the way the OrgAdmin-scoped services
/// elsewhere in this API are.
/// </summary>
public class TelemetryService
{
    private readonly AppDbContext _db;

    // A page load taking longer than this is more likely a bad/garbled client-side measurement
    // (e.g. a stopped debugger, a suspended background tab) than a real number worth plotting.
    private const double MaxPlausibleDurationMs = 300_000; // 5 minutes

    public TelemetryService(AppDbContext db)
    {
        _db = db;
    }

    public async Task RecordPageLoadAsync(double durationMs)
    {
        if (!double.IsFinite(durationMs) || durationMs <= 0 || durationMs > MaxPlausibleDurationMs)
        {
            return; // silently dropped — see class doc comment
        }

        _db.PageLoadTimings.Add(new PageLoadTiming
        {
            Id = Guid.NewGuid(),
            RecordedAt = DateTime.UtcNow,
            DurationMs = durationMs
        });
        await _db.SaveChangesAsync();
    }
}
