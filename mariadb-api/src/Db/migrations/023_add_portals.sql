-- Ported from php-api/src/Db/migrations/042_add_portals.sql (itself ported from
-- api/Enkl.Api/Data/Migrations/20260729190152_AddPortals.cs). uuid -> CHAR(36), timestamptz ->
-- DATETIME(6) per this tier's own column-type mapping (mariadb-api/CLAUDE.md §3). Organisational
-- Portals — an Org-Admin-authored, curated front door for org users who aren't necessarily members of
-- any Project. ProjectId points at a dedicated, membership-free "actioner" Project auto-provisioned
-- at creation time (see PortalService::create). Access is closed by default — see PortalAccessGrants;
-- a Portal with zero grants is invisible to every org user.

CREATE TABLE "Portals" (
    "Id" CHAR(36) NOT NULL PRIMARY KEY,
    "OrganisationId" CHAR(36) NOT NULL,
    "Name" VARCHAR(200) NOT NULL,
    "Slug" VARCHAR(80) NOT NULL,
    "Description" TEXT NULL,
    "Status" VARCHAR(20) NOT NULL DEFAULT 'draft',
    "ProjectId" CHAR(36) NOT NULL,
    "CreatedByUserId" CHAR(36) NULL,
    "DateCreated" DATETIME(6) NOT NULL,
    "DateLastModified" DATETIME(6) NOT NULL,
    "PublishedAt" DATETIME(6) NULL,
    CONSTRAINT "FK_Portals_Organisations" FOREIGN KEY ("OrganisationId") REFERENCES "Organisations" ("Id") ON DELETE CASCADE,
    CONSTRAINT "FK_Portals_Projects" FOREIGN KEY ("ProjectId") REFERENCES "Projects" ("Id") ON DELETE RESTRICT,
    CONSTRAINT "FK_Portals_Users" FOREIGN KEY ("CreatedByUserId") REFERENCES "Users" ("Id") ON DELETE SET NULL
);
CREATE UNIQUE INDEX "IX_Portals_OrganisationId_Slug" ON "Portals" ("OrganisationId", "Slug");
CREATE INDEX "IX_Portals_ProjectId" ON "Portals" ("ProjectId");
CREATE INDEX "IX_Portals_CreatedByUserId" ON "Portals" ("CreatedByUserId");

-- Kind: orgTeam|teamCommittee|namedUser — Value is the target OrgTeam/TeamCommittee/User id.
CREATE TABLE "PortalAccessGrants" (
    "Id" CHAR(36) NOT NULL PRIMARY KEY,
    "PortalId" CHAR(36) NOT NULL,
    "Kind" VARCHAR(20) NOT NULL,
    "Value" CHAR(36) NOT NULL,
    "DateCreated" DATETIME(6) NOT NULL,
    CONSTRAINT "FK_PortalAccessGrants_Portals" FOREIGN KEY ("PortalId") REFERENCES "Portals" ("Id") ON DELETE CASCADE
);
CREATE UNIQUE INDEX "IX_PortalAccessGrants_PortalId_Kind_Value" ON "PortalAccessGrants" ("PortalId", "Kind", "Value");

-- FormGroupId deliberately has no FK — Forms is keyed by Id (one row per version), not FormGroupId;
-- resolved at read time to whichever version is currently Status='published', same as FormService.
CREATE TABLE "PortalForms" (
    "Id" CHAR(36) NOT NULL PRIMARY KEY,
    "PortalId" CHAR(36) NOT NULL,
    "FormGroupId" CHAR(36) NOT NULL,
    "Order" INT NOT NULL,
    "DateCreated" DATETIME(6) NOT NULL,
    CONSTRAINT "FK_PortalForms_Portals" FOREIGN KEY ("PortalId") REFERENCES "Portals" ("Id") ON DELETE CASCADE
);
CREATE UNIQUE INDEX "IX_PortalForms_PortalId_FormGroupId" ON "PortalForms" ("PortalId", "FormGroupId");

CREATE TABLE "PortalTopics" (
    "Id" CHAR(36) NOT NULL PRIMARY KEY,
    "PortalId" CHAR(36) NOT NULL,
    "Title" VARCHAR(200) NOT NULL,
    "Order" INT NOT NULL,
    "DateCreated" DATETIME(6) NOT NULL,
    "DateLastModified" DATETIME(6) NOT NULL,
    CONSTRAINT "FK_PortalTopics_Portals" FOREIGN KEY ("PortalId") REFERENCES "Portals" ("Id") ON DELETE CASCADE
);
CREATE INDEX "IX_PortalTopics_PortalId" ON "PortalTopics" ("PortalId");

-- Answer is stored as markdown (rich-text editor's own serialization format), never raw HTML — same
-- convention as Tasks.Description.
CREATE TABLE "PortalQaEntries" (
    "Id" CHAR(36) NOT NULL PRIMARY KEY,
    "PortalId" CHAR(36) NOT NULL,
    "PortalTopicId" CHAR(36) NULL,
    "Question" VARCHAR(500) NOT NULL,
    "Answer" TEXT NULL,
    "Order" INT NOT NULL,
    "CreatedByUserId" CHAR(36) NULL,
    "DateCreated" DATETIME(6) NOT NULL,
    "DateLastModified" DATETIME(6) NOT NULL,
    CONSTRAINT "FK_PortalQaEntries_Portals" FOREIGN KEY ("PortalId") REFERENCES "Portals" ("Id") ON DELETE CASCADE,
    CONSTRAINT "FK_PortalQaEntries_PortalTopics" FOREIGN KEY ("PortalTopicId") REFERENCES "PortalTopics" ("Id") ON DELETE SET NULL,
    CONSTRAINT "FK_PortalQaEntries_Users" FOREIGN KEY ("CreatedByUserId") REFERENCES "Users" ("Id") ON DELETE SET NULL
);
CREATE INDEX "IX_PortalQaEntries_PortalId" ON "PortalQaEntries" ("PortalId");
CREATE INDEX "IX_PortalQaEntries_PortalTopicId" ON "PortalQaEntries" ("PortalTopicId");
CREATE INDEX "IX_PortalQaEntries_CreatedByUserId" ON "PortalQaEntries" ("CreatedByUserId");
