-- Ported from api/Enkl.Api/Data/Migrations/20260804072848_FixVendorIntegrationApiKeyHash.cs.
-- Corrects VendorIntegrations.ApiKey (a plain string, added last pass as pure schema groundwork) to
-- ApiKeyHash — same bcrypt-hash-only, shown-once pattern as OrganisationApiKeys.KeyHash, backing the
-- real "Manage Vendors" per-Vendor Generate/Revoke API key flow. No unique index on the hash column
-- (a bcrypt hash is never looked up by exact value — verification always tries
-- PasswordHasher::verify against known candidate rows, same as the org-wide key's own check).

DROP INDEX "IX_VendorIntegrations_ApiKey";
ALTER TABLE "VendorIntegrations" DROP COLUMN "ApiKey";
ALTER TABLE "VendorIntegrations" ADD COLUMN "ApiKeyHash" text;
ALTER TABLE "VendorIntegrations" ADD COLUMN "GeneratedAt" timestamptz;
ALTER TABLE "VendorIntegrations" ADD COLUMN "LastUsedAt" timestamptz;
ALTER TABLE "VendorIntegrations" ALTER COLUMN "IsActive" SET DEFAULT true;
