-- Ported from php-api/src/Db/migrations/044_add_portal_qa_entry_nps.sql (itself ported from
-- api/Enkl.Api/Data/Migrations/AddPortalQaEntryNps). Simple thumbs-up/down tally on a Q&A entry, no
-- floor/ceiling, no per-user vote tracking — see PortalHomeService::voteQaEntryNps.
ALTER TABLE "PortalQaEntries" ADD COLUMN "Nps" INT NOT NULL DEFAULT 0;
