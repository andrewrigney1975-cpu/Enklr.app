# CI/CD Pipeline

This documents what actually runs automatically on every push/PR (**CI**), and what happens after
that — which today is **entirely manual** (there is no **CD** yet). See §5 for what an actual
GitHub-Actions-driven CD pipeline could look like if that's ever worth building.

---

## 1. Overview

| Stage | Automated? | Where |
|---|---|---|
| Build + lint (all 3 backend tiers, frontend) | ✅ Yes | `.github/workflows/ci.yml`, on every push to `main` and every PR |
| Cross-tier contract-parity test | ✅ Yes (gated — see §3) | same workflow |
| Frontend jsdom test suite | ✅ Yes | same workflow |
| Deploy to local QA | ❌ Manual | operator runs `docker compose build`/`up -d --force-recreate` |
| Deploy to AWS production | ❌ Manual | operator builds locally, ships the image, recreates the container over SSH — see §4 |

There is exactly one workflow file (`.github/workflows/ci.yml`) and no separate CD workflow. Nothing
in this repository automatically builds a release artifact and pushes it anywhere outside of GitHub
Actions' own job runners — every deployment described in §4 is a person, at a keyboard, running
commands.

---

## 2. Triggers

```yaml
on:
  push:
    branches: [main]
  pull_request:
```

Every push to `main` and every PR (against any base) runs the workflow. There's no `workflow_dispatch`
trigger — the workflow can only be started by an actual push/PR event, not manually re-run from the
Actions tab or `gh workflow run` (confirmed live: `gh workflow run ci.yml` fails with
`HTTP 422: Workflow does not have 'workflow_dispatch' trigger`). If you need to re-run CI without a
new commit, use GitHub's "Re-run jobs" on an existing run, or push an empty/trivial commit.

---

## 3. Jobs

### 3.1 `changes` — path-based gate (added 2026-07-20)

The first job to run. Uses `dorny/paths-filter@v3` to compute a single `backend` boolean from the
diff, based on this path list:

```yaml
backend:
  - 'api/**'
  - 'php-api/**'
  - 'mariadb-api/**'
  - 'contract-tests/**'
  - 'docker-compose.yml'
  - '.github/workflows/ci.yml'
```

Every backend-only job below (`dotnet-build`, `php-lint`, `mariadb-lint`, `contract-parity`) declares
`needs: changes` and `if: needs.changes.outputs.backend == 'true'`, so a purely frontend change skips
all four and only runs `frontend-build-and-test` — meaningful because `contract-parity` alone takes
30+ minutes.

**Deliberately conservative list**: `docker-compose.yml` and the workflow file itself are included
even though they're not literally under `api/`/`php-api/`/`mariadb-api/`, so editing either always
re-runs everything rather than risking a false "nothing to check" skip. `frontend-build-and-test` has
**no** such gate — it always runs, so an actual backend change still gets the full pipeline (frontend
included), not just the backend-specific jobs. If you ever add a new top-level directory that a
backend tier depends on (a new shared migration tool, say), add it to this list — a job silently
skipped because its trigger path was missed is much harder to notice than one that runs unnecessarily.

### 3.2 `dotnet-build` — .NET API build

`dotnet restore` + `dotnet build --configuration Release` against `api/Enkl.Api/Enkl.Api.csproj`.
Build-only, no tests run here (`api/Enkl.Api.Tests/` needs a real Postgres via Testcontainers — see
§3.5's note on why that suite isn't CI-wired at all).

### 3.3 `php-lint` / `mariadb-lint` — PHP syntax check

`composer install` then `php -l` (syntax-check, not a real linter) across every `.php` file in
`php-api/`/`mariadb-api/` respectively (`vendor/` pruned from the `find`). Different `pdo`/`pdo_mysql`
PHP extensions installed per job to match what each tier actually needs.

### 3.4 `frontend-build-and-test` — the only always-on job

`npm ci` → `node build.js` (produces `dist/index.html`) → `npm ci` in `tests/` → `node
run_all_tests.js`. This is the one job every push runs regardless of what changed.

**Known "batch flake" behavior**: `run_all_tests.js` retries a failing/crashing file up to
`MAX_ATTEMPTS = 3` before calling it a real failure — a handful of files fail/crash only when run in
the full ~110-file sequential sweep (shared timing assumptions, system load) but pass every time when
run standalone. The runner's own output already distinguishes these:
- `FLAKY <file> (passed on attempt N/3)` — not a regression, needed a retry.
- `(failed on all 3 attempts - not batch flake)` — a real failure.

