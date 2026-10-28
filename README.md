# SmartRecruit AI

Phase 2 adds secure staff authentication, company workspaces and roles, team invitations, password reset, and durable SMTP notifications to the verified Phase 1 infrastructure. Recruitment and AI inference are not implemented. Phase 2 developer verification is recorded in [docs/phase-2-verification.md](docs/phase-2-verification.md); independent security approval is still required. The approved design is in [docs/architecture.md](docs/architecture.md); verification evidence is in [docs/progress.md](docs/progress.md).

## Prerequisites

- Node.js 24.13+ on the 24 LTS line; Docker builds pin 24.13.0.
- pnpm 10.28.2 (`npm install --global pnpm@10.28.2`).
- Docker Engine with Docker Compose v2 or newer, internet access for initial dependency/image/source downloads, and enough disk/memory to compile MinIO. The first build is substantially slower than subsequent cached builds.
- Available loopback port 8080; development tools additionally use 8025 and 9001.

Versions are exact in manifests and `pnpm-lock.yaml`; do not delete the lockfile to resolve installation problems. Vite's documented [Node requirements](https://vite.dev/guide/) and [Prisma 6 requirements](https://www.prisma.io/docs/guides/upgrade-prisma-orm/v6) informed the Node selection. Actual build/runtime results, rather than a blanket compatibility claim, are recorded in progress.

