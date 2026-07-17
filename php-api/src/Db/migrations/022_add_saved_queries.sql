CREATE TABLE "SavedQueries" (
    "Id" uuid PRIMARY KEY,
    "ProjectId" uuid NOT NULL REFERENCES "Projects" ("Id") ON DELETE CASCADE,
    "Name" varchar(200) NOT NULL,
    "Sql" text NOT NULL,
    "DateCreated" timestamptz NOT NULL
);
CREATE INDEX "IX_SavedQueries_ProjectId" ON "SavedQueries" ("ProjectId");
