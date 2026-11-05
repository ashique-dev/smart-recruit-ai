# OpenRouter Gate A — independent audit remediation

## Decision

**GATE A STILL BLOCKED.** GA-01, GA-03 and the executable GA-04 gaps have new local evidence. GA-02 has partial remediation, but post-activation credential isolation and mandatory admission for the future live executor are **NOT SUFFICIENTLY VERIFIED**. A disabled entry point is not proof of that enforcement. No live-provider acceptance is claimed.

Branch: `verification/openrouter-live`. HEAD: `84c90acfca3f4655698a5f708e0394581e56efc9`. No commits, pushes, merges, paid requests, catalog requests or Phase 4 work. Approved Phase 3 application logic, schemas, dependency lockfile and protected architecture specifications remain unchanged. The normal API/worker remain mock-configured and were observed to have no OpenRouter credential.

This supersedes the earlier developer READY assessment. The supplied independent audit verdict remains FAIL (47 PASS / 3 FAIL / 15 NOT SUFFICIENTLY VERIFIED out of 65 controls); this report does not invent a new full 65-control audit. The previous [report](audits/openrouter-gate-a-history/pre-remediation-report.md) and [evidence](audits/openrouter-gate-a-history/pre-remediation-evidence.json) are preserved byte-for-byte. Fresh results and source/image hashes are in [the updated evidence JSON](audits/openrouter-gate-a-evidence.json).

## A. Findings matrix

| Finding | Original issue | Remediation and exact references | Fresh tests / result |
|---|---|---|---|
| GA-01 | A run name created another two-send allowance | `scripts/openrouter-verification/authorization.mjs:8` fixes the future live root independently of run/CWD/env; `:11` binds immutable authorization ID, approval digest, purpose and limit; `:21` provisions one exclusive ledger; `:28` admits at the actual transport callback. `limit.mjs:5` creates the identity/constraints/triggers transactionally; `:21` verifies binding under `BEGIN IMMEDIATE` and commits consumption before send. `run.mjs:14` keeps ordinary synthetic run names separate from the singleton synthetic authorization store. | PASS for the implemented store boundary. Twelve initialization processes yielded one winner; twelve send contenders yielded two admissions; different run names, changed identity, reinitialization and generic-counter bypass were denied. Live provisioning/activation is not claimed complete. Tests: `tests/openrouter/remediation.test.mjs:19`, `:28`, `:37`, `:46`, `:132`. |
| GA-02 | Smoke and ordinary worker could bypass verification admission | `scripts/openrouter-smoke.mjs:1` now exits before imports, credentials or network. `live-entry.mjs:1` is the sole reserved future entry point and is unconditionally disabled. Actual call-site inventory and required credential boundary are below. Ordinary worker is unchanged. | NOT SUFFICIENTLY VERIFIED / original finding not fully closed. Disabled-entry and sentinel-redaction tests pass (`remediation.test.mjs:124`); current normal workers are mock with no credential. There is no implemented live credential broker or demonstrated post-activation egress fence. |
| GA-03 | Empty application/provider arrays returned success | `evidence.mjs:32` requires exactly the two planned task identities; `:56` reconciles expected operation/request/generation inventory; `:71` classifies unexpected rows; `:73` determines overall status. Missing/duplicate/truncated/unknown evidence cannot pass. `reconcile.mjs:5` requires an inventory file and exits 2 for INCOMPLETE. | PASS. Fourteen named negative cases plus inventory/CLI tests, `remediation.test.mjs:92`–`:122`. Both-empty CLI exits 2. Complete synthetic evidence passes. |
| GA-04 | Filesystem, concurrency, auth, provenance, integration and queue gaps | Permission/path/read-only/commit tests: `remediation.test.mjs:57`, `:68`, `:78`. Auth rejection: `workflow.mjs:64`. Image context: `build.mjs:10`; snapshot/image/container checks: `run.mjs:51`, `:71`, `:84`. Isolated BullMQ: `workflow.mjs:81`. Isolated old regressions: `regressions.mjs:11`, `:25`. | PASS for executed cases: actual PostgreSQL/Redis workflow, read-only bind mount, concurrent initialization, CSRF/revision/tenant rejection and duplicate BullMQ delivery. Physical fsync/power-loss faults remain untested. New harness does not independently exercise the production outbox polling loop. |

## B. Repository changes

Created in this remediation:

- `scripts/openrouter-verification/authorization.mjs`
- `scripts/openrouter-verification/build.mjs`
- `scripts/openrouter-verification/live-entry.mjs`
- `scripts/openrouter-verification/regressions.mjs`
- `tests/openrouter/authorization-child.mjs`
- `tests/openrouter/remediation.test.mjs`
- `docs/audits/openrouter-gate-a-history/pre-remediation-report.md`
- `docs/audits/openrouter-gate-a-history/pre-remediation-evidence.json`

