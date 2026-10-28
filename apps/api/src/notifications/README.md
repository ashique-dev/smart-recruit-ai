Phase 2 implementation.

Separate tenant and global-auth notification paths. PostgreSQL ledgers drive BullMQ dispatch, fenced retries and SMTP delivery; token payloads are purged on terminal states.
