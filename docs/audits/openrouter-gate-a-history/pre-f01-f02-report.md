# OpenRouter Gate A — isolated credential broker

**GA-02 READY FOR INDEPENDENT AUDIT**, for the synthetic-only implementation. This is not live-test approval. No real provider or authenticated catalog request was made. Real credentials and live purposes are rejected by this build.

Branch `verification/openrouter-live`; HEAD `84c90acfca3f4655698a5f708e0394581e56efc9`; working tree intentionally dirty. No commit, push, merge, dependency upgrade, protected-specification or production-source change. Previous reports/evidence remain under [history](audits/openrouter-gate-a-history/pre-broker-report.md). The owner's prior FAIL verdict remains historical; this developer report requests independent re-audit.

## Implementation and execution

New verification files: `broker.mjs`, `broker-policy.mjs`, `ipc-transport.mjs`, `provider-substitute.mjs`, `broker-client.mjs`, `broker-workflow.mjs`, `broker-build.mjs`, `broker-verify.mjs`, `scan-image.py` under `scripts/openrouter-verification/`, plus `tests/openrouter/broker-policy.test.mjs`. Modified `authorization.mjs` to use canonical `/authorization` and restrict the old utility to synthetic purposes. Updated this report, audit JSON and `docs/progress.md`; added pre-broker history copies. Earlier harness files, ignore rules and disabled smoke script remain present; unrelated historical untracked files were preserved.

Authenticated loopback API → production JobsService → persisted operation/outbox → production AiProcessor → AiGateway with injected IPC transport → Unix socket `/ipc/broker.sock` → broker validation → SQLite COMMIT → exactly one local provider POST → gateway output validation → usage settlement/artifact persistence. Two synthetic tenants, analysis review/save and rubric drafting are exercised through authentication and persistence. The gateway is explicitly pinned to openrouter mode for these operations; default construction remains mock. There is no silent mock fallback. A verification-only Prisma query extension assigns the two owner-planned operation UUIDs at creation; business guards, revisions and database writes are unchanged.

The broker workflow invokes AiProcessor directly after verifying the outbox. It does not independently prove full outbox-to-BullMQ dispatch. Existing isolated Phase 3 regressions cover queue behavior; the earlier harness also has separate BullMQ delivery evidence. No production gateway.ts/runtime.ts change was necessary.

## Credential and network boundaries

Only the broker client process is provisioned the synthetic provider secret, through read-only `/run/secrets/provider-key`. It is absent from application environment, child environment, mounts, database, Redis and evidence. The trusted provisioning host creates it; the local provider necessarily receives it for authentication and is configured with only its hash. No credential is in command-line arguments or build context. Image tar/layers, container logs, PostgreSQL dump and Redis values were scanned in memory for the sentinel without exporting raw content. Provider secret-echo responses are rejected; errors are generic.

Application and disposable database/Redis use one internal Docker network. Broker and substitute use a different internal network; only application/broker share the private Unix socket. Application has no ledger, approval, trust or secret mount. Numeric-IP connection probes to the provider, another-network canary, normal development database and worker all fail. This supplies runtime evidence beyond merely declaring `internal: true`; it is not a universal proof against Docker/kernel vulnerabilities. Normal API/worker configuration remains mock and has no broker mounts. A stopped normal API is inspected without starting it.

Broker/application containers have read-only roots, non-root UID, all capabilities dropped, no-new-privileges, no Docker socket, no privileged/host networking and no published ports. Broker is not a proxy: one fixed destination/path/method, strict task/operation/workload/schema/model/provider validation, no URL or header forwarding, no catalog, redirects, retries or callbacks. The default production OpenRouter transport still exists in unchanged production code; the verification application cannot use its credential or reach its destination. Legacy smoke and legacy live entry remain disabled and excluded.

## Approval and durable admission

Owner-signed Ed25519 approval binds authorization UUID, installation UUID, approved source digest, broker/application image IDs, fixed route/provider/model, two task and operation identities, workload hashes, output/request limits, execution purpose and expiry. Public trust and approval mounts are read-only. The test owner generates a synthetic signing key in host memory; no real approval is created. Broker verifies source hashes at startup and every request, validates signature/expiry/installation and rejects replacement after startup. Actual image IDs are checked by the trusted launcher; the broker has no Docker socket for self-attestation.

