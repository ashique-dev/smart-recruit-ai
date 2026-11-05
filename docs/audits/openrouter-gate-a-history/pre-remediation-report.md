# OpenRouter Gate A — verification harness

## Decision and scope

**GATE A READY FOR INDEPENDENT AUDIT.** Local developer verification only. Baseline `84c90acfca3f4655698a5f708e0394581e56efc9`, branch `verification/openrouter-live`. No business logic, schema, dependency lockfile, or protected architecture specification changed. No real OpenRouter inference or authenticated catalog request ran. No commit, push, merge, or Phase 4 work.

The harness deliberately supports **synthetic execution only**. It runs the application's `openrouter` gateway branch with a controlled transport; it does not select mock mode. Catalog discovery, live transport enablement, approved model/pricing, and independently retrieved billing evidence remain later gates. Do not interpret this report as live integration acceptance.

Machine-readable evidence, source hashes, image identity, per-attempt accounting, and reconciliation: [openrouter-gate-a-evidence.json](audits/openrouter-gate-a-evidence.json).

## Files

- `scripts/openrouter-verification/run.mjs`: isolated environment lifecycle and explicit counter initialization.
- `scripts/openrouter-verification/limit.mjs`: durable transport-boundary admission and read-only counter inspection.
- `scripts/openrouter-verification/workflow.mjs`: authenticated HTTP workflow, persistence, tenant denial, failure, stale-lease and crash tests.
- `scripts/openrouter-verification/crash-child.mjs`: separate worker process killed after response but before publication.
- `scripts/openrouter-verification/fixture.mjs`: hand-authored synthetic responses and designated provider-mode guard.
- `scripts/openrouter-verification/evidence.mjs`: allowlisted projections, unknown preservation and reconciliation.
- `scripts/openrouter-verification/reconcile.mjs`: offline reconciliation CLI.
- `tests/openrouter/verification.test.mjs`, `tests/openrouter/counter-child.mjs`: six focused tests including concurrent and restarted processes.
- `.gitignore`, `.dockerignore`: exclude `.verification` state/evidence from Git and Docker build context.
- This report, its evidence JSON, and `docs/progress.md`.

## Isolation and execution path

The launcher never reads the development `.env`, inherited database URLs, or real provider credentials. It creates a unique internal Docker network, separate PostgreSQL and authenticated Redis containers, a new `openrouter_verification` database, and generated synthetic authentication keys. No ports are published. The Nest API binds to `127.0.0.1` inside its container. Global `fetch` permits only loopback HTTP. The network has no outbound route. Storage/SMTP configuration points to an unused loopback port; those adapters are not exercised.

Only the verification scripts (read-only) and this run's private evidence/counter directory are mounted. The application image is resolved to an immutable image ID. No development network, application environment, database volume, or Docker socket is mounted. SQL migrations run as the disposable database owner; the API/processor uses the restricted `smart_recruit_runtime` role. Tests verify the expected host/database name, empty database/Redis, runtime role and lack of database CREATE privilege. Cleanup removes the unique containers, anonymous volumes and network, but retains the send ledger. A force-killed launcher may require manual cleanup of its uniquely named `orverify-*` containers; it cannot reconnect them to normal jobs.

The acceptance path is:

1. HTTP CSRF acquisition and `POST /api/v1/auth/register` create two synthetic users/companies through the application.
2. Authenticated `POST /api/v1/companies/:companyId/jobs` creates the job. Missing auth and foreign tenant access are denied.
3. Authenticated `POST .../jobs/:jobId/ai` calls `JobsService.request`, retaining its authorization, revision, idempotency, `AiRequest`, `ProcessingOperation`, and outbox transaction.
4. The harness explicitly calls the same `AiProcessor.process` used by the worker. It does not start `AiRuntime`, BullMQ consumers, notification workers, or automatic polling.
5. The processor reserves a usage attempt and invokes the real `AiGateway.execute` OpenRouter branch. The injected transport consumes the durable allowance before invoking the synthetic provider callback. Gateway JSON/schema/citation/model/provider checks run unchanged.
6. The processor settles usage and publishes artifacts transactionally. The test reads them through the API and checks the database rows.
7. It reviews the analysis against the expected source quotation, saves its requirements through authenticated job update, and requests/processes rubric drafting. The persisted draft, criterion weights and usage are checked.
8. Foreign-tenant reads/writes and mismatched tenant/operation processing are rejected. Duplicate submissions/deliveries produce only one operation, artifact and send.

