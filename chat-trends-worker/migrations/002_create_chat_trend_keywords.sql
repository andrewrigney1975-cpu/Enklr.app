-- Keyword frequency, grouped the same way as chat_trend_aggregates (by date bucket + topic-group +
-- sentiment) — see src/keywords.js for how candidate keywords are chosen (stopword-filtered,
-- likely-proper-nouns dropped) and src/run.js for how each message contributes at most ONE count
-- per keyword (deduplicated within the message, so one verbose message can't inflate a keyword's
-- cross-message frequency on its own).
CREATE TABLE chat_trend_keywords (
  id serial PRIMARY KEY,
  bucket_date date NOT NULL,
  topic text NOT NULL,
  sentiment text NOT NULL,
  keyword text NOT NULL,
  message_count int NOT NULL DEFAULT 0,
  UNIQUE (bucket_date, topic, sentiment, keyword)
);

-- Same anonymity threshold as chat_trend_aggregates_public, applied per-keyword instead of
-- per-bucket: a keyword is never exposed unless it showed up in at least 5 DISTINCT messages —
-- see keywords.js's own doc comment for why this is the load-bearing safety net against a single
-- name/identifier mention ever surfacing as a "top keyword".
CREATE VIEW chat_trend_keywords_public AS
  SELECT bucket_date, topic, sentiment, keyword, message_count
  FROM chat_trend_keywords
  WHERE message_count >= 5;