The only broker ledger is `/authorization/ledger.sqlite`, bound to the signed approval digest. It is owner-initialized once, never created or reset by broker startup. No environment/root/run-name override exists. SQLite BEGIN IMMEDIATE and synchronous FULL commit admission before HTTP. Unique task/operation constraints and ordinals 1–2 bound concurrency. Missing, corrupt, inaccessible or read-only state fails closed. Failures, timeout and killed processes never refund; ambiguous billing stays UNKNOWN. This is a request-attempt boundary, not an external monetary cap. Host administrators and the owner signer remain trusted; cloning/rolling back host storage is outside this boundary.

## Security test results

All requested cases are exercised using a sentinel and local substitute. Totals below distinguish the 30 requested cases from supplemental checks.

| Test | Result and observed evidence |
|---|---|
| 01 missing approval | PASS; `{"providerPosts":0}` |
| 02 modified approval signature | PASS; `{"providerPosts":0}` |
| 03 expired approval | PASS; `{"providerPosts":0}` |
| 04 wrong execution purpose | PASS; `{"providerPosts":0}` |
| 05 changed source/image identity | PASS; `{"providerPosts":0}` |
| 05b changed image identity alone | PASS; `{"providerPosts":0}` |
| 06 changed approved route/model | PASS; `{"providerPosts":0}` |
| 14 missing ledger | PASS; `{"providerPosts":0}` |
| 15 corrupted ledger | PASS; `{"providerPosts":0}` |
| 07 wrong operation | PASS; `{"providerPosts":0,"admissions":0}` |
| 08 wrong task | PASS; `{"providerPosts":0,"admissions":0}` |
| 21 arbitrary destination | PASS; `{"providerPosts":0,"admissions":0}` |
| 22 catalog endpoint | PASS; `{"providerPosts":0,"admissions":0}` |
| 23 generic proxy request | PASS; `{"providerPosts":0,"admissions":0}` |
| approved workload identity | PASS; `{"providerPosts":0,"admissions":0}` |
| approved request schema | PASS; `{"providerPosts":0,"admissions":0}` |
| token limit | PASS; `{"providerPosts":0,"admissions":0}` |
| request provider/model pin | PASS; `{"providerPosts":0,"admissions":0}` |
| 12 run name cannot expand authorization | PASS; `{"providerPosts":0,"admissions":0}` |
| 09 duplicate operation | PASS; `{"providerPosts":1}` |
| 10 duplicate task | PASS; `{"providerPosts":1}` |
| 11 third request | PASS; `{"providerPosts":2,"admissions":2}` |
| 13 broker restart preserves consumption | PASS; `{"providerPosts":2,"admissions":2}` |
| 16 read-only ledger | PASS; `{"providerPosts":0}` |
| 17 timeout | PASS; `{"providerPosts":1,"admissions":1,"redirectedRequests":0,"billing":"UNKNOWN"}` |
| 18 connection interruption | PASS; `{"providerPosts":1,"admissions":1,"redirectedRequests":0,"billing":"UNKNOWN"}` |
| 20 redirect | PASS; `{"providerPosts":1,"admissions":1,"redirectedRequests":0,"billing":"UNKNOWN"}` |
| provider secret echo rejected | PASS; `{"providerPosts":1,"admissions":1,"redirectedRequests":0,"billing":"UNKNOWN"}` |
| 19 broker crash after admission | PASS; `{"providerPosts":1,"admissions":1,"billing":"UNKNOWN"}` |
| 28 concurrent requests | PASS; `{"contenders":12,"providerPosts":2,"admissions":2}` |
| 24 application direct provider and other networks blocked | PASS; `{"probes":[{"name":"provider","reachable":false},{"name":"canary on other network","reachable":false},{"name":"normal database","reachable":false},{"name":"normal worker","reachable":false}]}` |
| 25 normal API/worker cannot access broker mounts | PASS |
| 26 application environment and child processes contain no credential | PASS |
| authenticated API -> production processor -> broker -> persistence | PASS; `{"providerPosts":2}` |
| 29 incomplete reconciliation fails | PASS |
| 27 credential absent from database/logs/evidence/image layers | PASS; `{"imageScan":{"members":17,"compressedMembers":12,"credentialMatches":0}}` |
| 30 legacy smoke disabled | PASS |

## Regression results and provenance

