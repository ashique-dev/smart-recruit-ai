# SmartRecruit AI — Master Product & Engineering Specification

**Repository:** `smart-recruit-ai`  
**Product:** SmartRecruit AI  
**Status:** Source of truth for phased implementation  
**Initial interview modality:** Text only

## 1. Product mission
Build a multi-tenant B2B SaaS that enables companies to upload externally collected resumes, assess candidates against job-specific approved rubrics, invite shortlisted candidates to structured AI-led **text interviews**, review evidence-backed interview assessments, and make **human-controlled** recruiting decisions. This is not a job board or public application collection system.

## 2. End-to-end user journey
1. Company administrator registers, creates workspace, signs in.
2. Admin invites recruiters and viewers; members accept invitations.
3. Recruiter creates a job and provides its job description.
4. AI drafts job requirements and weighted assessment rubric; recruiter edits and explicitly approves a version.
5. Recruiter uploads one or many PDF/DOCX resumes against the job.
6. Files are privately stored; asynchronous workers extract text and structured candidate information.
7. AI assesses each resume against the approved job rubric with cited resume evidence and explicit insufficient-evidence indicators.
8. Backend computes deterministic rubric-weighted scores and shows job-scoped rankings; recruiters review and shortlist.
9. Recruiter drafts/approves interview plan and invites candidates using secure expiring links; email delivered through SMTP (Mailpit locally).
10. Candidate opens invitation, reviews privacy notice and instructions, records consent, and begins text interview.
11. AI asks approved core questions and bounded follow-ups; backend orchestrator controls state, competency coverage, time, and completion. Messages/events are durably persisted.
12. On completion, background worker evaluates transcript against approved rubric and produces evidence-linked assessment and report.
13. Recruiter views resume and interview assessments separately, examines evidence, and records human decision.
14. Company reviews activity and AI usage metrics.

## 3. Scope exclusions and future extension
**Do not implement** `media/`, `mediasoup/`, `transports/`, `producers/`, `consumers/`, WebRTC, RTP, ICE, DTLS, camera/microphone capture, STT, TTS, audio, or video. Interview communication is text via Socket.IO/WebSocket, with durable REST-based session recovery. Separate `InterviewOrchestrator` business logic from `TextInterviewGateway` transport so a future media adapter can reuse the orchestrator without rewriting it. No public job applications, payment processing, or subscription billing in the MVP.

## 4. Mandatory stack
- **Frontend:** React.js, TypeScript, Vite, React Router, Tailwind CSS, shadcn/ui, TanStack Query, React Hook Form, Zod. Zustand only if justified. **Do not use Next.js.**
- **Backend:** NestJS, TypeScript, REST, Socket.IO or WebSocket for text events, class-validator/class-transformer, Swagger/OpenAPI.
- **Database:** PostgreSQL + Prisma, migrations (no production `db push`).
- **Background processing:** Redis + BullMQ, independent worker process.
- **Object storage:** MinIO in local Compose; S3-compatible abstraction for future production.
- **AI:** OpenRouter server-side gateway with mock and real modes; JSON schema validation.
- **Email:** SMTP abstraction, Mailpit locally.
- **Infrastructure:** pnpm workspace monorepo, Docker, Docker Compose, Nginx reverse proxy, persistent volumes, health checks.
- **Testing:** Jest or Vitest as appropriate, Playwright for browser E2E; deterministic mock AI for CI.

## 5. Target repository structure
```text
smart-recruit-ai/
├── AGENTS.md
├── apps/
│   ├── web/
│   │   ├── src/{app,components,features,hooks,lib,routes,services,types}/
│   │   ├── Dockerfile
│   │   └── package.json
│   ├── api/
│   │   ├── src/{auth,companies,memberships,jobs,candidates,resumes,resume-assessments,candidate-rankings,interview-invitations,interview-sessions,interview-engine,interview-assessments,ai-gateway,notifications,storage,usage,audit,common}/
│   │   ├── prisma/
│   │   ├── Dockerfile
│   │   └── package.json
│   └── worker/
│       ├── src/{processors,queues}/
│       ├── Dockerfile
│       └── package.json
├── packages/
│   ├── shared/
│   ├── config/
│   └── ai-contracts/
├── infrastructure/
│   ├── nginx/
│   ├── postgres/
│   └── minio/
├── tests/e2e/
├── docs/
│   ├── MASTER_SPEC.md
│   ├── PHASE_0.md
│   ├── architecture.md
│   ├── database.md
│   ├── ai-workloads.md
│   ├── interview-lifecycle.md
│   ├── infrastructure.md
│   ├── implementation-plan.md
│   └── progress.md
├── docker-compose.yml
├── docker-compose.dev.yml
├── .env.example
├── pnpm-workspace.yaml
├── package.json
└── README.md
```
This is the intended end-state; Phase 0 creates documentation only. Preserve existing compatible code if repository is not empty.

