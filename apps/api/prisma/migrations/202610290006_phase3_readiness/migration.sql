-- Runtime schema revision 4 marks the complete Phase 3 migration set.
-- New binaries must not become ready against only the initial Phase 3 tables.
UPDATE "InfrastructureState" SET version=4 WHERE id=1;
