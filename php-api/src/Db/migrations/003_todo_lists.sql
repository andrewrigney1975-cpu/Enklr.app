-- To-Do Lists: the app's first genuinely per-USER resource (not scoped to a Project or an
-- Organisation like everything else). A list belongs to exactly one User; deleting a User or a List
-- cascades to its children, unlike the deliberate ON DELETE RESTRICT used for Organisation->Project
-- and Organisation->ProjectTemplate — there's no service-layer orphan-handling for a user's own
-- private to-do data, and the app's own requirement is that deleting a list deletes its items.
CREATE TABLE "ToDoLists" (
    "Id" uuid PRIMARY KEY,
    "UserId" uuid NOT NULL REFERENCES "Users" ("Id") ON DELETE CASCADE,
    "Title" varchar(200) NOT NULL,
    "DateCreated" timestamptz NOT NULL,
    "DateLastModified" timestamptz NOT NULL
);
CREATE INDEX "IX_ToDoLists_UserId" ON "ToDoLists" ("UserId");

CREATE TABLE "ToDoItems" (
    "Id" uuid PRIMARY KEY,
    "ToDoListId" uuid NOT NULL REFERENCES "ToDoLists" ("Id") ON DELETE CASCADE,
    "Note" text NOT NULL,
    "Completed" boolean NOT NULL DEFAULT false,
    "DueDate" timestamptz,
    "DateCreated" timestamptz NOT NULL,
    "DateLastModified" timestamptz NOT NULL
);
CREATE INDEX "IX_ToDoItems_ToDoListId" ON "ToDoItems" ("ToDoListId");
