CREATE TABLE "Forms" (
    "Id" uuid PRIMARY KEY,
    "OrganisationId" uuid NOT NULL REFERENCES "Organisations" ("Id") ON DELETE CASCADE,
    "FormGroupId" uuid NOT NULL,
    "Name" varchar(200) NOT NULL,
    "Description" text NULL,
    "VersionNumber" integer NOT NULL,
    "Status" varchar(20) NOT NULL DEFAULT 'draft',
    "FieldsJson" text NULL,
    "WorkflowJson" text NULL,
    "CreatedByUserId" uuid NULL REFERENCES "Users" ("Id") ON DELETE SET NULL,
    "DateCreated" timestamptz NOT NULL,
    "DateLastModified" timestamptz NOT NULL,
    "PublishedAt" timestamptz NULL
);
CREATE INDEX "IX_Forms_OrganisationId" ON "Forms" ("OrganisationId");
CREATE INDEX "IX_Forms_FormGroupId_VersionNumber" ON "Forms" ("FormGroupId", "VersionNumber");
CREATE INDEX "IX_Forms_CreatedByUserId" ON "Forms" ("CreatedByUserId");

CREATE TABLE "FormSubmissions" (
    "Id" uuid PRIMARY KEY,
    "FormVersionId" uuid NOT NULL REFERENCES "Forms" ("Id") ON DELETE RESTRICT,
    "ProjectId" uuid NOT NULL REFERENCES "Projects" ("Id") ON DELETE CASCADE,
    "SubmittedByUserId" uuid NOT NULL REFERENCES "Users" ("Id") ON DELETE RESTRICT,
    "Status" varchar(20) NOT NULL DEFAULT 'draft',
    "CurrentNodeId" text NULL,
    "AnswersJson" text NULL,
    "ApprovalTrailJson" text NULL,
    "DateCreated" timestamptz NOT NULL,
    "DateLastModified" timestamptz NOT NULL,
    "DateSubmitted" timestamptz NULL
);
CREATE INDEX "IX_FormSubmissions_FormVersionId" ON "FormSubmissions" ("FormVersionId");
CREATE INDEX "IX_FormSubmissions_ProjectId_SubmittedByUserId" ON "FormSubmissions" ("ProjectId", "SubmittedByUserId");