## 6. Domain model and tenant isolation
Core entities: `User`, `Company`, `CompanyMembership`, `CompanyInvitation`, `RefreshSession`, `Job`, `JobEvaluationConfig` (immutable approved versions), `Candidate`, `Resume` (versioned), `JobCandidate`, `ResumeAssessment` (versioned), `InterviewPlan` (approved version), `InterviewInvitation`, `InterviewSession`, `InterviewMessage`, `InterviewEvent`, `InterviewAssessment` (versioned), `RecruiterDecision`, `UsageRecord`, `AuditLog`, `ConsentRecord`. Add support entities when justified.

- A user may belong to multiple companies via memberships.
- Candidate identity is company-scoped; job candidacy is a separate relation. A candidate may be associated with multiple jobs within one company.
- Every tenant-owned row carries `companyId`; enforce tenant-scoped queries and authorization and use composite foreign keys/constraints where appropriate.
- Client-supplied company IDs are never sufficient authorization. Derive active tenant from authenticated membership.
- Explicit tests must prove cross-tenant denial for jobs, candidates, resumes, downloads, invitations, interviews, and reports.
- Company roles: `COMPANY_ADMIN`, `RECRUITER`, `VIEWER`; platform operator access is separate, limited, and audited.

## 7. Authentication, permissions, and privacy
Implement registration, login, logout, password reset, invitations, role checks, short-lived JWT access tokens, rotating/revocable refresh tokens stored securely (hash tokens server-side), Argon2id password hashes, auth rate limits, CSRF protection if using cookies, and audit trails. Use HTTPS at deployment edge. Do not log secrets, resume contents, or full transcripts. Consent before interviews; implement configurable retention and candidate-data deletion workflows. Assess applicable local privacy/employment requirements before production; do not claim legal compliance by default.

## 8. Jobs and approved rubrics
Jobs: title, description, department, employment type, work arrangement, location, requirements, status (`DRAFT`, `ACTIVE`, `PAUSED`, `CLOSED`, `ARCHIVED`), creator, timestamps. AI drafts requirements/rubric from JD, recruiter edits and approves. Rubric criteria have weights totaling 100%, explicit scale, evidence requirements, and version. Approved versions are immutable; assessments reference exact version; edits require new version and explicit reassessment. Avoid ungrounded criteria or protected-attribute inference.

## 9. Resume ingestion and evaluation
- Accept PDF/DOCX, enforce size limits, MIME + signature checks, safe parsers, private storage and authorized download, antivirus-scanning integration point.
- BullMQ pipeline: validate → store → extract text → structured AI extraction → candidate association → AI assessment → deterministic scoring → persist; retries/backoff, idempotency, visible failure states.
- Distinguish `EVIDENCE_FOUND`, `INSUFFICIENT_EVIDENCE`, `REQUIREMENT_NOT_MET`; no fabricated credentials.
- Store criterion-level evidence and uncertainty, model/prompt/rubric versions, scores, timestamps. Do not silently auto-reject candidates.
- Rank via SQL/application sorting, not LLM. Keep resume scores separate from interview scores.

## 10. Interview invitations and plans
Recruiters create individual/bulk invitations tied to job-candidacy. Use random high-entropy tokens, store hashes, enforce expiration, revocation, resend and attempt policy. SMTP + Mailpit for local dev; copy link UI. Candidate can access only own invited session. AI can draft interview plan from JD, rubric and resume; recruiter reviews/approves; standardize core questions per job with limited evidence-based follow-ups.

## 11. Text interview engine
- Dedicated candidate UI: invitation validation, consent, instructions, chat, progress, completion, error/reconnect.
- Durable session states with validated transitions: `CREATED`, `READY`, `IN_PROGRESS`, `INTERRUPTED`, `COMPLETED`, `EVALUATING`, `EVALUATED`, `EVALUATION_FAILED`, `CANCELLED` (refine in Phase 0).
- Orchestrator controls competency, question count, follow-up cap, time budget, session ownership, and completion. LLM generates only conversational text and bounded structured intents.
- Socket.IO/WebSocket gateway authenticates candidate and acknowledges durable messages; sequence numbers/idempotency keys prevent duplicates. REST retrieves authoritative state/transcript after reconnect.
- PostgreSQL is source of truth; Redis only for ephemeral state/coordination; enforce concurrency control and recovery after API restart.
- Persist full transcript/events; context summary reduces token load but cannot replace original evidence.

## 12. Interview evaluation and human decision
Queue transcript evaluation after completion; score approved job competencies with exact message/question evidence references, missing evidence, strengths, gaps and report. Do not penalize unasked questions or evaluate accent, emotion, personality, or protected characteristics. Validate citations against stored messages. Retain model, prompt, plan and rubric versions. Failed evaluations are retryable without losing transcript. Recruiter decisions (`UNDER_REVIEW`, `SHORTLISTED`, `NEXT_ROUND`, `NOT_SELECTED`) are independent, attributed and audited; final decisions are human-controlled.

