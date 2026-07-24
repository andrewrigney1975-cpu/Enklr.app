-- Per-Organisation feature entitlements, owned by Enkl Portal exactly like vendor_licenses/
-- vendor_contracts (001_create_vendor_tables.sql) — this app's own table, org_id FK'd against the
-- main app's "Organisations", the main app's own backend tiers only ever SELECT from it (see root
-- CLAUDE.md's per-Organisation AI Assistant entitlement section).
--
-- Row-presence semantics: no row for a given (org_id, feature_key) means DISABLED - the safe
-- default for any future feature_key added here. The backfill below is a one-time exception for
-- "ai_assistant" specifically, grandfathering every Organisation that already existed when this
-- shipped (they already had unrestricted access before this table existed at all); any
-- Organisation created afterward starts with no row, i.e. disabled until an Enkl Portal admin
-- explicitly turns it on for them.

CREATE TABLE vendor_feature_entitlements (
  org_id uuid NOT NULL REFERENCES "Organisations"("Id") ON DELETE CASCADE,
  feature_key text NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by text,
  PRIMARY KEY (org_id, feature_key)
);

INSERT INTO vendor_feature_entitlements (org_id, feature_key, enabled, updated_by)
SELECT "Id", 'ai_assistant', true, 'migration-backfill' FROM "Organisations";
