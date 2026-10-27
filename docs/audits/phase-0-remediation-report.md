# Phase 0 remediation report

Date: 2026-10-27, subsequent to the independent audit. Scope: documentation corrections only. **Remediation is ready for independent re-audit; this report does not declare Phase 0 independently verified or authorize Phase 1.**

## Evidence and disposition

Read completely: AGENTS.md, MASTER_SPEC.md, PHASE_0.md, all seven design/progress documents and all three audit documents. Initial combined output was truncated; bounded follow-up reads covered the omitted content. Repository status remains untracked starter/design documentation. Pre-edit SHA-256 hashes were recorded in `/tmp/phase0-remediation-baseline.json` for preservation checks.

The historical [verification report](phase-0-verification-report.md) remains **FAIL**: 151/159 covered, six partial, two contradictory rows, 29/35 content checks, zero critical, two high, two medium and one low finding. The original [requirements matrix](phase-0-requirements-matrix.md), [findings](phase-0-findings.md) and verification report are preserved byte-for-byte. This report supplies subsequent corrective evidence instead of relabeling the auditor's judgments.

All five findings were confirmed against the master and original design. F01 is an internal design contradiction; the master requires expiration but does not choose pre-start semantics. F02 and F03 are missing recovery/dependency contracts, not inherently impossible architectures. F04 requires enforcement of the design's chosen attempt policy; the master does not require a new lifetime numeric cap. F05 identifies exactly three missing details in the matrix, not permission to introduce a different stack or product scope. No master-spec contradiction requires changing MASTER_SPEC.md.

## F02 — HIGH: pending-turn recovery

