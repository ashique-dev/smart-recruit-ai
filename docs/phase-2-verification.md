# Phase 2 developer verification

**Independent Phase 2 audit: FAIL — 27/30 passed, 2 failed, 1 insufficiently verified; 0 critical, 2 high and 3 medium findings.** The earlier developer PASS below is historical and superseded. F01–F04 are locally FIXED; F05 remains UNRESOLVED. Remediation verification is complete; independent re-audit is pending. No independent approval is claimed. Owner-reported Phase 0/1 approval remains unchanged.

Branch `phase-2/auth-multitenancy`; baseline `e830a84645f3bfe4a7535d2f023a426d39459c99`; initially clean, verified with `git status`, `git branch --show-current`, `git rev-parse HEAD`. No commit or push.

## Requirement and implementation checklist

| Checkpoint | Implementation and verification | Status |
|---|---|---|
| 2A | Approved global identity/reset/session and tenant company/membership/invitation/audit models; tenant and auth notification ledgers/outboxes; UUIDs, tenant FKs, unique normalized email/membership/token hashes, lifecycle checks, indexes, owner migrations and runtime privilege denials | Passed checks below |
| 2B | Atomic signup, Argon2id/login, short-lived verified JWT, hashed rotating refresh families, row-lock replay revocation, logout/session revoke, cookies, origin/CSRF, account/IP throttles, single-use reset; real DB/HTTP/race tests | Passed — evidence below |
| 2C | Membership resolution per request and transaction, reusable role policy, scoped repositories, workspace/team controls, last-admin lock; two-company read/write/role/removal/association tests | Passed — evidence below |
| 2D | Invite/create/accept/revoke/resend; encrypted versioned payloads, DB outboxes, BullMQ ID-only jobs, fenced leases, bounded retries, SMTP and purge; Mailpit/crash/Redis loss/concurrency tests | Passed — evidence below |
| UI | Register/login/reset/acceptance, workspace switching, sessions, team/settings controls; React forms/query isolation and browser tests | Passed — evidence below |
| Final | Frozen install, lint/typecheck/build/Vitest, Prisma migrations, Compose, browser, infrastructure, audit, secret-log review | Executed; functional checks pass, dependency audit nonzero |

## Decisions and assumptions

Approved documents define principal fields/invariants rather than a complete executable schema. Concrete field names follow their terminology. Email identity is trimmed/lowercased consistently, without provider-specific dot/plus rewriting. Company ownership is its active admin memberships, not a second owner identity. Status enums distinguish inactive memberships, disabled users and suspended companies. Audit actor references preserve membership attribution. UUID keys and timestamptz are used throughout.

Phase 2 adds no AI, recruitment or interview schema. Global resets never borrow a company. Notification recipient is resolved through the invitation or reset/user reference, not duplicated in queue payloads. Outbox relational IDs are the ID-only payload. Delivery records own bounded attempt/lease state; tenant operations mirror it. Expired live invitations must be explicitly revoked in issuance transactions before replacement; the unique partial index does not use a volatile clock predicate.

## Checkpoint 2A evidence

Changed: `apps/api/prisma/schema.prisma`, `apps/api/prisma/migrations/20261028000100_auth_tenancy/migration.sql`, `tests/phase2/database.test.mjs`, `tests/phase2/database.sql`, this report and progress.

Executed:

- `pnpm --filter @smart-recruit/api exec prisma format`: initially found missing composite uniqueness on the one-to-one delivery/operation relation; corrected, then passed.
- `DATABASE_URL=postgresql://unused:unused@localhost/unused pnpm --filter @smart-recruit/api exec prisma validate`: passed (synthetic URL; no DB access).
- `pnpm prisma:generate`: passed.
- Prisma `migrate diff` from the baseline schema to the new schema: generated explicit SQL; manually added checks, partial indexes and append-only runtime audit permissions. Initial attempt with `--from-migrations` required a shadow URL; switched to the actual Git baseline schema, without using a development DB as shadow.
- `docker compose build api`: sandbox cache write denied; approved escalation succeeded, including workspace build.
- `pnpm db:migrate`: passed, new migration applied using the existing ephemeral schema-owner wrapper. Runtime account unchanged.
- `PHASE2_DATABASE_TESTS=1 pnpm exec vitest run tests/phase2/database.test.mjs`: passed, one integration case containing SQL assertions. All migrations replayed in a unique temporary PostgreSQL database, removed in finally; development data untouched.
- `pnpm lint`: passed.

