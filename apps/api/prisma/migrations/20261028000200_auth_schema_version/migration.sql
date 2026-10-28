-- Explicit release readiness gate. Only migration credentials may change this row.
UPDATE "InfrastructureState" SET version = 2 WHERE id = 1;