Modified relative to the supplied Gate A implementation:

- `scripts/openrouter-smoke.mjs`
- `scripts/openrouter-verification/{limit,evidence,reconcile,run,workflow}.mjs`
- `tests/openrouter/verification.test.mjs`
- `docs/openrouter-gate-a.md`, `docs/audits/openrouter-gate-a-evidence.json`, `docs/progress.md`

Existing Gate A changes to `.gitignore`/`.dockerignore`, other verification helpers, and the 47 pre-existing untracked historical files were preserved. Git still has uncommitted Gate A work; no unrelated files were removed.

## C. Request-limit proof and trust boundary

The ledger contains one immutable serialized binding: authorization ID, approval-record digest, purpose and limit two. Initialization exclusively creates the file and commits its schema, identity and immutable-identity triggers in one transaction. Another initializer cannot overwrite it, even with a new ID. Admission checks the supplied binding inside the same write transaction that inserts a send. Unique task/operation and ordinal constraints allow one analysis and one rubric send, at most two total. `COMMIT` returns before transport is invoked. HTTP failure, timeout, interruption and crash never refund admission.

The future `live-approval` purpose is restricted to the code-owned `LIVE_AUTHORIZATION_ROOT`, not a run-name-derived directory. Changing run names does not change that path or binding. Synthetic counters cannot consume an authorization-bound ledger without its exact binding. Missing/corrupt state, inaccessible paths and unsuccessful transactions fail before the callback.

The singleton synthetic CLI also demonstrates the actual renamed-run attack: `--synthetic renamed-a` and `renamed-b`, repeated provisioning, and provisioning with a run name each exited 1; consumption remained two before and after. The multiprocess tests additionally prove one initialization winner out of twelve and exactly two admitted sends out of twelve. Separate restarted processes see prior consumption. Within the callback, another connection observes the committed count before the simulated send fails.

`--synthetic-proof` creates a new, explicitly synthetic authorization fixture with a new random identity for repeatable isolated integration testing. It accepts no run name, cannot use a live-purpose approval, does not touch the live root and always uses the noncredential synthetic transport. The fault-scenario ledgers are also synthetic-only. These are independent test fixtures, not a way to reset or expand an existing live authorization. The singleton renamed-run tests and fixed live-root rejection tests remain separate.

The approval digest is an immutable reference, not a verified signature or proof that an owner approved spending. Authentic approval issuance/provisioning still needs to be bound to the future live executor. Trusted installation/storage is also assumed: this is not protection against a privileged operator replacing code, moving an installation or editing storage. There is no external provider spending-cap claim.

### GA-02: audited outbound call sites and explicit execution design

Actual call sites:

- `apps/api/src/ai-gateway/gateway.ts:58` defaults to global `fetch`; `:76` makes the inference POST through `this.transport`.
- `apps/api/src/ai-gateway/runtime.ts:15` constructs the ordinary gateway. This default remains unchanged; supplying it a real key and real configuration outside the approved workflow can bypass the verification store.
- `scripts/openrouter-smoke.mjs` previously constructed that gateway directly. It is now disabled unconditionally, including when `--approved-live` is supplied.
- `scripts/openrouter-preflight.mjs:7` contains authenticated catalog GETs. It remains outside this workflow and was not run; it does not perform inference.
- `authorization.mjs:35` is the authorized verification callback after durable admission. In every executed test its callback is synthetic and performs no provider network request.
- `workflow.mjs:26` rejects non-loopback global fetch. Its HTTP requests are only to the loopback API; its Docker network is internal. Fault callbacks and the crash child are synthetic. No real key is loaded by either launcher.

Reserved future workflow, **design only—not implemented enforcement**:

1. `live-entry.mjs` is the only permitted activation entry point. It must validate an independently issued approval artifact tied to one fixed installation/root, authorization ID, approved route/prompt/source digests and two expected operations. A flag, digest string or run name must not constitute approval.
2. A dedicated verification-only credential holder must own the fixed ledger and be the only process receiving the key, preferably through a private file descriptor/secret mount rather than shared environment. The API and processing container receive no real key and have no internet route. The key must never enter normal Compose, shell command arguments, copied environment, logs or application evidence.
3. The credential holder must validate the request and commit `authorizedTransport` admission before its sole provider network send. It must reject task/operation replay and every third send, have no internal retry/fallback, and preserve consumed state on all ambiguous outcomes. It must not inherit or launch the ordinary worker/smoke/catalog scripts with credentials.
4. Synthetic tests must demonstrate process/network isolation and credential confinement using a sentinel secret, including direct gateway/smoke attempts from noncredential processes. Only after that proof and explicit future approval can activation be considered.

