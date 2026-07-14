-- Ported from api/Enkl.Api's AddProjectResourcePlaceholderUser migration. A placeholder resource row
-- can now optionally reference a real person (User) in the org, sharing the row's existing
-- AllocatedFraction — UserId NULL means an unfilled role. ON DELETE SET NULL: if the account is ever
-- deleted, the row survives as unassigned again rather than being destroyed.
ALTER TABLE "ProjectResourcePlaceholders" ADD COLUMN "UserId" uuid NULL REFERENCES "Users"("Id") ON DELETE SET NULL;
CREATE INDEX "IX_ProjectResourcePlaceholders_UserId" ON "ProjectResourcePlaceholders" ("UserId");
