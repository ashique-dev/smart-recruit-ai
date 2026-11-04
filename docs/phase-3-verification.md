# Phase 3 developer verification — history and F08 completion

**Final independent Session 2 result: PHASE 3 PASS.** Owner reports 46 PASS, 0 FAIL and 2 explicitly nonblocking live-provider verification gaps out of 48 requirements; no local acceptance blockers. Git finalization is authorized. See [final acceptance and dependency risk record](audits/phase-3-final-acceptance.md). Earlier FAIL/pending statements below are historical and superseded by this final result.

**Current handoff (2026-11-04):** second independent audit FAIL with F01–F05 confirmed FIXED and F08 blocking. F08 is now locally remediated; independent re-audit pending. See the final F08 section for verification and the changed dependency-advisory status.

**Independent Phase 3 audit: FAIL.** The owner supplied F01–F05 blocking and F06–F07 nonblocking findings (48 reviewed: 24 pass, 4 fail, 20 insufficiently verified). This supersedes the historical local acceptance claims below. Remediation is locally complete with LOCAL PASS; the independent FAIL remains pending re-audit. No independent acceptance is claimed. See [preserved findings](audits/phase-3-independent-findings.md).

Owner explicitly authorized complete Phase 3, deterministic `AI_PROVIDER=mock`, both providers, no real API calls without separate approval, no commits/pushes/merges, then independent audit. Initial Git tree was clean on `phase-3/jobs-rubrics`, HEAD `aed850a472feb21dd8f80e6b4e71bf32c9a3c49a`. Phase 0 specifications and historical audit reports remain unchanged. This report is developer evidence, not an independent audit or production approval.

## Historical implementation evidence (superseded by the remediation section)

## Delivered scope and decisions

- Tenant-scoped jobs, list/detail/edit, archive and all five exact statuses. All mutations use the existing CompanyService transaction boundary: company lock, fresh session/account/membership/company authorization, role check, then mutation and audit. Admin/recruiter writes; viewer reads. List queries use bounded keyset pagination.
- Assumed transition graph: `DRAFT → ACTIVE | ARCHIVED`, `ACTIVE → PAUSED | CLOSED`, `PAUSED → ACTIVE | CLOSED`, `CLOSED → ARCHIVED`, `ARCHIVED →` none. ACTIVE requires an approved rubric matching both current JD hash and reviewed requirements. Archive is the deletion action; no physical job/history delete. Archived jobs are read-only. Other job edits increment revision; changing description in the UI clears reviewed requirements for fresh review. No future interview behavior is implemented.
- Human-reviewed requirements carry stable keys and exact JD quotes/UTF-16 offsets. Manual entry, AI suggestion review, and edits use the same validation. AI suggestions never automatically replace reviewed requirements.
- Relational rubric criteria with stable keys, integer basis-point weights, five explicit 0–4 anchors, evidence requirements, requirement references and order. Drafts may temporarily have weights not totaling 10,000; approval cannot. Approval checks source freshness and revision under the company lock. Approved config and criteria are protected from update/delete by PostgreSQL triggers, including direct runtime SQL. Copying creates a new monotonically allocated version; old approved records remain APPROVED and immutable rather than rewriting them as SUPERSEDED. Future assessments must explicitly pin a version. Current detail exposes the newest 100 versions; full archival browsing beyond that limit is a documented UI limitation.
- Composite foreign keys prevent tenant and job substitution, including rubric → artifact → AI request → operation/job alignment. Runtime cannot update/delete AI input pins or artifacts. Audit is append-only under the inherited runtime permissions.
- Versioned strict Zod contracts generate JSON Schema for `job-analysis` and `rubric-draft`; schema validation is followed by citation, requirement-reference, uniqueness, correlation-ID and weight validation. Other seven workloads remain names only for their later phases. JSONB input/output hashes use canonical key ordering.
- Deterministic mock output is schema-valid and explicitly identified in the UI and usage ledger. Real mode has no fallback to mock, alternate model or unapproved provider. Real provider errors never produce a success artifact.
- OpenRouter gateway is server-only, exact HTTPS endpoint, redirects rejected, no tools/link fetching, bounded input/output, 90-second maximum attempt timeout capped by operation deadline. Explicit permitted provider, no fallback, strict parameters, `data_collection=deny`, and `zdr=true`. Configuration requires model/provider/limits/pricing verification within seven days; no unverified model default. A process configuration change invalidates queued requests rather than silently changing their pins.
- Transactional AI request + existing ProcessingOperation + OutboxEvent + audit. Worker-hosted PostgreSQL polling runs independently of Redis scheduling. ID-only BullMQ payloads; published and unpublished operations are reconciled after queue loss. Company-level reservations and operation lease generations fence duplicate/stale results. External calls run outside DB transactions. Validated artifact, new rubric draft and success status commit atomically. A crash before commit may repeat an external call, but not the domain artifact.
- Four total attempts within a ten-minute operation deadline. Only connection/timeout/429/5xx errors retry with backoff/jitter and bounded Retry-After; invalid output has at most one regeneration within the same cap. Explicit UI retry creates a new audited operation pinned to current job/configuration; old failures remain inspectable. Job revision/status/company changes fence publication.
- One UsageRecord per persisted attempt, including unknown/crashed calls; tokens, model/provider, versions, latency/outcome and returned cost retained. USD cost is decimal. Mock external cost is explicitly zero. Known usage settles token/cost reservations; unknown usage retains the conservative reservation for the UTC day, never an invented zero real cost. Reservations use verified model prices and conservative input-byte/output-token bounds; they are estimates and cannot guarantee an upstream billing ceiling if provider prices/charges differ. Defaults: two calls concurrently per tenant, ten pending operations, 100 calls/day, 1,000,000 tokens/day, USD 10/day reserved/known spend, and 1,000 total jobs/tenant. Environment can lower/raise AI budgets within validation bounds. Unknown-cost reconciliation with provider billing is not implemented; it remains a manual operational step before production.
- React workflows: job creation/edit/status, manual and AI requirements, draft task status/failure/retry, manual/AI rubric editing, explicit approval, and copy approved version to new draft. Polling uses tenant-prefixed query keys and inherited authorization/cache fences. React escapes untrusted text. No browser secrets or persisted recruiting cache. Rubric criteria details expose all anchors and requirement references. Approval stays disabled while an editor is open; saving refreshes authoritative revision before closing the editor.