- **Original problem:** accepted answer at revision r could be stranded when disconnect/reconnect changed the revision and the worker could no longer commit.
- **Root cause:** a general state revision was used as a semantic AI-result fence; stale-response disposal, durable response staging and failed-turn recovery were underspecified.
- **Resolution:** separate general `revision`, `conversationRevision`, `turnGeneration` and worker `leaseGeneration`. Presence changes and grant rotation preserve semantic turn identity. Persist accepted answer/operation/outbox atomically, then durable request attempt, validated response artifact with RESULT_READY, and finally one atomic next-question publication. Explicit recovery covers running, queued, staged, expired-lease, exhausted and invariant-conflict cases. Retry reuses the accepted answer, not a new candidate submission; terminal changes invalidate work. Unique response keys and sequence allocation prevent duplicate/out-of-order publication. Authenticated browser commands check the current grant; workers check continuing session consent/revocation rather than an old browser grant.
- **Modified files:** architecture.md, database.md, ai-workloads.md, interview-lifecycle.md, implementation-plan.md; progress/report record disposition.
- **Supporting evidence:** master §§11, 18; [Durable pending-turn recovery](../interview-lifecycle.md#durable-pending-turn-recovery), [Attempt and turn integrity](../database.md#attempt-and-turn-integrity), [Delivery and idempotency](../ai-workloads.md#delivery-and-idempotency), Phase 7A–7C and 10 gates.
- **Remaining risks:** real DB locking/fencing and crash windows need integration/fault testing; ambiguous external calls may still be billed twice. Exactly-one local publication does not imply exactly-once provider execution or socket delivery. No runtime proof is claimed.
- **Local disposition:** corrected in design, pending independent review.

## F03 — HIGH: Phase 2 notification dependency

- **Original problem:** password resets and employee invitations were accepted in Phase 2, but durable outbox infrastructure and secure token delivery were allocated vaguely or to later phases.
- **Root cause:** phase scope said notification abstractions “may start” early without assigning their required concrete persistence/dispatch behavior.
- **Resolution:** Phase 2 explicitly owns SMTP adapter, notifications processor, tenant operation/delivery/outbox and global auth delivery/outbox tables, encrypted payload/key handling, DB-polled dispatcher, leases, bounded retries, recovery, status and purge. Token hash + delivery request + outbox commit together. Phase 1 supplies connectivity; Phase 3 adds AI-specific columns/contracts; Phase 6 reuses the notification foundation. Phase 2 has no later-domain schema/import dependency. Reset status is internal; public reset responses remain enumeration-safe.
- **Modified files:** architecture.md, database.md, ai-workloads.md, infrastructure.md, implementation-plan.md; progress/report record disposition.
- **Supporting evidence:** master §§2, 7, 17; [Phase 2 notification foundation](../ai-workloads.md#phase-2-notification-foundation), [Supporting durable workflow tables](../database.md#supporting-durable-workflow-tables), [Phase 2 plan](../implementation-plan.md#phase-2--authentication-membership-and-isolation), infrastructure service phase ownership.
- **Remaining risks:** SMTP acceptance cannot prove receipt; crashes around acceptance may duplicate email. Phase 2 must test actual Mailpit delivery, outage/restart, queue loss, token rotation and payload purge. Those tests have not run.
- **Local disposition:** corrected in design, pending independent review.

## F01 — MEDIUM: invitation expiration

- **Original problem:** prose allowed an “already authorized” session to continue after link expiry while the diagram cancelled exchanged-but-unstarted CREATED/READY sessions.
- **Root cause:** acceptance, consent, start, invitation expiry and grant expiry were conflated.
- **Resolution:** invitation `expiresAt` is an immutable acceptance/start cutoff (proposed seven days). Acceptance records acceptedAt/CREATED; consent yields READY; start must occur strictly before expiresAt under lock. Expiry cancels unstarted sessions even after acceptance/consent. Once started, deadlineAt governs collection. Grant expiry denies access without resetting/cancelling an otherwise authorized turn. Resend rotates credentials without extending expiry; a purpose-restricted recovery token can resume only the existing started session before deadline. Explicit revocation/withdrawal terminates collection. Per-state policy table, sweep and command predicates now agree.
- **Modified files:** architecture.md, database.md, interview-lifecycle.md, implementation-plan.md; progress/report record disposition.
- **Supporting evidence:** master §§10–11; [Ownership, invitation and start](../interview-lifecycle.md#ownership-invitation-and-start), [Expiry policy](../interview-lifecycle.md#expiry-access-and-cancellation-policy), [State machine](../interview-lifecycle.md#state-machine), database invitation/session fields.
- **Remaining risks:** the seven-day value remains an owner-review default. Database-time boundary behavior, start-versus-sweep races, grant expiration and recovery-token purpose must be tested in 6/7A/10.
- **Local disposition:** contradiction removed from active design, pending independent review.

## F04 — MEDIUM: attempts across invitations

- **Original problem:** unique session/invitation prevented reuse of one token but did not prevent different invitation tokens from creating parallel attempts for the same job candidacy.
- **Root cause:** the active-attempt policy lacked a shared reservation, live-state definition, uniqueness constraint and parent transaction lock.
- **Resolution:** JobCandidate owns InterviewAttempt ordinals; issuance reserves one attempt before acceptance. Partial unique `(companyId,jobCandidateId) WHERE closedAt IS NULL`, state/closedAt check, ordinal uniqueness, and same-attempt composite invitation/session FKs enforce scope. Parent-first locks serialize distinct issuance/acceptance/start/re-invite operations. RESERVED includes unaccepted/CREATED/READY; ACTIVE includes IN_PROGRESS/INTERRUPTED. Expiry/cancel/completion closes the reservation atomically; evaluation does not reopen or reserve collection. Only an explicit recruiter action after closure can allocate a new ordinal. Resend/recovery changes credentials on the existing invitation and cannot create another attempt.
- **Modified files:** architecture.md, database.md, interview-lifecycle.md, implementation-plan.md; progress/report record disposition.
- **Supporting evidence:** master §10; [Attempt ownership across invitations](../interview-lifecycle.md#attempt-ownership-across-invitations), [Attempt and turn integrity](../database.md#attempt-and-turn-integrity), Phase 6 issuance and Phase 7A acceptance/constraint gates.
- **Remaining risks:** SQL partial-index/check/composite-FK implementation and multi-transaction race behavior are untested. Identity matching is still company-scoped; creating a genuinely different Candidate is not the same JobCandidate and remains subject to existing recruiter identity review, not automatic AI merging.
- **Local disposition:** enforcement contract supplied, pending independent review.

## F05 — LOW: omitted mandatory details

- **Original problem:** class-validator/class-transformer, complete target layout and exact job statuses were not explicit in the implementation design.
- **Root cause:** broad references to validation, folders and status relied on readers returning to the master instead of adopting those details explicitly.
- **Resolution:** explicitly adopt NestJS TypeScript DTO libraries and Swagger/OpenAPI; adopt all master §5 target paths with phase allocation, including worker processors/queues, infrastructure folders, tests/e2e and root files. Job enum is exactly DRAFT, ACTIVE, PAUSED, CLOSED, ARCHIVED; status meaning is documented, further transition guards remain explicit Phase 3 assumptions. Phase 1/3 acceptance names stack/layout/enum checks. No source tree is scaffolded.
- **Modified files:** architecture.md, database.md, implementation-plan.md; progress/report record disposition.
- **Supporting evidence:** master §§4–5, 8; [Mandatory stack and repository layout](../architecture.md#mandatory-stack-and-repository-layout), backend boundaries, database Job row and Phase 1/3 plan.
- **Remaining risks:** manifests, DTO behavior, generated tree and enum guards remain future implementation checks. No additional mandatory gaps were found in the supplied matrix during local review.
- **Local disposition:** omissions restored, pending independent review.

## Requirements matrix follow-up

The following are all eight non-covered rows in the historical matrix. This is local corrective traceability, **not an independently approved replacement coverage score**. The other 151 rows retain their design evidence; the core architecture and required services remain intact. Independent re-audit should recompute all 159 rows and all 35 completeness checks against the corrected documents.

| Requirement ID | Historical status | Finding | Corrective evidence / future gate |
|---|---|---|---|
| R04-04 | PARTIALLY_COVERED | F05 | architecture backend boundaries explicitly name class-validator/class-transformer and Swagger/OpenAPI; Phase 1/2 DTO gates |
| R05-01 | PARTIALLY_COVERED | F05 | architecture complete layout adoption and path/phase table; Phase 1 tree/manifests gate |
| R08-02 | PARTIALLY_COVERED | F05 | database Job row and status meanings; Phase 3 exact enum/guard tests |
| R10-02 | CONTRADICTORY | F01,F04 | lifecycle per-state expiry/attempt tables and database reservation constraints; Phase 6/7A token/concurrency tests |
| R11-02 | CONTRADICTORY | F01 | lifecycle start cutoff, diagram, state table and expiry sweep/command consistency; Phase 7A transition tests |
| R11-06 | PARTIALLY_COVERED | F02 | lifecycle semantic revision, request/staged-result/publication recovery; database uniqueness and Phase 7A–7C crash/reconnect gates |
| R17-03 | PARTIALLY_COVERED | F03 | Phase 2 delivery schemas/dispatch/SMTP/status fully allocated before acceptance; Phase 3/6 extension only |
| R18-05 | PARTIALLY_COVERED | F01,F02,F04 | combined expiry/attempt/recovery gates repeated in Phase 10 full deployment verification |

The six originally failed completeness checks now have corrective evidence: architecture stack/layout (F05); database integrity/attempts/job enum (F04/F05); lifecycle transitions (F01); lifecycle concurrency/recovery (F02); phase dependency contracts (F03); progress accuracy (latest status explicitly retains historical FAIL and awaits re-audit). This is an author's review, not an auditor's PASS.

## Local consistency review

Manual document reasoning, not executed system scenarios:

| Scenario / boundary | Expected outcome specified consistently |
|---|---|
| Exchange then expiry in CREATED or READY | Cancellation and EXPIRED reservation; consent/valid earlier acceptance cannot authorize a late start |
| Start races expiry | Parent-first locks and fresh DB time; strict `now < expiresAt`; sweep and command use same rule |
| Invitation expiry after start | Existing valid grant and session continue only until original deadline; expired START token cannot exchange |
| Grant expiry / recovery rotation during AI call | Browser reauth required; semantic turn and deadline unchanged; worker validates session authorization |
| Two invitation requests with distinct keys | Shared JobCandidate lock plus partial unique reservation; only one live attempt can exist |
| Old token after re-invite / completed attempt | Closed reservation and invalid generation cannot reopen collection; explicit new ordinal/session only |
| Disconnect/reconnect during RUNNING | General revision changes; conversation revision and turn identity remain valid |
| Crash before / after RESULT_READY | Before: bounded retry may repeat provider call; after: reuse staged artifact, acquire publication lease, publish once |
| Lost ack / concurrent answer / stale worker | Exact key returns original result; conflicting key/question denied; stale lease/generation cannot publish |
| Failed turn then explicit retry | Same accepted message/operation, new fenced bounded cycle, no deadline extension; reconnect alone cannot reset budget |
| Completion/revocation races response | Parent-first terminal transaction invalidates pending work; stale response discarded, no late transcript append |
| Phase 2 with Phase 3/6 absent | Auth/team notification schemas and worker dispatch already present; Mailpit, retry/failure/status gates are achievable independently |
| Tenant relationships | Attempt/invitation/session/message/operation links include company and stronger same-parent tuples; global auth delivery remains separate |
| Infrastructure | Same nine services, networks, secrets, migrations, health, volumes and startup design retained; notification phase ownership clarified only |

## Documentation verification and scope

The following documentation checks were actually executed: No application, DB, queue, AI, SMTP, Compose, unit, integration or browser runtime tests were run. Mermaid source is reviewed but not rendered. Structural validators cannot establish transactional correctness or independent design approval.

Files modified: `docs/architecture.md`, `docs/database.md`, `docs/ai-workloads.md`, `docs/interview-lifecycle.md`, `docs/infrastructure.md`, `docs/implementation-plan.md`, `docs/progress.md`. File created: this report. AGENTS.md, README.md, MASTER_SPEC.md, PHASE_0.md and the three original audit artifacts remain unchanged. No dependencies, infrastructure configuration or application code were created.

No confirmed finding is intentionally left without a documentation resolution. All F01–F05 closures remain subject to independent review. Existing production decisions (privacy/retention, provider/model verification, scanner, deployment and recovery targets) remain explicit later gates, not newly hidden blockers. **Next step: independent re-audit of corrected Phase 0. Do not start Phase 1.**

### Executed documentation checks

- `git status --short && rg --files --hidden -g '!.git' && cat AGENTS.md docs/MASTER_SPEC.md docs/PHASE_0.md`, followed by complete `cat`/bounded `sed` reads of the remaining requested files — repository/spec/audit review completed. Combined truncation was resolved with the recorded bounded follow-up reads; no missing evidence was assumed.
- Inline Python SHA-256 baseline capture to `/tmp/phase0-remediation-baseline.json` before editing — succeeded; used to check preservation, not a committed baseline.
- `rg -n 'expiry|expiresAt|generation|revision|Phase 2|Phase 3|Phase 6|attempt|RESULT_READY' docs/interview-lifecycle.md docs/database.md docs/implementation-plan.md docs/ai-workloads.md docs/architecture.md docs/infrastructure.md` — cross-reference search; large output was only a navigation aid, not a semantic PASS.
- `python3 /tmp/validate_phase0_remediation.py` — **PASS**: protected-file hashes and documentation-only scope; nonempty documents, final newlines, no trailing whitespace, balanced fences, relative links/heading anchors; preserved 159 unique historical rows and 151/6/2 counts; exact follow-up for all eight non-covered rows; complete F01–F05 resolution fields; all 13 phase headings; explicit Phase 2 notification dependencies; all nine services; 21 core entities plus attempt reservation; required lifecycle state/recovery/integrity markers and removal of the old conflicting phrases.
- `git diff --check` — exit 0, limited evidence because files are untracked; the Python validator directly checked changed documents.
- `git status --short` — `?? AGENTS.md`, `?? README.md`, `?? docs/`; no application tree created. Hash/file-scope checks provide the more precise changed-file evidence.

No documentation validation failures remain. The local manual scenario review above supports submitting the corrections for re-audit; it is not an independent coverage score or runtime correctness finding. Validator scripts live only in `/tmp`, not application or repository test directories. Independent re-auditing is recommended and required before considering Phase 0 acceptance or requesting Phase 1 authorization.
