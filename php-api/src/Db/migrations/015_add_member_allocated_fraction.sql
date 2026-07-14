-- Ported from api/Enkl.Api's AddMemberAllocatedFraction migration. Unconstrained nullable integer,
-- no CHECK constraint — clamping to [0, 100] happens in application code (MemberService::update),
-- matching the "Role" column's own app-enforced-only convention on this same table.
ALTER TABLE "ProjectMembers" ADD COLUMN "AllocatedFraction" integer NULL;
