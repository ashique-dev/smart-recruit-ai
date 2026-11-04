# Jobs and rubrics

Phase 3 tenant-scoped CRUD (archive preserves history), guarded statuses, reviewed requirement citations, versioned rubric drafts and explicit immutable approval. Controllers use class-validator DTOs; services run through CompanyService's session/membership transaction boundary. AI enqueue commits its pinned request, ProcessingOperation, outbox and audit together. See docs/phase-3-verification.md for assumptions, tests and limits.
