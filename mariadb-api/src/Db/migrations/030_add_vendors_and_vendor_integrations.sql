-- Ported from php-api/src/Db/migrations/049_add_vendors_and_vendor_integrations.sql (itself ported
-- from api/Enkl.Api/Data/Migrations/20260803201923_AddVendorsAndVendorIntegrations.cs). uuid ->
-- CHAR(36), timestamptz -> DATETIME(6) per this tier's own column-type mapping
-- (mariadb-api/CLAUDE.md §3). Groundwork only for now, no controller/service exposes these yet.

-- Org-scoped child, no independent meaning outside its Organisation, same shape as
-- PortfolioCategory/Announcements/ChatChannels.
CREATE TABLE "Vendors" (
    "Id" CHAR(36) NOT NULL PRIMARY KEY,
    "OrganisationId" CHAR(36) NOT NULL,
    "Name" VARCHAR(200) NOT NULL,
    "PrimaryContactPerson" VARCHAR(200) NULL,
    "ContactEmailAddress" VARCHAR(320) NULL,
    "ContactUrl" VARCHAR(500) NULL,
    "TaxNumber" VARCHAR(50) NULL,
    "IsActive" BOOLEAN NOT NULL DEFAULT true,
    "DateCreated" DATETIME(6) NOT NULL,
    "DateLastModified" DATETIME(6) NOT NULL,
    CONSTRAINT "FK_Vendors_Organisations" FOREIGN KEY ("OrganisationId") REFERENCES "Organisations" ("Id") ON DELETE CASCADE
);
CREATE INDEX "IX_Vendors_OrganisationId" ON "Vendors" ("OrganisationId");

-- ApiKey is a plain string column, not a hash (contrast OrganisationApiKeys.KeyHash's bcrypt-only,
-- shown-once pattern) — this table exists purely to establish the schema shape ahead of the real
-- "per-vendor API key" feature; whether that feature reuses OrganisationApiKeys' hash-only pattern
-- is an open question for that later pass, not decided here. IsActive deliberately has NO DEFAULT
-- clause at all (unlike Vendors.IsActive) — every INSERT must supply it explicitly, matching the
-- .NET tier's own migration (no HasDefaultValue call on this property).
CREATE TABLE "VendorIntegrations" (
    "Id" CHAR(36) NOT NULL PRIMARY KEY,
    "VendorId" CHAR(36) NOT NULL,
    "ApiKey" VARCHAR(200) NOT NULL,
    "IsActive" BOOLEAN NOT NULL,
    "DateCreated" DATETIME(6) NOT NULL,
    "DateLastModified" DATETIME(6) NOT NULL,
    CONSTRAINT "FK_VendorIntegrations_Vendors" FOREIGN KEY ("VendorId") REFERENCES "Vendors" ("Id") ON DELETE CASCADE
);
CREATE INDEX "IX_VendorIntegrations_VendorId" ON "VendorIntegrations" ("VendorId");
-- Globally unique, not scoped to Vendor — an ApiKey is a bearer secret meant to be looked up
-- directly once real auth is built on top of this, not a human-facing short code like Tasks.Key.
CREATE UNIQUE INDEX "IX_VendorIntegrations_ApiKey" ON "VendorIntegrations" ("ApiKey");
