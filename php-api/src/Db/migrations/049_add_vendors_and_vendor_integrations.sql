-- Ported from api/Enkl.Api/Data/Migrations/20260803201923_AddVendorsAndVendorIntegrations.cs.
-- Groundwork only for now, no controller/service exposes these yet — later work will add Vendor
-- management and extend API management to per-vendor API keys for greater granularity/control.

-- Org-scoped child, no independent meaning outside its Organisation, same shape as
-- PortfolioCategory/Announcements/ChatChannels.
CREATE TABLE "Vendors" (
    "Id" uuid PRIMARY KEY,
    "OrganisationId" uuid NOT NULL REFERENCES "Organisations" ("Id") ON DELETE CASCADE,
    "Name" varchar(200) NOT NULL,
    "PrimaryContactPerson" varchar(200) NULL,
    "ContactEmailAddress" varchar(320) NULL,
    "ContactUrl" varchar(500) NULL,
    "TaxNumber" varchar(50) NULL,
    "IsActive" boolean NOT NULL DEFAULT true,
    "DateCreated" timestamptz NOT NULL,
    "DateLastModified" timestamptz NOT NULL
);
CREATE INDEX "IX_Vendors_OrganisationId" ON "Vendors" ("OrganisationId");

-- ApiKey is a plain string column, not a hash (contrast OrganisationApiKeys.KeyHash's bcrypt-only,
-- shown-once pattern) — this table exists purely to establish the schema shape ahead of the real
-- "per-vendor API key" feature; whether that feature reuses OrganisationApiKeys' hash-only pattern
-- is an open question for that later pass, not decided here. IsActive deliberately has NO DEFAULT
-- clause at all (unlike Vendors.IsActive) — every INSERT must supply it explicitly until that later
-- feature decides what "freshly created, key not yet issued" should mean, matching the .NET tier's
-- own migration (no HasDefaultValue call on this property).
CREATE TABLE "VendorIntegrations" (
    "Id" uuid PRIMARY KEY,
    "VendorId" uuid NOT NULL REFERENCES "Vendors" ("Id") ON DELETE CASCADE,
    "ApiKey" varchar(200) NOT NULL,
    "IsActive" boolean NOT NULL,
    "DateCreated" timestamptz NOT NULL,
    "DateLastModified" timestamptz NOT NULL
);
CREATE INDEX "IX_VendorIntegrations_VendorId" ON "VendorIntegrations" ("VendorId");
-- Globally unique, not scoped to Vendor — an ApiKey is a bearer secret meant to be looked up
-- directly once real auth is built on top of this, not a human-facing short code like Tasks.Key.
CREATE UNIQUE INDEX "IX_VendorIntegrations_ApiKey" ON "VendorIntegrations" ("ApiKey");
