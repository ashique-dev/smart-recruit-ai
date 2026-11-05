# OpenRouter Gate A — GA-F01 / GA-F02 targeted remediation

**READY FOR TARGETED INDEPENDENT RE-AUDIT.** This developer result does not supersede the independent FAIL verdict. GA-F03 remains **NOT SUFFICIENTLY VERIFIED** until Session 2 can execute the tests. Live inference remains disabled. No real provider/catalog requests or credentials, production-source changes, dependency upgrades, protected-specification changes, commits, pushes, merges or Phase 4 work.

Branch `verification/openrouter-live`; HEAD `84c90acfca3f4655698a5f708e0394581e56efc9`; dirty working tree retained. Earlier reports and evidence are preserved as [pre-f01-f02 report](audits/openrouter-gate-a-history/pre-f01-f02-report.md) and [evidence](audits/openrouter-gate-a-history/pre-f01-f02-evidence.json), alongside older history.

## GA-F01 — decoded response validation

Root cause: raw substring checking missed a credential encoded as JSON Unicode escapes, including escapes inside the nested structured-output JSON string. `broker-policy.mjs::validateProviderResponse` now parses the outer envelope, recursively checks decoded keys and values, enforces a strict envelope/choice/message/usage field allowlist, parses nested content, recursively checks it, and calls the existing contracts' `validateOutput` with the approved task/input/correlation ID. Malformed or unexpected content is rejected before any provider output crosses IPC. Missing/null accounting metadata stays missing/null; no zero substitution. The production gateway still validates independently.

`broker.mjs` keeps the 150,000-byte streaming limit, calls this validator before success, and emits only generic rejection errors. All non-success HTTP responses are discarded without forwarding provider error content. Errors and tests never log raw responses or the sentinel. Request admission is already committed; rejection never refunds it. Canonical reserialization releases only validated decoded content.

This detects the complete sentinel in decoded JSON strings; it is not a claim against arbitrary transformations, base64, partial-secret leakage or every covert channel. The strict envelope is deliberately narrow for this synthetic build; future provider envelopes need explicit review, not permissive passthrough.

## GA-F02 — approval-derived inventory

Root cause: the coordinator used accounting rows to construct the expected operation identities, making modified identities self-validating. `evidence.mjs::approvedInventory` now verifies the signed approval (signature, expiry, purpose, installation and build bindings) and extracts its two task/operation identities. It binds request IDs from a separately queried `AiRequest` export and generation IDs from the local provider's independently collected operation/task receipts. It rejects missing, duplicate or mismatched bindings before reconciliation. Accounting records are never rewritten.

`broker-verify.mjs` reads the signed approval from its read-only approval mount source, constructs that inventory, and compares usage rows against it. The provider substitute records generation receipts from received requests; the coordinator no longer creates expected operations or provider exports from the accounting rows. `reconcile.mjs` now requires a signed binding bundle (`signed`, `trust`, `publicKey`, `built`, `requests`, `receipts`) instead of an unsigned expected array. Its trust/public-key material must come from owner provisioning, not an untrusted submitter. The core low-level comparison remains usable for existing synthetic tests, but is not itself an authorization verifier.

Receipts are synthetic and `provenanceVerified` remains false. Separate database records establish request binding, not proof against a malicious database owner. Independent live provider billing is still unverified.

## Security regression results

- **PASSED** — decoded provider response literal.
- **PASSED** — decoded provider response unicode.
- **PASSED** — decoded provider response nested-json.
- **PASSED** — decoded provider response split-escapes.
- **PASSED** — decoded provider response array.
- **PASSED** — decoded provider response object.
- **PASSED** — decoded provider response structured-text.
- **PASSED** — decoded provider response error-content.
- **PASSED** — decoded provider response malformed-outer.
- **PASSED** — decoded provider response malformed-nested.
- **PASSED** — decoded provider response unexpected-envelope.
- **PASSED** — decoded provider response oversized.
- **PASSED** — decoded provider response valid.
- **PASSED** — unknown response usage remains absent.
- **PASSED** — signed reconciliation valid signed inventory.
- **PASSED** — signed reconciliation modified analysis operation.
- **PASSED** — signed reconciliation modified rubric operation.
- **PASSED** — signed reconciliation swapped operation IDs.
- **PASSED** — signed reconciliation missing analysis.
- **PASSED** — signed reconciliation missing rubric.
- **PASSED** — signed reconciliation duplicate operation.
- **PASSED** — signed reconciliation unexpected third operation.
- **PASSED** — signed reconciliation modified request ID.
- **PASSED** — signed reconciliation swapped request IDs.
- **PASSED** — signed reconciliation missing generation.
- **PASSED** — signed reconciliation modified generation.
- **PASSED** — signed reconciliation duplicate generation.
- **PASSED** — signed reconciliation empty application.
- **PASSED** — signed reconciliation empty provider.
- **PASSED** — signed reconciliation both empty.
- **PASSED** — signed reconciliation truncated evidence.
- **PASSED** — signed reconciliation invalid signature.
- **PASSED** — signed reconciliation expired approval.
- **PASSED** — signed reconciliation approval application mismatch.
- **PASSED** — signed reconciliation unknown cost.
- **PASSED** — signed reconciliation unknown usage.
- **PASSED** — signed reconciliation request binding mismatch.
- **PASSED** — signed reconciliation generation receipt mismatch.