## 13. OpenRouter workload router
Use `OPENROUTER_API_KEY`, `OPENROUTER_BASE_URL` and env-configurable per-task model IDs. Initial **candidates**, not guaranteed available defaults:
- Job analysis: `anthropic/claude-haiku-5.5`
- Rubric drafting: `anthropic/claude-sonnet-5.5`
- Resume extraction: `anthropic/claude-haiku-5.5`
- Resume evaluation: `openai/gpt-5-mini`
- Interview planning: `anthropic/claude-sonnet-5.5`
- Live text interviewer: `anthropic/claude-haiku-5.5`
- Context summarization: `anthropic/claude-haiku-5.5`
- Interview evaluation: `anthropic/claude-sonnet-5.5`
- Final report: `anthropic/claude-sonnet-5.5`

Verify IDs and structured-output support against the actual OpenRouter catalog during integration; do not assume availability. Model routing is centralized and pinned per assessment for comparability. AI gateway: prompt templates/versioning, schema validation, timeout/retry/backoff, provider restrictions/privacy configuration, structured errors, usage and cost estimates, trace/correlation IDs. Never call OpenRouter from browser. `AI_PROVIDER=mock|openrouter`; mock is deterministic and schema-valid for E2E/CI. Never silently fall back to mock on real provider failure. Treat resumes and transcripts as untrusted data (prompt-injection defenses).

## 14. Frontend product surfaces
Public: landing, register, login, password reset, company invitation acceptance. Company: overview, jobs CRUD, rubric draft/edit/approve, resume upload/bulk status, candidates/search/rank, candidate details/evidence, shortlist, interview plan approval, invitations, interview reports/transcript, recruiter decisions, team/settings, usage. Candidate: invite landing, consent, chat, completion. Responsive accessible UI, meaningful empty/loading/error states, optimistic updates only where safe, all controls wired to real APIs. React SPA only, no Next.js.

## 15. Docker Compose deployment design
Services: `nginx`, `web`, `api`, `worker`, `postgres`, `redis`, `minio`, `minio-init`, `mailpit`. Nginx routes SPA/API/Socket.IO. Multi-stage Dockerfiles; health/readiness checks; named volumes; internal networks; graceful shutdown; secrets from environment; explicit database migrations. Dev override for hot reload. Production-oriented configuration must not expose DB/Redis/MinIO admin publicly; TLS and backups need documented deployment setup. Startup should be reproducible with documented commands.

## 16. Testing, observability, and acceptance
Unit: scoring, rubric weights/versioning, state transitions, auth and permissions, token validity, AI schema validation. Integration: CRUD, storage, queues, AI mock processing, invitation, transcript persistence, evaluation, usage. E2E Playwright: register → job → approve rubric → upload resume → evaluate/rank → shortlist → invite → consent → text interview → evaluation → human decision. Security tests: cross-tenant, role escalation, token abuse, unauthorized downloads, WebSocket ownership, duplicate message handling, prompt injection. Run lint/typecheck/build/test; only report actually executed checks. Structured logs, health/readiness, queue status, AI latency/token/cost metrics, audit events, no sensitive payload logging.

## 17. Phase delivery roadmap
- **Phase 0:** architecture and documentation only; no application code.
- **Phase 1:** pnpm monorepo, React/NestJS/worker, Docker Compose, Postgres/Redis/MinIO/Mailpit/Nginx, health checks.
- **Phase 2:** auth, memberships, roles, tenant isolation.
- **Phase 3:** jobs, AI job analysis, versioned rubric draft/approval, AI gateway.
- **Phase 4:** candidates, secure resume uploads, extraction queues.
- **Phase 5:** AI resume assessment, deterministic scoring/ranking.
- **Phase 6:** interview invitations, secure links, SMTP.
- **Phase 7A:** interview state machine, persistence, concurrency.
- **Phase 7B:** interview plans and AI orchestrator.
- **Phase 7C:** real-time text chat and reconnection UI.
- **Phase 8:** transcript evaluation, reports, evidence.
- **Phase 9:** dashboard, usage and human decisions.
- **Phase 10:** complete integration, security, E2E and deployment verification.

Every phase must include relevant frontend/backend integration and tests. Verify before advancing. Record blockers and results in `docs/progress.md`. Do not claim completion without evidence.

## 18. Final acceptance criteria
One documented Docker Compose workflow starts the stack; company signup/auth works; tenant isolation tests pass; recruiters create jobs and approve AI rubrics; resumes are stored, parsed and assessed asynchronously; candidates rank by evidence-based assessment; invitations are secure; candidates complete full text interviews with reconnect/recovery; transcripts persist; evaluation and reports appear; recruiters make final decisions; usage tracked; deterministic mock E2E passes; OpenRouter path implemented and documented; no media functionality introduced. Report any unverified requirements honestly.