SQL assertions prove duplicate email/membership/live invitation rejection; normalized email/hash/expiry/rotation bounds; cross-company invitation issuer, outbox operation and delivery reference rejection; reset/user mismatch rejection; notification terminal ciphertext purge, attempt cap and acceptance timestamp constraints; required partial indexes; runtime has DML but cannot own/alter/create schema, edit infrastructure metadata or update/delete audit events. Expected SQLSTATE is checked exactly, so unrelated failures cannot pass.

No architecture boundary changed. Authentication/authorization behavior is not established by schema tests and remains pending.

## Checkpoint 2B evidence

Implemented `auth/{security,dto,guards,auth.service,auth.controller}.ts`; wired API bootstrap/module; added safe exception response filter, independent secret provisioning and Compose configuration. Added Argon2, jose, Nodemailer (for 2D), Zod and typings with exact lockfile pins. UI and SMTP execution remain later checkpoints.

Access JWTs are HS256 with explicit key ID, issuer/audience, algorithm, type, subject/session UUID and 10-minute expiry; guards check live DB session/user state. Opaque refresh tokens contain 256 random bits and only SHA-256 hashes persist. User-row locks serialize refresh, reset, login and revoke. Concurrent refresh gives one rotation and one replay rejection, then revokes the entire family; revocation commits before the error is returned. Families have a fixed 30-day maximum lifetime. Browser single-flight coordination remains required in the UI checkpoint.

Argon2id uses 64 MiB, three iterations and one lane, exceeding the [OWASP minimum](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html). A library verifier and dummy hash cover invalid identities. Passwords are bounded to 12–128 characters at signup/reset. Redis atomic counters limit 10 attempts/account and 60/IP per 15 minutes; Redis failure fails closed for auth attempts. Signed, time-limited CSRF tokens must match an HttpOnly cookie and exact Origin on mutations. Cookies are host-only, SameSite Strict, explicitly expire, use narrow API paths and require Secure in production. Unknown exceptions never expose/log raw Prisma inputs.

Password reset hash, AES-256-GCM payload (AAD bound to delivery ID/scope), delivery and auth outbox commit atomically. Tokens expire in 30 minutes, are single-use, and reset revokes sessions and purges pending reset payloads. Unknown/known reset requests return the same response. Email verification is not a separate approved Phase 2 workflow.

Executed: `pnpm build` passed after fixing strict TypeScript annotations and adding the direct Zod dependency; `pnpm lint` passed; `pnpm exec vitest run tests/phase2/security.test.mjs` passed 3 tests. API Docker image built successfully. `PHASE2_AUTH_TESTS=1 pnpm exec vitest run tests/phase2/auth.test.mjs` passed, including the runner's explicit completion marker. The harness creates/drops only its unique isolated PostgreSQL database and uses runtime credentials for HTTP tests.

HTTP/DB coverage: atomic signup and duplicate rollback; unknown DTO field rejection; valid/invalid login; malformed/expired/wrong issuer/audience JWTs; refresh rotation/replay/concurrent race; zero surviving sessions after replay; logout/revoke; session expiry; disabled user; reset generic response, transactional outbox, decryption binding, one-time consume/expiry and purge; HttpOnly/path/expiry/host-only/production Secure flags; missing/invalid CSRF and cross-origin denial; independent account and IP throttles. Unit tests cover JWT signature mismatch, key validation, CSRF signature/expiry, token hash/normalization and authenticated encryption context/version rejection. No approved architecture boundary changed.

## Checkpoint 2C evidence

Added company service/controller and reusable permission policy; shared workspace types. Every tenant transaction locks the company, revalidates the session and active membership/company, checks permission, then scopes resources with company-leading identifiers. Company creation is atomic and grants its creator an admin membership. Settings/member edits use revisions. Last-admin checks serialize under the same company lock. Membership deactivation preserves audit attribution; JWTs contain no company or role claims.

