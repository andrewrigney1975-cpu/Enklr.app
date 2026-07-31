-- UserPreferences: one-per-User personalization settings row (UserId is both PK and FK, a strict
-- 1:1) — same shape as OrganisationSsoConfigs, ported from php-api's 045_add_user_preferences.sql.
-- Avatar/HeaderColour previously existed purely client-side/localStorage (see
-- src/js/storage.js's getUserAvatar/getHeaderColor) with no cross-device sync; this table is what
-- makes them follow a signed-in user across browsers/devices instead. Row is created lazily on
-- first save, not provisioned for every user up front.
CREATE TABLE "UserPreferences" (
    "UserId" CHAR(36) PRIMARY KEY,
    "Avatar" TEXT NULL,
    "HeaderColour" VARCHAR(20) NULL,
    "DateLastModified" DATETIME(6) NOT NULL,
    CONSTRAINT "FK_UserPreferences_Users" FOREIGN KEY ("UserId") REFERENCES "Users" ("Id") ON DELETE CASCADE
) ENGINE=InnoDB;