**Real-world caveat found this session**: the "not batch flake" label is itself only as reliable as
the machine running it. When many other heavyweight processes are competing for CPU/IO at the same
time (this session had concurrent AWS/Docker work happening), even a 3x retry can consistently lose a
timing race across all 3 attempts on files that pass cleanly in isolation seconds later. Before trusting
a "real regression" verdict from a local run under unusual load, spot-check a handful of unrelated
files standalone (see this session's own investigation, where 3 completely unrelated files all came
back clean despite being listed as "real regressions" in a 41-file batch — the batch itself was the
compromised signal, not the app). GitHub's own hosted runners don't have this problem — a red result
*there* is the trustworthy signal; a red result from a local dev machine under heavy concurrent load
deserves a second look before you start bisecting code for a regression that isn't there.

### 3.5 `contract-parity` — cross-tier contract proof

The most expensive job (30+ minutes). Spins up three service containers (`postgres:16-alpine` ×2,
`mariadb:11.4` ×1), boots all three live backend tiers in `Development`/`development` mode as
background processes (`dotnet run`, `php -S` ×2), waits for all three `/health` endpoints, then runs
`contract-tests/run-parity.js` against all three simultaneously — the same fixture requests fired at
every tier, comparing PHP/MariaDB's responses against .NET (the reference) for status code + JSON
shape (not exact values — ids/timestamps legitimately differ between independently-seeded backends).

**Two real bugs this job caught this session, both MySQL/MariaDB-ecosystem-specific, neither ever
surfaced by local verification:**

1. The `mariadb:11.4` service container's `--health-cmd` used `mysqladmin ping`, which no longer
   exists in that image (only `mariadb-admin` does) — the healthcheck failed outright with
   `Failed to initialize container mariadb:11.4`, which reads like a container startup failure but was
   actually just an unrecognized health-check binary. Fixed to `mariadb-admin ping -u root
   -p<password>` (verified against a live `mariadb:11.4` container locally before trusting the fix).
2. The "Start MariaDB API tier" step's `DB_HOST: localhost` env var made every request to the
   `mariadb-api` PHP app fail with `SQLSTATE[HY000] [2002] No such file or directory` — a Unix-socket
   error, not a networking one. MySQL/MariaDB client libraries (`mysqlnd`/PDO_MYSQL) special-case the
   literal string `"localhost"` to mean "connect via the local Unix socket," silently ignoring the
   port entirely — unlike Postgres's `libpq`, which treats `localhost` as an ordinary hostname and
   resolves it normally. Since `db-mariadb` here is a separate service container only reachable via
   the mapped TCP port, `host=localhost` can never work; `host=127.0.0.1` forces a genuine TCP
   connection and fixed it. This one never surfaced during any local verification because
   `mariadb-api/CLAUDE.md`'s own Docker test recipe already used `host.docker.internal` (a real
   resolved hostname), not the literal string `"localhost"` — the exact difference that mattered here.
   Confirmed the failure mode by reproducing the identical `PDOException` locally against a real
   `mariadb:11.4` container before trusting the diagnosis.

