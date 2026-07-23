-- Ported from php-api's 033_add_strategy_management.sql / api/Enkl.Api's AddStrategyManagement
-- migration. Same column-type mapping as every other migration in this tier: uuid -> CHAR(36),
-- timestamptz -> DATETIME(6), boolean -> TINYINT(1) (see mariadb-api/CLAUDE.md §3, §4.8 for the
-- (bool)-cast-on-read gotcha this creates in the Services below).
CREATE TABLE "Strategies" (
    "Id" CHAR(36) PRIMARY KEY,
    "OrganisationId" CHAR(36) NOT NULL,
    "Name" VARCHAR(150) NOT NULL,
    "IsActive" TINYINT(1) NOT NULL DEFAULT 0,
    "SortOrder" INT NOT NULL,
    "DateCreated" DATETIME(6) NOT NULL,
    CONSTRAINT "FK_Strategies_Organisations" FOREIGN KEY ("OrganisationId") REFERENCES "Organisations" ("Id") ON DELETE CASCADE
) ENGINE=InnoDB;
CREATE INDEX "IX_Strategies_OrganisationId_IsActive" ON "Strategies" ("OrganisationId", "IsActive");

CREATE TABLE "StrategyPillars" (
    "Id" CHAR(36) PRIMARY KEY,
    "StrategyId" CHAR(36) NOT NULL,
    "Name" VARCHAR(150) NOT NULL,
    "Description" TEXT NULL,
    "SortOrder" INT NOT NULL,
    CONSTRAINT "FK_StrategyPillars_Strategies" FOREIGN KEY ("StrategyId") REFERENCES "Strategies" ("Id") ON DELETE CASCADE
) ENGINE=InnoDB;
CREATE INDEX "IX_StrategyPillars_StrategyId" ON "StrategyPillars" ("StrategyId");

CREATE TABLE "StrategyEnablers" (
    "Id" CHAR(36) PRIMARY KEY,
    "PillarId" CHAR(36) NOT NULL,
    "Name" VARCHAR(150) NOT NULL,
    "Description" TEXT NULL,
    "SortOrder" INT NOT NULL,
    CONSTRAINT "FK_StrategyEnablers_Pillars" FOREIGN KEY ("PillarId") REFERENCES "StrategyPillars" ("Id") ON DELETE CASCADE
) ENGINE=InnoDB;
CREATE INDEX "IX_StrategyEnablers_PillarId" ON "StrategyEnablers" ("PillarId");

CREATE TABLE "StrategyMetrics" (
    "Id" CHAR(36) PRIMARY KEY,
    "PillarId" CHAR(36) NULL,
    "EnablerId" CHAR(36) NULL,
    "Name" VARCHAR(150) NOT NULL,
    "TargetValue" DOUBLE NULL,
    "UnitLabel" VARCHAR(20) NULL,
    "SortOrder" INT NOT NULL,
    CONSTRAINT "FK_StrategyMetrics_Pillars" FOREIGN KEY ("PillarId") REFERENCES "StrategyPillars" ("Id") ON DELETE CASCADE,
    CONSTRAINT "FK_StrategyMetrics_Enablers" FOREIGN KEY ("EnablerId") REFERENCES "StrategyEnablers" ("Id") ON DELETE CASCADE
) ENGINE=InnoDB;
CREATE INDEX "IX_StrategyMetrics_PillarId" ON "StrategyMetrics" ("PillarId");
CREATE INDEX "IX_StrategyMetrics_EnablerId" ON "StrategyMetrics" ("EnablerId");

CREATE TABLE "StrategyMetricEntries" (
    "Id" CHAR(36) PRIMARY KEY,
    "MetricId" CHAR(36) NOT NULL,
    "RecordedAt" DATETIME(6) NOT NULL,
    "Value" DOUBLE NOT NULL,
    "Note" TEXT NULL,
    CONSTRAINT "FK_StrategyMetricEntries_Metrics" FOREIGN KEY ("MetricId") REFERENCES "StrategyMetrics" ("Id") ON DELETE CASCADE
) ENGINE=InnoDB;
CREATE INDEX "IX_StrategyMetricEntries_MetricId_RecordedAt" ON "StrategyMetricEntries" ("MetricId", "RecordedAt");

CREATE TABLE "ProjectPillarFulfilments" (
    "Id" CHAR(36) PRIMARY KEY,
    "ProjectId" CHAR(36) NOT NULL,
    "PillarId" CHAR(36) NOT NULL,
    "FulfilmentPercent" INT NOT NULL,
    "DateLastModified" DATETIME(6) NOT NULL,
    CONSTRAINT "FK_ProjectPillarFulfilments_Projects" FOREIGN KEY ("ProjectId") REFERENCES "Projects" ("Id") ON DELETE CASCADE,
    CONSTRAINT "FK_ProjectPillarFulfilments_Pillars" FOREIGN KEY ("PillarId") REFERENCES "StrategyPillars" ("Id") ON DELETE CASCADE
) ENGINE=InnoDB;
CREATE UNIQUE INDEX "IX_ProjectPillarFulfilments_ProjectId_PillarId" ON "ProjectPillarFulfilments" ("ProjectId", "PillarId");
CREATE INDEX "IX_ProjectPillarFulfilments_PillarId" ON "ProjectPillarFulfilments" ("PillarId");
