namespace Enkl.Api.Dtos;

/// <summary>durationMs is the frontend's own performance.now() reading at the end of app.js's
/// init() — see features/page-load-telemetry.js for exactly what that measures.</summary>
public record ReportPageLoadRequest(double DurationMs);
