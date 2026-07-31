-- Ported from api/Enkl.Api/Data/Migrations/AddPortalQaEntryNps. Simple thumbs-up/down tally on a
-- Q&A entry, no floor/ceiling, no per-user vote tracking — see PortalHomeService::voteQaEntryNps.
ALTER TABLE "PortalQaEntries" ADD COLUMN "Nps" integer NOT NULL DEFAULT 0;
