# Deployment Guide — Standalone PostgreSQL + PHP API + Static Frontend

This guide covers deploying Enkl's **self-hosted tier** on infrastructure your organisation owns and
operates directly — no Docker, no managed platform assumptions. Three independent pieces:

1. **PostgreSQL** — a database instance you provision and own.
2. **PHP API** (`php-api/`) — a Slim 4 application, run under php-fpm behind a web server.
3. **Static frontend** — a single self-contained `index.html` file, produced by `npm run build`.

This is a parallel, alternative deployment path to the repo's Docker Compose stack (which runs the
.NET API tier instead). Both API tiers speak the exact same HTTP contract and share the same
frontend unmodified, so everything in this guide applies only to the PHP tier — do not run both
tiers against the same database in production; pick one.

```
                    ┌─────────────────────────────────────────────┐
   HTTPS            │              Reverse proxy / LB             │
  (browser) ───────► │   TLS termination + security headers        │
                    │   /            → static index.html          │
                    │   /api/*, /health → php-fpm upstream         │
                    └───────────────┬───────────────────────────────┘
                                    │ (plain HTTP, private network)
                            ┌───────▼────────┐
                            │  php-fpm pool   │
                            │  (php-api/)     │
                            └───────┬────────┘
                                    │ PDO / pgsql (TLS if possible)
                            ┌───────▼────────┐
                            │  PostgreSQL 16  │
                            │  (13+ minimum)  │
                            └────────────────┘
```

---

## 1. Provision PostgreSQL

- **Version**: PostgreSQL 16 is what this repo's own tooling exercises; **13 is the hard floor** —
  one migration (`010_add_user_security_stamp.sql`) relies on `gen_random_uuid()` being native
  (added in PG13). Anything older is unsupported.
- Create a dedicated database and a dedicated, least-privilege application user — do not use the
  Postgres superuser for the application connection:

  ```sql
  CREATE DATABASE enkl;
  CREATE USER enkl_app WITH ENCRYPTED PASSWORD '<a long, randomly generated password>';
  GRANT ALL PRIVILEGES ON DATABASE enkl TO enkl_app;
  \c enkl
  GRANT ALL ON SCHEMA public TO enkl_app;
  ```

  The application itself creates every table via its own migrations (see §3) — you only need to
  create the empty database and a user with rights inside it. It does **not** need
  database-creation or role-management privileges, and does not need superuser.
- **Network exposure**: PostgreSQL should **not** be reachable from the public internet. Bind it to
  a private network/VPC and restrict inbound connections (via `pg_hba.conf` and/or a security
  group/firewall) to only the host(s) running the PHP API.
- **Encryption in transit**: enable and require SSL/TLS on the Postgres connection
  (`ssl = on` in `postgresql.conf`, and `hostssl` entries in `pg_hba.conf` rather than plain `host`).
  The PDO/`pgsql` driver will use TLS automatically if the server offers it and the client library
  supports it; verify with `\conninfo` after connecting that SSL is in use.
- **Backups**: set up automated `pg_dump`/WAL-archiving or your platform's managed-backup
  equivalent, with tested restores — there is no backup mechanism built into the application.

---

## 2. Deploy the PHP API

### 2.1 Requirements

- PHP **8.2+**
- PHP extensions: `pdo_pgsql`, `pgsql` (the plain `pgsql` extension is required specifically for the
  SSE live-update stream's `LISTEN`/`NOTIFY` support — PDO alone can't do async notification waits),
  `openssl`.
