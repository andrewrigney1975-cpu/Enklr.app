-- Opt-in "Enterprise" App Settings that apply org-WIDE rather than per-project (Forms & Workflow,
-- Portfolio Planner) — see EnterpriseSettingsSerializer.php's own doc comment. Nullable; NULL means
-- "no Org Admin has opened App Settings' Enterprise category and toggled one of these yet", parsed
-- to {forms:false, portfolioPlanner:false} by the serializer's own defaults.
ALTER TABLE "Organisations" ADD COLUMN "EnterpriseSettingsJson" text;
