# Phase 0 independent findings

Audit date: 2026-10-27. Baseline is the ten source documents, read completely. No application exists to test. Findings describe design gaps and possible failure paths, not demonstrated production exploits. Source documents were not repaired in this audit.

Severity totals: **0 CRITICAL, 2 HIGH, 2 MEDIUM, 1 LOW**. One distinct architectural contradiction (F01), appearing in two requirement rows. The incomplete recovery and dependency contracts are gaps, not additional counted contradictions.

## F01 — Invitation expiry has inconsistent pre-start semantics

- **Severity:** MEDIUM.
- **Requirements:** R10-02, R11-02, R18-05 (master §§10–11, 18).
- **Evidence:** [interview-lifecycle.md:7](../interview-lifecycle.md) says expiry gates new link exchange and does not interrupt an already authorized session before its deadline. Lines 9–11 create an authorized `CREATED` session on exchange but set a deadline only on start. The state diagram, lines 28–29, cancels both `CREATED` and `READY` on expiry; the state table, line 36, refers to an “unused invitation” although exchange has already created the session.
- **Explanation:** A candidate exchanges a link shortly before expiry, consents, then starts after expiry. The prose supports continuing with the grant, while the diagram requires cancellation. It is unclear whether “already authorized” means exchanged or started and which expiry (invitation versus grant) cancels READY. This is a conflict in authorization/state policy, not a missing implementation detail.
- **Correction:** Specify a table for invitation expiry, grant expiry, revocation and withdrawal in every collection state. State explicitly whether exchanged-but-unstarted sessions may start after link expiry; align prose/diagram and identify the sweep and start-command checks. Preserve deadline-based continuation for already-started sessions if that is the chosen policy.
- **Verification:** Exchange before expiry; cross expiry in CREATED, READY and IN_PROGRESS; race start against expiry; test grant expiry independently.
- **Blocks Phase 1:** No independent foundation dependency; **yes under the requested exit gate**, which prohibits any unresolved contradiction. Medium severity reflects that the foundation itself remains feasible.

## F02 — Pending AI turn recovery lacks a revision reconciliation contract

- **Severity:** HIGH.
- **Requirements:** R11-06, R18-05 (master §§11, 18).
- **Evidence:** [interview-lifecycle.md](../interview-lifecycle.md), “Commands, ordering and commit protocol,” lines 82–84, captures state revision and rejects provider results unless it still matches. “Reconnect and failures,” lines 92–94, changes state on disconnect/recovery and forbids a second answer while a turn is pending. [ai-workloads.md](../ai-workloads.md), “Delivery and idempotency,” redispatches unfinished operations with pinned inputs but does not specify how session revision/generation is refreshed following nonterminal presence transitions.
- **Explanation:** An answer commits at revision r and its AI task starts. A disconnect moves the session to INTERRUPTED; reconnect moves it back to IN_PROGRESS with a later revision. The old result cannot commit. The documents do not say who clears/replaces the pending turn, whether the same accepted answer is regenerated under a new generation, or how an operation discarded for revision mismatch reaches a retryable state. Redis reconciliation alone does not resolve a permanently stale captured revision. The core recovery journey is therefore unverified, even though transcript durability and general retry design are strong.
- **Correction:** Define an atomic recovery command that either preserves a valid semantic turn generation across presence-only state changes or cancels/replaces the old task and creates a new pending generation/outbox from the already accepted answer. Specify operation terminal/retry states, authorization after grant rotation, and exactly-one next-question publication. Distinguish stale terminal results from recoverable revision mismatches.
- **Verification:** Disconnect/reconnect while provider call runs, restart before stale result disposal, rotate recovery grant while pending, recover after exhausted retries; assert one accepted answer, one next question, no permanently pending turn and unchanged deadline.
- **Blocks Phase 1:** **Yes under the Phase 0 exit gate:** important recovery behavior is not fully designed. This does not mean scaffolding technically depends on an AI turn implementation.

## F03 — Phase 2 durable auth email depends on unspecified earlier dispatcher work