- [Composer](https://getcomposer.org/).
- A web server capable of running PHP behind php-fpm (nginx or Apache). `php -S` is fine for a
  quick smoke test but is not a production server.

### 2.2 Install

```bash
cd php-api
composer install --no-dev
cp .env.example .env
```

### 2.3 Configure `.env`

| Variable | Required | Notes |
|---|---|---|
| `DB_HOST` | yes | Your Postgres host — **not** assumed to be `localhost` or a Docker service name |
| `DB_PORT` | | default `5432` |
| `DB_NAME` | yes | default `enkl` |
| `DB_USER` | yes | the least-privilege user from §1 |
| `DB_PASSWORD` | yes | **must not** be left as `change-me` — the app hard-fails at startup outside `APP_ENV=development` if it is empty or still the placeholder |
| `JWT_SIGNING_KEY` | yes | **must** be a cryptographically random string, 32+ characters. Same hard-fail-if-placeholder/empty/short guard applies. Generate with e.g. `openssl rand -base64 48` |
| `JWT_ISSUER` / `JWT_AUDIENCE` | | defaults `Enkl.Api` / `Enkl.App` — only change if you also change them consistently everywhere tokens are validated |
| `JWT_EXPIRY_HOURS` | | default `8` |
| `RUN_MIGRATIONS_ON_STARTUP` | | default `true` — see §2.4 |
| `APP_ENV` | yes | set to `production`. `development` disables the secrets guard above and leaks exception details in error responses — never use it in production |
| `APP_PUBLIC_BASE_URL` | yes if using SAML/SSO | the browser-facing scheme+host (no trailing slash), e.g. `https://enkl.example.org`. Used to build the SAML SP entity id/ACS URL and SCIM base URL — **cannot** be correctly derived from the incoming request if a reverse proxy in front doesn't forward the original scheme |

Never commit a real `.env` to version control. Prefer injecting these as real process environment
variables (systemd unit `Environment=`/`EnvironmentFile=`, or your platform's secrets manager) over
a plaintext `.env` file sitting on disk where possible.

### 2.4 Run migrations

```bash
php migrate.php
```

Safe to re-run any time — already-applied migrations are tracked in a `migrations_history` table
and skipped. With the default `RUN_MIGRATIONS_ON_STARTUP=true`, the API also re-checks for and
applies any new migration on every process boot, so the explicit command above is mainly needed for
the very first deploy, or if you'd rather run schema updates out-of-band ahead of a rollout (set
`RUN_MIGRATIONS_ON_STARTUP=false` if so).

### 2.5 Run under php-fpm

Point a php-fpm pool at `public/index.php`, with the **document root set to `php-api/public`** (not
the `php-api/` root — nothing outside `public/` should ever be web-accessible). Example pool
snippet:

```ini
[enkl-api]
listen = /run/php-fpm/enkl-api.sock
user = www-data
group = www-data
pm = dynamic
pm.max_children = 20
env[APP_ENV] = production
; ...or load all config via EnvironmentFile in the systemd unit that starts php-fpm
```

Do not expose php-fpm's TCP port (if used instead of a socket) beyond the host it runs on — only
the reverse proxy in front of it should be able to reach it.

---

## 3. Build and deploy the static frontend

```bash
npm install
npm run build
```

This produces a **single self-contained file**, `dist/index.html` — the JS bundle, minified CSS,
and the keyword-matching web worker's source are all inlined into it. There is nothing else to
deploy: no separate `.js`/`.css`/asset files. Copy that one file to your web server's document root
as `index.html`.

The frontend calls its API at a **same-origin relative path**, `/api/...` — there is no
build-time or runtime configuration for pointing it at a different origin. The static file host and
the PHP API **must** be reachable through the same origin, with the API reverse-proxied under
`/api/`, exactly as set out in §4 below.

Rebuild and redeploy this file after every frontend code change — it is a build artifact, not
something to hand-edit.

---

## 4. Reverse proxy configuration

Everything (static file serving, `/api/` proxying, `/health` proxying, and security headers) needs
to live behind one reverse proxy so the frontend's same-origin assumption holds. The repo's own
`web/nginx.conf` is written for the Docker/.NET stack but the shape is identical for this tier —
only the upstream changes (a php-fpm socket instead of a container). Example, adapted:

```nginx
server {
  listen 80;
  root /var/www/enkl/html;   # wherever you copied dist/index.html to

  add_header X-Frame-Options "DENY" always;
  add_header X-Content-Type-Options "nosniff" always;
  add_header Referrer-Policy "strict-origin-when-cross-origin" always;
  add_header Strict-Transport-Security "max-age=63072000; includeSubDomains" always;
  add_header Content-Security-Policy "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' data: https://fonts.gstatic.com; img-src 'self' data:; manifest-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'" always;

  # SSE live-update stream — must not be buffered, and needs a long read timeout since the
  # connection stays open for hours (the app sends a 15s heartbeat to keep it alive).
  location /api/events/ {
    fastcgi_pass unix:/run/php-fpm/enkl-api.sock;
    fastcgi_param SCRIPT_FILENAME /var/www/enkl/php-api/public/index.php;
    include fastcgi_params;
    fastcgi_param HTTP_AUTHORIZATION $http_authorization;   # PHP's fastcgi_params doesn't forward this by default
    fastcgi_buffering off;
    fastcgi_read_timeout 1h;
  }

  location /api/ {
    fastcgi_pass unix:/run/php-fpm/enkl-api.sock;
    fastcgi_param SCRIPT_FILENAME /var/www/enkl/php-api/public/index.php;
    include fastcgi_params;
    fastcgi_param HTTP_AUTHORIZATION $http_authorization;
  }

  location = /health {
    fastcgi_pass unix:/run/php-fpm/enkl-api.sock;
    fastcgi_param SCRIPT_FILENAME /var/www/enkl/php-api/public/index.php;
    include fastcgi_params;
  }

  location / {
    try_files /index.html =404;
  }
}
```

Notes:
- `Authorization` must reach the app — the API is bearer-JWT-only (no cookies, no sessions), and
  standard `fastcgi_params`/reverse-proxy configs often strip this header by default. Confirm it
  arrives (test a request with `Authorization: Bearer ...` and check the API actually sees it).
- If proxying to php-fpm via a TCP upstream instead of PHP directly (e.g. `proxy_pass` to an
  Apache/php-fpm HTTP frontend) instead of `fastcgi_pass`, forward `X-Forwarded-For` and
  `X-Forwarded-Proto` too — `RateLimitMiddleware` partitions by the first `X-Forwarded-For` entry
  (falling back to the raw connecting IP if absent), and `APP_PUBLIC_BASE_URL` combined with a
  correct forwarded scheme is what SAML's redirect URLs depend on.
- `/health` is intentionally **not** under `/api/` — both API tiers expose it at their own root, and
  the frontend's connectivity probe (`api.js`'s `pollApiReachability`) relies on it being reachable
  same-origin at exactly this path.

