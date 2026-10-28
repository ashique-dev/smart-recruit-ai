-- Bootstrap grants future domain tables DML, but runtime must not edit migration metadata.
-- The named role belongs to local Compose; external deployments supply their own grants.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'smart_recruit_runtime') THEN
    REVOKE ALL ON TABLE "_prisma_migrations" FROM smart_recruit_runtime;
    REVOKE INSERT, UPDATE, DELETE ON TABLE "InfrastructureState" FROM smart_recruit_runtime;
  END IF;
END $$;
