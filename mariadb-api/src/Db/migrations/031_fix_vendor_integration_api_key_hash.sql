-- Ported from php-api/src/Db/migrations/050_fix_vendor_integration_api_key_hash.sql (itself ported
-- from api/Enkl.Api/Data/Migrations/20260804072848_FixVendorIntegrationApiKeyHash.cs). timestamptz ->
-- DATETIME(6) per this tier's own column-type mapping (mariadb-api/CLAUDE.md §3). No dialect
-- divergence otherwise — plain DDL, no Postgres-only primitives involved.

DROP INDEX "IX_VendorIntegrations_ApiKey" ON "VendorIntegrations";
ALTER TABLE "VendorIntegrations" DROP COLUMN "ApiKey";
ALTER TABLE "VendorIntegrations" ADD COLUMN "ApiKeyHash" TEXT;
ALTER TABLE "VendorIntegrations" ADD COLUMN "GeneratedAt" DATETIME(6);
ALTER TABLE "VendorIntegrations" ADD COLUMN "LastUsedAt" DATETIME(6);
ALTER TABLE "VendorIntegrations" ALTER COLUMN "IsActive" SET DEFAULT true;
