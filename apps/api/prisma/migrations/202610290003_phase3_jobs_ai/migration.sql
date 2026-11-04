-- CreateEnum
CREATE TYPE "JobStatus" AS ENUM ('DRAFT', 'ACTIVE', 'PAUSED', 'CLOSED', 'ARCHIVED');

-- CreateTable
CREATE TABLE "Job" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "creatorMembershipId" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "department" TEXT NOT NULL,
    "employmentType" TEXT NOT NULL,
    "workArrangement" TEXT NOT NULL,
    "location" TEXT NOT NULL,
    "requirements" JSONB NOT NULL,
    "status" "JobStatus" NOT NULL DEFAULT 'DRAFT',
    "revision" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "Job_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JobEvaluationConfig" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "jobId" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "sourceDescription" TEXT NOT NULL,
    "sourceHash" TEXT NOT NULL,
    "requirements" JSONB NOT NULL,
    "scaleVersion" TEXT NOT NULL DEFAULT 'rating-0-4.v1',
    "scoringPolicyVersion" TEXT NOT NULL DEFAULT 'scoring-policy-v1',
    "artifactId" UUID,
    "approverMembershipId" UUID,
    "approvedAt" TIMESTAMPTZ,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "JobEvaluationConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RubricCriterion" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "configId" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "weight" INTEGER NOT NULL,
    "anchors" JSONB NOT NULL,
    "evidenceRequirements" TEXT NOT NULL,
    "requirementKeys" TEXT[],
    "position" INTEGER NOT NULL,

    CONSTRAINT "RubricCriterion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiRequest" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "jobId" UUID NOT NULL,
    "operationId" UUID NOT NULL,
    "jobRevision" INTEGER NOT NULL,
    "task" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "promptVersion" TEXT NOT NULL,
    "schemaVersion" TEXT NOT NULL,
    "policyVersion" TEXT NOT NULL,
    "input" JSONB NOT NULL,
    "inputHash" TEXT NOT NULL,

    CONSTRAINT "AiRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AIArtifact" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "operationId" UUID NOT NULL,
    "task" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "promptVersion" TEXT NOT NULL,
    "schemaVersion" TEXT NOT NULL,
    "inputHash" TEXT NOT NULL,
    "outputHash" TEXT NOT NULL,
    "output" JSONB NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AIArtifact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UsageRecord" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "operationId" UUID NOT NULL,
    "attempt" INTEGER NOT NULL,
    "mode" TEXT NOT NULL,
    "task" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "returnedModel" TEXT,
    "provider" TEXT,
    "promptVersion" TEXT NOT NULL,
    "schemaVersion" TEXT NOT NULL,
    "inputTokens" INTEGER,
    "outputTokens" INTEGER,
    "cost" DECIMAL(18,8),
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "costStatus" TEXT NOT NULL DEFAULT 'UNKNOWN',
    "outcome" TEXT NOT NULL DEFAULT 'UNKNOWN',
    "latencyMs" INTEGER,
    "reservedTokens" INTEGER NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UsageRecord_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Job_companyId_status_createdAt_id_idx" ON "Job"("companyId", "status", "createdAt", "id");

-- CreateIndex
CREATE INDEX "Job_companyId_creatorMembershipId_idx" ON "Job"("companyId", "creatorMembershipId");

-- CreateIndex
CREATE UNIQUE INDEX "Job_companyId_id_key" ON "Job"("companyId", "id");

-- CreateIndex
CREATE INDEX "JobEvaluationConfig_companyId_approverMembershipId_idx" ON "JobEvaluationConfig"("companyId", "approverMembershipId");

-- CreateIndex
CREATE INDEX "JobEvaluationConfig_companyId_artifactId_idx" ON "JobEvaluationConfig"("companyId", "artifactId");