## Changed files

| Group | Paths |
|---|---|
| Database | `apps/api/prisma/schema.prisma`; migrations `202610290003_phase3_jobs_ai`, `202610290004_phase3_accounting`, `202610290005_phase3_artifact_alignment`, `202610290006_phase3_readiness` |
| API/domain | `apps/api/src/jobs/{jobs.controller.ts,jobs.service.ts,README.md}`; `apps/api/src/app.module.ts` |
| AI/worker | `apps/api/src/ai-gateway/{gateway.ts,runtime.ts,README.md}`; `apps/api/src/usage/README.md`; `apps/worker/src/main.ts` |
| Contracts | `packages/ai-contracts/src/{index.ts,drafting.ts}` and package manifest; shared schema-version constant |
| Frontend | `apps/web/src/features/jobs.tsx`, workspace integration |
| Configuration/tooling | `.env.example`, `docker-compose.yml`, API/root package manifests, minimal lockfile importer additions; `scripts/{phase3-browser,openrouter-preflight,openrouter-smoke}.mjs` |
| Tests/docs | `tests/phase3/*`, `tests/e2e/phase3.spec.ts`, layout ownership assertion; README, this report, progress and dependency audit snapshot |

## API surface

All routes are under `/api/v1/companies/:companyId/jobs`, guarded by authenticated session, current membership/role, and CSRF/origin on mutations. DTOs reject unknown properties.

| Method/path | Behavior |
|---|---|
| GET/POST `/` | List (50 rows, `after` UUID) / create |
| GET/POST `/:id` | Job, recent versions/artifacts/operations / revision-checked edit |
| POST `/:id/status` | Revision-checked guarded transition, including archive |
| POST `/:id/drafts` | New version or editable draft with job/config revisions |
| POST `/:id/rubrics/:configId/approve` | Explicit approval of validated unchanged source |
| POST `/:id/ai` | Enqueue task with UUID idempotency key and current job revision |

AI operation history is bounded to 30 recent records; usage aggregation/dashboard remains Phase 9. No candidate, resume, interview, ranking, or media feature is added.

## Verification evidence

Final command results are recorded below after execution. Tests create synthetic users/jobs only, use explicit mock mode, uniquely named disposable databases and queue prefixes, and restore the normal stack. Test assertions use PostgreSQL SQLSTATE 23514/42501 or Prisma foreign-key code P2003 where the exact failure matters.

