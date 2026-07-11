-- PHP-specific — no .NET equivalent. The .NET side's rate limiter (Program.cs's "auth" policy) is
-- an in-memory sliding window, which works because Kestrel hosts the app as one long-lived process;
-- PHP's request model has no equivalent guarantee (a PHP-FPM worker holds no state between requests,
-- same reasoning as 007_add_exchange_codes.sql's own note) — see security review finding H1. This
-- table replaces the in-memory window: MustChangePasswordMiddleware's sibling, RateLimitMiddleware,
-- inserts one row per request it's attached to and counts rows for that partition key within the
-- trailing window, pruning old rows opportunistically on every check (same lazy-prune idea as
-- ExchangeCodes).
CREATE TABLE "RateLimitHits" (
    "Id" bigserial PRIMARY KEY,
    "PartitionKey" text NOT NULL,
    "OccurredAt" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX "IX_RateLimitHits_PartitionKey_OccurredAt" ON "RateLimitHits" ("PartitionKey", "OccurredAt");
