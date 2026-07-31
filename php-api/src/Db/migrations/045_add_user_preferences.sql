-- UserPreferences: one-per-User personalization settings row (UserId is both PK and FK, a strict
-- 1:1) — same shape as OrganisationSsoConfigs, ported from the .NET side's AddUserPreferences
-- migration. Avatar/HeaderColour previously existed purely client-side/localStorage (see
-- src/js/storage.js's getUserAvatar/getHeaderColor) with no cross-device sync; this table is what
-- makes them follow a signed-in user across browsers/devices instead. Row is created lazily on
-- first save, not provisioned for every user up front.
CREATE TABLE "UserPreferences" (
    "UserId" uuid PRIMARY KEY REFERENCES "Users" ("Id") ON DELETE CASCADE,
    "Avatar" text,
    "HeaderColour" varchar(20),
    "DateLastModified" timestamptz NOT NULL
);