- `pnpm install --frozen-lockfile` — PASS. An initial offline install pruned optional platform lock entries; original lock content was restored with only the two new dependency importer entries, and frozen install passed.
- `pnpm build`, `pnpm typecheck`, `pnpm lint` — PASS on the implemented code. Initial frontend enum/default-value typing and a Prisma composite one-to-one uniqueness error were corrected. Exact source whitespace is preserved for citation offsets. The final migration advances runtime schema revision to 4, so new binaries cannot report ready against a partially applied Phase 3 schema.
- `pnpm test` — PASS: 41 tests; three Docker-dependent cases explicitly skipped by default, never represented as passed.
- `pnpm test:phase3` — PASS: 11 tests (ten contract/provider tests plus the real PostgreSQL/HTTP/Redis suite). Covers overlapping memberships, viewer writes, guessed/cross-tenant IDs, cross-tenant and same-tenant cross-job composite FKs, stale revisions, approval races, 9,999 weight rejection, immutable approved data, archive/status guards, duplicate enqueue/worker calls, malformed outputs, four-attempt rate-limit exhaustion, stale job publication, daily budget denial before a call, SIGKILL after persisted attempt, Redis queue loss, outbox replay, UNKNOWN crashed attempt and exactly one artifact.
- `pnpm test:phase3:e2e` — PASS: register → create job → mock analysis → human requirements edit → mock rubric → invalid weight rejection → corrected approval → copy new version → activate → reload persistence. First run detected a stale-revision save/approve race; UI sequencing was fixed and the assertion retained. Subsequent runs passed.
- `pnpm test:phase2` — PASS (5 tests), preserving auth/tenancy/notification/expiry/remediation evidence. Existing module-boundary test was updated to assert Phase 3 ownership for newly implemented modules; no assertion was deleted.
- `docker compose config --quiet` and dev-override equivalent — PASS. Docker initially unavailable; owner started Docker Desktop. Buildx could not write its protected config directory; setting `BUILDX_CONFIG=/tmp/smart-recruit-buildx` fixed the build without changing permissions.
- `BUILDX_CONFIG=/tmp/smart-recruit-buildx docker compose build api worker web` — PASS. `pnpm db:migrate` deployed all four additive migrations using owner-only credentials; existing data is preserved and artifact job IDs are backfilled before NOT NULL enforcement. `docker compose up -d --wait` — PASS, eight healthy running services plus successful initializer.
- `pnpm audit --json` — FAIL (exit 1): four inherited moderate MinIO-chain advisories, no low/high/critical findings. Actual snapshot: [phase-3-dependency-audit.json](audits/phase-3-dependency-audit.json). The existing [Phase 2 assessment](phase-2-advisories.md) remains applicable; no suppression or incompatible transitive replacement.

Live catalog/endpoint checks, paid inference, production privacy/geography/contracts, provider billing reconciliation, production TLS/backups/container scanning and later-phase acceptance are **not executed**. Reading public provider documentation is not model-catalog or live integration verification.

## Secure OpenRouter configuration — separate approval required

**Current local configuration remains `AI_PROVIDER=mock`. No key was requested, exposed in output, or committed. No real OpenRouter API call was made.** Both providers and opt-in tools are ready for review; actual model/provider compatibility remains unverified until approval. Do not put the key in chat, shell command arguments, `VITE_*`, source code, or tracked files.

Create an ignored local `.env.openrouter.local` using a private editor and restrict it to mode 0600. This is the exact variable set; replace bracketed values only after choosing and authorizing actual routes (they are not working defaults):

```dotenv
AI_PROVIDER=openrouter
OPENROUTER_API_KEY=<your-key-entered-only-in-the-private-file>
OPENROUTER_BASE_URL=https://openrouter.ai/api/v1
AI_MODEL_JOB_ANALYSIS=<verified-model-id>
AI_MODEL_RUBRIC_DRAFT=<verified-model-id>
AI_PROVIDER_JOB_ANALYSIS=<exact-approved-catalog-provider-name>
AI_PROVIDER_RUBRIC_DRAFT=<exact-approved-catalog-provider-name>
AI_TIMEOUT_MS=90000
AI_COMPANY_CONCURRENCY=1
AI_DAILY_CALL_LIMIT=10
AI_DAILY_TOKEN_BUDGET=100000
AI_DAILY_COST_BUDGET_USD=2
```

The two `AI_PROVIDER_*` task variables are preflight inputs. Runtime provider allowlists come from `AI_ROUTE_MANIFEST`, passed only to API/worker. After explicit approval for catalog requests, run:

```sh
chmod 600 .env.openrouter.local
node --env-file=.env.openrouter.local scripts/openrouter-preflight.mjs --approved-catalog
```

Preflight makes authenticated read-only catalog calls (no inference), requires exact model/provider, strict structured outputs, supported token limits/pricing, and exact endpoint identity in the ZDR catalog. It writes the ignored mode-0600 `.env.openrouter.routes`. Incomplete or changed catalog metadata fails closed and requires review; this path is intentionally unverified without approval. A successful manifest must have this shape, with **actual** values for both task entries:

```json
{
  "job-analysis": {
    "model": "<verified model>", "provider": "<approved provider>",
    "contextTokens": 32768, "maxOutputTokens": 4096,
    "inputCostPerMillion": 0, "outputCostPerMillion": 0,
    "structuredOutputs": true, "zdr": true,
    "verifiedAt": "<actual ISO UTC verification time>"
  },
  "rubric-draft": { "...": "same required fields, actual verified values" }
}
```