### 4.1 TLS termination

**Nothing in this stack terminates TLS on its own** — the example above listens on plain HTTP 80
only, matching the repo's own reference config. This is only safe once a TLS-terminating layer sits
in front of it: a cloud load balancer, an ingress controller, or a `listen 443 ssl` server block
with real certificates on this same host. Before going live, do one of:

- Put a TLS-terminating load balancer/ingress in front and confirm **it** sets
  `X-Forwarded-Proto: https` on every request it forwards (the API trusts this header
  unconditionally for building SAML redirect URLs and API responses — safe only if nothing except
  your trusted proxy can reach the app directly), **or**
- Add a real `listen 443 ssl;` block with a valid certificate (e.g. via Let's Encrypt/certbot)
  directly in this nginx config, and redirect all plain-HTTP traffic to it.

Never expose the php-fpm socket/port, or PostgreSQL, directly to any network the TLS-terminating
layer doesn't control.

---

## 5. Verify a fresh deployment

```bash
curl https://your-domain/health
# {"status":"ok"}
```

Then either:
- Migrate an existing local Enkl project into the fresh install via `POST /api/migration/projects`
  (the same JSON shape `exportProjectJSON()` produces client-side in the browser) — this single call
  creates the organisation too if it doesn't already exist (see `organisationName` in the request
  body), or
- Create an org/user directly in the database and sign in via the frontend's Login screen
  (`POST /api/auth/login`).

Confirm in the browser:
- The app loads and the header key badge shows the cloud icon for a migrated project.
- The connectivity pulse on that key is green (confirms `/health` is reachable same-origin through
  your proxy).
- Live updates (the SSE stream) work across two open tabs — edit a task in one, watch it update in
  the other without a reload. This is the single best end-to-end proof the reverse proxy's
  buffering/timeout settings for `/api/events/` are correct.

---

## 6. Security best practices checklist

Most of the following is already implemented in the application — this checklist is about not
undermining it at the infrastructure layer, plus the handful of things that are genuinely your
responsibility to configure.

### Already built in (verify you haven't disabled or bypassed it)
- [ ] **Passwords**: bcrypt (`PASSWORD_BCRYPT`, cost 12) — do not weaken this.
- [ ] **JWTs**: HS256, `iss`/`aud` checked on every request, 60s clock-skew leeway, and a live
      **SecurityStamp** check on every authenticated request — changing a password, deactivating a
      user, or toggling org-admin immediately invalidates every previously-issued token for that
      user, not just at expiry. Don't add a JWT-caching layer in front that could serve a stale
      validation result.
