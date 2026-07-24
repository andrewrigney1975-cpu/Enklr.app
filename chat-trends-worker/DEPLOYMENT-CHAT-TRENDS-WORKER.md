# Chat Trends Worker — Deployment

A standalone, one-shot batch job (not a long-running service) that reads real `ChatMessages` from
the main app's shared Postgres database, classifies each one **locally, on-device** (sentiment +
a fixed topic label, via `@huggingface/transformers` running quantized ONNX models fully in-process
— no cloud API call, no network dependency once the models are cached), and writes only anonymised
daily aggregate counts to its own `chat_trend_aggregates` table. No message text, user id, org id,
or channel id is ever written anywhere by this worker — see `migrations/001_create_chat_trend_aggregates.sql`.

Also extracts a conservative, stopword/proper-noun-filtered keyword per message (`src/keywords.js`)
and writes per-keyword frequency counts to `chat_trend_keywords` — see that file's own doc comment
for the two-layer safety approach (filtering at extraction time, plus the same 5-distinct-message
suppression threshold applied again at the keyword level).

Vendor Portal reads only the `chat_trend_aggregates_public` and `chat_trend_keywords_public` views
(which suppress any bucket/keyword contributed to by fewer than 5 real messages) — never this
worker's raw counts tables, and never `ChatMessages` itself.

## 1. Local development

```bash
cd chat-trends-worker
npm install
cp .env.example .env   # point DATABASE_URL at the main app's local docker-compose `db` service —
                        # the same credentials src/js/api.js's own dev stack already uses
npm run migrate         # creates chat_trend_aggregates / chat_trend_keywords (+ both _public
                        # views) / chat_trends_cursor, idempotent
npm run run              # processes every ChatMessage since the last run; safe to re-run any time
```

The first run downloads and caches two small ONNX models (`Xenova/distilbert-base-uncased-
finetuned-sst-2-english` for sentiment, `Xenova/distilbert-base-uncased-mnli` for zero-shot topic
classification) to `node_modules/@huggingface/transformers`'s own cache directory — subsequent runs
reuse the cache, no re-download.

## 2. Production — a new, tightly-scoped Postgres role (manual, operator-run step)

This worker needs to read `"ChatMessages"`/`"ChatChannels"` directly — chat content is the most
sensitive data in this system, so it gets its **own** role, scoped to exactly what it touches,
never the app's master credentials and never Vendor Portal's own `vendor_portal` role (which
deliberately has no access to chat tables at all — see `DEPLOYMENT-AWS-DETAILS.md` §9.1):

```sql
CREATE ROLE chat_trends_worker LOGIN PASSWORD '...';
GRANT CONNECT ON DATABASE enkl TO chat_trends_worker;
GRANT SELECT ON "ChatMessages", "ChatChannels" TO chat_trends_worker;
GRANT USAGE, CREATE ON SCHEMA public TO chat_trends_worker;
```

No `REFERENCES` grant is needed — neither `chat_trend_aggregates` nor `chat_trend_keywords` has a
foreign key into any main-app table, by design (there's nothing in either that identifies an org to
begin with). Also grant Vendor Portal's existing `vendor_portal` role read access to the suppressed
views only, once this worker's migrations have created them:

```sql
GRANT SELECT ON chat_trend_aggregates_public, chat_trend_keywords_public TO vendor_portal;
```

## 3. Running this against production data

**Do not deploy this worker onto the production EC2 instance itself.** That instance is a
free-tier `t3.micro` with no swap and has already had a real OOM/unresponsive-SSH incident from a
`dotnet build` run directly on it (`DEPLOYMENT-AWS-DETAILS.md` §5.1) — installing a new ML runtime
there is a real, not theoretical, risk to the running production app.

Instead, reuse Vendor Portal's own already-proven "prod-readonly" pattern exactly: run this worker
**locally**, on the operator's own machine, connected to the production RDS instance (which has no
public accessibility) via the same SSH-tunneled bastion:

```bash
# 1. Tunnel — reuses the exact same bastion/RDS endpoint as Vendor Portal's own prod-readonly setup
#    (DEPLOYMENT-AWS-DETAILS.md §9.3), just a different local port so it can run alongside that
#    tunnel without clashing (15432 is already used for the vendor-portal one).
ssh -i ~/.ssh/enkl-key.pem -N -L 15433:enkl-postgres.c61qe4i8mw5i.us-east-1.rds.amazonaws.com:5432 ec2-user@107.21.99.255

# 2. .env.prod-readonly (git-ignored, never committed — same convention as
#    vendor-portal/.env.prod-readonly)
DATABASE_URL=postgres://chat_trends_worker:<password>@localhost:15433/enkl?sslmode=require

# 3. Run
npm run migrate
npm run run
```

**Recommended cadence**: nightly, via a simple cron entry on the operator's own machine (or any
trusted machine with the tunnel open) — e.g.:
```
0 3 * * * cd /path/to/chat-trends-worker && npm run run >> chat-trends.log 2>&1
```
There's no harm running it more or less often — each run only ever processes messages created since
its own last run (`chat_trends_cursor`), and the underlying classification work is proportional to
new message volume, not elapsed time.

## 4. Known npm audit findings (reviewed, not blocking)

`npm audit` reports vulnerabilities in `sharp` (libvips CVEs — sharp's image-decoding code path,
which this worker never invokes; only the text `sentiment-analysis`/`zero-shot-classification`
pipelines are used) and `adm-zip` (a DoS via a crafted zip, used only by `onnxruntime-node`'s own
`postinstall` step to unpack its prebuilt binary from the npm registry — not a code path reachable
by any input this worker processes at runtime). Both are transitive dependencies of
`@huggingface/transformers` itself; re-check `npm audit` when bumping that dependency in case a
newer release has picked up fixed versions.