The example numbers are shape illustrations, **not verified limits or prices**. Never set zero pricing merely because price is unknown. Real-mode startup rejects absent/inconsistent/stale manifests. Privacy controls follow OpenRouter's [provider routing documentation](https://github.com/OpenRouterTeam/docs/blob/main/guides/routing/provider-selection.mdx); catalog sources are the [models API documentation](https://openrouter.ai/docs/api/api-reference/models/get-models) and endpoint/ZDR catalogs. Provider privacy and geographic suitability still require owner review; do not infer legal compliance or guaranteed external deletion.

After separate approval for two paid synthetic inference calls:

```sh
node --env-file=.env.openrouter.local --env-file=.env.openrouter.routes scripts/openrouter-smoke.mjs --approved-live
```

This standalone gateway smoke calls each Phase 3 contract once, without retries or candidate data; it does not create application jobs or change the running stack. Application usage/recovery is tested through the normal worker path. Only after approval to enable the application route:

```sh
docker compose --env-file .env --env-file .env.openrouter.local --env-file .env.openrouter.routes up -d --no-deps --force-recreate --wait api worker
```

Restore mock application mode with ordinary `docker compose up -d --no-deps --force-recreate --wait api worker`, because the base `.env` stays mock. Do not print expanded Compose configuration with a real key loaded. Configured API keys are runtime environment secrets visible to authorized host/container operators; use a production secret manager before deployment.

### Dated route matrix (2026-10-29)

| Task | Mock | Live model/provider/limits/prices/privacy compatibility |
|---|---|---|
| job-analysis | deterministic-mock-v1; validated | NOT VERIFIED; no permitted real route selected or catalog request authorized |
| rubric-draft | deterministic-mock-v1; validated | NOT VERIFIED; no permitted real route selected or catalog request authorized |

## Acceptance and remaining concerns

Local Phase 3 functional/security acceptance applies to mock mode and simulated real-provider failures, with the final verification below complete and independent audit pending. Real integration acceptance is **pending explicit approval**, not a reported pass. Four inherited moderate advisories remain unresolved. Approved history is preserved; the current UI shows only the latest 100 rubric versions and 30 operations/artifacts. Unknown provider billing needs manual reconciliation; cost reservations are conservative admission control, not a guaranteed billing limit. These limitations and all production/provider policy gates must be reviewed before release.

Stop at Phase 3. No commit, push, merge, independent audit result, or authorization for Phase 4 is claimed.


## Final verification and handoff

Final runtime source, images and migrations were rechecked after citation preservation, usage accounting, job/artifact alignment and readiness changes. `pnpm build`, `pnpm typecheck`, `pnpm lint`, frozen install, both Compose configurations, container builds, and whitespace checks passed. Default Vitest: **41 passed / 3 explicit service skips**. Phase 3: **11 passed**. Phase 2: **5 passed**. These suites overlap; counts must not be added as distinct tests. All three real-service cases skipped by default were run through the explicit Phase 2/3 commands.

`pnpm test:phase3:e2e`: **1 passed** on final images. `pnpm test:phase2:e2e`: **2 passed**, including mounted authorization/CSRF/session regressions. `pnpm test:infrastructure`: **11 named checks passed**, including restart persistence and runtime privilege denial. `pnpm test:e2e`: infrastructure browser **1 passed / 3 explicit phase-specific skips**; the phase-specific browser cases passed through their isolated wrappers.

`node scripts/migrate.mjs --status`: nine migrations, database up to date. `docker compose run --rm --no-deps api pnpm exec prisma validate`: PASS. Four Phase 3 migrations are applied; the final runtime schema revision is 4. Final inventory: eight healthy running services, initializer exited successfully, and no generated `phase3_%` database remains. Base mock configuration was restored after isolated browser tests.

`node /tmp/phase3-final-scan.mjs`: PASS for mock mode in `.env` and both running containers, configured-secret absence in API/worker logs, no OpenRouter key configuration in browser bundles, and byte-for-byte preservation of the eight protected specification/design documents. The temporary script compared secrets privately and printed only a safe summary. `git diff --check` and a separate new-file whitespace/document-link check passed. The preflight/smoke commands without their approval flags were exercised and rejected before network access, as intended.

**Acceptance: local mock-mode Phase 3 criteria met; independent audit pending.** The paid/live catalog, model/provider compatibility, policy and smoke gates remain **unverified pending explicit owner approval**. The dependency audit remains FAIL for four inherited moderate advisories; this is not an all-dependencies-clear or production-release claim. No functional test is left failing. No commit, push, merge, real API call, or next-phase implementation occurred. Stop for independent Phase 3 audit.

## Audit remediation — current evidence, 2026-10-29

The preceding implementation report and its original acceptance claims are historical. The independent audit returned **FAIL**; its supplied findings are preserved in [the audit record](audits/phase-3-independent-findings.md). This section describes subsequent developer remediation. It does not replace the independent result or claim Session 2 execution.

