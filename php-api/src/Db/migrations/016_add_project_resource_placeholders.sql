-- Ported from api/Enkl.Api's AddProjectResourcePlaceholders migration. Draft resourcing (role +
-- allocated %) for a Portfolio Planner placeholder project — project-scoped (FK to Projects), not
-- org-scoped, same as ProjectMembers/TaskTypes. Role is an unconstrained varchar, no CHECK
-- constraint, matching the ProjectMembers."Role"/Projects."Priority" convention.
CREATE TABLE "ProjectResourcePlaceholders" (
    "Id" uuid PRIMARY KEY,
    "ProjectId" uuid NOT NULL REFERENCES "Projects"("Id") ON DELETE CASCADE,
    "Role" varchar(100) NOT NULL,
    "AllocatedFraction" integer NOT NULL
);
CREATE INDEX "IX_ProjectResourcePlaceholders_ProjectId" ON "ProjectResourcePlaceholders" ("ProjectId");