MinIO remains the approved storage service. Its original public image was unavailable during implementation, so `infrastructure/minio/Dockerfile` compiles the pinned upstream server release `RELEASE.2025-10-15T17-29-55Z` and client release `RELEASE.2025-08-13T08-35-41Z`. This follows the [upstream source-build guidance](https://github.com/minio/minio/releases/tag/RELEASE.2025-10-15T17-29-55Z). The upstream repository is archived; maintenance and security review are required before production. No third-party mirror is used.

## Fresh local setup

```sh
node scripts/setup-env.mjs
# Review .env, including the explicitly selected AI_PROVIDER=mock.
pnpm install --frozen-lockfile
pnpm build
docker compose build
docker compose up -d --wait postgres redis minio mailpit
docker compose run --rm minio-init
pnpm db:migrate
docker compose up -d --wait
docker compose ps -a
```

Open http://localhost:8080. The page polls actual API readiness; it reports errors instead of a fabricated healthy state. OpenAPI is at http://localhost:8080/api/docs in development only.

`setup-env.mjs` creates a mode-0600 `.env` with independently generated random credentials and refuses to overwrite an existing file. `.env.example` contains no usable credentials. Alternatively copy it and fill every blank secret with URL-safe random values (hex is recommended because Compose constructs connection URLs). Keep `.env` private. Do not run `docker compose config` without `--quiet` when sharing output: resolved configuration contains secrets.

`AI_PROVIDER` is required and explicit. Phase 1 makes no provider calls; catalog/key validation and AI contracts arrive in Phase 3. No automatic fallback exists. Local HTTP and mock mode are rejected when `NODE_ENV=production`; this local Compose stack is not a production deployment.

## Workspace and development

- `apps/web`: React, Vite, Router, Tailwind, shadcn-style accessible primitives (`components.json`), TanStack Query and a React Hook Form/Zod refresh-settings form.
- `apps/api`: modular NestJS REST/OpenAPI and origin-restricted Socket.IO handshake. Auth, companies, memberships and notifications are implemented; later-phase directories remain documented boundaries.
- `apps/worker`: independent Nest application context, BullMQ smoke processor, health server and database heartbeat. It imports only the API's explicit infrastructure export, never its bootstrap or gateway.
- `packages/shared`: transport types/constants without data access; `packages/config`: validated server environment; `packages/ai-contracts`: task names only, with prompts/schemas deferred to Phase 3.

After completing the fresh migration workflow:

```sh
pnpm dev
# Equivalent:
docker compose -f docker-compose.yml -f docker-compose.dev.yml up --build
```

The override mounts app sources, uses named dependency volumes, runs Vite/Nest/worker watch commands and routes HMR through Nginx. Shared package, dependency, Prisma schema or build-configuration changes require rebuilding. Dependency volumes preserve installed versions: after changing the lockfile, stop the dev stack and remove only its `api_dependencies`, `worker_dependencies`, and `web_dependencies` volumes before rebuilding (never the data volumes).

Development tools: Mailpit http://localhost:8025 and MinIO console http://localhost:9001. PostgreSQL, Redis and the S3 port remain private even in the override. The base publishes only `127.0.0.1:8080`; API and worker credentials contain no MinIO root or database owner password. Source watchers run as non-root users. The development-only CSP permits the inline React Refresh preamble; the static stack retains `script-src 'self'`. After changing a bind-mounted Nginx configuration, recreate the nginx service so the complete file is remounted.

To return to built static assets, stop the override with both `-f` arguments, then run `docker compose up -d --build --wait`. These commands preserve named data volumes.

## Migrations

```sh
pnpm prisma:generate
pnpm db:migrate
# The wrapper runs a one-shot API container with owner DATABASE_URL:
# docker compose run --rm --no-deps -e DATABASE_URL api pnpm prisma:migrate:deploy
```

The wrapper reads `.env` privately and passes the schema-owner credential only to the ephemeral migration process. Normal API/worker connections use `smart_recruit_runtime`, which has data privileges but cannot create schema objects. Migrations never run automatically on API startup. Prisma's migration locking serializes deployment; no `db push` is used.

The Phase 1 baseline creates `InfrastructureState` and `WorkerHeartbeat`. Phase 2 adds identity/session/reset, company/membership/invitation, audit and tenant/global notification tables; readiness now requires schema version 2. Later recruitment schemas remain deferred. PostgreSQL's initialization script runs only for a fresh volume; editing credentials in `.env` does not rotate existing database/MinIO credentials automatically. Existing data needs an explicit rotation/migration procedure.

## Health and verification

```sh
pnpm lint
pnpm typecheck
pnpm build
pnpm test # builds workspaces, then runs Vitest
docker compose config --quiet
docker compose -f docker-compose.yml -f docker-compose.dev.yml config --quiet
curl -fsS http://localhost:8080/api/health/live
curl -fsS http://localhost:8080/api/health/ready
docker compose exec worker pnpm smoke
pnpm test:infrastructure
pnpm exec playwright install chromium
pnpm test:e2e
# With the development override running, verify HMR and process users:
node scripts/verify-dev.mjs
```

`test:infrastructure` targets the running **base** stack. It verifies routing, an actual polling→WebSocket upgrade, origin denial, API/worker dependency access, idempotent MinIO initialization, denied anonymous reads and schema/storage administration, then writes synthetic markers, **restarts PostgreSQL/Redis/MinIO/Mailpit**, confirms persisted data and removes its markers. Run against local development only. No real candidate data is used. `APP_URL` can select a different entry point; keep `PUBLIC_APP_URL`, `CORS_ORIGIN`, and `EDGE_PORT` consistent.

API direct probes: `/health/live` checks the process; `/health/ready` verifies schema compatibility and reports PostgreSQL, Redis, private bucket and SMTP. Missing DB/schema returns 503; noncritical dependency failure returns 200 with `status: degraded` and individual failures. Health checks issue no AI calls. Nginx maps `/api/health/*` to these probes without changing ordinary `/api/*` paths.

Worker probes are private on port 3001. Readiness requires a running consumer and a recent DB heartbeat after successful DB/schema and Redis checks. Liveness stays independent of dependencies. SIGTERM stops work, closes connections, and has a bounded 25-second drain inside a 30-second Compose grace period. `minio-init` is a one-shot success, not a permanently running tenth service.

## Troubleshooting and operational limits

- Missing/invalid configuration: fill the required `.env` fields; errors intentionally do not echo secrets. Exact origins have no trailing slash.
- API unavailable or worker unready: inspect `docker compose ps -a` and `docker compose logs api worker`; run the explicit migration command. Do not reset volumes to fix a missing migration.
- MinIO initialization: inspect `docker compose logs minio-init`; rerun `docker compose run --rm minio-init`. The initializer removes anonymous policy and grants the app access only to the configured bucket. Root credentials stay in MinIO/bootstrap.
- Socket error: browser origin must match `CORS_ORIGIN`. Handshake-only transport has no session rooms or business commands; future authentication remains required.
- Port conflict: choose another `EDGE_PORT` and update both origins. Tool ports bind loopback only.
- Build failures: preserve logs and verify registry/GitHub/Go proxy access. MinIO compiles from pinned source; do not silently substitute a storage provider.
- `docker compose stop`/`down` preserves state. `docker compose down -v` **destroys local database, queue, object and mailbox data** and is not part of ordinary setup.

Named volumes persist database, Redis AOF (`noeviction`), private objects and Mailpit data. Logs contain safe event names/component state, not payloads or credentials; Nginx request logging is disabled to avoid URL token leakage. Runtime data services are isolated on an internal network; API/worker have outbound networking for later integrations. This is not an egress allowlist.

TLS, production secret management, maintained-image review, backups/restore drills, real SMTP/provider policy and candidate privacy remain production release gates. Phase 2 auth and tenant security tests do not authorize production deployment or real candidate data.

Current dependency-audit limitation after audit remediation: four moderate advisories remain in MinIO’s parsing dependencies; none are suppressed. esbuild and js-yaml advisories were fixed with compatible updates. See [the per-advisory analysis](docs/phase-1-advisories.md). The owner reports independent Phase 1 approval. Phase 2 requires a new independent security-focused audit; local passing checks are not production release approval.

## Vitest testing foundation

`pnpm test` builds all workspace packages with TypeScript and runs Vitest 4.1.12 via `vitest.config.mts`. `pnpm test:watch` builds once and starts Vitest watch mode. For focused reruns after a build, use `pnpm exec vitest run tests/config.test.mjs` or another included test path. All nine original cases were migrated without removing their assertions; verifier regressions, Git-visible boundary checks, Nest metadata and React rendering bring the current total to 18.

Tests can live under `tests/**/*.test.{mjs,ts,tsx}`, `apps/*/src/**/*.test.{ts,tsx}`, or `packages/*/src/**/*.test.ts`. Playwright E2E and generated/build artifacts are excluded. Backend tests load the TypeScript-compiled modules so Nest decorator/constructor metadata is retained; rebuild after backend edits during watch mode. Vitest's Node environment, automatic JSX transform and web `@` alias support React server-render tests now. For future DOM interaction unit tests, add a DOM environment dependency when needed and select it per test using [Vitest's documented environment configuration](https://vitest.dev/guide/environment); existing browser interaction checks remain Playwright. No additional DOM framework is installed before it is needed.

The corrected infrastructure test requires exact PostgreSQL SQLSTATE `42501` and S3 `AccessDenied`; transport/missing-table/unrelated errors fail. Recovery compares persisted heartbeat timestamps across restart with bounded polling. Runtime inventory must contain exactly the nine named services, including a successfully exited initializer and eight running healthy services.


## Phase 2 setup and workflows

For an existing Phase 1 checkout, run `node scripts/setup-auth-env.mjs` once to append missing independent auth/CSRF/email encryption keys to the ignored `.env`, preserving existing values. Fresh `setup-env.mjs` now generates these keys too. Never share resolved Compose configuration or `.env`.

```sh
pnpm install --frozen-lockfile
pnpm build
docker compose build api worker web
pnpm db:migrate
node scripts/migrate.mjs --status
docker compose up -d --wait
```

Open `/register` to create an admin and workspace atomically, `/login` to sign in, or `/workspace` to select an authorized workspace. Admins manage team roles, memberships, invitation delivery/revocation/resend and company name. A last active admin cannot be demoted or removed. Users can create additional companies and switch independent roles. All company lists are bounded to 100 entries with cursor pagination. Active sessions can be revoked. `/reset-request` always gives a generic response; reset links expire after 30 minutes. Team links expire after seven days and are single-use. Existing users sign in as the invited identity before accepting; new users create an account through the invitation. Resending invalidates the old link without extending expiry.

Email tokens are URL fragments, cleared immediately on page load, never query parameters. Access JWTs live only in browser memory; refresh cookies are HttpOnly and rotate with a fixed 30-day family lifetime. Refresh is single-flight per tab and uses Web Locks across supported browser tabs. A concurrent replay deliberately revokes the family, requiring sign-in. Cookies are Secure in production; local HTTP is development-only. Runtime authorization reloads membership on every company transaction. Cache contents are cleared on workspace changes/logout; no auth data is persisted to localStorage.

The independent worker polls both PostgreSQL outboxes without relying on Redis scheduling. BullMQ jobs contain only IDs and scope/company context. SMTP acceptance is distinct from inbox receipt. Pending work survives Redis loss and bounded leases recover after worker failure. Attempts cap at five. Terminal delivery states purge encrypted token payloads; a new authorized resend/reset request creates a new token. SMTP can duplicate an email after an ambiguous crash; no exactly-once delivery guarantee is made. Queue keys are namespaced by database name so isolated tests cannot consume development jobs.

Keys are 32-byte hex values, independently generated. `AUTH_KEY_ID` identifies the active JWT key; `NOTIFICATION_KEY_VERSION` identifies the AES-GCM key. Rotate auth/CSRF keys together across API replicas; existing access tokens/CSRF state then need renewal. Before changing the notification key/version, drain or cancel unfinished deliveries; old-version payloads fail closed and require authorized resend. Keep the old key available in protected operational backups until pending ciphertext has been handled. This local implementation accepts one active key version and does not silently decrypt with a fallback key. Mailpit is the local SMTP target; deployment SMTP/TLS/secret management remains a release decision.

```sh
pnpm test                 # unit/configuration tests; service tests explicitly skipped
pnpm test:phase2          # real PostgreSQL, Redis, Mailpit; requires current API image
pnpm test:phase2:e2e      # isolated DB; temporarily switches API/worker, restores base stack
pnpm test:infrastructure
pnpm test:e2e            # existing infrastructure browser smoke
pnpm audit --json        # four inherited moderate advisories remain unsuppressed
```

Phase 2 integration tests create uniquely named disposable databases and queue namespaces, never truncate development tables, and remove their synthetic Mailpit messages. The browser wrapper temporarily restarts API/worker/web/Nginx, so run locally without concurrent use. It restores the ordinary stack and drops only its generated database in `finally`. No candidate data is used. Default tests deliberately skip Docker-dependent suites; an explicit Phase 2 test command is required for acceptance.
