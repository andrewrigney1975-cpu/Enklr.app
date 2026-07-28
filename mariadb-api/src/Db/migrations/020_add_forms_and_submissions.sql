CREATE TABLE "Forms" (
    "Id" CHAR(36) NOT NULL PRIMARY KEY,
    "OrganisationId" CHAR(36) NOT NULL,
    "FormGroupId" CHAR(36) NOT NULL,
    "Name" VARCHAR(200) NOT NULL,
    "Description" TEXT NULL,
    "VersionNumber" INT NOT NULL,
    "Status" VARCHAR(20) NOT NULL DEFAULT 'draft',
    "FieldsJson" TEXT NULL,
    "WorkflowJson" TEXT NULL,
    "CreatedByUserId" CHAR(36) NULL,
    "DateCreated" DATETIME(6) NOT NULL,
    "DateLastModified" DATETIME(6) NOT NULL,
    "PublishedAt" DATETIME(6) NULL,
    CONSTRAINT "FK_Forms_Organisations" FOREIGN KEY ("OrganisationId") REFERENCES "Organisations" ("Id") ON DELETE CASCADE,
    CONSTRAINT "FK_Forms_Users" FOREIGN KEY ("CreatedByUserId") REFERENCES "Users" ("Id") ON DELETE SET NULL
);
CREATE INDEX "IX_Forms_OrganisationId" ON "Forms" ("OrganisationId");
CREATE INDEX "IX_Forms_FormGroupId_VersionNumber" ON "Forms" ("FormGroupId", "VersionNumber");
CREATE INDEX "IX_Forms_CreatedByUserId" ON "Forms" ("CreatedByUserId");

CREATE TABLE "FormSubmissions" (
    "Id" CHAR(36) NOT NULL PRIMARY KEY,
    "FormVersionId" CHAR(36) NOT NULL,
    "ProjectId" CHAR(36) NOT NULL,
    "SubmittedByUserId" CHAR(36) NOT NULL,
    "Status" VARCHAR(20) NOT NULL DEFAULT 'draft',
    "CurrentNodeId" TEXT NULL,
    "AnswersJson" TEXT NULL,
    "ApprovalTrailJson" TEXT NULL,
    "DateCreated" DATETIME(6) NOT NULL,
    "DateLastModified" DATETIME(6) NOT NULL,
    "DateSubmitted" DATETIME(6) NULL,
    CONSTRAINT "FK_FormSubmissions_Forms" FOREIGN KEY ("FormVersionId") REFERENCES "Forms" ("Id") ON DELETE RESTRICT,
    CONSTRAINT "FK_FormSubmissions_Projects" FOREIGN KEY ("ProjectId") REFERENCES "Projects" ("Id") ON DELETE CASCADE,
    CONSTRAINT "FK_FormSubmissions_Users" FOREIGN KEY ("SubmittedByUserId") REFERENCES "Users" ("Id") ON DELETE RESTRICT
);
CREATE INDEX "IX_FormSubmissions_FormVersionId" ON "FormSubmissions" ("FormVersionId");
CREATE INDEX "IX_FormSubmissions_ProjectId_SubmittedByUserId" ON "FormSubmissions" ("ProjectId", "SubmittedByUserId");