-- CreateIndex
CREATE UNIQUE INDEX "JobEvaluationConfig_companyId_id_key" ON "JobEvaluationConfig"("companyId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "JobEvaluationConfig_companyId_jobId_id_key" ON "JobEvaluationConfig"("companyId", "jobId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "JobEvaluationConfig_companyId_jobId_version_key" ON "JobEvaluationConfig"("companyId", "jobId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "RubricCriterion_companyId_id_key" ON "RubricCriterion"("companyId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "RubricCriterion_companyId_configId_key_key" ON "RubricCriterion"("companyId", "configId", "key");

-- CreateIndex
CREATE UNIQUE INDEX "RubricCriterion_companyId_configId_position_key" ON "RubricCriterion"("companyId", "configId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "AiRequest_operationId_key" ON "AiRequest"("operationId");

-- CreateIndex
CREATE INDEX "AiRequest_companyId_jobId_idx" ON "AiRequest"("companyId", "jobId");

-- CreateIndex
CREATE UNIQUE INDEX "AiRequest_companyId_id_key" ON "AiRequest"("companyId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "AiRequest_companyId_operationId_key" ON "AiRequest"("companyId", "operationId");

-- CreateIndex
CREATE UNIQUE INDEX "AIArtifact_operationId_key" ON "AIArtifact"("operationId");

-- CreateIndex
CREATE UNIQUE INDEX "AIArtifact_companyId_id_key" ON "AIArtifact"("companyId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "AIArtifact_companyId_operationId_key" ON "AIArtifact"("companyId", "operationId");

-- CreateIndex
CREATE INDEX "UsageRecord_companyId_createdAt_id_idx" ON "UsageRecord"("companyId", "createdAt", "id");

-- CreateIndex
CREATE UNIQUE INDEX "UsageRecord_companyId_id_key" ON "UsageRecord"("companyId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "UsageRecord_companyId_operationId_attempt_key" ON "UsageRecord"("companyId", "operationId", "attempt");

-- AddForeignKey
ALTER TABLE "Job" ADD CONSTRAINT "Job_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Job" ADD CONSTRAINT "Job_companyId_creatorMembershipId_fkey" FOREIGN KEY ("companyId", "creatorMembershipId") REFERENCES "CompanyMembership"("companyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobEvaluationConfig" ADD CONSTRAINT "JobEvaluationConfig_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobEvaluationConfig" ADD CONSTRAINT "JobEvaluationConfig_companyId_jobId_fkey" FOREIGN KEY ("companyId", "jobId") REFERENCES "Job"("companyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobEvaluationConfig" ADD CONSTRAINT "JobEvaluationConfig_companyId_approverMembershipId_fkey" FOREIGN KEY ("companyId", "approverMembershipId") REFERENCES "CompanyMembership"("companyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobEvaluationConfig" ADD CONSTRAINT "JobEvaluationConfig_companyId_artifactId_fkey" FOREIGN KEY ("companyId", "artifactId") REFERENCES "AIArtifact"("companyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RubricCriterion" ADD CONSTRAINT "RubricCriterion_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RubricCriterion" ADD CONSTRAINT "RubricCriterion_companyId_configId_fkey" FOREIGN KEY ("companyId", "configId") REFERENCES "JobEvaluationConfig"("companyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiRequest" ADD CONSTRAINT "AiRequest_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiRequest" ADD CONSTRAINT "AiRequest_companyId_jobId_fkey" FOREIGN KEY ("companyId", "jobId") REFERENCES "Job"("companyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiRequest" ADD CONSTRAINT "AiRequest_companyId_operationId_fkey" FOREIGN KEY ("companyId", "operationId") REFERENCES "ProcessingOperation"("companyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AIArtifact" ADD CONSTRAINT "AIArtifact_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AIArtifact" ADD CONSTRAINT "AIArtifact_companyId_operationId_fkey" FOREIGN KEY ("companyId", "operationId") REFERENCES "ProcessingOperation"("companyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UsageRecord" ADD CONSTRAINT "UsageRecord_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UsageRecord" ADD CONSTRAINT "UsageRecord_companyId_operationId_fkey" FOREIGN KEY ("companyId", "operationId") REFERENCES "ProcessingOperation"("companyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Job" ADD CONSTRAINT "Job_bounds" CHECK (revision > 0 AND length(title) BETWEEN 1 AND 200 AND length(description) BETWEEN 1 AND 20000);
ALTER TABLE "JobEvaluationConfig" ADD CONSTRAINT "Config_state" CHECK (version > 0 AND revision > 0 AND status IN ('DRAFT','APPROVED') AND ((status='APPROVED') = ("approvedAt" IS NOT NULL AND "approverMembershipId" IS NOT NULL)));
ALTER TABLE "RubricCriterion" ADD CONSTRAINT "Criterion_bounds" CHECK (weight BETWEEN 0 AND 10000 AND position >= 0 AND jsonb_array_length(anchors)=5);
ALTER TABLE "UsageRecord" ADD CONSTRAINT "Usage_bounds" CHECK (attempt BETWEEN 1 AND 4 AND "reservedTokens">0 AND (cost IS NULL OR cost>=0));
CREATE FUNCTION protect_rubric() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE frozen boolean; total bigint;
BEGIN
 IF TG_TABLE_NAME='JobEvaluationConfig' THEN
  IF TG_OP <> 'INSERT' AND OLD.status='APPROVED' THEN RAISE EXCEPTION 'APPROVED_IMMUTABLE' USING ERRCODE='23514'; END IF;
  IF TG_OP <> 'DELETE' AND NEW.status='APPROVED' THEN
   SELECT sum(weight) INTO total FROM "RubricCriterion" WHERE "companyId"=NEW."companyId" AND "configId"=NEW.id;
   IF total IS DISTINCT FROM 10000 THEN RAISE EXCEPTION 'INVALID_WEIGHT_TOTAL' USING ERRCODE='23514'; END IF;
  END IF;
 ELSE
  -- Serialize criterion mutation with approval even for direct SQL writers.
  SELECT status='APPROVED' INTO frozen FROM "JobEvaluationConfig" WHERE "companyId"=COALESCE(NEW."companyId",OLD."companyId") AND id=COALESCE(NEW."configId",OLD."configId") FOR UPDATE;
  IF frozen THEN RAISE EXCEPTION 'APPROVED_IMMUTABLE' USING ERRCODE='23514'; END IF;
  IF TG_OP='UPDATE' AND (OLD."companyId",OLD."configId") IS DISTINCT FROM (NEW."companyId",NEW."configId") THEN RAISE EXCEPTION 'CRITERION_PARENT_IMMUTABLE' USING ERRCODE='23514'; END IF;
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER protect_config BEFORE INSERT OR UPDATE OR DELETE ON "JobEvaluationConfig" FOR EACH ROW EXECUTE FUNCTION protect_rubric();
CREATE TRIGGER protect_criterion BEFORE INSERT OR UPDATE OR DELETE ON "RubricCriterion" FOR EACH ROW EXECUTE FUNCTION protect_rubric();
CREATE INDEX "AiOperation_due" ON "ProcessingOperation" (kind,"availableAt") WHERE status IN ('PENDING','RETRY_WAIT','RUNNING');
UPDATE "InfrastructureState" SET version=3 WHERE id=1;