Passed: workspace build, lint, API image build; `PHASE2_AUTH_TESTS=1 PHASE2_TENANT_TESTS=1 pnpm exec vitest run tests/phase2/auth.test.mjs` (auth suite plus explicit tenant completion marker); `PHASE2_DATABASE_TESTS=1 pnpm exec vitest run tests/phase2/database.test.mjs`.

Actual HTTP cases cover company A admin denied B read/write; nonmember denied A; viewer/recruiter denied settings/team administration; viewer allowed workspace read; multi-company workspace list and independent access; guessed cross-company membership ID rejected; injected company body field rejected; last-admin removal rejected; membership removal immediately denies the same access token; promotion immediately changes effective permissions; simultaneous last-admin demotions result in one success/one conflict with one admin remaining. Permission policy separately checks viewer denial/recruiter allowance for future recruitment mutations; no artificial recruitment endpoint was created. SQL tests continue proving tenant association enforcement. No Phase 0 architecture changes.

## Checkpoint 2D backend evidence

Added invitation service/controllers and notification processor/runtime, exported only explicit worker modules and wired the independent worker. Issuance and resend are idempotent by company operation key; one live invite/email is DB-enforced. Existing users must authenticate as the exact invited email; new-user acceptance creates identity/membership atomically. Acceptance never takes a client company/role. Resend rotates the token generation without extending expiry. Revocation cancels unsent deliveries and purges payloads.

The DB-polled worker validates strict AUTH/TENANT ID-only jobs, reloads scoped references, locks user/company parents, records attempts/60-second fenced leases, sends outside locks, and revalidates before completion. PostgreSQL owns retries (five max, bounded exponential delay), terminal failure, SMTP acceptance and purge. Tenant operation and delivery transitions commit together. Published outboxes remain redispatchable after Redis loss. Queue namespaces derive from the database name, isolating temporary tests. Stable Message-ID mitigates duplicate SMTP delivery; exactly-once SMTP is not claimed. Mailpit API is used only by verification to inspect and remove synthetic messages.

Passed: API/worker image builds; workspace build after repairing a browser Web Locks type annotation; lint; `PHASE2_AUTH_TESTS=1 PHASE2_TENANT_TESTS=1 PHASE2_NOTIFICATION_TESTS=1 pnpm exec vitest run tests/phase2/auth.test.mjs`. The runner requires explicit auth/tenant/notification completion markers. Tests include actual Mailpit team/reset capture, unauthorized/duplicate invitation issuance, new/existing-user acceptance and rejection of account takeover, expiry/revoke/reuse, cross-company worker payload/endpoint denial, invalid job payload rejection, concurrent duplicate processing, SMTP refused connection then recovery, terminal exhaustion, corrupt ciphertext, expired-lease/stale completion, revocation during send, queue obliteration in the isolated namespace followed by DB reconciliation, runtime restart, and separate worker SIGKILL/replacement-process recovery. Synthetic Mailpit messages and isolated DB/queue are removed. Browser and final full-stack gates remain pending.

## API and UI inventory

All routes are prefixed `/api/v1`. JSON mutations require exact Origin and signed CSRF header/cookie. Protected routes additionally require a verified staff Bearer token.

| Routes | Behavior |
|---|---|
| `GET /auth/csrf` | Issue/reuse short-lived CSRF state; no-store |
| `POST /auth/register`, `/auth/login`, `/auth/refresh` | Atomic signup, credential login, rotating cookie session |
| `POST /auth/logout`, `/auth/sessions/:familyId/revoke` | Revoke current/owned session family |
| `GET /auth/me`, `/auth/sessions` | Safe identity and owned active session metadata |
| `POST /auth/reset-request`, `/auth/reset` | Generic reset intent and single-use password change |
| `GET /companies`, `POST /companies` | Authorized workspace list and atomic new workspace |
| `GET /companies/:companyId` | Authorized workspace profile/effective role |
| `POST /companies/:companyId/settings` | Admin name update with revision check |
| `GET /companies/:companyId/members` | Admin team list |
| `POST /companies/:companyId/members/:memberId` | Admin role/status update with last-admin/revision protection |
| `GET /companies/:companyId/invitations`, `POST` same | Safe delivery list; idempotent admin issuance |
| `POST /companies/:companyId/invitations/:id/resend`, `/revoke` | Rotate/cancel invitation and associated deliveries |
| `POST /invitations/accept`, `/invitations/accept-new` | Matching signed-in user or new identity acceptance |

