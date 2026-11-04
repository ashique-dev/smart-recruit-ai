# AI gateway

Phase 3 central server-only mock/OpenRouter gateway and independent worker runtime. Contracts live in packages/ai-contracts. AiProcessor owns persisted attempts, budget reservations, retries, lease fencing, usage and atomic artifact/draft publication. AiRuntime polls the existing PostgreSQL outbox and reconciles Redis loss. Real mode requires verified routes; no startup or health probe makes an external call. See docs/phase-3-verification.md before any live integration test.
