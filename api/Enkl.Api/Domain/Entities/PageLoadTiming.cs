namespace Enkl.Api.Domain.Entities;

/// <summary>
/// One Real User Monitoring sample: how long a real browser took, from request to "ready to
/// interact with", to load this app's main page (see TelemetryController/TelemetryService and the
/// frontend's features/page-load-telemetry.js). Deliberately anonymous — no OrganisationId/UserId —
/// this is a pure ops/performance metric, not user data. Read by the standalone Vendor Portal app
/// (shares this same Postgres database) to feed its "APM - Web App Responsiveness" chart.
/// </summary>
public class PageLoadTiming
{
    public Guid Id { get; set; }
    public DateTime RecordedAt { get; set; }
    public double DurationMs { get; set; }
}