This exercises the actual processor path, not a replacement processor. Queue dispatch itself is covered by existing Phase 3 regression tests; the new acceptance run deliberately avoids background dispatch.

## Durable request limit

Each explicitly initialized run has an independent local SQLite ledger outside PostgreSQL. Initialization uses exclusive `wx` creation and refuses existing files; execution never initializes, truncates or deletes a ledger. Named runs require a separate explicit initialization action. Ordinary relaunch of a partially or fully consumed run is rejected before Docker resources are started. A new run name is not an implicit reset: an uninitialized name fails.

At the actual gateway transport boundary, `BEGIN IMMEDIATE` serializes contenders. The transaction validates the ledger, checks the count, and inserts a unique ordinal (1 or 2), task and operation ID. `synchronous=FULL` and COMMIT complete **before** the callback can send. There is at most one send per task as well as two per run. Failures, interruption, timeout, and crashes after commit never refund slots. Missing, corrupt or unwritable stores fail closed. A counter denial becomes terminal `AiFailure('VERIFICATION_SEND_DENIED')` in the processor, without changing application code.

Twelve independent concurrent processes accepted exactly two sends. Separate process restarts observed earlier consumption. A real SIGKILL after synthetic response left the usage row unknown and its slot consumed; recovery could not resend. Third-send rejection, store-update failure, missing/corrupt stores, duplicate operations and reinitialization refusal were verified.

Failure scenarios use separately initialized **synthetic test ledgers** and never make network sends. They are not additional live allowances. Do not reuse their test initialization mechanism as a paid retry facility. There is no live mode in this gate.

This is a request-count control, **not a monetary cap**. It assumes a trusted operator, unchanged reviewed harness and a durable local filesystem. A privileged operator can delete/replace files or deliberately initialize a different run. Billing after a real timeout would still require independent reconciliation. Power-loss/filesystem failure behavior was not physically tested.

## Accounting and reconciliation

Evidence projects only operation/request IDs, attempt, generation ID, provider/model, input/output/cache counters, costs, outcome, usage metadata status and settlement. Unknown values remain `null`, not zero. Raw responses, errors, prompts, headers, cookies and connection strings are excluded. Known secrets and synthetic error sentinels are checked against serialized evidence before the final report is printed.

The two successful synthetic attempts each report 100 input tokens, 50 output tokens, zero cache-read tokens, five cache-write tokens and USD 0.001. Both persisted records reconcile to separately constructed generation fixtures: two MATCH results and USD 0.002 on each side. These are **fixture values, not actual charges**; external cost was zero.

Reconciliation detects mismatches, missing IDs/counters/costs, duplicate generation identity, unsettled rows and unmatched provider rows. Known-cost totals use integer decimal units; unknown counts are reported separately. Tests also cover missing usage, missing generation ID, malformed numeric fields and credential/error exclusion.

`reconcile.mjs` reads an application-row array and an independently acquired, normalized generation-row array. The latter fields are `providerGenerationId`, `provider`, `model`, `inputTokens`, `outputTokens`, `cacheReadTokens`, `cacheWriteTokens`, `providerReportedCost`. Absent fields must stay null. It exits 0 for complete matches, 2 for incomplete/mismatched reconciliation, and 1 for invalid input. Input objects are re-projected before output; arbitrary additional properties are discarded.

For Gate C, retrieve generation data independently under separate approval and normalize documented provider fields into that format. The CLI performs no retrieval. `independent-provider-generation` is a declared provenance label, not proof that data was independently fetched. Do not relabel synthetic fixtures as live evidence. Missing provider metadata must remain an unverified reconciliation item.

## Actual verification