Company/team/invitation lists use bounded 100-row pages and validated `after` UUID cursors; UI offers further pages. No domain record is looked up by a guessed tenant ID without server-side scope validation. Global identity/token lookups are deliberate auth exceptions, not tenant bypasses. Session lists are capped at 100 current families.

React pages: `/register`, `/login`, `/reset-request`, `/reset`, `/accept`, `/workspace`, `/workspace/:companyId`. Forms use React Hook Form and Zod; async state uses TanStack Query, company-prefixed keys and cancellation/cache clearing when switching. Inputs have labels, validation errors and status messages; role-based visibility is UX only. Access tokens stay in memory. Web Locks serialize refresh across supported tabs; older browsers retain per-tab single-flight and can require re-login after a genuine cross-tab replay. Link fragments are removed before rendering. Infrastructure status remains `/` with navigation to auth/workspaces. No recruitment screen or AI workflow is added.

## Final verification history

- Frozen install, workspace build/typecheck/lint and Prisma schema validation passed.
- Default `pnpm test` initially failed the Phase 1 placeholder wording assertion after those modules were implemented. Updated its phase-ownership assertions while retaining all 20 Git-visible boundary checks; rerun passed **21 tests**, with the **2 opt-in integration cases skipped**. They must run separately via `pnpm test:phase2`.
- Both base and development Compose configuration validation passed.
- Registry downloads/DNS temporarily delayed image builds; pinned dependency resolution was retained. No provider/image substitution or security weakening.
- `pnpm db:migrate` applied `20261028000200_auth_schema_version`, setting readiness version 2. The earlier auth schema migration is preserved unchanged after deployment.
- `pnpm audit --json` executed and returned **exit 1: 4 moderate, 0 low/high/critical**. These are the same unsuppressed MinIO-chain advisories as Phase 1. Snapshot: [phase-2-dependency-audit.json](audits/phase-2-dependency-audit.json); rationale remains [phase-1-advisories.md](phase-1-advisories.md). No new dependency advisory was introduced by the resolved Phase 2 packages.

## Remaining production limits

Local Compose SMTP is Mailpit, without deployment SMTP credentials/TLS. HTTPS, production SMTP transport policy, maintained container/Go-image vulnerability assessment, backups/restore, legal/privacy/retention decisions and operational key storage remain release gates. npm audit does not scan containers. No real candidate data is used.

Notification encryption supports one active version, explicitly rejects unknown versions, and never guesses/falls back to another key. Operators must drain/cancel existing encrypted payloads before rotation or resend after safe failure. SMTP may duplicate delivery after a crash; database domain effects remain single-use. Audit retention/purge is a future privileged operational policy; runtime audit UPDATE/DELETE is denied. Authentication rate limits fail closed if Redis is unavailable; committed notifications remain durable. No platform-admin bypass, RLS, email-verification campaign, production deployment or later-phase business feature is claimed.


## Final executed gates and acceptance