The current repository does **not** implement this credential holder/egress fence. It would add a verification-specific process/network boundary; changing the normal production worker merely for the test was avoided. The reserved entry point currently rejects before reading any environment or credentials. No disabled-path test is counted as proof of the future architecture. This unresolved GA-02 boundary is why the overall verdict remains blocked, even though current remediation performs zero provider calls.

## D. Reconciliation proof

An explicit expected inventory must contain exactly one job-analysis and one rubric-draft operation, with unique operation/request IDs. Expected generation IDs are compared to both application rows and independent normalized generation rows. The workflow exports this inventory separately from the application accounting array using the known queued operations and request identities. In a future live run, missing generation IDs must remain unknown.

Each expected operation must have exactly one settled attempt, the correct task/request/generation identity and one matching provider row. Missing IDs, usage, cache counters or cost remain null and cause INCOMPLETE. Duplicate operations, request IDs or generation identities cannot pass. Unexpected records are explicitly classified as UNEXPECTED_APPLICATION or UNEXPECTED_PROVIDER and block success. Known zero values remain zero; absent costs are not replaced with zero, including empty totals.

Fresh negative cases cover: both arrays empty; either array empty; either export truncated; duplicate application/provider rows; missing generation; unknown cost; unknown tokens; mismatched cost; wrong task; extra application/provider rows; absent or empty inventory. Empty CLI exports return exit 2. Valid evidence returns PASS with two matches and fixture totals USD 0.002 on each side. These are synthetic values, not billed charges.

Every reconciliation report states `provenanceVerified: false`. A provenance label is not proof of independent provider retrieval. Live generation retrieval/normalization and authenticity remain later work; no live record was obtained.

## E. Fresh integration and regression evidence

The verified build context is an explicit temporary snapshot of tracked application/package sources and required build configuration. Every context file is hashed, and the aggregate context digest plus Git HEAD are image labels. The launcher verifies current source hashes and labels, uses the immutable image ID, snapshots verification scripts into a read-only mount, records their hashes, and checks the executed container's image ID. It also records actual network names, mount destinations and port bindings from Docker inspection.

Fresh image:

`sha256:80e6876ee9c2e800115bfdee11f61440e36196addb0c639e55fd6c7548b48ddc`

Build-context digest:

`8df580ab727983ee1a71cc2364b8df6371e9432cb23867661367d94a33b1bd57`

Final workflow evidence:

`.verification/openrouter/proofs/5bdb7b88-c35f-423e-a8f0-d77361a41b4b/result.json`

This fresh run used disposable PostgreSQL and Redis on one unique internal network, no published ports, loopback API, an empty database/Redis, and the restricted runtime role. No normal development database was connected or mutated. Authentication, tenant scope, requests/outbox, artifacts, rubric drafts and usage persistence all run through unchanged application code. Missing/invalid CSRF, stale revision and foreign tenant requests each reject before provider sends, operations or artifacts are created.

Analysis is explicitly driven through `AiProcessor` after checking the durable outbox. Rubric uses an isolated BullMQ queue with two duplicate deliveries and one provider send. Both jobs complete and publish one artifact. This proves queue-to-processor duplicate delivery, not the whole new-harness outbox-to-`AiRuntime` dispatch loop. Existing Phase 3 dispatch/recovery regressions were freshly rerun in the separate regression environment.

The regression launcher uses a unique Compose project/file with disposable PostgreSQL, Redis and Mailpit, internal networking, no published ports and explicit synthetic credentials; it disables normal `.env` loading. It runs the unchanged Phase 2/3 suites against that project. Its temporary credential configuration is deleted afterward. The historical Phase 3 integration evidence file is restored byte-for-byte after the suite. A legacy test performs a read-only lookup of the normal API image ID, but execution uses the verification image in the isolated Compose file; the new report records that distinction.

### Commands actually executed and results

