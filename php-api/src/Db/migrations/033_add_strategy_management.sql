-- Ported from api/Enkl.Api's AddStrategyManagement migration. Enterprise Strategy Management:
-- Strategy -> Pillars -> (Enablers, Metrics), Metrics also attach directly to a Pillar (exactly one
-- of PillarId/EnablerId non-null, enforced app-layer only in StrategyMetricService — no CHECK
-- constraint, same standing convention as every other enum-like/invariant field in this codebase).
-- ProjectPillarFulfilment is an at-most-one-row-per-(ProjectId,PillarId) upsert target, same "real
-- unique index, not a CHECK constraint" convention as ChatChannelMembers/AnnouncementAcknowledgements.

CREATE TABLE "Strategies" (
    "Id" uuid PRIMARY KEY,
    "OrganisationId" uuid NOT NULL REFERENCES "Organisations"("Id") ON DELETE CASCADE,
    "Name" varchar(150) NOT NULL,
    "IsActive" boolean NOT NULL DEFAULT false,
    "SortOrder" integer NOT NULL,
    "DateCreated" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX "IX_Strategies_OrganisationId_IsActive" ON "Strategies" ("OrganisationId", "IsActive");

CREATE TABLE "StrategyPillars" (
    "Id" uuid PRIMARY KEY,
    "StrategyId" uuid NOT NULL REFERENCES "Strategies"("Id") ON DELETE CASCADE,
    "Name" varchar(150) NOT NULL,
    "Description" text,
    "SortOrder" integer NOT NULL
);
CREATE INDEX "IX_StrategyPillars_StrategyId" ON "StrategyPillars" ("StrategyId");

CREATE TABLE "StrategyEnablers" (
    "Id" uuid PRIMARY KEY,
    "PillarId" uuid NOT NULL REFERENCES "StrategyPillars"("Id") ON DELETE CASCADE,
    "Name" varchar(150) NOT NULL,
    "Description" text,
    "SortOrder" integer NOT NULL
);
CREATE INDEX "IX_StrategyEnablers_PillarId" ON "StrategyEnablers" ("PillarId");

CREATE TABLE "StrategyMetrics" (
    "Id" uuid PRIMARY KEY,
    "PillarId" uuid REFERENCES "StrategyPillars"("Id") ON DELETE CASCADE,
    "EnablerId" uuid REFERENCES "StrategyEnablers"("Id") ON DELETE CASCADE,
    "Name" varchar(150) NOT NULL,
    "TargetValue" double precision,
    "UnitLabel" varchar(20),
    "SortOrder" integer NOT NULL
);
CREATE INDEX "IX_StrategyMetrics_PillarId" ON "StrategyMetrics" ("PillarId");
CREATE INDEX "IX_StrategyMetrics_EnablerId" ON "StrategyMetrics" ("EnablerId");

CREATE TABLE "StrategyMetricEntries" (
    "Id" uuid PRIMARY KEY,
    "MetricId" uuid NOT NULL REFERENCES "StrategyMetrics"("Id") ON DELETE CASCADE,
    "RecordedAt" timestamptz NOT NULL,
    "Value" double precision NOT NULL,
    "Note" text
);
CREATE INDEX "IX_StrategyMetricEntries_MetricId_RecordedAt" ON "StrategyMetricEntries" ("MetricId", "RecordedAt");

CREATE TABLE "ProjectPillarFulfilments" (
    "Id" uuid PRIMARY KEY,
    "ProjectId" uuid NOT NULL REFERENCES "Projects"("Id") ON DELETE CASCADE,
    "PillarId" uuid NOT NULL REFERENCES "StrategyPillars"("Id") ON DELETE CASCADE,
    "FulfilmentPercent" integer NOT NULL,
    "DateLastModified" timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX "IX_ProjectPillarFulfilments_ProjectId_PillarId" ON "ProjectPillarFulfilments" ("ProjectId", "PillarId");
CREATE INDEX "IX_ProjectPillarFulfilments_PillarId" ON "ProjectPillarFulfilments" ("PillarId");
