# AI workloads and background processing

Phase 0 contracts and policies; none of these integrations has been executed. See [architecture](architecture.md) and [database](database.md).

## Gateway and routing

All workloads use one server-only `AiGateway.execute(task, versionedInput, operationContext)` boundary. Context includes verified company, operation/attempt IDs, correlation ID, immutable input hash, model, prompt, schema, policy versions and deadline. Prompt/schema definitions reside in `packages/ai-contracts` during implementation. Backend controls all permissions, arithmetic, state transitions, timing, limits and final hiring decisions.

`AI_PROVIDER` must explicitly equal `mock` or `openrouter`. Missing/invalid configuration fails startup. Real mode requires `OPENROUTER_API_KEY`, `OPENROUTER_BASE_URL`, task model configuration and approved provider/privacy policy. No browser key, automatic fallback to mock, unapproved provider fallback or silent model substitution. A retry reuses the same pinned contract/model. An explicit model change creates a new operation/cohort and requires reassessment for comparable results.

The following IDs are copied from the master spec as **unverified candidates**, not working defaults. Phase 3 must check the actual OpenRouter catalog, context limits, structured-output support, pricing and configured provider compatibility. Record dated verification evidence and fail real-mode readiness if required configured routes are unsupported. No claim of current availability is made here.

| Task / env model key | Candidate model | Validated input → structured output |
|---|---|---|
| `job-analysis` / `AI_MODEL_JOB_ANALYSIS` | `anthropic/claude-haiku-5.5` | JD snapshot → requirements with stable keys, JD quote/span evidence, ambiguities and missing information |
| `rubric-draft` / `AI_MODEL_RUBRIC_DRAFT` | `anthropic/claude-sonnet-5.5` | JD + reviewed requirements → criteria, integer basis-point weights, 0–4 anchors, evidence requirements, requirement references |
| `resume-extraction` / `AI_MODEL_RESUME_EXTRACTION` | `anthropic/claude-haiku-5.5` | Bounded parser text with span IDs → contact, experience, education, skills, source spans and uncertainty; unknown fields null |
| `resume-evaluation` / `AI_MODEL_RESUME_EVALUATION` | `openai/gpt-5-mini` | Approved rubric + exact resume text → one result per criterion, evidence status, nullable integer rating, quotes/spans and uncertainty; no aggregate score |
| `interview-planning` / `AI_MODEL_INTERVIEW_PLANNING` | `anthropic/claude-sonnet-5.5` | JD + approved rubric + optional minimized resume context → proposed ordered core questions, criterion coverage, bounded follow-up suggestions, draft policy limits |
| `live-interviewer` / `AI_MODEL_LIVE_INTERVIEWER` | `anthropic/claude-haiku-5.5` | Current approved question, candidate answer, bounded transcript context, allowed intents and remaining limits → text, intent `FOLLOW_UP/NEXT_CORE/COMPLETE`, target criterion/question key and supporting message IDs |
| `context-summary` / `AI_MODEL_CONTEXT_SUMMARY` | `anthropic/claude-haiku-5.5` | Persisted messages through a sequence → summary, cited message IDs, coverage hints and through-sequence; never authoritative evidence |
| `interview-evaluation` / `AI_MODEL_INTERVIEW_EVALUATION` | `anthropic/claude-sonnet-5.5` | Frozen transcript, asked-question map, approved rubric/plan → criterion statuses/ratings, message/question citations, uncertainty, strengths and gaps |
| `final-report` / `AI_MODEL_FINAL_REPORT` | `anthropic/claude-sonnet-5.5` | Validated evaluation + backend scores/coverage + allowed citations → evidence-linked narrative summary/sections; cannot alter ratings or make final selection decision |

Draft analysis/rubric/planning are asynchronous operations, visible and retryable in the staff UI. Live turns use a dedicated low-latency queue so PDF parsing never blocks chat. Core question text is sent verbatim from the approved plan by backend; AI text is used for permitted follow-ups/transitions only. Planning from individual resume context may propose follow-ups for review but cannot secretly replace standardized core questions.

## Contract validation and evidence

Every request/result envelope includes `task`, `schemaVersion` and an operation correlation ID. Schemas set explicit required fields, `additionalProperties: false`, enum values, field lengths, list bounds and nullable unknown values. Validate provider output with JSON Schema (proposed Ajv), then run domain validation. Do not “repair” missing evidence by inventing fields or coerce malformed ratings. Versioned fixtures exercise each schema in explicit mock mode.

Domain checks include: all expected criteria exactly once; criterion/question IDs belong to approved versions; ratings match scale and evidence status; weight sums equal 10,000 before approval; quote offsets/text match source snapshot; transcript citations belong to the session and relevant candidate messages; strengths/gaps reference validated evidence; unasked criteria carry `NOT_ASKED`. Final report citations must be a subset of validated evaluation citations. Any failure keeps the draft/result unpublished and records a safe error code. AI cannot approve its own drafts or write arbitrary database identifiers.