| Gate | Result |
|---|---|
| `pnpm install --frozen-lockfile` | PASS |
| `pnpm lint` | PASS on final source |
| `pnpm typecheck` | PASS on final source |
| `pnpm build` and build inside final `pnpm test` | PASS |
| `pnpm test` | PASS: 21 tests; two explicitly opt-in service cases skipped here |
| `pnpm test:phase2` | PASS: five cases across three files, including both opt-in service cases; three security unit cases overlap the default suite. 23 distinct Vitest cases total across the two commands |
| Prisma schema validate/generate | PASS |
| `pnpm db:migrate` | PASS: both Phase 2 migrations applied with migration credentials |
| `node scripts/migrate.mjs --status` | PASS: four migrations, database up to date |
| Isolated PostgreSQL replay of every migration and negative SQLSTATE tests | PASS |
| Base and development `docker compose ... config --quiet` | PASS |
| `docker compose build api worker web` | PASS on final implementation |
| `pnpm test:phase2:e2e` | PASS: one isolated-database browser workflow, including API restart/stopped-worker intent recovery, two-tab refresh, and session revocation |
| `pnpm test:infrastructure` | PASS: all 11 checks, including real data-service restart, private storage and runtime privilege denials |
| `pnpm test:e2e` | PASS: infrastructure browser smoke; Phase 2 test intentionally skipped by this default command and passed separately above |
| `pnpm audit --json` | FAIL/nonzero: four inherited moderate MinIO-chain advisories; no low/high/critical findings; unsuppressed |
| Final `git diff --check`, protected-document byte comparison | PASS |
| Changed-file/current runtime-log secret scan | PASS: 53 changed/new files scanned against configured secret values; API/worker/Nginx logs checked for secrets, token links and synthetic test passwords/hashes |
| Final `docker compose ps -a` | PASS: eight healthy running services, initializer exited 0, only loopback edge 8080 published |

The original browser run failed at acceptance because it proceeded immediately after restarting the API, while the form was still waiting. The harness now polls actual API readiness before resuming. The same workflow then passed, followed by a passing expanded run with simultaneous browser tabs, no localStorage auth data and session-revoke control. No failing assertion was removed. The wrapper restored the normal stack and removed its unique database on each run.

Additional final coverage: validated cursor pagination and malformed cursors; viewer invitation issuance denial; permanent SMTP rejection (550 fixture) fails after one attempt; real refused Redis connection in a separate worker process preserves pending DB intent while independently purging expired ciphertext. Tests never flush shared Redis or delete unrelated mail. The synthetic queue namespace alone is obliterated for queue-loss tests. Argon2id calibration in the final service runner measured **136 ms for one hash** on the local test container; this is a single measurement, not a throughput/load guarantee.

Acceptance checklist:

- [x] Secure atomic company/admin signup, login, rotating/revocable sessions and password reset.
- [x] PostgreSQL-backed replay/race/constraint tests with runtime privilege separation.
- [x] Multi-company identity, independently checked roles, tenant-leading FKs and negative read/write authorization tests.
- [x] Last-active-admin protection and immediate membership-role/removal enforcement.
- [x] CSRF/origin checks, secure cookie policy, account/IP throttles and safe errors/logs.
- [x] Single-use team acceptance for existing/new users, duplicate/expiry/revoke/resend handling and isolation.
- [x] Durable global/tenant notification intent, encrypted short-lived payloads, leases/fencing, bounded retries and terminal purge.
- [x] Actual Mailpit team/reset emails; SMTP failure/recovery, Redis job loss, unavailable-Redis expiry maintenance and worker process restart tests.
- [x] React auth/team/settings/workspace/session controls and required browser workflows.
- [x] Approved architecture and Phase 1 verification history preserved; Phase 3 not started.
- [x] Verification/progress/README updated; no commits or pushes.
- [ ] Dependency audit entirely clean — four inherited moderate findings remain.
- [ ] Independent Phase 2 security audit and explicit owner approval — pending.

No required Phase 2 functional/security check remains unexecuted. Not executed because outside local Phase 2 acceptance: production TLS/real external SMTP, load/soak benchmarks, complete container/Go vulnerability scanning, backup restore, real OpenRouter calls, recruitment/candidate workflows and independent audit. These are not reported as passing. No architectural contradiction required a redesign: the approved Phase 0 remediation explicitly moves foundational team/reset SMTP into Phase 2, while candidate invitation workflows remain Phase 6.

## Changed file groups

- Schema and two explicit migrations under `apps/api/prisma`.
- API auth/security/DTO/guards; company policy/controllers; team invitation services/controllers; global/tenant notification processor/runtime; pagination and safe error response utilities; bootstrap/module wiring and explicit package exports.
- Independent worker lifecycle/readiness wiring; React auth/workspace/team/session forms, API client and routes; shared workspace types.
- Exact package manifests/lockfile and Argon2 build allowlist; Compose auth/encryption settings; non-secret env example and safe setup/migration helpers.
- PostgreSQL/HTTP/security/worker recovery fixtures and Vitest harnesses in `tests/phase2`; isolated Playwright wrapper/spec; updated phase-ownership boundary test.
- README and implemented-module boundary descriptions; progress and this report; actual Phase 2 npm audit snapshot.

