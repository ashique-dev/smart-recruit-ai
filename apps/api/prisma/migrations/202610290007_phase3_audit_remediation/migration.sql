-- AlterTable
ALTER TABLE "UsageRecord" ADD COLUMN     "cacheReadTokens" INTEGER,
ADD COLUMN     "cacheWriteTokens" INTEGER,
ADD COLUMN     "providerGenerationId" TEXT,
ADD COLUMN     "settledAt" TIMESTAMPTZ,
ADD COLUMN     "usageMetadataStatus" TEXT NOT NULL DEFAULT 'UNKNOWN';

-- CreateTable
CREATE TABLE "RubricApprovalCommand" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "jobId" UUID NOT NULL,
    "configId" UUID NOT NULL,
    "idempotencyKey" UUID NOT NULL,
    "requestHash" TEXT NOT NULL,
    "result" JSONB NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RubricApprovalCommand_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "RubricApprovalCommand_companyId_id_key" ON "RubricApprovalCommand"("companyId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "RubricApprovalCommand_companyId_jobId_configId_idempotencyK_key" ON "RubricApprovalCommand"("companyId", "jobId", "configId", "idempotencyKey");

-- AddForeignKey
ALTER TABLE "RubricApprovalCommand" ADD CONSTRAINT "RubricApprovalCommand_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RubricApprovalCommand" ADD CONSTRAINT "RubricApprovalCommand_companyId_jobId_fkey" FOREIGN KEY ("companyId", "jobId") REFERENCES "Job"("companyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RubricApprovalCommand" ADD CONSTRAINT "RubricApprovalCommand_companyId_jobId_configId_fkey" FOREIGN KEY ("companyId", "jobId", "configId") REFERENCES "JobEvaluationConfig"("companyId", "jobId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "UsageRecord" ADD CONSTRAINT "Usage_cache_bounds" CHECK (("cacheReadTokens" IS NULL OR "cacheReadTokens">=0) AND ("cacheWriteTokens" IS NULL OR "cacheWriteTokens">=0));
-- Existing terminal records have already been settled; do not reinterpret or zero unknown usage.
UPDATE "UsageRecord" SET "settledAt"="createdAt" WHERE outcome<>'UNKNOWN';
DO $$ BEGIN
 IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='smart_recruit_runtime') THEN
  REVOKE UPDATE,DELETE ON "RubricApprovalCommand" FROM smart_recruit_runtime;
 END IF;
END $$;
UPDATE "InfrastructureState" SET version=5 WHERE id=1;
