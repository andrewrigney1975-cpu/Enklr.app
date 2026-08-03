-- Resolved once, server-side, at Create/Update time (Support/PortalQaImageResolver.php) from a
-- Pexels search over the entry's own keyword-extracted Question+Answer text -- never re-resolved on
-- read. Exactly one of the two is ever set: an image when Pexels found a reasonable match, otherwise
-- a persisted random fallback colour (HeaderImageColor).
ALTER TABLE "PortalQaEntries" ADD COLUMN "HeaderImageUrl" varchar(500);
ALTER TABLE "PortalQaEntries" ADD COLUMN "HeaderImageColor" varchar(7);
