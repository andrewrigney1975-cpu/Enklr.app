-- Ported from api/Enkl.Api's ScopeProjectKeyUniquenessToOrganisation migration — this was never
-- carried over to the PHP tier when that .NET migration landed, leaving MigrationService.php's
-- resolveUniqueProjectKey() (org-scoped collision check + auto-suffix) silently unable to do its
-- job: the DB's own global "IX_Projects_Key" unique index still rejected two different
-- organisations both migrating a project with the same key (e.g. every fresh install seeding the
-- same "SMPL" key) with a raw 23505 constraint violation (-> a generic 409) instead of the intended
-- graceful auto-suffix-with-warning path. Found while porting api/Enkl.Api.Tests' migration test
-- coverage to this tier (php-api/tests/MigrationServiceTest.php).
DROP INDEX "IX_Projects_Key";
DROP INDEX "IX_Projects_OrganisationId";
CREATE UNIQUE INDEX "IX_Projects_OrganisationId_Key" ON "Projects" ("OrganisationId", "Key");
