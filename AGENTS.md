# Codex Instructions — SmartRecruit AI

## Source of truth
Read `docs/MASTER_SPEC.md`, `docs/implementation-plan.md` (when it exists), and `docs/progress.md` (when it exists) before implementing any phase. For Phase 0, read `docs/PHASE_0.md`. If a requirement is ambiguous, document the assumption and choose a simple, secure, maintainable default.

## Execution discipline
- Implement **only the phase explicitly requested**. Phase 0 is **documentation only**: do not scaffold, install dependencies, create application code, or start Docker services.
- Inspect the repository and Git status first. Preserve existing compatible code. Do not delete unrelated code or overwrite secrets.
- Produce a concise plan, implement incrementally, test, repair failures, update `docs/progress.md`, and stop at the phase boundary.
- No placeholders represented as finished functionality. No fabricated test results. State blockers clearly.
- Do not silently replace OpenRouter with mock mode. Use deterministic mock mode only when explicitly configured.
- Treat tenant isolation, authentication, and candidate privacy as release-blocking concerns.
- Keep AI prompts and schemas versioned; validate all AI output. Deterministic business logic belongs in backend code.
- Text interviews only. **Never implement** Mediasoup, WebRTC, RTP, ICE, DTLS, audio/video, STT/TTS or `media/` in these phases.
- React + Vite frontend, NestJS API, Prisma/PostgreSQL, BullMQ/Redis, MinIO, Mailpit, Nginx, Docker Compose, pnpm workspaces. Do not use Next.js.
- Avoid premature microservices, Kubernetes, Kafka, or extra infrastructure without clear need.
- Keep interviews transport-independent so a future media adapter can reuse the orchestrator.
- Do not commit credentials or personal candidate data.

## Phase completion report
At the end of each phase report: changed files, decisions, verification commands actually run, passed/failed tests, security concerns, blockers, and whether acceptance criteria were met. Wait for explicit approval before starting the next phase.