Neither `php-api/tests/` nor `mariadb-api/tests/` (each tier's own PHPUnit suite, ~124 tests) is wired
into this job or any other — they're local-only, run manually via the throwaway-Docker recipes each
tier's own `CLAUDE.md` documents. Only each tier's lint step and its `contract-parity` participation
are automated.

---

## 4. Deployment (manual — the "CD" that doesn't exist yet)

### 4.1 Local QA

```bash
docker compose build api web     # or just the one service that changed
docker compose up -d --force-recreate api web
```
Straightforward — this is the reference `docker-compose.yml` stack, run directly on the operator's
own machine. `RunMigrationsOnStartup=true` applies any new EF Core migration automatically when `api`
restarts.

### 4.2 AWS production (.NET tier only)

The only tier with a live production deployment today is the .NET/PostgreSQL stack, on a single
free-tier EC2 instance + RDS (see `DEPLOYMENT-AWS.md` for the target ECS Fargate + ALB architecture,
and the local, not-committed `DEPLOYMENT-AWS-DETAILS.md` for the as-built specifics — real resource
IDs deliberately kept off this public repo).

**Deploy procedure, as it stands today — entirely by hand, from the operator's own machine:**
```bash
docker compose -f docker-compose.aws.yml build api web   # build locally, NOT on the instance
docker save enklapp-api:latest enklapp-web:latest | gzip > enkl-images.tar.gz
scp enkl-images.tar.gz ec2-user@<host>:/home/ec2-user/
ssh ec2-user@<host> "cd Enkl.app && git pull && gunzip -c ~/enkl-images.tar.gz | sudo docker load && sudo docker compose -f docker-compose.aws.yml up -d --force-recreate api web"
```

**Why images are built locally and not on the instance**: this session hit a real incident where
running `docker compose build` (i.e. a full `dotnet restore`/`publish`) directly on the `t3.micro`
(916MB RAM, no swap) consumed enough memory to make the instance briefly unreachable over SSH — see
`DEPLOYMENT-AWS-DETAILS.md` §5.1 for the full writeup. No builds run on the instance itself anymore,
by design.

The PHP and MariaDB tiers have their own bare-metal deployment guides (`DEPLOYMENT-PHP.md`,
`DEPLOYMENT-MARIADB.md`) but no running production instance as of this writing — those are
"how you'd deploy this if you stood one up," not as-built records like §4.2 above.

---

## 5. Future consideration: GitHub Actions as an actual CD pipeline

Nothing here is built — this is a list of what it would take, and the real trade-offs, if automating
§4.2 (the one tier with a live target) is ever worth doing.

### What it could look like
A new job (or a separate `cd.yml` workflow, `needs: [contract-parity]` or gated on a successful CI
run on `main`) that:
1. Builds the `api`/`web` images (same `docker compose -f docker-compose.aws.yml build` this doc's
   §4.2 already does by hand) — on the GitHub-hosted runner, not the target instance, preserving the
   exact lesson §4.2 already learned the hard way.
2. Transfers them to the EC2 instance and recreates the containers — either the same
   `docker save`/`scp`/`docker load` shape already established, or by pushing to a registry (ECR) and
   having the instance `docker pull` instead (trades a registry dependency for not needing SSH file
   transfer from the runner).
3. Runs the same `curl https://<domain>/health` check §4.2 already uses to confirm the deploy landed,
   ideally with an automatic rollback (see below) if it doesn't come back healthy.

### Real considerations specific to this deployment, not generic CD boilerplate
- **Network reachability**: the EC2 instance's security group currently allows SSH only from the
  operator's own static IP (`enkl-ec2-sg`, see `DEPLOYMENT-AWS-DETAILS.md` §2). GitHub-hosted runners
  have no fixed IP range — allowing them in means either (a) widening the SSH rule to GitHub's
  documented (and large, frequently-changing) IP ranges, a real reduction in the current
  narrow-allowlist posture, or (b) using AWS Systems Manager Session Manager instead of SSH, which
  can be reached via IAM policy rather than a security-group CIDR rule — the better fit here, but a
  real setup cost (SSM agent + an instance IAM role, neither of which exist on this instance today).
- **Secrets**: an SSH private key (or SSM-equivalent IAM credentials), and potentially AWS access
  keys if using ECR, would need to live in GitHub encrypted secrets — a new trust boundary this repo
  doesn't have today (the current deploy key/credentials live only on the operator's own machine).
- **No rollback mechanism exists yet, automated or otherwise**: a bad deploy today means manually
  `docker load`-ing a previous image (if you kept the tarball) or rebuilding from an older commit by
  hand. An automated pipeline should keep the previous image tagged/available on the instance
  specifically so a failed health check can trigger an automatic revert, not just a red pipeline run
  someone has to notice and fix by hand.
- **Single instance, no staging slot**: there's no blue/green or canary path available on a single
  free-tier `t3.micro` — a CD pipeline here means "replace the one thing running" the same way the
  manual process does today, just faster. A true zero-downtime deploy would need the ECS
  Fargate + ALB target architecture (`DEPLOYMENT-AWS.md`) that free-tier constraints have deliberately
  deferred.
- **Approval gate**: given the single-instance blast radius, a GitHub Environment with a required
  reviewer (a manual "approve this deploy" click) before the CD job actually touches production is
  worth strong consideration even after everything above is automated — the build/package/verify
  steps benefit from automation; the "actually replace what's running in prod" step is exactly the
  kind of action this project's own working conventions already treat as needing an explicit human
  go-ahead.
- **Cost**: GitHub Actions minutes are free for public repositories, so running this on every merge
  to `main` costs nothing extra beyond what CI already uses — consistent with this whole deployment's
  free-tier ethos.
