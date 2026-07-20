# AWS Deployment — As-Built Details (Enklr Task production instance)

This is the **as-built record** of the actual production deployment currently running — real
resource IDs, real commands, real file paths. `DEPLOYMENT-AWS.md` is the prescriptive/reusable guide
for standing up a *new* environment (ECS Fargate + ALB, written before this deployment happened);
this document is what was **actually built instead**, once free-tier cost constraints ruled that
architecture out in favor of a single EC2 instance + RDS. Read this before touching the running
production instance — it's the map of what exists and how to operate it, not a tutorial.

**Live URL**: https://enklr-task.duckdns.org
**AWS Account**: `800380167179`, region `us-east-1`

---

## 1. IAM — the CLI deploy user

Real AWS domain registration/some other services are blocked outright on a free-tier account
(`CheckDomainAvailability` returned `AccessDeniedException: Free Tier accounts are not supported for
this service`) — noted here in case it resurfaces for other Route 53/other-service calls later; it's
an AWS-side account restriction, not something fixable from this side.

- **IAM user**: `enklr-task-deploy` — programmatic access only (no console password), created via the
  IAM console (Users → Create user → *did not* check "Provide user access to the AWS Management
  Console").
- **Policy**: `PowerUserAccess` (AWS managed policy) attached directly — deliberately not
  `AdministratorAccess`. Covers EC2/RDS/VPC/security-group provisioning but excludes IAM/org-management
  actions, keeping the blast radius of a leaked key smaller than a full admin credential.
- **Access key**: created under this user's Security credentials → Access keys → "Command Line
  Interface (CLI)" use case. The Access Key ID/Secret were configured locally via `aws configure`
  (region `us-east-1`, output `json`) — **never pasted into this chat/session**; the operator ran
  `aws configure` themselves in their own terminal and the connection was verified afterward with
  `aws sts get-caller-identity` (which only echoes back the account id/user ARN, never secrets).
- **Local AWS CLI**: v2.36.2, installed via `winget install --id Amazon.AWSCLI -e` on the Windows
  operator machine, binary at `C:\Program Files\Amazon\AWSCLIV2\aws.exe` (add this to `PATH` in any
  fresh shell session — a machine-level PATH update via an MSI install doesn't propagate into
  already-open shells until they're restarted).

---

## 2. Networking

Used the account's **default VPC** rather than provisioning a new one (`vpc-00624d1a08163ac3b`,
`us-east-1`) — its pre-existing subnets (one per AZ, all with `MapPublicIpOnLaunch=true` and a route
to an Internet Gateway) were sufficient; no NAT Gateway was provisioned (not free-tier, and not
needed — the EC2 instance is itself in a public subnet with a public/Elastic IP, not behind a NAT).

| Subnet | AZ | Used for |
|---|---|---|
| `subnet-0f9870db812f5c8ca` | `us-east-1a` | EC2 instance; RDS subnet group (1st) |
| `subnet-0bb803ad96f0f773d` | `us-east-1b` | RDS subnet group (2nd — RDS requires ≥2 AZs even for a single-AZ instance) |

**Security groups** (three, matching the "only the web-facing port is open" model):

| Name | ID | Inbound rules |
|---|---|---|
| `enkl-ec2-sg` | `sg-057296bc49f94eb2e` | `22/tcp` from the operator's own IP only (`/32`, **not** `0.0.0.0/0` — re-add/update this rule if the operator's home/office IP changes and SSH stops connecting); `80/tcp` and `443/tcp` from `0.0.0.0/0` |
| `enkl-rds-sg` | `sg-09e4b83064cf68f68` | `5432/tcp` from `enkl-ec2-sg` **only** (security-group-to-security-group reference, not a CIDR) — RDS has no public accessibility at all (`--no-publicly-accessible`) |

No security group opens port `8080` (the `api` container) to anything outside the Docker
Compose-internal bridge network — `web` (nginx) is the only thing that ever reaches it, exactly like
the reference `docker-compose.yml`'s own model.