| Command/check | Result |
|---|---|
| `pnpm lint` | PASS, including new scripts/tests |
| `pnpm typecheck` | PASS, existing TypeScript workspace; verification JS is covered by lint and runtime tests |
| `pnpm build` | PASS |
| `docker build -f apps/api/Dockerfile --target runtime -t smart-recruit-openrouter-verification .` | Initially blocked by read-only Buildx activity directory |
| Same build with `DOCKER_BUILDKIT=0` | PASS; fresh verification-only image, unchanged lockfile |
| `pnpm test:phase2` | 5 passed |
| `pnpm test:phase3` | 13 passed, including 17 audit scenarios; historical tracked integration evidence backed up/restored |
| `pnpm exec vitest run tests/openrouter/verification.test.mjs` | 6 passed |
| `AI_PROVIDER=mock pnpm exec vitest run` | 48 passed, 4 opt-in service tests skipped in default invocation; all four executed in explicit Phase 2/3 suites |
| `node scripts/openrouter-verification/run.mjs --initialize-synthetic-counter gate-a-final-verified` | PASS |
| `node scripts/openrouter-verification/run.mjs --synthetic gate-a-final-verified` | PASS: full workflow and all requested failure cases |
| Same run relaunch and same initialization repeated | Expected exit 1, counter unchanged at 2 |
| `--live` and `--approved-catalog` supplied to the new launcher | Expected exit 1; unsupported modes |
| Offline reconciliation of final application/generation files | PASS, two matches, no unmatched records |
| `node scripts/phase3-security-check.mjs` | PASS: mock settings in normal file/API/worker, configured-secret log scan, browser scan, protected specifications |
| `git diff --check` | PASS |

Earlier synthetic runs (unnamed and `gate-a-final`) also passed; their ledgers were retained. An intentionally repeated unnamed run failed before the early relaunch check was added, demonstrating the transport limit; final relaunch now fails before creating resources. No functional assertion was weakened. No implementation blocker or business-code change was needed.

Browser/UI suites, new live inference/catalog calls, refreshed dependency audit, and physical power-loss tests were not run. No UI changed; HTTP/service regressions cover this scope. The previously documented HIGH advisory and five moderate advisories remain preserved in [the final acceptance record](audits/phase-3-final-acceptance.md) and [dependency snapshot](audits/phase-3-final-dependency-audit.json). No dependency was upgraded or advisory suppressed; this gate is not dependency clearance.

## Independent audit commands

Run from the repository root with Node 24, pnpm and Docker. Commands below use synthetic data only. Do not supply real API credentials. The normal stack must remain mock-configured.

```bash
node scripts/phase3-security-check.mjs
pnpm lint
pnpm typecheck
pnpm build
pnpm exec vitest run tests/openrouter/verification.test.mjs
AI_PROVIDER=mock pnpm exec vitest run
DOCKER_BUILDKIT=0 docker build -f apps/api/Dockerfile --target runtime -t smart-recruit-openrouter-verification .
node scripts/openrouter-verification/run.mjs --initialize-synthetic-counter independent-gate-a
node scripts/openrouter-verification/run.mjs --synthetic independent-gate-a
node scripts/openrouter-verification/reconcile.mjs .verification/openrouter/runs/independent-gate-a/application.json .verification/openrouter/runs/independent-gate-a/generations.synthetic.json synthetic-independent-fixture
```

Initialization is a one-time action for this explicit audit run. If that name already exists, preserve its evidence; do not delete/reset the ledger. The following commands should fail with exit 1 and leave its count unchanged:

```bash
node scripts/openrouter-verification/run.mjs --synthetic independent-gate-a
node scripts/openrouter-verification/run.mjs --initialize-synthetic-counter independent-gate-a
node scripts/openrouter-verification/run.mjs --live
```

Optional existing regression reruns:

```bash
pnpm test:phase2
pnpm test:phase3
```

The Phase 3 suite writes `docs/audits/phase-3-remediation-evidence/integration.json`; preserve the existing historical file before rerunning and restore it afterward, or run those existing suites in a separate checkout. Tests use the existing mock stack for service access and disposable test databases. The new harness itself uses no normal-stack services.

## Remaining gates

No Gate A implementation blocker remains. Independent audit is still required. Gate B catalog/provider/privacy/pricing verification and Gate C live transport activation, credential provisioning, paid-request approval and real cost reconciliation remain unperformed and unauthorized. The implementation intentionally has no catalog or live execution mode. Activating a live adapter/network route later must preserve this reviewed boundary and omit the synthetic failure suite. No further phase is started.