### Remediation matrix

| Finding | Root cause | Changed files | Fix and direct evidence | Local result |
| --- | --- | --- | --- | --- |
| F01 | Polling advanced the expected revision while local criteria remained stale. | `apps/web/src/features/jobs.tsx`; `tests/e2e/phase3.spec.ts`; `tests/phase3/audit-runner.cjs` | Editor captures a cloned job/configuration snapshot on open. Saves retain those revisions. A 409 preserves edits, displays conflict and disables resubmission until explicit discard/reload/review. Mounted A/B editors verify B saves revision 2, A polls revision 2 but submits revision 1, is rejected, retains edits, sees conflict, and intentionally reloads. Real HTTP/database test verifies B's criteria survive. | FIXED, tests passed |
| F02 | Details exposed only the latest 100 versions, without historical retrieval. | `apps/api/src/jobs/jobs.controller.ts`, `jobs.service.ts`; `apps/web/src/features/jobs.tsx`; audit runner/browser tests | Tenant/job-scoped history uses 50-item descending version keyset pages, plus immutable UUID lookup. Existing details remain compatible. Tests create 101 versions, retrieve pages of 50/50/1 and compare oldest criteria and metadata; validate boundaries, identifiers, permissions and cross-tenant denial. Mounted UI navigates to the oldest version. | FIXED, tests passed |
| F03 | Revision checks alone could not replay a committed approval after response loss. | Jobs controller/service; Prisma schema and migration `202610290007_phase3_audit_remediation`; jobs UI; audit runner | Required UUID key scoped to company/job/configuration, canonical request hash and original result stored atomically with approval/audit under the existing authorization/locking transaction. Database uniqueness and append-only runtime permissions enforce durability. Identical concurrent commands/retries replay; conflicting payload rejects. Tests include lost response, cross-company key reuse, downgraded/revoked retries and exactly one audit/command. | FIXED, tests passed |
| F04 | Adapter and ledger discarded cache counters and generation identity. | `apps/api/src/ai-gateway/gateway.ts`, `runtime.ts`; Prisma schema/migration; `packages/shared/src/index.ts`; contract/audit tests | Independently validate optional cache-read/write counters and generation ID; preserve null versus zero and metadata validity. Persist per attempt on success, invalid output and provider error. Settlement uses a tenant-scoped compare-and-set, preventing duplicate settlement. Tests cover malformed/missing/zero metadata, both counters, attribution, retries and duplicate delivery. | FIXED, tests passed |
| F05 | Sequential checks did not establish overlap or recovery guarantees. | `tests/phase3/audit-runner.cjs`, `audit-integration.test.mjs`, `completed-child.cjs`; contract/original runner updates; mounted browser tests; verification scripts | 17 additional real-service scenarios plus mounted browser coverage. Company-lock barriers verify actual PostgreSQL lock waiters before releasing races; provider barriers hold parallel reservations/completions. Real BullMQ duplicate delivery, SIGKILL after completion before publication, Redis transport outage/reconnect, lease replacement, and duplicate settlement are exercised. Existing crash-after-attempt and terminal-exhaustion tests also rerun. | VERIFIED locally; independent re-audit pending |
| F06 | Inherited MinIO dependency chain advisories. | Existing risk record preserved; fresh audit log retained. | Four moderate advisories remain under the owner's existing local risk decision; no storage-processing change or incompatible dependency upgrade. | NONBLOCKING, unresolved |
| F07 | Real provider/model/privacy compatibility has not been exercised live. | Existing secure configuration instructions preserved. | Local and container `AI_PROVIDER=mock`; deterministic transport doubles only. No paid/live request executed. | NONBLOCKING for local acceptance; LIVE UNVERIFIED |

### Database and API details

Migration `202610290007_phase3_audit_remediation` preserves existing usage rows, adds nullable cache counters, provider generation ID and settlement marker, with metadata status defaulting to UNKNOWN. Existing terminal usage rows receive their creation time as a historical settlement marker, not a claim about actual completion time. Cache counters have nonnegative checks. The approval command table has composite tenant/resource foreign keys and a unique `(companyId, jobId, configId, idempotencyKey)` constraint. Runtime UPDATE/DELETE are revoked on command records. Authorization runs before replay lookup on every retry. Migration/schema readiness is now version 5 (ten migrations total).

New read endpoints are `GET /companies/:companyId/jobs/:id/rubrics?before=<positive version>` (50 items, `nextBefore`) and `GET /companies/:companyId/jobs/:id/rubrics/:configId` (UUID). Historical versions remain immutable. Approval requires `{revision, idempotencyKey}`; frontend retains the key for the same command after response failure. A reused key with a changed revision fails rather than approving again.

