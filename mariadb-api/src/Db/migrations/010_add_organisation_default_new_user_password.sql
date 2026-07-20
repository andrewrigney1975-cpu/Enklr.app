-- Lets an OrgAdmin configure the password newly (implicitly) created users in their org get,
-- instead of the hardcoded PasswordHasher::GLOBAL_DEFAULT_NEW_USER_PASSWORD every org used to
-- share. Only the bcrypt HASH is ever stored — never the plaintext — reused directly as a new
-- User's PasswordHash at creation time, never re-hashed. See OrganisationService::createUser's own
-- comment and Services/MemberService.php/MigrationService.php's resolveDefaultNewUserPasswordHash
-- for where this is actually consumed. Mirrors php-api's own 029_add_organisation_default_new_user_password.sql.
ALTER TABLE "Organisations" ADD COLUMN "DefaultNewUserPasswordHash" TEXT NULL;
