-- Ported from php-api/src/Db/migrations/043_add_portal_icon_name.sql. IconName is one of
-- src/js/config.js's ICON_PATHS keys — the same shared icon library every other icon in the app
-- draws from, not a Portal-specific set.
ALTER TABLE "Portals" ADD COLUMN "IconName" VARCHAR(50);
