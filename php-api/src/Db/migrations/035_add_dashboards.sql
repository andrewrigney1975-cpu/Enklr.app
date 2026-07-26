CREATE TABLE "Dashboards" (
    "Id" uuid PRIMARY KEY,
    "ProjectId" uuid NOT NULL REFERENCES "Projects" ("Id") ON DELETE CASCADE,
    "Name" varchar(200) NOT NULL,
    "Description" text,
    "DateCreated" timestamptz NOT NULL,
    "DateLastModified" timestamptz NOT NULL
);
CREATE INDEX "IX_Dashboards_ProjectId" ON "Dashboards" ("ProjectId");

CREATE TABLE "DashboardWidgets" (
    "Id" uuid PRIMARY KEY,
    "DashboardId" uuid NOT NULL REFERENCES "Dashboards" ("Id") ON DELETE CASCADE,
    "WidgetType" varchar(20) NOT NULL,
    "Title" varchar(200) NOT NULL,
    "SavedQueryId" uuid REFERENCES "SavedQueries" ("Id") ON DELETE SET NULL,
    "Width" varchar(10) NOT NULL DEFAULT 'full',
    "SortOrder" integer NOT NULL DEFAULT 0,
    "ConfigJson" text,
    "DateCreated" timestamptz NOT NULL,
    "DateLastModified" timestamptz NOT NULL
);
CREATE INDEX "IX_DashboardWidgets_DashboardId" ON "DashboardWidgets" ("DashboardId");
