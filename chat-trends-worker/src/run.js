import { pathToFileURL } from 'node:url';
import { pool } from './db.js';
import { runMigrations } from './migrate.js';
import { classifyMessage } from './classify.js';
import { extractKeywords } from './keywords.js';

const BATCH_SIZE = 200;

/* node-postgres parses a `timestamptz` column into a JS `Date`, which only has millisecond
   precision — Postgres itself stores microseconds. Round-tripping the cursor through a `Date`
   silently truncates that last fractional digit, so two messages created within the same
   millisecond (very possible under real load, and trivially reproducible with a bulk insert — this
   was caught live, not just reasoned about: a 5-row test insert sharing one `now()` value replayed
   itself on the very next run) compare as "not yet past the cursor" and get reprocessed/double-
   counted. Fix: keep the timestamp as `::text` everywhere — fetched as text, stored as text, and
   compared as text (Postgres casts it back to `timestamptz` on the column side of the comparison,
   preserving full precision) — never let it become a JS `Date` at any point in this file. */
async function loadCursor(client){
  const { rows } = await client.query('SELECT last_date_created::text AS last_date_created, last_message_id FROM chat_trends_cursor WHERE id = true');
  const cursor = rows[0];
  return {
    lastDateCreated: cursor.last_date_created ?? '-infinity',
    lastMessageId: cursor.last_message_id ?? '00000000-0000-0000-0000-000000000000'
  };
}

/* Excludes DMs (the most sensitive message class — a channel with IsDirectMessage=true) and
   soft-deleted messages (ChatMessages.IsDeleted — the DB itself doesn't enforce this, deletion is
   a purely client-side display convention today, see ChatService.php's toMessageDto(), so this
   worker must filter explicitly or it would classify text the app itself treats as removed). */
async function fetchNextBatch(client, cursor){
  const { rows } = await client.query(`
    SELECT m."Id", m."Text", m."DateCreated"::text AS "DateCreated"
    FROM "ChatMessages" m
    JOIN "ChatChannels" c ON c."Id" = m."ChannelId"
    WHERE c."IsDirectMessage" = false AND m."IsDeleted" = false
      AND (m."DateCreated", m."Id") > ($1::timestamptz, $2)
    ORDER BY m."DateCreated" ASC, m."Id" ASC
    LIMIT $3
  `, [cursor.lastDateCreated, cursor.lastMessageId, BATCH_SIZE]);
  return rows;
}

async function processBatch(client, messages){
  for (const message of messages) {
    const { sentiment, topic } = await classifyMessage(message.Text);
    // "DateCreated" is now a "YYYY-MM-DD HH:MM:SS.ffffff+00"-shaped string (see the ::text cast
    // above), so the date portion is a plain slice — no Date object, no precision loss.
    const bucketDate = message.DateCreated.slice(0, 10);

    await client.query(`
      INSERT INTO chat_trend_aggregates (bucket_date, topic, sentiment, message_count)
      VALUES ($1, $2, $3, 1)
      ON CONFLICT (bucket_date, topic, sentiment)
      DO UPDATE SET message_count = chat_trend_aggregates.message_count + 1
    `, [bucketDate, topic, sentiment]);

    // One count per keyword per MESSAGE (extractKeywords already dedupes within the message) —
    // see keywords.js's own doc comment for why this, plus the >=5-distinct-messages threshold
    // chat_trend_keywords_public applies on read, is what keeps a one-off name/identifier mention
    // from ever surfacing as a "top keyword".
    for (const keyword of extractKeywords(message.Text)) {
      await client.query(`
        INSERT INTO chat_trend_keywords (bucket_date, topic, sentiment, keyword, message_count)
        VALUES ($1, $2, $3, $4, 1)
        ON CONFLICT (bucket_date, topic, sentiment, keyword)
        DO UPDATE SET message_count = chat_trend_keywords.message_count + 1
      `, [bucketDate, topic, sentiment, keyword]);
    }
  }

  const last = messages[messages.length - 1];
  await client.query(
    'UPDATE chat_trends_cursor SET last_date_created = $1::timestamptz, last_message_id = $2 WHERE id = true',
    [last.DateCreated, last.Id]
  );
}

export async function run(){
  await runMigrations();

  let totalProcessed = 0;
  for (;;) {
    const client = await pool.connect();
    let batchLength;
    try {
      await client.query('BEGIN');
      const cursor = await loadCursor(client);
      const messages = await fetchNextBatch(client, cursor);
      batchLength = messages.length;
      if (batchLength > 0) {
        await processBatch(client, messages);
        totalProcessed += batchLength;
      }
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
    if (batchLength < BATCH_SIZE) break;
  }
  return totalProcessed;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  run()
    .then(async (count) => { console.log(`[chat-trends-worker] processed ${count} message(s)`); await pool.end(); process.exit(0); })
    .catch(async (err) => { console.error(err); await pool.end(); process.exit(1); });
}