| Command | Exit / result |
|---|---|
| `node scripts/openrouter-verification/build.mjs` | 0; staged-context Docker build and image-label verification passed |
| `GATE_A_DOCKER_TESTS=1 pnpm exec vitest run tests/openrouter --reporter=json --outputFile=.verification/openrouter/remediation-tests-final-v3.json` | 0; **30 passed, 0 failed, 0 skipped** |
| `node scripts/openrouter-verification/run.mjs --provision-synthetic-authorization` | 0 on first provisioning; later repeats correctly exit 1 |
| `node scripts/openrouter-verification/run.mjs --synthetic remediation-ga` | 0; isolated workflow passed |
| `node scripts/openrouter-verification/run.mjs --synthetic-proof` | 0 for final snapshot-backed run above; repaired launch failures listed below |
| `node scripts/openrouter-verification/regressions.mjs` | 0; **Phase 2: 5 passed; Phase 3: 13 passed**, no skips; cleanup exit 0 |
| `pnpm lint` | 0 |
| `pnpm typecheck` | 0; workspace TypeScript; verification JS is lint/runtime tested |
| `pnpm build` | 0 |
| `AI_PROVIDER=mock pnpm exec vitest run --reporter=json --outputFile=.verification/openrouter/remediation-checks/default-tests.json` | 0; **71 passed, 5 skipped**; four service opt-ins executed by isolated regressions, read-only-mount opt-in executed by focused tests |
| Offline reconciliation command below | 0; overall PASS, two inventory matches |
| `node scripts/phase3-security-check.mjs` | 0; normal mock mode, configured-secret logs/browser checks and protected specifications passed |
| `git diff --check` | 0 |

The evidence JSON includes exact inner regression commands, exit codes, test names/statuses, source hashes, image provenance, actual container inspection, reconciliation rows and counter results. Earlier developer results were not reused as passing proof.

Failures during remediation were retained rather than hidden: initial lint found an unused fixture argument (fixed); the first read-only test's Docker child exited 125 because the daemon could not see sandbox `/tmp` (fixture moved to its own ignored-workspace temporary directory); an intermediate duplicate import caused a syntax failure (fixed); two SQL setup launches failed when socket readiness accepted PostgreSQL's temporary init server (now waits for the final TCP listener). All related final checks passed; no assertion was relaxed. Failed authorization ledgers were retained, not reset.

### Independent audit commands

These commands remain synthetic-only and require Docker plus Node 24/pnpm. Do not supply real provider credentials.

```bash
node scripts/openrouter-verification/build.mjs
GATE_A_DOCKER_TESTS=1 pnpm exec vitest run tests/openrouter
node scripts/openrouter-verification/run.mjs --synthetic-proof
node scripts/openrouter-verification/regressions.mjs
pnpm lint
pnpm typecheck
pnpm build
node scripts/phase3-security-check.mjs
git diff --check
```

Exact offline comparison against this session's retained fixture exports:

```bash
node scripts/openrouter-verification/reconcile.mjs .verification/openrouter/proofs/5bdb7b88-c35f-423e-a8f0-d77361a41b4b/application.json .verification/openrouter/proofs/5bdb7b88-c35f-423e-a8f0-d77361a41b4b/generations.synthetic.json .verification/openrouter/proofs/5bdb7b88-c35f-423e-a8f0-d77361a41b4b/expected.json synthetic-independent-fixture
```

On another checkout, use the new proof directory printed by `--synthetic-proof`. Do not delete an existing authorization ledger to rerun it. Normal `--synthetic` renamed-run and reinitialization denials are tested separately and cannot reset the singleton store.

## F. Security and remaining gaps

**PASS:** implemented authorization binding/admission tests; reconciliation inventory and negative cases; actual permission-denied writes; actual inaccessible paths; actual read-only Docker mount; missing/corrupt stores; actual SQLite COMMIT rejection through a deferred constraint; concurrent initialization; HTTP rejection; image/context/container linkage; disposable PostgreSQL/Redis; isolated old regressions; new isolated BullMQ delivery. No credentials, authorization headers, session cookies, database URLs or raw provider errors are exported in the evidence. Snapshot/config/evidence paths remain Git-ignored; temporary regression credentials are deleted. Normal API and worker were independently observed as `mock` with `providerCredentialPresent: false`.

**FAIL / original audit not closed:** overall Gate A acceptance, because GA-02 lacks proven post-activation enforcement. No claim that all 65 original controls now pass.

**NOT SUFFICIENTLY VERIFIED:** live approval authenticity/provisioning; a credential-isolated live process and mandatory egress fence; physical fsync failure/power-loss durability; independent live provider records. The new harness does not independently verify production outbox polling, although isolated existing Phase 3 tests cover that path. Browser/UI suites were not rerun; no UI changed.

The existing HIGH and moderate dependency advisories remain documented in [final Phase 3 acceptance](audits/phase-3-final-acceptance.md) and the [dependency snapshot](audits/phase-3-final-dependency-audit.json). No dependency was upgraded or advisory suppressed. No fresh dependency audit is claimed.

**Final: GATE A STILL BLOCKED.** Stop here. No live activation, catalog request, credential provisioning, paid traffic, commit, merge or next phase is authorized by this remediation report.