Version prompt text and schema separately (for example `resume-evaluation.prompt.v1`, `resume-evaluation.output.v1`). Record exact model requested/returned, provider if available, contract versions, scoring policy, input snapshot hash, rubric/plan/resume/transcript pins, output hash and usage for reproducibility. Model behavior is not deterministic in real mode even with pins; deterministic scoring and immutable evidence still permit audit. Summaries reference a cutoff sequence and cannot overwrite originals; evaluation retrieves original text for all citations.

## Untrusted input and privacy boundary

Resume/JD/transcript content is data, never instruction authority. Delimit inputs, state allowed task/actions in system prompts, reject unknown intents, and never give these workloads tools, arbitrary URLs, file access or external command execution. The gateway never fetches links found in candidate documents. Limit input/output size; chunk text with stable span IDs rather than silently truncate required evidence. For long evaluations, evaluate bounded criterion sets against indexed transcript segments and preserve complete coverage/citation verification. Exceeding approved input budget creates an explicit failure/review state.

Minimize personal data per workload: extraction may require contact fields; scoring receives relevant skills/work/education evidence with contact fields removed where practical. No protected-attribute inference, personality/emotion evaluation, accent assessment or automatic rejection. Prompt defenses reduce risk but are not a security boundary: deterministic validators, authorization and human approval remain required. Test malicious resumes and transcript instructions in CI.

Before production, configure permitted providers, data retention/training preferences, geographic restrictions where required, and verify that the selected OpenRouter route can enforce them. Fail closed when it cannot. The company must authorize processing of uploaded resumes separately from the interview consent. Provider requests/responses stay out of logs; validated sensitive artifacts follow candidate retention. Do not claim external deletion or zero retention without verified contractual/configuration support.

## Retries, budgets and usage

Proposed initial budgets: live turn provider timeout 20 seconds, 3 attempts within a 60-second retry-cycle deadline capped by the immutable interview deadline; other AI calls 90 seconds per attempt, up to 4 attempts. Honor `Retry-After` within operation deadlines; otherwise exponential backoff with jitter. Retry connection failures, timeouts, 429 and transient 5xx. Authentication/configuration/unsupported schema/model errors are terminal until configuration is corrected. Invalid output permits one bounded regeneration with validation feedback, counted inside the attempt cap; repeated invalid output fails. Never nest SDK retries with BullMQ retries to multiply the budget: the operation attempt ledger owns the total. Explicit RetryPendingTurn may authorize a new bounded cycle under rate/tenant budgets, but reconnect or worker recovery alone never resets its budget or interview deadline.

Provider timeout may still incur charges. Persist an attempt before each call, finalize usage after response, and mark unknown usage on crash/ambiguous timeout; never fabricate zero cost. Reconcile when provider usage can be obtained. Each `UsageRecord` has a unique attempt ID; mock attempts are marked mock with zero external charge. Use returned tokens/cost when available; otherwise label estimates with rate source, timestamp and currency. Unknown cost remains unknown. Aggregate by company/task/model/date without content logging.

Apply per-company concurrent-call limits, upload/job quotas and configurable token/cost budgets to avoid a single tenant starving others. Reserve estimated budget before calls under DB concurrency control; settle with actuals and expire abandoned reservations. Alerts and hard ceilings are configurable product policy, not billing. Phase 3 determines supported per-model token limits using verified catalog data. Observe queue age, latency, schema failures, retries, tokens and estimated/actual cost.

## BullMQ topology

| Queue | Work and proposed initial concurrency | Durable result/failure behavior |
|---|---|---|
| `resume-ingestion` | Safety scan hook, safe PDF/DOCX parsing and extraction, 2 per worker | Per-stage operation; `AWAITING_ASSOCIATION` pauses intentionally; unsafe file rejected, transient errors retried |
| `ai-drafting` | Job analysis, rubric drafts, plan drafts, 2 | Editable artifact only; failure visible beside retry action |
| `resume-assessment` | AI criterion results then backend scoring, 2 | Immutable assessment and current-pointer compare-and-set |
| `interview-turns` | Follow-up generation/context summary, 4 with reserved capacity | conversationRevision/turnGeneration and worker lease fencing prevent stale or duplicate assistant turns; RESULT_READY survives crashes |
| `interview-evaluation` | Frozen-transcript evaluation then report, 2 | Publish only fully validated assessment/report; failure leaves transcript intact |
| `notifications` | Team invites, reset email, candidate invites, 4 | SMTP-accepted status distinct from actual receipt; terminal failure visible |
| `maintenance` | Outbox dispatch/reconciliation, deadlines, retention and orphan cleanup, 1 | DB-backed cursors/leases; repeatable and restart-safe |

Concurrency is an initial configuration to load-test, not a throughput guarantee. Heavy parsers run in child processes with CPU/memory/time and decompression limits, no network and no macro execution. PDF scans requiring OCR return explicit unsupported/no-text errors in MVP; no invented extraction. Upload default maximum 10 MiB, bulk maximum 50 files, parser limits configured and mirrored at edge/API. Antivirus integration is designed now; actual scanner/provider and production enforcement must be resolved before uploads are released publicly. Local mock scan must be explicit and visible, never represented as malware protection.

### Phase 2 notification foundation