**Stop at Phase 2.** The developer PASS covers the local acceptance evidence above and does not close the dependency advisories, approve production, or substitute for the requested independent security-focused audit. Await that audit and explicit owner authorization. No commit, push or Phase 3 work was performed.


## Independent Phase 2 audit and remediation — 2026-10-29

Owner supplied independent **FAIL**: 27 passed, 2 failed, 1 insufficiently verified out of 30 criteria; 0 critical, 2 high, 3 medium. Findings: F01 HIGH expiry starvation; F02 MEDIUM cached-CSRF recovery; F03 MEDIUM rendered/cache retention after denial; F04 HIGH missing reset/session and concurrent-consumption evidence; F05 MEDIUM four inherited MinIO-chain vulnerabilities. This supersedes the historical developer acceptance above. Audit remediation is authorized on the same branch and baseline; existing uncommitted Phase 2 work is preserved. No Phase 0 document changes, commits, pushes or Phase 3 work.

Remediation plan/evidence in progress: independent bounded expiry maintenance and partial indexes; CSRF-specific single renewal on refresh; centralized auth/company invalidation with request-generation fencing; mounted React/query-cache tests and browser checks; concurrent HTTP reset/acceptance/refresh tests with PostgreSQL effects; installed-source/upstream advisory reassessment. Final finding dispositions and command results follow after verification.

### Remediation outcome and exact evidence

**Developer remediation assessment: F01–F04 FIXED and locally verified; F05 UNRESOLVED. Overall unrestricted Phase 2 approval remains FAIL/pending independent re-audit.** No independent PASS is claimed. Working tree remains dirty with the original uncommitted Phase 2 implementation and these remediation changes; branch and HEAD remain as above.

| Finding | Disposition | Implementation and evidence |
|---|---|---|
| F01 HIGH | FIXED | Separate expiry timer and expiry-only batches of at most 100 rows per notification scope. Terminal transitions remove rows from the selection, ensuring forward progress independently of blocked Redis dispatch. Existing parent locks, tenant relationships and lease-generation fencing remain in use. PostgreSQL test creates 101 earlier nonexpired plus 205 later expired deliveries **per scope**, including a SENDING lease. Two worker processes run concurrently with Redis unavailable and dispatch blocked. All 410 expired payloads are purged, 202 nonexpired rows preserved, tenant operations cancelled, generation incremented once and repeated sweeps return zero. |
| F02 MEDIUM | FIXED | Both API mutation and refresh paths renew CSRF only after explicit `403 CSRF_REJECTED`, with exactly one retry. Bootstrap failure, repeated rejection, invalid refresh session and cross-tab replacement are tested. Arbitrary 403/network errors are not replayed; no token storage or backend validation was weakened. Actual browser/backend test observes refresh 403 then 201 with a valid session after replacing the HttpOnly CSRF cookie. |
| F03 MEDIUM | FIXED | Central authorization store cancels/removes sensitive queries on terminal 401 and scopes membership denial to the affected company. Request generations and abort checks fence late responses. Mounted UI immediately reacts to confirmed denial; role polling removes admin-only views/caches. Ten frontend unit cases cover F02/F03 together, including scoped late responses, company switching and temporary failures. Browser test verifies mounted role downgrade, membership removal, unrelated workspace access and external session revocation without reload; network failure retains authorized data. |
| F04 HIGH | FIXED | Real concurrent HTTP requests and PostgreSQL effects prove live access/refresh invalidation by reset, new-password success/old-password failure, exactly one reset consumer/password/audit effect, exactly one invitation consumer/membership/audit effect, replay denial, and reset-versus-refresh family revocation. Successor credentials are checked when refresh wins. Existing rotation, last-admin, tenant and worker recovery cases remain passing. |
| F05 MEDIUM | UNRESOLVED | Four inherited moderate MinIO-chain findings remain unsuppressed. Versions, chains, compatibility and source-level reachability reassessed in [phase-2-advisories.md](phase-2-advisories.md); no safe compatible upstream fix identified. |

