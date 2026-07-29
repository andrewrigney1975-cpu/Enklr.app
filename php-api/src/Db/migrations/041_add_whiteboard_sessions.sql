CREATE TABLE "WhiteboardSessions" (
    "Id" uuid PRIMARY KEY,
    "OrganisationId" uuid NOT NULL REFERENCES "Organisations" ("Id") ON DELETE CASCADE,
    "HostUserId" uuid NOT NULL REFERENCES "Users" ("Id") ON DELETE CASCADE,
    "JoinCode" varchar(6) NOT NULL,
    "Title" varchar(200) NULL,
    "Status" varchar(20) NOT NULL DEFAULT 'open',
    "IsSaved" boolean NOT NULL DEFAULT false,
    "CreatedAt" timestamptz NOT NULL,
    "ClosedAt" timestamptz NULL,
    "SavedAt" timestamptz NULL
);
CREATE INDEX "IX_WhiteboardSessions_OrganisationId" ON "WhiteboardSessions" ("OrganisationId");
CREATE INDEX "IX_WhiteboardSessions_HostUserId" ON "WhiteboardSessions" ("HostUserId");
-- Not unique — JoinCode is only unique among currently-open sessions, enforced in
-- WhiteboardService (re-roll on collision), not at the DB level.
CREATE INDEX "IX_WhiteboardSessions_JoinCode_Status" ON "WhiteboardSessions" ("JoinCode", "Status");

CREATE TABLE "WhiteboardElements" (
    "Id" uuid PRIMARY KEY,
    "SessionId" uuid NOT NULL REFERENCES "WhiteboardSessions" ("Id") ON DELETE CASCADE,
    "CreatedByUserId" uuid NOT NULL REFERENCES "Users" ("Id") ON DELETE CASCADE,
    "ElementType" varchar(20) NOT NULL,
    "ElementJson" text NOT NULL,
    "CreatedAt" timestamptz NOT NULL,
    "DeletedAt" timestamptz NULL
);
CREATE INDEX "IX_WhiteboardElements_CreatedByUserId" ON "WhiteboardElements" ("CreatedByUserId");
-- Serves the "current board state" fetch (WHERE SessionId = ... AND DeletedAt IS NULL).
CREATE INDEX "IX_WhiteboardElements_SessionId_DeletedAt" ON "WhiteboardElements" ("SessionId", "DeletedAt");

CREATE TABLE "WhiteboardParticipants" (
    "Id" uuid PRIMARY KEY,
    "SessionId" uuid NOT NULL REFERENCES "WhiteboardSessions" ("Id") ON DELETE CASCADE,
    "UserId" uuid NOT NULL REFERENCES "Users" ("Id") ON DELETE CASCADE,
    "JoinedAt" timestamptz NOT NULL,
    "LeftAt" timestamptz NULL
);
CREATE INDEX "IX_WhiteboardParticipants_UserId" ON "WhiteboardParticipants" ("UserId");
CREATE INDEX "IX_WhiteboardParticipants_SessionId_UserId" ON "WhiteboardParticipants" ("SessionId", "UserId");