- `pnpm lint`: exit 0.
- `pnpm typecheck`: exit 0.
- `pnpm build`: exit 0.
- `AI_PROVIDER=mock pnpm exec vitest run --reporter=json --outputFile=.verification/openrouter/broker-checks/default-tests.json`: exit 0.
- `git diff --check`: exit 0.
- `node scripts/openrouter-verification/broker-verify.mjs`: exit 0.
- `node scripts/openrouter-verification/build.mjs`: exit 0.
- `node scripts/openrouter-verification/broker-build.mjs`: exit 0.
- `GATE_A_DOCKER_TESTS=1 pnpm exec vitest run tests/openrouter --reporter=json --outputFile=.verification/openrouter/broker-focused-tests.json`: 58 passed; JSON success true.
- Focused tests: **58 passed, 0 failed, 0 skipped**, including filesystem/concurrency/restart and reconciliation negatives.
- Default suite: **99 passed, 0 failed, 5 opt-in skips**. Service opt-ins were exercised by isolated regressions; read-only Docker opt-in by focused tests.
- `node scripts/openrouter-verification/regressions.mjs`: exit 0, Phase 2 **5 passed**, Phase 3 **13 passed**, no skips, cleanup exit 0. Exact inner commands and inspected disposable container identities are in the evidence JSON.
- Full broker run `c652d0db-628c-44ad-a972-852b5372f82c`: **37 checks passed**, all 30 requested cases plus seven supplemental checks.
- Application image: `sha256:80e6876ee9c2e800115bfdee11f61440e36196addb0c639e55fd6c7548b48ddc`.
- Broker image: `sha256:9d7419766675dec7cd31166adb6b62ac9bb370e12fd5cf4117391b3b03454c54`.
- Broker source digest: `cad8cac26047397e2eaf0eba11cdb75c95e886c98727a25748d37cd50fd686f5`.
- Application context digest: `8df580ab727983ee1a71cc2364b8df6371e9432cb23867661367d94a33b1bd57`.

[Evidence JSON](audits/openrouter-gate-a-evidence.json) contains source hashes, actual executed images/mounts, tests, network probes and reconciliation. Build contexts are explicit allowlists; secrets are generated only after building. Image scan inspected 17 tar members including 12 compressed members and found zero sentinel matches. Final helper lint initially found an unused import after the stopped-container adjustment; it was removed, then lint and all 58 focused tests passed (exit 0). This import-only cleanup followed the full runtime run; broker image sources are unchanged. Initial workflow failed because Prisma `$use` is unavailable; the fixture was corrected to `$extends`. A later repeat stopped because normal API was stopped; mount/config inspection now supports that state. Failed evidence is retained; no production code or assertion about actual network isolation was weakened.

Two persisted usage records each match synthetic generation records: input 100/output 50, cache read 0/cache write 5, cost 0.001 fixture units each. These values come from controlled metadata, not real charges. Missing fields remain null/unknown; `provenanceVerified` is false. Empty, missing, duplicate, truncated, mismatched and unexpected reconciliation exports fail or classify incomplete in focused tests. A provenance label does not establish independence.

## Remaining limits and future activation

PASS applies to the tested synthetic broker architecture and restrictions. Real OpenRouter authentication, TLS/provider routing, live approval provisioning, billing and independent generation records remain NOT SUFFICIENTLY VERIFIED. This build deliberately accepts only a synthetic purpose, synthetic model/provider and local HTTP substitute; no flag enables live execution. Future activation needs explicit owner approval, a separately reviewed fixed HTTPS route and outbound policy, rebuilt source/image pins, secure owner secret provisioning, signed two-operation workload approval and one durable ledger. Those changes must be independently checked before any paid request. Do not use the smoke script or pass credentials to a worker.

Physical power-loss/fsync durability and browser/UI tests were not executed. Existing HIGH/moderate dependency advisories remain documented in [Phase 3 acceptance](audits/phase-3-final-acceptance.md) and its dependency snapshot. No fresh advisory lookup or dependency upgrade was performed. The legacy security script that reads normal secret configuration was not rerun; this task instead used sentinel scans, unchanged protected/production-source and lockfile checks, Git-ignore checks and container mock/mount inspections. No real credentials were inspected.

## Independent audit commands

Run sequentially, with Docker, Node 24 and pnpm. Supply no real credentials.

```bash
node scripts/openrouter-verification/build.mjs
node scripts/openrouter-verification/broker-build.mjs
GATE_A_DOCKER_TESTS=1 pnpm exec vitest run tests/openrouter
node scripts/openrouter-verification/broker-verify.mjs
node scripts/openrouter-verification/regressions.mjs
pnpm lint
pnpm typecheck
pnpm build
AI_PROVIDER=mock pnpm exec vitest run
git diff --check
```

Every test case provisions a distinct synthetic approval; run labels cannot replenish a given approval. Retain existing consumed ledgers and historical evidence. The normal stack need not be started for mock-mode/mount inspection, but its containers must exist for those probes. Stop for independent audit; live activation remains disabled.
