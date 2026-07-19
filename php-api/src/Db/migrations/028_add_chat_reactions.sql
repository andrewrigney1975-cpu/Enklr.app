CREATE TABLE "ChatMessageReactions" (
    "Id" uuid PRIMARY KEY,
    "MessageId" uuid NOT NULL REFERENCES "ChatMessages" ("Id") ON DELETE CASCADE,
    "UserId" uuid NOT NULL REFERENCES "Users" ("Id") ON DELETE CASCADE,
    "Emoji" varchar(8) NOT NULL,
    "DateCreated" timestamptz NOT NULL
);
CREATE UNIQUE INDEX "IX_ChatMessageReactions_MessageId_UserId_Emoji" ON "ChatMessageReactions" ("MessageId", "UserId", "Emoji");
CREATE INDEX "IX_ChatMessageReactions_UserId" ON "ChatMessageReactions" ("UserId");