Every rejected response scenario also runs through real broker IPC and the authenticated application/production processor/gateway path with disposable PostgreSQL. Each asserts zero artifacts, a generic IPC error, one consumed admission, no refund and no extra send on replay. The successful workflow verifies two persisted artifacts and usage records. Logs, database, Redis, evidence and image layers are scanned for the freshly generated sentinel without exporting raw secret-bearing output.

## Actual execution

| Command | Exit |
|---|---|
| `pnpm lint` | 0 |
| `pnpm typecheck` | 0 |
| `pnpm build` | 0 |
| `GATE_A_DOCKER_TESTS=1 pnpm exec vitest run tests/openrouter --reporter=json --outputFile=.verification/openrouter/targeted-checks/focused.json` | 1 |
| `pnpm lint` | 0 |
| `pnpm typecheck` | 0 |
| `pnpm build` | 0 |
| `GATE_A_DOCKER_TESTS=1 pnpm exec vitest run tests/openrouter --reporter=json --outputFile=.verification/openrouter/targeted-checks/focused-final.json` | 0 |
| `AI_PROVIDER=mock pnpm exec vitest run --reporter=json --outputFile=.verification/openrouter/targeted-checks/default.json` | 0 |
| `node scripts/openrouter-verification/broker-build.mjs` | 0 |
| `node scripts/openrouter-verification/broker-verify.mjs` | 1 |
| `pnpm lint` | 0 |
| `node scripts/openrouter-verification/broker-build.mjs` | 0 |
| `node scripts/openrouter-verification/broker-verify.mjs` | 0 |
| `node scripts/openrouter-verification/regressions.mjs` | 0 |
| `git diff --check` | 0 |

The base application build also executed successfully (exit 0). Focused suite: **96 passed, 0 failed, 0 skipped**. Default suite: **137 passed, 0 failed, 5 skipped**. Four service opt-ins run in isolated Phase 2/3 regressions; the read-only-mount opt-in runs in focused tests. Phase 2 **5 passed**, Phase 3 **13 passed**, no skips; cleanup exit 0.

Full broker run `bc4f42db-8870-45f6-804a-7abad444550d`: **61 checks passed**. The [evidence JSON](audits/openrouter-gate-a-evidence.json) includes each result, actual container images/mounts/networks, source hashes, ledger concurrency/restart/crash results, expected inventory, separate request bindings, provider receipts, artifact counts and reconciliation. Two-request concurrency and restart/crash cases retain the original tests. All provider endpoints are local synthetic substitutes; disposable PostgreSQL/Redis use isolated Docker resources. No successful connection or mutation of a shared development database occurs. Normal API/workers remain mock-configured.

Application image: `sha256:80e6876ee9c2e800115bfdee11f61440e36196addb0c639e55fd6c7548b48ddc`. Broker image: `sha256:4c69ceec7ce29fd483bc8b395d8efa85982f002608c8aa1db0256c62f1864d8d`. Broker source digest: `540562f7d703c2bbdef69e429a8b70ed44e853b67b547ae57d8a2afeaa295029`. Application context digest: `8df580ab727983ee1a71cc2364b8df6371e9432cb23867661367d94a33b1bd57`. Source and executed image identities are checked before testing; no provider secret is included in the build context. Broker secret/ledger mounts are absent from application containers; broker/application communicate only through the private Unix socket, with separate internal networks and no public broker port.

Failures are retained: the first CLI regression expected the obsolete unsigned-inventory result; its assertion now requires rejection. An initial read-only Docker test failed, then passed unchanged in isolation and in the full rerun; the initial runner output did not establish its cause. A build/run attempt detected changed source hashes after provider receipt instrumentation and stopped before provider testing; rebuilding restored matching provenance. No failed result is counted as a pass.