---

## 3. RDS — PostgreSQL

| Setting | Value |
|---|---|
| Identifier | `enkl-postgres` |
| Endpoint | `enkl-postgres.c61qe4i8mw5i.us-east-1.rds.amazonaws.com` |
| Engine | PostgreSQL 16 (`16.13` as provisioned) |
| Instance class | `db.t4g.micro` (free tier) |
| Storage | 20 GB `gp3` |
| Multi-AZ | No (single-AZ — free tier doesn't cover Multi-AZ; would need re-provisioning for real HA later) |
| Backup retention | **1 day** — the free-tier account rejected the originally-intended 7 days with `FreeTierRestrictionError`; 1 day was the accepted value |
| Master username | `enkl_app` |
| Database name | `enkl` |
| Subnet group | `enkl-db-subnets` (the two subnets above) |
| Security group | `enkl-rds-sg` |

**Why the master user, not a scoped-down one**: the app's `AddSavedQueryApiExposure`-equivalent
migration runs `CREATE ROLE enkl_public_query ...` for the Public Query API feature, which needs
`rds_superuser` (RDS's own bounded superuser-equivalent, granted to the master user by default) — see
`DEPLOYMENT-AWS.md` §2 for the fuller explanation. This is *not* the same situation as the
`mariadb-api` tier's shared-hosting story (`DEPLOYMENT-MARIADB.md` §7.1) — nothing here needed to be
split out into a manual step, RDS's master user already has what's needed.

**Do not put RDS Proxy in front of this database** — `Services/SseBroadcaster.cs`'s live-update
stream depends on `LISTEN`/`NOTIFY`, which RDS Proxy's connection pooling breaks silently.

---

## 4. EC2 — the application host

| Setting | Value |
|---|---|
| Instance ID | `i-027338a4d721703b6` |
| Instance type | `t3.micro` (free tier — 750 hrs/month for 12 months from account creation) |
| AMI | `ami-0fd6240f599091088` (Amazon Linux 2023, x86_64, looked up via the `/aws/service/ami-amazon-linux-latest/al2023-ami-kernel-default-x86_64` SSM public parameter — re-resolve this parameter for a fresh AMI id if ever relaunching, don't hardcode the id itself) |
| Root volume | 20 GB `gp3` |
| Key pair | `enkl-key` — private key lives at `~/.ssh/enkl-key.pem` on the operator's Windows machine (`C:\Users\andre\.ssh\enkl-key.pem`); **this file is the only copy**, back it up somewhere safe, losing it means losing SSH access to this instance entirely (would require detaching the root volume and attaching it to a rescue instance to recover) |
| Elastic IP | `107.21.99.255` (allocation `eipalloc-0af2e27ddd771d102`, association `eipassoc-0040f5e907457cd07`) — **free only while attached to a running instance**; stopping the instance without releasing the EIP starts incurring an hourly charge |
| Security group | `enkl-ec2-sg` |

**Bootstrap (EC2 user-data, ran once at first boot)**: installs Docker (`dnf install docker`),
enables it, adds `ec2-user` to the `docker` group, and installs the Docker Compose CLI plugin
(`docker-compose-linux-x86_64` binary from the Compose GitHub releases, placed at
`/usr/local/lib/docker/cli-plugins/docker-compose`).

**Real gotcha hit during setup**: the `buildx` CLI plugin AL2023's `docker` package ships
(`v0.12.1`) is too old for Compose v5's `docker compose build` (`compose build requires buildx 0.17.0
or later`). Fixed by downloading a current `buildx` release binary directly from
`github.com/docker/buildx/releases` and overwriting
`/usr/local/lib/docker/cli-plugins/docker-buildx` (now `v0.35.0`). If this instance is ever rebuilt
from scratch, redo this step — the stock AL2023 Docker package's bundled buildx is not sufficient.

**SSH access**:
```
ssh -i ~/.ssh/enkl-key.pem ec2-user@107.21.99.255
```

---

## 5. Application deployment

**Layout on the EC2 instance** (`/home/ec2-user/Enkl.app/`, a full clone of
`https://github.com/andrewrigney1975-cpu/Enklr.app.git` — renamed from `Enkl.app` on 2026-07-20,
matching the app's own Enklr rebrand; GitHub redirects the old URL, but the EC2 checkout's own git
remote and this doc were both updated to the real name rather than relying on that redirect
indefinitely):

| Path | What it is | Tracked in git? |
|---|---|---|
| (whole repo) | Standard clone — `api/`, `src/`, `web/`, etc. Still kept up to date via `git pull` even though builds no longer happen here (see §5.2) — it's what `docker-compose.aws.yml` and `.env` sit alongside, and it's a convenient reference for what's actually deployed | Yes |
| `docker-compose.aws.yml` | This deployment's own compose file — no `db` service (RDS is used instead), `api`'s connection strings point at `${DB_HOST}` via `.env`, `web` gets extra volumes for TLS (see §7) | **No** — created directly on the server, never committed (would need per-deployment values otherwise) |
| `.env` | `DB_HOST`, `DB_PASSWORD`, `JWT_SIGNING_KEY`, `PUBLIC_BASE_URL`, `ASPNETCORE_ENVIRONMENT` — `chmod 600`, owned by `ec2-user` | **No** — secrets, gitignored pattern, never committed |
| `nginx-active.conf` | The live nginx config, bind-mounted into the `web` container (see §7) | **No** — server-local, swapped between "interim" and "final" versions during TLS setup |
| `certbot/www/`, `certbot/conf/` | Let's Encrypt webroot + certificate storage | **No** — real certificate material, never committed |

### 5.1 Incident (2026-07-20): building on the instance itself wedged it

The original deploy procedure ran `docker compose build` (i.e. `dotnet restore`/`publish` for `api`,
`npm ci`/`node build.js` for `web`) directly on the EC2 instance, same as the git-based flow
`DEPLOYMENT-AWS.md` assumes for an on-prem/dedicated host. On this `t3.micro` (916 MB RAM, **no swap**
— `zram-generator` explicitly declines to configure one because it only activates below an 800 MB
total-memory threshold, and this instance has slightly more than that) a `dotnet build` from a
larger commit (the org-configurable-default-password feature, touching all three backend tiers)
consumed enough memory that the instance became unreachable over SSH — TCP connected but the SSH
banner never arrived, for over ten minutes, across repeated attempts. `aws ec2 describe-instance-status`
still reported both status checks `ok` throughout (the hypervisor-level check doesn't catch an
OS wedged this way), and `CPUCreditBalance` was low but not zero, so this wasn't simple CPU-credit
throttling either — the most likely cause is memory pressure with nothing to fall back on once RAM
filled up (no swap configured at all).

**Recovery**: `aws ec2 reboot-instances --instance-ids i-027338a4d721703b6` (a soft/ACPI reboot, not
a stop/start — preserves the instance and its EBS volume exactly as configured). SSH access returned
a few minutes later. Both `api` and `web` containers **auto-restarted on their own** once the Docker
daemon came back up — `systemctl enable --now docker` (set at initial provisioning, §4) plus each
service's `restart: unless-stopped` policy in `docker-compose.aws.yml` means no manual container
restart was needed after the reboot, only the interrupted deploy itself still needed finishing.

The interrupted build had produced a couple of dangling `<none>:<none>` layers (harmless, but worth
an occasional `docker image prune` if disk space ever gets tight on this small instance).

### 5.2 Current deploy procedure: build locally, ship the image, never build on the instance

Following the incident above, this deployment no longer builds anything on the EC2 instance at all.
Images are built on the operator's own machine (ample RAM/CPU, no free-tier constraint) and shipped
across as a plain tarball — no ECR, no registry, no CI/CD, matching this deployment's existing
"minimum moving parts" style.

```bash
# 1. Build both images locally, from the repo root, using a local copy of docker-compose.aws.yml
#    (its build contexts — ./api/Enkl.Api and . — resolve relative to wherever this file sits, so
#    it needs to live at the repo root locally too, same as it does on the server).
docker compose -f docker-compose.aws.yml build api web

# 2. Save + gzip both images into one transportable file. Confirmed the local Docker Desktop
#    already builds linux/amd64 natively (`docker version --format '{{.Server.Os}}/{{.Server.Arch}}'`)
#    — matching the t3.micro's architecture exactly, so no --platform flag or cross-build step is
#    needed. (If ever building from an ARM host — e.g. Apple Silicon — add
#    `docker compose build --build-arg` isn't relevant here; instead pass
#    `docker buildx build --platform linux/amd64` per-service, or set `DOCKER_DEFAULT_PLATFORM=linux/amd64`.)
docker save enklapp-api:latest enklapp-web:latest | gzip > enkl-images.tar.gz   # ~124 MB compressed

# 3. Ship it to the instance.
scp -i ~/.ssh/enkl-key.pem enkl-images.tar.gz ec2-user@107.21.99.255:/home/ec2-user/enkl-images.tar.gz

# 4. On the instance: load the images (no build, no compilation — just decompressing/importing
#    already-built layers, a fraction of the memory/CPU cost of an actual build) and recreate.
ssh -i ~/.ssh/enkl-key.pem ec2-user@107.21.99.255
cd /home/ec2-user/Enkl.app
git pull origin main    # keeps the checkout in sync for reference/migrations context, even though
                         # it's no longer what gets built — RunMigrationsOnStartup reads migration
                         # files baked into the api IMAGE, not this checkout, so this step is for
                         # keeping the repo a truthful mirror, not functionally required for the
                         # deploy itself
gunzip -c ~/enkl-images.tar.gz | sudo docker load
sudo docker compose -f docker-compose.aws.yml up -d --force-recreate api web
rm ~/enkl-images.tar.gz   # don't leave the transfer artifact sitting on the small root volume
```
`RunMigrationsOnStartup=true` in `.env` still means any new EF Core migration is applied automatically
the moment the new `api` container starts — no separate migration step needed either way.

**If the EC2 checkout ever has local modifications that collide with `git pull`** (this happened once,
from an early rebrand deploy done via direct `scp` before it was committed upstream): confirm the
local diff is genuinely superseded by what's about to be pulled (`git diff`), then
`git checkout -- <file>` to discard the local copy before pulling. Never do this blindly — check the
diff first in case the EC2 checkout has a real, not-yet-committed change of its own.

---

## 6. Domain — DuckDNS

- **Domain**: `enklr-task.duckdns.org` (free, no registrar/payment involved — Route 53 domain
  registration is blocked on this free-tier account, see §1).
- Managed at https://www.duckdns.org (OAuth sign-in, no separate account/password) — the subdomain's
  "current IP" is pointed at the Elastic IP (`107.21.99.255`) and needs updating there manually if
  the Elastic IP ever changes (e.g., if the EIP is ever released and re-allocated).
- **Known limitation, not urgent**: a free DuckDNS subdomain isn't a permanently-owned asset the way
  a purchased domain is — don't assume it survives indefinitely with zero maintenance.

---

## 7. TLS — Let's Encrypt via certbot (webroot method)

No ALB/ACM involved (this deployment has no load balancer) — TLS is terminated directly by the
`web` (nginx) container on the EC2 instance itself, using a real Let's Encrypt certificate.

**Why the nginx config is bind-mounted, not baked into the image**: `web/Dockerfile`'s reference
build (`COPY web/nginx.conf ...`) bakes the config in at build time. This deployment instead mounts
`./nginx-active.conf:/etc/nginx/conf.d/default.conf:ro` in `docker-compose.aws.yml`, so the config
(and therefore TLS itself) can be changed/renewed without rebuilding the `web` image.

**Two-phase setup actually performed** (needed because a cert must be *requested* over plain HTTP
before it exists, but the *final* config wants to redirect plain HTTP to HTTPS):
1. **Interim config** (`nginx-step1.conf`'s content, first placed as `nginx-active.conf`): plain
   HTTP on port 80, serving `/.well-known/acme-challenge/` from a webroot volume alongside the
   normal app routes — nothing redirects yet.
2. Requested the cert via a one-shot `certbot` container run against that webroot:
   ```bash
   sudo docker compose -f docker-compose.aws.yml run --rm --entrypoint certbot certbot \
     certonly --webroot -w /var/www/certbot -d enklr-task.duckdns.org \
     --email andrewrigney1975@gmail.com --agree-tos --no-eff-email
   ```
   **Gotcha hit here**: the `certbot` service in `docker-compose.aws.yml` has
   `entrypoint: "true"` so `docker compose up` never tries to start it as a long-running service —
   but that same override also silently no-ops `docker compose run` unless the entrypoint is
   explicitly overridden back with `--entrypoint certbot` on the command line, as above. Forgetting
   `--entrypoint certbot` produces a container that starts, does nothing, and exits — no error, no
   certificate, easy to miss.
3. **Final config** (`nginx-final.conf`'s content, swapped in as `nginx-active.conf` once the cert
   existed): port 80 now only serves the ACME challenge path and 301-redirects everything else to
   HTTPS; port 443 does full TLS termination (`ssl_certificate`/`ssl_certificate_key` pointed at
   `/etc/letsencrypt/live/enklr-task.duckdns.org/`) plus the same security headers/proxy routes as
   the reference `web/nginx.conf`.
4. Reload: `sudo docker compose -f docker-compose.aws.yml exec web nginx -t && ... nginx -s reload`
   (test the config before reloading — a bad config here would otherwise silently keep serving the
   old one until the container is fully restarted).

**Certificate details**: issued 2026-07-20, expires **2026-10-18** (90-day Let's Encrypt lifetime).

**Auto-renewal**: a cron job (installed via `cronie`, not present on AL2023 by default — had to
`dnf install -y cronie` and `systemctl enable --now crond` first) runs weekly:
```
0 3 * * 1 /home/ec2-user/renew-cert.sh
```
`renew-cert.sh` runs `certbot renew` (a safe no-op until within ~30 days of expiry) via the same
one-shot container pattern, then reloads nginx — logs to `/home/ec2-user/certbot-renew.log`. If the
site ever shows an expired-certificate warning, check that log first; the most likely causes are the
cron job not firing (check `systemctl status crond`) or the renewal itself failing (DNS no longer
pointing at this instance, port 80 blocked, etc.).

---

## 8. What's deliberately NOT part of this deployment

- **No load balancer** (ALB/NLB) — TLS terminates directly on the EC2 instance's nginx.
- **No auto-scaling** — a single EC2 instance; if it needs to handle more load, this would need
  re-architecting (see `DEPLOYMENT-AWS.md`'s ECS Fargate + ALB design as the natural next step, once
  free-tier constraints no longer apply).
- **No CI/CD** — deployment is the manual build-locally-and-ship procedure in §5.2, run by an
  operator from their own machine. No GitHub Actions workflow builds or pushes to this instance
  automatically.
- **No container registry** — images are built on the operator's own machine and shipped as a plain
  `docker save`d tarball (§5.2), not pushed to ECR and pulled. **No builds of any kind run on the EC2
  instance itself** — deliberately, after §5.1's incident: this `t3.micro` has no swap, and a
  `dotnet build`/`npm ci` running directly on it can consume enough memory to make the instance
  briefly unreachable over SSH.
- **No automated database backups beyond RDS's own 1-day retention** — no separate `pg_dump`
  schedule exists.