- **Severity:** HIGH.
- **Requirements:** R17-03 (master §§7, 17; registration/team/reset journey).
- **Evidence:** [database.md](../database.md), “Supporting durable workflow tables,” requires global `AuthNotificationDelivery`/`AuthOutboxEvent`, encryption/expiry/retries and an auth-only dispatcher; tenant invitations use tenant notification operations. [implementation-plan.md](../implementation-plan.md), Phase 2, lines 43–45, requires working team acceptance and reset and says notification abstractions “may start” with needed functionality. Phase 3, line 49, introduces the durable operation/outbox framework. Phase 6, lines 67–69, assigns encrypted notification payload and delivery/retry work. [ai-workloads.md](../ai-workloads.md), “Delivery and idempotency,” requires a DB-polled worker dispatcher.
- **Explanation:** The plan acknowledges early notification needs but does not allocate the durable dispatcher/ledger and encrypted-token delivery prerequisites to Phase 2, or define an interim interface/implementation consistent with the final architecture. Phase 2's browser acceptance requires actual reset/team email; an abstract notification interface alone cannot deliver it. Implementers must pull later framework work forward or invent a temporary delivery design. This is a forward dependency gap; no inevitable cycle is asserted.
- **Correction:** Explicitly deliver minimum shared notification persistence, global auth dispatch, tenant invitation dispatch, encrypted payload handling and SMTP adapter in Phase 2, with contracts extended by Phases 3/6. Alternatively document a concrete secure interim delivery strategy and replacement/migration gate. Add SMTP outage/restart and token-payload purge tests to Phase 2.
- **Verification:** Demonstrate Phase 2 reset/team flows through Mailpit, durable recovery after worker/API restart, no raw tokens in queue/logs, and no dependency on Phase 3 schema/modules.
- **Blocks Phase 1:** **Yes under the Phase 0 exit gate:** the phased dependency contract is incomplete. No request to implement Phase 2 now.

## F04 — One-active-attempt policy lacks cross-invitation enforcement

- **Severity:** MEDIUM.
- **Requirements:** R10-02, R18-05 (master §10 attempt policy).
- **Evidence:** [interview-lifecycle.md](../interview-lifecycle.md), “Ownership, invitation and start,” line 7, allows one active attempt per candidacy. [database.md](../database.md), “Tables and relationships,” makes session invitation FK unique and stores attempt ordinal, but “Additional integrity rules and indexes” gives no active-attempt reservation/constraint. Lifecycle commands lock sessions, not a candidacy shared by multiple invitations.
- **Explanation:** One session per invitation does not prevent two active sessions for two separately issued invitations to the same candidacy. Idempotency of identical issuance requests also does not serialize different request keys. A policy is documented, but its enforcement boundary and active-state definition are missing. Tenant composite FKs do not fix this within-tenant race.
- **Correction:** Define active states and serialize issuance/exchange on JobCandidate, or use a tenant/candidacy active-attempt reservation with a unique constraint and atomic release on the selected terminal states. Specify attempt ordinal uniqueness and re-invite behavior while a prior attempt remains active.
- **Verification:** Concurrent distinct invitations/exchanges for one candidacy produce at most one active attempt; another candidacy remains unaffected; terminal release permits a deliberate new attempt.
- **Blocks Phase 1:** No independent foundation blocker; incomplete coverage nevertheless prevents a full Phase 0 PASS under the supplied gate.

## F05 — Some mandated implementation details are only present in the master specification

- **Severity:** LOW.
- **Requirements:** R04-04, R05-01, R08-02 (master §§4–5, 8).
- **Evidence:** [architecture.md](../architecture.md), “Backend modules and public boundaries,” specifies DTO validation/OpenAPI but not class-validator/class-transformer. Its module/frontend/package layout and [implementation-plan.md](../implementation-plan.md) Phase 1 cover the main tree but do not explicitly allocate all specified worker/infrastructure/test paths and root files. [database.md](../database.md), `Job` row, says “status” without declaring the five job enum values or explicitly adopting the master enum (unlike its RecruiterDecision row).
- **Explanation:** These are small documentation omissions, not incompatible technology choices. A competent implementer could consult the master spec, but the requested audit explicitly disallows treating undocumented design as covered. There is no evidence that a different validator, layout or job enum was chosen.
- **Correction:** Explicitly adopt the required DTO libraries, reference/adopt the complete target repository tree and job enum in the design/phase scope. No implementation needed.
- **Verification:** Documentation cross-check and, in the appropriate later phase, manifests/tree/DTO/enum tests.
- **Blocks Phase 1:** No independent blocker; rows remain partial until documented, so the strict all-requirements gate still fails.

## Items not classified as defects

RLS deferral is an explicit tradeoff backed by scoped repositories, composite tenant FKs and negative tests; it is not evidence of a tenant bypass. Approved plan introduction in Phase 6 and shortlist in Phase 5 explicitly resolve later-phase dependencies. First question is emitted verbatim from the approved plan, so an extra model call is unnecessary. Global auth-only tables are explicit exceptions to tenant-owned tables, including the later-listed auth notification tables; they are not contradictory tenant leakage. Candidate consent is session-linked and collected after session creation, before start. An optional future platform support procedure does not confer current operator access. Model IDs, privacy jurisdiction, scanner choice, retention periods and recovery targets are acknowledged integration/production decisions; no live availability or legal compliance is claimed. Lack of application tests in a documentation-only phase is expected, not a finding.
