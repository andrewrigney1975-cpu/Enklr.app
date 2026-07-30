-- Ported from api/Enkl.Api/Data/Migrations/AddPortalIconName. IconName is one of src/js/config.js's
-- ICON_PATHS keys — the same shared icon library every other icon in the app draws from, not a
-- Portal-specific set. Shown at large size in the Portal home page's own header, and as the icon for
-- this Portal's entry in the side nav's "Portals" section.
ALTER TABLE "Portals" ADD COLUMN "IconName" varchar(50);
