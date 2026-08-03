-- Ported from php-api/src/Db/migrations/048_add_portal_qa_entry_header_image.sql. Resolved once,
-- server-side, at Create/Update time (Support/PortalQaImageResolver.php) from a Pexels search over
-- the entry's own keyword-extracted Question+Answer text -- never re-resolved on read. Exactly one
-- of the two is ever set: an image when Pexels found a reasonable match, otherwise a persisted
-- random fallback colour (HeaderImageColor).
ALTER TABLE "PortalQaEntries" ADD COLUMN "HeaderImageUrl" VARCHAR(500);
ALTER TABLE "PortalQaEntries" ADD COLUMN "HeaderImageColor" VARCHAR(7);