OpenRouter's documented chat-completions fields `usage.prompt_tokens_details.cached_tokens`, `usage.prompt_tokens_details.cache_write_tokens`, and top-level generation `id` are preserved when individually valid. Malformed optional metadata becomes unknown without storing response bodies or losing other valid counters. Cache counts are subsets/details of prompt accounting; they are **not added** to prompt tokens or independently priced. Only provider-reported cost is settled. See the primary [prompt caching contract](https://github.com/OpenRouterTeam/docs/blob/main/guides/best-practices/prompt-caching.mdx), [usage accounting contract](https://github.com/OpenRouterTeam/docs/blob/main/cookbook/administration/usage-accounting.mdx), and [response overview](https://github.com/OpenRouterTeam/docs/blob/main/api_reference/overview.mdx). Documentation review is not live integration verification.

### Evidence and reproduction

Fresh developer execution is captured in [commands.json](audits/phase-3-remediation-evidence/run-2026-10-29T09-31-06.582Z/commands.json) with exact commands, timestamps, exit codes, image identities and source fingerprints. Individual command logs are beside it. [Integration evidence](audits/phase-3-remediation-evidence/integration.json) identifies the disposable database `phase3_audit_2e2eb16cdba140febf21edde3b9e7a6b`, named test container, image and all 17 audit scenarios. Browser wrapper logs identify their separate disposable databases and source fingerprint. These tests were executed during remediation; no independent auditor execution is asserted.

Tested source fingerprint: `357d96b662409ce6be31a2637b3b512bf627d27d7b7186e141558640b47617dc` (153 Git-visible non-Markdown/non-docs files). Documentation and logs are excluded to avoid a self-changing evidence hash. Baseline/HEAD remains `aed850a472feb21dd8f80e6b4e71bf32c9a3c49a`, branch `phase-3/jobs-rubrics`. PostgreSQL image `postgres:16-alpine` is `sha256:44c4ee9810eff91f7eab4d822642e01115b1a9eccce4bcbdde7604752d68eac6`; Redis image `redis:7-alpine` is `sha256:ff02b58f971e7d7d156a1267e283fcbbeee91773b6aa36c49dac28ecfe28eadf`.

Reproduce on an authorized disposable local stack with private `.env` configured as described in README and `AI_PROVIDER=mock`: run `pnpm install --frozen-lockfile`, `pnpm build`, `BUILDX_CONFIG=/tmp/smart-recruit-buildx docker compose build api worker web`, `pnpm db:migrate`, and `docker compose up -d --wait`. Then run `node scripts/phase3-remediation-verify.mjs`. The integration suites create/drop their own databases; browser wrappers temporarily select a disposable database and restore the base stack. The infrastructure check restarts local dependencies, so do not run this workflow against production or shared active workloads. Focused commands are `pnpm test:phase3` and `pnpm test:phase3:e2e`; explicit opt-in enables service/browser tests skipped by the default suites.

Two intermediate verification failures were repaired before the final run: a failed migration-generation command had appended error text into the new migration (removed before base deployment; disposable migration tests rerun), and the Redis outage harness initially closed its proxy before BullMQ became ready (added readiness synchronization and deterministic socket teardown). Neither failure was suppressed by removing assertions. The final results below supersede those intermediate failures.

### Final remediation verification results

| Exact command | Exit | Result |
| --- | --- | --- |
| `pnpm install --frozen-lockfile` | 0 | Lockfile/install passed |
| `pnpm lint` | 0 | Passed |
| `pnpm typecheck` | 0 | Passed |
| `pnpm build` | 0 | All workspace builds passed |
| `pnpm exec vitest run` | 0 | 42 passed, 4 explicit service skips |
| `pnpm test:phase3` | 0 | 13 passed, no skips; includes 11 contracts and 2 real-service suites, one containing 17 audit scenarios |
| `pnpm test:phase2` | 0 | 5 passed, no skips |
| `pnpm test:phase3:e2e` | 0 | 3 passed, no skips |
| `pnpm test:phase2:e2e` | 0 | 2 passed, no skips |
| `pnpm test:infrastructure` | 0 | 11 named checks passed, including restart persistence and privilege denial |
| `pnpm test:e2e` | 0 | 1 passed, 5 explicit phase-specific skips |
| `docker compose run --rm --no-deps api pnpm exec prisma validate` | 0 | Valid schema |
| `node scripts/migrate.mjs --status` | 0 | Ten migrations, database up to date |
| `docker compose config --quiet` | 0 | Valid production/local Compose |
| `docker compose -f docker-compose.yml -f docker-compose.dev.yml config --quiet` | 0 | Valid development Compose |
| `pnpm audit --json` | 1 | Four moderate inherited advisories; zero high/critical, existing F06 risk decision applies |
| `node scripts/phase3-security-check.mjs` | 0 | Mock mode in file/API/worker, configured-secret/log/browser checks, no secret environment files tracked, protected specs byte-identical to HEAD |
| `git diff --check` | 0 | Passed |

