-- This worker's own schema, in the same Postgres database the main app and Vendor Portal already
-- share — deliberately structured so nothing here can ever identify a person or an organisation,
-- independent of any query-time filter: no message text, no user id, no org id, no channel id
-- column exists anywhere below.

CREATE TABLE chat_trend_aggregates (
  id serial PRIMARY KEY,
  bucket_date date NOT NULL,
  topic text NOT NULL,
  sentiment text NOT NULL,
  message_count int NOT NULL DEFAULT 0,
  UNIQUE (bucket_date, topic, sentiment)
);

-- Vendor Portal is granted SELECT on this view only, never on chat_trend_aggregates itself — a
-- (date, topic, sentiment) bucket contributed to by too few real messages (default threshold: 5)
-- is never exposed. A second, DB-enforced layer of anonymity on top of "there is no identifying
-- column to begin with."
CREATE VIEW chat_trend_aggregates_public AS
  SELECT bucket_date, topic, sentiment, message_count
  FROM chat_trend_aggregates
  WHERE message_count >= 5;

-- Single-row cursor tracking the last ChatMessages row this worker has already processed, so a
-- re-run only classifies messages created since the previous run instead of re-scanning/re-counting
-- everything. (last_date_created, last_message_id) is a compound cursor — DateCreated alone isn't
-- unique, so a plain timestamp cursor could skip or double-count same-instant rows.
CREATE TABLE chat_trends_cursor (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  last_date_created timestamptz,
  last_message_id uuid
);
INSERT INTO chat_trends_cursor (id) VALUES (true);