Database change: migration `20261028000300_notification_expiry_indexes` adds two partial `(payloadExpiresAt,id)` indexes over unfinished global/tenant deliveries. No new model or privilege changes. All five migrations replay successfully in isolated test databases; designated owner migration command reports no pending migrations on the development database. Runtime DDL remains denied. Existing migrations were not rewritten.

Remediation files (in addition to preserved Phase 2 implementation):

- `apps/api/src/notifications/{notifications,runtime}.ts` and `apps/api/prisma/migrations/20261028000300_notification_expiry_indexes/migration.sql`.
- `apps/web/src/services/{api,authorization,authorization-cache}.ts`, `api.test.ts`, `apps/web/src/features/auth-workspace.tsx`, `apps/web/src/app/main.tsx`.
- `tests/phase2/{expiry-runner,consumption-runner,worker-child,auth-runner,notification-runner}.cjs`, `tests/phase2/auth.test.mjs`, `tests/e2e/phase2.spec.ts`.
- This report, `docs/progress.md`, `docs/phase-2-advisories.md`, `docs/audits/phase-2-remediation-dependency-audit.json`.

| Command / check actually executed | Result |
|---|---|
| `pnpm install --frozen-lockfile` | PASS; lockfile unchanged by remediation. |
| `pnpm lint`; `pnpm typecheck`; `pnpm build` | PASS. Build also rerun by `pnpm test`; harmless upstream Zod annotation warnings remain. |
| `pnpm test` | **31 passed, 2 explicitly skipped** across 10 files. Original 23 cases comprise 21 normal cases and 2 Docker cases; the latter execute separately below. Ten frontend cases added. |
| `pnpm test:phase2` | **5 passed across 3 files**, including the 2 real Docker/PostgreSQL suites and 3 existing security unit cases. Nested HTTP/SQL assertions are not counted as separate Vitest cases. Output confirms F01, F04, authentication, tenant/RBAC and notification recovery PASS markers. |
| `pnpm test:phase2:e2e` | **2 passed**, including existing full signup/email/reset flow and new mounted-workspace security regression. Isolated database removed and normal stack restored. |
| `pnpm test:e2e` | **1 passed, 2 explicitly skipped**; the skipped Phase 2 browser cases passed through the isolated wrapper above. |
| `pnpm test:infrastructure` | **11 PASS checks**: network isolation, HTTP/WebSocket/origin policy, actual services/worker queue, idempotent bucket bootstrap, runtime privilege denial, persistent data and worker heartbeat across restarts, final health. |
| `pnpm db:migrate`; `node scripts/migrate.mjs --status` | PASS; 5 migrations, schema up to date. |
| `docker compose exec -T api pnpm exec prisma validate` | PASS. Initial host invocation failed because DATABASE_URL is intentionally absent from the shell; corrected by executing in the configured API container. No secret was exported or embedded. |
| `docker compose build api worker web` | PASS; remediated images used for integration and browser tests. |
| Base and development `docker compose ... config --quiet` | PASS. |
| `pnpm audit --json` | **FAIL / exit 1**, 4 moderate, 0 low/high/critical; retained snapshot, no suppression. |
| `git diff --check`; protected-document diff review | PASS; approved Phase 0 documents and Phase 1 verification/advisory history unchanged. |
| Configured-secret comparison against changed files and API/worker logs | PASS after excluding the public S3 access identifier. Initial broad scan flagged that identifier in Compose/example env; no secret value was exposed. This bounded scan is not a comprehensive secret detector. |

No functional/security regression test remains failed. Not executed in this local remediation: production TLS/external SMTP, load/soak testing, complete container/Go vulnerability scanning, production backup restore and independent re-audit. These are not counted as passes. SMTP remains at-least-once external delivery: a send accepted before a crash may be duplicated; leases fence database updates, not SMTP side effects. Expiry maintenance requires PostgreSQL and a running worker; batches advance under that availability assumption. UI revocation detection uses five-second polling/request responses, not server push; backend authorization rejects revoked access immediately. Existing rendered data is removed when denial is confirmed, while offline errors alone do not erase authorized state.

Stop at Phase 2. No commit or push. Await independent security re-audit and explicit owner authorization.
