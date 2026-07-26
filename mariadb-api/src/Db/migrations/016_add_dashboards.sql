-- Self-Service Dashboards — consolidates php-api's 035_add_dashboards.sql straight into its
-- MariaDB-typed form (CHAR(36) for uuid, DATETIME(6) for timestamptz, InnoDB), same convention as
-- every other ported table in this tier. Not part of the Public Query API's view set (006) — a
-- Dashboard's own layout/config is never itself AlaSQL-queryable, only the SavedQuery each widget
-- points at is.

CREATE TABLE "Dashboards" (
    "Id" CHAR(36) PRIMARY KEY,
    "ProjectId" CHAR(36) NOT NULL,
    "Name" VARCHAR(200) NOT NULL,
    "Description" TEXT NULL,
    "DateCreated" DATETIME(6) NOT NULL,
    "DateLastModified" DATETIME(6) NOT NULL,
    CONSTRAINT "FK_Dashboards_Projects" FOREIGN KEY ("ProjectId") REFERENCES "Projects" ("Id") ON DELETE CASCADE
) ENGINE=InnoDB;
CREATE INDEX "IX_Dashboards_ProjectId" ON "Dashboards" ("ProjectId");

CREATE TABLE "DashboardWidgets" (
    "Id" CHAR(36) PRIMARY KEY,
    "DashboardId" CHAR(36) NOT NULL,
    "WidgetType" VARCHAR(20) NOT NULL,
    "Title" VARCHAR(200) NOT NULL,
    "SavedQueryId" CHAR(36) NULL,
    "Width" VARCHAR(10) NOT NULL DEFAULT 'full',
    "SortOrder" INT NOT NULL DEFAULT 0,
    "ConfigJson" TEXT NULL,
    "DateCreated" DATETIME(6) NOT NULL,
    "DateLastModified" DATETIME(6) NOT NULL,
    CONSTRAINT "FK_DashboardWidgets_Dashboards" FOREIGN KEY ("DashboardId") REFERENCES "Dashboards" ("Id") ON DELETE CASCADE,
    CONSTRAINT "FK_DashboardWidgets_SavedQueries" FOREIGN KEY ("SavedQueryId") REFERENCES "SavedQueries" ("Id") ON DELETE SET NULL
) ENGINE=InnoDB;
CREATE INDEX "IX_DashboardWidgets_DashboardId" ON "DashboardWidgets" ("DashboardId");
