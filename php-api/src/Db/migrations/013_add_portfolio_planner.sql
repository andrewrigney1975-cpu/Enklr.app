-- Ported from api/Enkl.Api's AddPortfolioPlanner migration. IsActive/Priority follow the exact
-- convention Tasks.Priority already established (unconstrained varchar, no CHECK constraint,
-- app-code-enforced default) — see PortfolioService::createProject.
ALTER TABLE "Projects" ADD COLUMN "IsActive" boolean NOT NULL DEFAULT true;
ALTER TABLE "Projects" ADD COLUMN "Priority" varchar(20) NOT NULL DEFAULT 'medium';
ALTER TABLE "Projects" ADD COLUMN "CategoryId" uuid;

CREATE TABLE "PortfolioCategories" (
    "Id" uuid PRIMARY KEY,
    "OrganisationId" uuid NOT NULL REFERENCES "Organisations"("Id") ON DELETE CASCADE,
    "Name" varchar(100) NOT NULL,
    "SortOrder" integer NOT NULL
);
CREATE INDEX "IX_PortfolioCategories_OrganisationId" ON "PortfolioCategories" ("OrganisationId");

ALTER TABLE "Projects" ADD CONSTRAINT "FK_Projects_PortfolioCategories_CategoryId"
    FOREIGN KEY ("CategoryId") REFERENCES "PortfolioCategories"("Id") ON DELETE SET NULL;
CREATE INDEX "IX_Projects_CategoryId" ON "Projects" ("CategoryId");