Counts overlap and must not be added as distinct tests. All default service/browser skips were executed using the opt-in Phase 2/3 commands. No targeted remediation test remains skipped or failing. Real OpenRouter requests were **not executed**. The final run lasted 09:31:06–09:35:14 UTC on 2026-10-29. Final inventory: eight healthy running services and initializer exited zero; a separate SQL check found no `phase3_%` database remaining. A full Git inventory is saved beside the command evidence in `git-state.txt`; existing Phase 3 changes remain uncommitted.

**PHASE 3 REMEDIATION: LOCAL PASS.** F01–F05 are remediated and verified locally. Independent acceptance remains pending Session 2 re-audit. Real provider/model compatibility, external privacy/policy gates, unknown billing reconciliation and production deployment remain unverified; unknown costs retain conservative reservations. Four inherited dependency advisories remain unresolved under the owner's local exception. The secure live configuration section above still applies and requires separate approval before any provider request. No commit, push, merge, paid call or Phase 4 work occurred. Stop for independent re-audit.

## F08 remediation — 2026-10-29 implementation; 2026-11-04 verification completion

The owner reports the second independent audit returned **PHASE 3: FAIL**, confirming F01–F05 FIXED, F06/F07 nonblocking, and identifying one remaining blocker: **F08 — creating a new job retains the previous job's rubric editor**. The auditor reproduced a save to Job A while Job B was selected. Earlier findings and developer reports above remain historical evidence. This section records developer remediation, not independent acceptance.

### Root cause and fix

`New job` cleared the selection but retained the editor snapshot. Creation success selected B without clearing A's editor. Rendering checked only editor presence/write access, and save targeted the snapshot's job ID.

`apps/web/src/features/jobs.tsx` now clears editor state and history position through a common selection helper for New Job, creation success, and job selection. This follows the existing navigation convention of discarding unsaved local edits when leaving a job; it neither saves nor transfers them. Rendering requires the editor's job ID to match the selection. Immediately before save, a current ownership reference checks the job, editing session and write permission. Archive/role downgrade clears the editor; existing company-keyed unmount and membership revocation handling remain intact. Unmount invalidates ownership. Late conflict-reload responses can replace only their still-active editor, and a completed save can close only the session that submitted it.

F01 remains unchanged: editor-open job/configuration revision snapshots survive polling, stale saves return 409, unsaved criteria remain visible, and explicit reload is required before another save. No automatic revision replacement/retry was introduced. No backend, schema, shared workspace navigation, provider, or approved Phase 0 document changed for F08.

### Regression coverage and changed files

- `apps/web/src/features/jobs.tsx`: editor ownership and navigation guards.
- `tests/e2e/phase3.spec.ts`: exact dirty-A → New Job → create/select-B regression, ordinary A → B switching, actual B saves with URL/config/revision assertions, persisted A/B rubric checks, delayed A conflict reload after opening B, and archive while editing. The existing F01 concurrent-editor test is rerun unchanged. Authorization coverage additionally observes draft requests and persisted criteria and opens a dirty editor before workspace switching with an in-flight response.
- `docs/phase-3-verification.md`, `docs/progress.md`: current result and preserved audit history.
- `docs/audits/phase-3-f08-evidence/` and dated verification logs: reproducible harnesses and execution evidence. The Phase 2 isolation wrapper is a copy of the existing wrapper with a dedicated authenticated Redis container; application rate limits and test assertions are unchanged.

Browser tests use real PostgreSQL-backed APIs and deterministic mock AI. They verify no draft POST occurs during creation/navigation, A's persisted rubric is unchanged, B initially has no versions, subsequent saves target B's actual job/configuration, and a late A reload cannot restore A's editor. Database state is checked through the application API, not inferred from button visibility.

### Evidence and verification history

Source SHA-256: `0e0811d877351bda52dbc4be14443438c0659324ada9692c7e31bd4a77e1dd20` (153 Git-visible non-Markdown/non-docs paths and contents). The fingerprint is unchanged across implementation verification and resumed completion. Branch remains `phase-3/jobs-rubrics`; HEAD remains `aed850a472feb21dd8f80e6b4e71bf32c9a3c49a`.

[Initial command evidence](audits/phase-3-remediation-evidence/run-2026-10-29T15-06-26.368Z/commands.json) contains exact commands/exits, timestamps, source fingerprint and image identities. Phase 3 browser results are in its `08-pnpm.log`; the separate [browser evidence manifest](audits/phase-3-f08-evidence/handoff.json) also passed all four cases. [Completion evidence](audits/phase-3-f08-evidence/remaining-commands.json) records the resumed checks. [Integration evidence](audits/phase-3-f08-evidence/integration.json) records all 17 audit scenarios and disposable database/container identity. The pre-F08 integration evidence is preserved at its historical path and as `integration-before-f08.json`.

