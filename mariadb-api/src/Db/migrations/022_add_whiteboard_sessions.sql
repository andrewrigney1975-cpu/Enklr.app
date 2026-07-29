CREATE TABLE "WhiteboardSessions" (
    "Id" CHAR(36) NOT NULL PRIMARY KEY,
    "OrganisationId" CHAR(36) NOT NULL,
    "HostUserId" CHAR(36) NOT NULL,
    "JoinCode" VARCHAR(6) NOT NULL,
    "Title" VARCHAR(200) NULL,
    "Status" VARCHAR(20) NOT NULL DEFAULT 'open',
    "IsSaved" BOOLEAN NOT NULL DEFAULT 0,
    "CreatedAt" DATETIME(6) NOT NULL,
    "ClosedAt" DATETIME(6) NULL,
    "SavedAt" DATETIME(6) NULL,
    CONSTRAINT "FK_WhiteboardSessions_Organisations" FOREIGN KEY ("OrganisationId") REFERENCES "Organisations" ("Id") ON DELETE CASCADE,
    CONSTRAINT "FK_WhiteboardSessions_Users" FOREIGN KEY ("HostUserId") REFERENCES "Users" ("Id") ON DELETE CASCADE
);
CREATE INDEX "IX_WhiteboardSessions_OrganisationId" ON "WhiteboardSessions" ("OrganisationId");
CREATE INDEX "IX_WhiteboardSessions_HostUserId" ON "WhiteboardSessions" ("HostUserId");
-- Not unique — JoinCode is only unique among currently-open sessions, enforced in
-- WhiteboardService (re-roll on collision), not at the DB level.
CREATE INDEX "IX_WhiteboardSessions_JoinCode_Status" ON "WhiteboardSessions" ("JoinCode", "Status");

CREATE TABLE "WhiteboardElements" (
    "Id" CHAR(36) NOT NULL PRIMARY KEY,
    "SessionId" CHAR(36) NOT NULL,
    "CreatedByUserId" CHAR(36) NOT NULL,
    "ElementType" VARCHAR(20) NOT NULL,
    "ElementJson" TEXT NOT NULL,
    "CreatedAt" DATETIME(6) NOT NULL,
    "DeletedAt" DATETIME(6) NULL,
    CONSTRAINT "FK_WhiteboardElements_Sessions" FOREIGN KEY ("SessionId") REFERENCES "WhiteboardSessions" ("Id") ON DELETE CASCADE,
    CONSTRAINT "FK_WhiteboardElements_Users" FOREIGN KEY ("CreatedByUserId") REFERENCES "Users" ("Id") ON DELETE CASCADE
);
CREATE INDEX "IX_WhiteboardElements_CreatedByUserId" ON "WhiteboardElements" ("CreatedByUserId");
-- Serves the "current board state" fetch (WHERE SessionId = ... AND DeletedAt IS NULL).
CREATE INDEX "IX_WhiteboardElements_SessionId_DeletedAt" ON "WhiteboardElements" ("SessionId", "DeletedAt");

CREATE TABLE "WhiteboardParticipants" (
    "Id" CHAR(36) NOT NULL PRIMARY KEY,
    "SessionId" CHAR(36) NOT NULL,
    "UserId" CHAR(36) NOT NULL,
    "JoinedAt" DATETIME(6) NOT NULL,
    "LeftAt" DATETIME(6) NULL,
    CONSTRAINT "FK_WhiteboardParticipants_Sessions" FOREIGN KEY ("SessionId") REFERENCES "WhiteboardSessions" ("Id") ON DELETE CASCADE,
    CONSTRAINT "FK_WhiteboardParticipants_Users" FOREIGN KEY ("UserId") REFERENCES "Users" ("Id") ON DELETE CASCADE
);
CREATE INDEX "IX_WhiteboardParticipants_UserId" ON "WhiteboardParticipants" ("UserId");
CREATE INDEX "IX_WhiteboardParticipants_SessionId_UserId" ON "WhiteboardParticipants" ("SessionId", "UserId");