## Changed files

- `scripts/openrouter-verification/broker.mjs`
- `scripts/openrouter-verification/broker-policy.mjs`
- `scripts/openrouter-verification/provider-substitute.mjs`
- `scripts/openrouter-verification/broker-verify.mjs`
- `scripts/openrouter-verification/broker-workflow.mjs`
- `scripts/openrouter-verification/fixture.mjs`
- `scripts/openrouter-verification/evidence.mjs`
- `scripts/openrouter-verification/reconcile.mjs`
- `tests/openrouter/targeted-security.test.mjs`
- `tests/openrouter/remediation.test.mjs`
- `docs/openrouter-gate-a.md`, `docs/audits/openrouter-gate-a-evidence.json`, `docs/progress.md`.
- Two `pre-f01-f02-*` historical copies under `docs/audits/openrouter-gate-a-history/`.

The existing production gateway/runtime/contracts and dependency lock are unchanged. Earlier harness files and unrelated historical untracked files are preserved. Existing HIGH/moderate advisories remain documented in [Phase 3 acceptance](audits/phase-3-final-acceptance.md). Security checks cover unchanged protected/production sources, unchanged lockfile, ignored temporary configuration, mock/mount inspection, and sentinel scans. The legacy security script that reads normal secret configuration was not run; no real credentials were inspected. Browser/UI and fresh advisory lookup were not run.

## Independent audit procedure

Read-only inspection needs no Docker and changes no files: inspect this report, the evidence JSON and history, then compare each `sourceHashes` entry with SHA-256 of the named file. Review the signed-inventory and decoded-response code and test names. Reported image/container results are developer evidence, not independent runtime proof.

For independent execution, use an authorized writable workspace and permitted Docker daemon. Do not change socket permissions, use privileged containers or bypass audit restrictions. If these permissions are unavailable, retain GA-F03 NOT SUFFICIENTLY VERIFIED. Run sequentially:

```bash
pnpm lint
pnpm typecheck
pnpm build
node scripts/openrouter-verification/build.mjs
node scripts/openrouter-verification/broker-build.mjs
GATE_A_DOCKER_TESTS=1 pnpm exec vitest run tests/openrouter
node scripts/openrouter-verification/broker-verify.mjs
node scripts/openrouter-verification/regressions.mjs
AI_PROVIDER=mock pnpm exec vitest run
git diff --check
```

A temporary-workspace option is a local `git clone --no-hardlinks` of the baseline into a fresh writable directory, followed by an allowlisted overlay of `scripts/openrouter-verification/`, `tests/openrouter/`, `scripts/openrouter-smoke.mjs`, `.gitignore` and `.dockerignore` from the reviewed working tree. Compare source hashes before running. Install the frozen dependency lock from an existing offline cache (`pnpm install --offline --frozen-lockfile`), then run the commands above. Do not copy `.env`, `.verification`, approval/secret mounts, credentials, runtime volumes or node_modules from the development workspace. The Docker daemon must be able to bind-mount the temporary directory; sandbox-private `/tmp` may not be visible. The harness inspects existing normal-container configuration and performs blocked network probes without starting/mutating those containers; document any missing-container limitation rather than fabricating a pass. Each execution generates fresh synthetic approvals/keys and disposable resources; preserve prior consumed ledgers and reports.

Offline CLI comparison requires the owner-provisioned signed binding bundle and separately obtained application/provider exports:

```bash
node scripts/openrouter-verification/reconcile.mjs application.json provider.json signed-bindings.json synthetic-independent-fixture
```

Expired approval fails closed, including offline CLI use. Historical expired runs can be inspected as historical evidence; do not re-sign or change their timestamps to obtain a new PASS.

## Remaining classification

- **Remediated in developer tests:** GA-F01 decoded-credential leakage and GA-F02 self-derived inventory.
- **NOT SUFFICIENTLY VERIFIED:** GA-F03 independent execution, real provider billing/provisioning/routing, physical power-loss durability. Developer execution does not close auditor permissions.
- **Trust assumptions:** owner signing/provisioning host, Docker administrator/kernel, trustworthy separate request export and provider receipts. Arbitrary credential encodings/transformations are outside the tested claim.
- **Coverage limits:** production processor is invoked directly after outbox verification; this targeted harness does not independently certify full dispatcher delivery.

Stop for targeted independent re-audit. No live activation is authorized.