The first `pnpm test:phase2:e2e` run exited 1 (one passed, one stale-CSRF refresh timeout). The unchanged rerun exited 1 (two failed, including explicit HTTP 429 registration); Redis inspection found shared IP counters of 61 and 63 against the existing limit of 60. Both failures are retained. A first disposable Redis setup was rejected at startup because it lacked authentication; this was corrected with a private generated password, without weakening application configuration validation. After resuming on November 4, verification uses the dedicated Redis instance and disposable PostgreSQL database. No rate-limit keys were deleted and no rate limits or security assertions were relaxed.

| Exact command | Exit | Result |
| --- | --- | --- |
| `pnpm install --frozen-lockfile` | 0 | Passed |
| `pnpm lint` | 0 | Passed; rerun after adding evidence harnesses also passed |
| `pnpm typecheck` | 0 | Passed |
| `pnpm build` | 0 | Passed |
| `BUILDX_CONFIG=/tmp/smart-recruit-buildx docker compose build web` | 0 | Updated browser image built |
| `pnpm exec vitest run` | 0 | 42 passed; 4 opt-in service skips |
| `pnpm test:phase3` | 0 | 13 passed, including 17 additional real-service audit scenarios; no skips |
| `pnpm test:phase2` | 0 | 5 passed; no skips |
| `pnpm test:phase3:e2e` | 0 | 4 passed, including F08 and F01; no skips (two successful runs) |
| `pnpm test:phase2:e2e` | 1 | Initial 1 passed/1 failed; shared-Redis rerun 0 passed/2 failed; preserved above |
| `node docs/audits/phase-3-f08-evidence/phase2-isolated-browser.mjs` | 0 | Same Phase 2 browser tests/assertions: 2 passed, no skips, with disposable authenticated Redis |
| `pnpm test:infrastructure` | 0 | 11 checks passed |
| `pnpm test:e2e` | 0 | 1 passed; 6 opt-in phase-specific skips |
| `docker compose run --rm --no-deps api pnpm exec prisma validate` | 0 | Schema valid |
| `node scripts/migrate.mjs --status` | 0 | Ten migrations; up to date |
| `docker compose config --quiet` | 0 | Passed |
| `docker compose -f docker-compose.yml -f docker-compose.dev.yml config --quiet` | 0 | Passed |
| `pnpm audit --json` | 1 | November 4: 5 moderate, 1 high, 0 critical; see changed advisory status below |
| `node scripts/phase3-security-check.mjs` | 0 | Mock mode, configured-secret/log/browser checks, environment tracking, protected specifications passed |
| `git diff --check` | 0 | Passed |

Suite counts overlap. Every default opt-in skip was exercised in the explicit service/browser runs. Phase 2's normal wrapper retains shared-Redis interference risk when repeatedly running authentication-heavy suites within its 15-minute rate-limit window; use the retained isolated wrapper to reproduce the passing run. No assertion was removed or timeout increased. The November 4 completion run restored eight healthy services, with initializer exited successfully. A separate SQL check found no `phase3_%` or `phase2_browser_%` databases remaining; the temporary Redis container was removed. Source fingerprint remained identical. The saved October results are not misrepresented as fresh November execution or independent audit execution.

### Remaining findings and decision

F01–F05 remain confirmed fixed by the reported second independent audit, with their regression suites passing on the F08 source. F08 is locally fixed and tested. F07 remains unverified: `AI_PROVIDER=mock`, no live/paid OpenRouter calls. The original four moderate F06 advisories and their prior risk decision remain historical evidence.

**Dependency status changed during the pause:** the November 4 audit additionally reports high-severity [GHSA-qr28-fpjm-wq7f](https://github.com/advisories/GHSA-qr28-fpjm-wq7f) in `minio → query-string → decode-uri-component@0.2.2`, and moderate [GHSA-g3hv-75wg-m249](https://github.com/advisories/GHSA-g3hv-75wg-m249) in development tooling `eslint → minimatch@10.2.6`. Local inspection finds MinIO using `query-string.stringify` in its client/helpers; this focused inspection is not a comprehensive proof of non-reachability. F08 introduces no storage processing or dependency change. The earlier acceptance of four moderate advisories does **not** imply acceptance of these additional findings; they require separate dependency/security review before broader release approval. No incompatible upgrades or advisory suppression were introduced.

**PHASE 3 F08 REMEDIATION: LOCAL PASS** applies to the editor fix and executed regressions, not overall dependency clearance, production readiness or independent acceptance. Branch/HEAD remain unchanged. No commit, push, merge, Phase 4 work, paid API call or Phase 0 architecture modification occurred. Stop for independent re-audit.
