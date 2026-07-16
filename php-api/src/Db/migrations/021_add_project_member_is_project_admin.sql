-- Ported from api/Enkl.Api's AddProjectMemberIsProjectAdmin migration — new Project Administrator
-- role (per-project permission tier between plain ProjectMember and org-wide IsOrgAdmin). See
-- Auth/ProjectAdminMiddleware.php's own doc comment for what this gates.
ALTER TABLE "ProjectMembers" ADD COLUMN "IsProjectAdmin" boolean NOT NULL DEFAULT false;
