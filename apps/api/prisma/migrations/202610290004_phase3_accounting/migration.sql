ALTER TABLE "AiRequest" ADD COLUMN "policySnapshot" JSONB NOT NULL DEFAULT '{}';
ALTER TABLE "AiRequest" ALTER COLUMN "policySnapshot" DROP DEFAULT;
ALTER TABLE "UsageRecord" ADD COLUMN "reservedCost" DECIMAL(18,8) NOT NULL DEFAULT 0;
ALTER TABLE "UsageRecord" DROP CONSTRAINT "Usage_bounds";
ALTER TABLE "UsageRecord" ADD CONSTRAINT "Usage_bounds" CHECK (attempt BETWEEN 1 AND 4 AND "reservedTokens">=0 AND "reservedCost">=0 AND (cost IS NULL OR cost>=0));
ALTER TABLE "AiRequest" ADD CONSTRAINT "AiRequest_task" CHECK (task IN ('job-analysis','rubric-draft') AND mode IN ('mock','openrouter'));
DO $$ BEGIN
 IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='smart_recruit_runtime') THEN
  REVOKE UPDATE,DELETE ON "AiRequest","AIArtifact" FROM smart_recruit_runtime;
 END IF;
END $$;
