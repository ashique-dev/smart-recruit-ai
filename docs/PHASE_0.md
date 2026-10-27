# Phase 0 — Architecture and Planning Only

## Goal
Produce an implementation-ready architecture and phased plan for SmartRecruit AI, based on `docs/MASTER_SPEC.md` and `AGENTS.md`. **Do not implement application code.**

## Steps
1. Inspect repository files, Git status, existing services, Docker files, dependencies, and configuration; preserve compatible work.
2. Read the master specification completely and identify contradictions, missing business rules, security risks, and assumptions.
3. Design system boundaries: React SPA, NestJS API, independently deployed BullMQ worker, PostgreSQL, Redis, MinIO, Mailpit, Nginx, OpenRouter gateway, and text-interview transport.
4. Design entity relationship model and constraints for user/company/membership, jobs/versioned rubrics, candidates/resume versions/job candidacy, assessments, approved interview plans, invitations, sessions/messages/events, consent, human decisions, audit and usage.
5. Design tenant isolation strategy for REST, queues, object storage, WebSocket, and reports; explain authorization and cross-tenant test approach.
6. Design AI contracts for each workload, mock and real OpenRouter modes, schema validation, model/prompt versioning, usage accounting, failure/retry policy and prompt injection boundaries.
7. Design BullMQ workflows, idempotency and failure recovery for resumes and interview evaluation.
8. Design interview lifecycle, state transitions, session concurrency, message ordering/idempotency, transcript persistence, reconnect and deterministic orchestration independent of transport.
9. Design Docker Compose service networking, health/readiness, migration strategy, volumes, local development and production considerations.
10. Break implementation into Phases 1–10, with 7A/7B/7C, explicit dependencies, acceptance criteria and test gates.

## Required documentation deliverables
- `docs/architecture.md`: boundaries, request/data flow, Mermaid diagrams, tradeoffs.
- `docs/database.md`: ERD, table relationships, versioning, keys/indexes, tenant isolation.
- `docs/ai-workloads.md`: model routing, structured contracts, privacy, retry, mock mode, versioning and costs.
- `docs/interview-lifecycle.md`: state machine, message sequence, concurrency, failure/reconnect.
- `docs/infrastructure.md`: Compose services, network topology, env/secrets, migrations, health, storage.
- `docs/implementation-plan.md`: phased milestones, dependencies, acceptance criteria, testing gates.
- `docs/progress.md`: current phase status, architecture decisions, unresolved questions, next authorized step.

## Explicit boundaries
- Documentation only; do not create `apps/`, `packages/`, Dockerfiles, migrations, source code, tests, or generated dependency files.
- Do not use or implement media/WebRTC/Mediasoup, STT, TTS, audio or video.
- Do not assume OpenRouter model IDs are available; flag them for runtime verification in Phase 3.
- Do not invent legal compliance claims.
- Do not begin Phase 1 without user approval.

## Completion checklist
- Architecture aligns with `MASTER_SPEC.md`.
- Domain model supports multi-company isolation and multiple job candidacies per candidate.
- Rubrics, resumes and assessments are versioned appropriately.
- Interview orchestrator is independent from text delivery.
- Every external dependency has a failure/retry/recovery story.
- Phases include explicit tests and clear pass/fail acceptance gates.
- Documentation is internally consistent and ready for review.

## Final response format
Summarize architecture, repository findings, key tradeoffs, security risks, unresolved decisions, files created, and readiness for Phase 1. **STOP.**