- [ ] **MustChangePassword enforcement**: a fresh/reset account can only call
      `POST /api/auth/change-password` until its password is changed — every other mutating
      request is rejected. Reads still work. Don't route around this.
- [ ] **Rate limiting**: 10 requests/60s per client IP on the login, SSO lookup/exchange,
      change-password, and anonymous-migration endpoints, DB-backed so it holds across php-fpm
      workers. This is what makes correct `X-Forwarded-For` forwarding from your proxy
      security-relevant, not just cosmetic — get it wrong and every client behind the proxy shares
      one rate-limit bucket (denial-of-service risk) or the limit is trivially bypassable (an
      attacker just needs to vary a header the proxy trusts blindly).
- [ ] **SAML replay protection & certificate validation**: every outgoing `AuthnRequest` ID is
      single-use; IdP signing certificates are validated for expiry and RSA key strength (≥2048
      bits) at save time. Don't hand-edit `OrganisationSsoConfigs` rows to bypass this.
- [ ] **SCIM** endpoints use a separate, per-organisation bearer token (bcrypt-hashed at rest), not
      a user JWT — rotate an org's SCIM token immediately if you suspect it's leaked (there is
      presently no automatic expiry).

### Your responsibility to configure correctly
- [ ] **TLS everywhere in transit** — browser↔proxy (§4.1), and ideally proxy↔php-fpm and
      PHP↔Postgres too if they cross any network segment you don't fully trust. As shipped, nothing
      in this stack enforces TLS on its own.
- [ ] **`JWT_SIGNING_KEY` and `DB_PASSWORD`**: real, unique, randomly generated secrets — the app
      refuses to boot in production with the checked-in placeholder values, but confirm nothing
      overrides `APP_ENV` to `development` in production to route around that guard.
- [ ] **Least-privilege database user** (§1) — not the Postgres superuser.
- [ ] **Network segmentation**: PostgreSQL and the php-fpm socket/port should be unreachable except
      from the exact hosts that need them. Nothing about this application enforces network-level
      isolation for you.
- [ ] **`X-Forwarded-Proto`/`X-Forwarded-For` set only by a proxy you control**, and the app only
      ever reachable through that proxy — both are trusted unconditionally once they arrive.
- [ ] **`APP_PUBLIC_BASE_URL`** set correctly and matching what users actually type into their
      browser, if you use SAML SSO — a mismatch breaks the SP entity id/ACS URL your IdP expects.
- [ ] **Secrets out of source control and off disk where possible** — use your platform's secrets
      manager or at minimum an `.env` file with restrictive filesystem permissions
      (`chmod 600`, owned by the php-fpm user only), never committed to git.
- [ ] **CORS**: none is configured, by design, because the app is only ever reached same-origin
      through your reverse proxy. If you ever need the API reachable from a different origin
      (a separate SPA domain, a mobile app calling it directly, etc.), you must add explicit CORS
      middleware yourself — do not simply widen `Access-Control-Allow-Origin` to `*` anywhere.
- [ ] **Composer dependencies**: `composer install --no-dev` in production (skip dev tooling), and
      keep dependencies patched — `composer outdated` / `composer audit` periodically. In
      particular, `onelogin/php-saml` should stay at 4.3.1+ (the pinned version here, 4.3.2, is
      already past the disclosed advisory GHSA-5j8p-438x-rgg5).
- [ ] **Backups and restore testing** for PostgreSQL (§1) — nothing in the application layer backs
      up your data.
- [ ] **Log monitoring**: `RUN_MIGRATIONS_ON_STARTUP` logs applied migrations via `error_log()` on
      every boot — route php-fpm/web-server error logs somewhere you actually watch, so an
      unexpected schema change or a wave of 401/403/429 responses gets noticed.
- [ ] **Don't run both API tiers against the same database in production** unless you specifically
      intend the interchangeable-JWT/shared-password-hash behavior described in
      `php-api/README.md` — treat this as an either/or deployment choice, not a load-balanced pair,
      unless you've deliberately verified both tiers' behavior stays in lockstep for every request
      path you rely on.

### Explicitly out of scope for this application (handle at your layer if needed)
- CSRF protection — not applicable; there are no cookies or server-side sessions, only bearer JWTs
  sent explicitly by the frontend's own JS.
- File upload virus scanning / storage — not applicable; the app stores no binary uploads, only
  URLs/text for documents and attachments.
