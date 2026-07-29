-- Ported from api/Enkl.Api/Data/Migrations/20260729190152_AddPortals.cs. Organisational Portals — an
-- Org-Admin-authored, curated front door for org users who aren't necessarily members of any Project.
-- ProjectId points at a dedicated, membership-free "actioner" Project auto-provisioned at creation
-- time (see PortalService::create). Access is closed by default — see PortalAccessGrants; a Portal
-- with zero grants is invisible to every org user.

CREATE TABLE "Portals" (
    "Id" uuid PRIMARY KEY,
    "OrganisationId" uuid NOT NULL REFERENCES "Organisations" ("Id") ON DELETE CASCADE,
    "Name" varchar(200) NOT NULL,
    "Slug" varchar(80) NOT NULL,
    "Description" text NULL,
    "Status" varchar(20) NOT NULL DEFAULT 'draft',
    "ProjectId" uuid NOT NULL REFERENCES "Projects" ("Id") ON DELETE RESTRICT,
    "CreatedByUserId" uuid NULL REFERENCES "Users" ("Id") ON DELETE SET NULL,
    "DateCreated" timestamptz NOT NULL,
    "DateLastModified" timestamptz NOT NULL,
    "PublishedAt" timestamptz NULL
);
CREATE UNIQUE INDEX "IX_Portals_OrganisationId_Slug" ON "Portals" ("OrganisationId", "Slug");
CREATE INDEX "IX_Portals_ProjectId" ON "Portals" ("ProjectId");
CREATE INDEX "IX_Portals_CreatedByUserId" ON "Portals" ("CreatedByUserId");

-- Kind: orgTeam|teamCommittee|namedUser — Value is the target OrgTeam/TeamCommittee/User id.
CREATE TABLE "PortalAccessGrants" (
    "Id" uuid PRIMARY KEY,
    "PortalId" uuid NOT NULL REFERENCES "Portals" ("Id") ON DELETE CASCADE,
    "Kind" varchar(20) NOT NULL,
    "Value" uuid NOT NULL,
    "DateCreated" timestamptz NOT NULL
);
CREATE UNIQUE INDEX "IX_PortalAccessGrants_PortalId_Kind_Value" ON "PortalAccessGrants" ("PortalId", "Kind", "Value");

-- FormGroupId deliberately has no FK — Forms is keyed by Id (one row per version), not FormGroupId;
-- resolved at read time to whichever version is currently Status='published', same as FormService.
CREATE TABLE "PortalForms" (
    "Id" uuid PRIMARY KEY,
    "PortalId" uuid NOT NULL REFERENCES "Portals" ("Id") ON DELETE CASCADE,
    "FormGroupId" uuid NOT NULL,
    "Order" integer NOT NULL,
    "DateCreated" timestamptz NOT NULL
);
CREATE UNIQUE INDEX "IX_PortalForms_PortalId_FormGroupId" ON "PortalForms" ("PortalId", "FormGroupId");

CREATE TABLE "PortalTopics" (
    "Id" uuid PRIMARY KEY,
    "PortalId" uuid NOT NULL REFERENCES "Portals" ("Id") ON DELETE CASCADE,
    "Title" varchar(200) NOT NULL,
    "Order" integer NOT NULL,
    "DateCreated" timestamptz NOT NULL,
    "DateLastModified" timestamptz NOT NULL
);
CREATE INDEX "IX_PortalTopics_PortalId" ON "PortalTopics" ("PortalId");

-- Answer is stored as markdown (rich-text editor's own serialization format), never raw HTML — same
-- convention as Tasks.Description.
CREATE TABLE "PortalQaEntries" (
    "Id" uuid PRIMARY KEY,
    "PortalId" uuid NOT NULL REFERENCES "Portals" ("Id") ON DELETE CASCADE,
    "PortalTopicId" uuid NULL REFERENCES "PortalTopics" ("Id") ON DELETE SET NULL,
    "Question" varchar(500) NOT NULL,
    "Answer" text NULL,
    "Order" integer NOT NULL,
    "CreatedByUserId" uuid NULL REFERENCES "Users" ("Id") ON DELETE SET NULL,
    "DateCreated" timestamptz NOT NULL,
    "DateLastModified" timestamptz NOT NULL
);
CREATE INDEX "IX_PortalQaEntries_PortalId" ON "PortalQaEntries" ("PortalId");
CREATE INDEX "IX_PortalQaEntries_PortalTopicId" ON "PortalQaEntries" ("PortalTopicId");
CREATE INDEX "IX_PortalQaEntries_CreatedByUserId" ON "PortalQaEntries" ("CreatedByUserId");