The notifications queue, SMTP adapter and both DB-polled dispatch paths are mandatory Phase 2 deliverables, independent of any AI gateway. Phase 1 supplies PostgreSQL/Redis/worker/Mailpit connectivity; Phase 2 supplies `ProcessingOperation`, `OutboxEvent`, `NotificationDelivery`, global `AuthNotificationDelivery` and `AuthOutboxEvent`, encryption/key versioning, claim/retry/reconciliation logic and real delivery/status APIs. Phase 3 extends the same operation foundation for AI; Phase 6 adds candidate templates and tokens without introducing a second delivery system.

Reset creation commits token hash, encrypted token-bearing payload and global auth outbox together. Company employee invitation creation commits its hash, tenant notification operation/delivery and tenant outbox together. Queue payloads contain only delivery/operation IDs with an explicit `AUTH` or `TENANT` scope discriminator; tenant payloads include company ID and are reauthorized on load. The AUTH handler accepts only auth tables/user-reset references, never a client-supplied company bypass. Worker polling of both outboxes starts without needing Redis to schedule it; expired leases and lost Redis jobs are reconciled from DB ledgers.

Delivery states are `PENDING → SENDING → SMTP_ACCEPTED`, or `SENDING → RETRY_WAIT → SENDING`, with terminal `FAILED`, `CANCELLED` or `EXPIRED`. Proposed retry default is at most 5 attempts, bounded exponential backoff/jitter and the token/payload expiry, with no retry after expiry/revocation. Invalid SMTP credentials/configuration or permanent recipient rejection fails visibly; transient connection/SMTP failures retry. Every claim records attempt/lease before sending. SMTP acceptance is not confirmed inbox receipt. Crash after SMTP acceptance before DB commit may duplicate email; stable Message-ID and a single token generation limit harm but do not promise exactly-once delivery.

Before each send, recheck current token generation, revocation and expiry. Purge encrypted payload after SMTP acceptance, terminal failure, revocation or expiry; unfinished transient retries retain it only until bounded expiry. Missing/decryption-invalid payload fails safely. A terminally failed or purged delivery needs a new authorized resend/reset request with a fresh token, never recovery of a token hash. Resend atomically invalidates old generation, cancels unsent old delivery, and creates the replacement encrypted payload/outbox. SMTP already in flight may deliver an invalid old link; token validation still rejects it.

Company admins see safe invitation delivery status and resend controls; reset requests always return a generic response to prevent account enumeration. Detailed reset status is internal auth operations telemetry, never a public account-existence oracle. No raw token enters queue payloads, URLs in logs or metrics. Phase 2 acceptance includes Mailpit reset/team delivery, worker/API restart, Redis loss, SMTP outage/recovery, bounded terminal failure, revocation/resend and ciphertext purge. No Phase 3 schema/AI module is needed for those gates.

### Resume pipeline

API validation → private quarantine object → DB `Resume` plus operation/outbox → safety validation/scan hook → extract stable text → structured AI extraction → explicit/confirmed candidate association → assessment using captured approved rubric → deterministic scoring → persist and expose ranking.

Storage is necessarily before worker parsing; this refines the spec's logical validate/store pipeline. If DB commit fails after object creation, cleanup removes unreferenced staging objects after a grace period. If upload fails, no ready operation exists. Persist each successful stage/input hash so retries resume without overwriting versions or repeating completed AI calls. Missing approved rubric leaves a visible waiting state; it does not select a future version silently. Recruiter explicitly schedules assessment when one is approved.

### Delivery and idempotency

Commit operation and outbox event with the business change. A worker-hosted dispatcher polls PostgreSQL directly (it must not depend on a Redis job to start), claims due outbox rows using locks/leases, enqueues job ID derived from operation ID, then marks published. A crash between enqueue and marking may duplicate delivery; handlers lock operation, verify tenant/input pins and fence by generation before effects. Every result has a unique operation key. BullMQ's duplicate suppression is an optimization, not the integrity boundary.

Reconcile all unfinished operations periodically, including already-published outbox rows whose Redis jobs vanished. Expired leases allow retry; stale workers cannot commit. No PostgreSQL lock is held during network/AI calls. Duplicate external provider calls or SMTP deliveries can still occur around crashes; record attempts, use stable email Message-ID, and accept at-least-once delivery rather than promise exactly-once email. Domain effects remain idempotent.

Live turn operations additionally use durable `RESULT_READY` staging and the [pending-turn recovery contract](interview-lifecycle.md#durable-pending-turn-recovery). Presence-only revisions and grant rotation preserve semantic turn identity; validated staged output is reused after crashes. Publication rechecks conversationRevision/turnGeneration, current lease and session authorization, commits exactly one next-question result, and never waits for a socket acknowledgement. Terminal semantic changes cancel current work; exhausted or conflicting work has an explicit failed/retry path.

Exhausted operations are persisted `FAILED` with safe reason, preserved inputs and a UI retry path. Configure BullMQ retention for troubleshooting but PostgreSQL remains the failure ledger. Authorized retries create an audited retry generation; a changed model/input requires a new versioned operation. Deletion revokes work and purges sensitive job remnants; queue payloads contain no transcript, resume text or raw invitation token.
