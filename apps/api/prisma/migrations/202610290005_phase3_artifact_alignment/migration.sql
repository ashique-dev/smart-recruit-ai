-- DropForeignKey
ALTER TABLE "JobEvaluationConfig" DROP CONSTRAINT "JobEvaluationConfig_companyId_artifactId_fkey";

-- AlterTable
ALTER TABLE "AIArtifact" ADD COLUMN "jobId" UUID;
UPDATE "AIArtifact" a SET "jobId"=r."jobId" FROM "AiRequest" r WHERE r."companyId"=a."companyId" AND r."operationId"=a."operationId";
ALTER TABLE "AIArtifact" ALTER COLUMN "jobId" SET NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "AiRequest_companyId_jobId_operationId_key" ON "AiRequest"("companyId", "jobId", "operationId");

-- CreateIndex
CREATE UNIQUE INDEX "AIArtifact_companyId_jobId_id_key" ON "AIArtifact"("companyId", "jobId", "id");

-- AddForeignKey
ALTER TABLE "JobEvaluationConfig" ADD CONSTRAINT "JobEvaluationConfig_companyId_jobId_artifactId_fkey" FOREIGN KEY ("companyId", "jobId", "artifactId") REFERENCES "AIArtifact"("companyId", "jobId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AIArtifact" ADD CONSTRAINT "AIArtifact_companyId_jobId_fkey" FOREIGN KEY ("companyId", "jobId") REFERENCES "Job"("companyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;


ALTER TABLE "AIArtifact" ADD CONSTRAINT "AIArtifact_companyId_jobId_operationId_fkey" FOREIGN KEY ("companyId","jobId","operationId") REFERENCES "AiRequest"("companyId","jobId","operationId") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE UNIQUE INDEX "AIArtifact_companyId_jobId_operationId_key" ON "AIArtifact"("companyId","jobId","operationId");
