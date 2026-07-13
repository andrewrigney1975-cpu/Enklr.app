-- Ported from api/Enkl.Api's AddPageLoadTimings migration. Anonymous Real User Monitoring samples
-- (no OrganisationId/UserId — a pure ops/performance metric, not user data) — see
-- TelemetryController/TelemetryService and the frontend's features/page-load-telemetry.js. Read
-- directly by the standalone Vendor Portal app (shares this same Postgres database) to feed its
-- "APM - Web App Responsiveness" chart.
CREATE TABLE "PageLoadTimings" (
    "Id" uuid PRIMARY KEY,
    "RecordedAt" timestamptz NOT NULL,
    "DurationMs" double precision NOT NULL
);
CREATE INDEX "IX_PageLoadTimings_RecordedAt" ON "PageLoadTimings" ("RecordedAt");
