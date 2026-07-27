-- Ported from api/Enkl.Api's AddReleaseColor migration. Rendered as the Release list row's left
-- border and the Timeline release bar's hatch color. Always set (never null) — defaults to light
-- grey so every pre-existing release gets a sensible, unobtrusive color with no data backfill.
ALTER TABLE "Releases" ADD COLUMN "Color" varchar(20) NOT NULL DEFAULT '#cccccc';
