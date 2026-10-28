-- CreateEnum
CREATE TYPE "AccountStatus" AS ENUM ('ACTIVE', 'DISABLED');

-- CreateEnum
CREATE TYPE "CompanyStatus" AS ENUM ('ACTIVE', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "MembershipStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "CompanyRole" AS ENUM ('COMPANY_ADMIN', 'RECRUITER', 'VIEWER');

-- CreateEnum
CREATE TYPE "OperationStatus" AS ENUM ('PENDING', 'RUNNING', 'RETRY_WAIT', 'RESULT_READY', 'SUCCEEDED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "DeliveryStatus" AS ENUM ('PENDING', 'SENDING', 'RETRY_WAIT', 'SMTP_ACCEPTED', 'FAILED', 'CANCELLED', 'EXPIRED');

-- CreateTable
CREATE TABLE "User" (
    "id" UUID NOT NULL,
    "normalizedEmail" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "status" "AccountStatus" NOT NULL DEFAULT 'ACTIVE',
    "verifiedAt" TIMESTAMPTZ,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Company" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "status" "CompanyStatus" NOT NULL DEFAULT 'ACTIVE',
    "revision" INTEGER NOT NULL DEFAULT 1,
    "retentionDays" INTEGER NOT NULL DEFAULT 180,
    "retentionPolicyVersion" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "Company_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CompanyMembership" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "role" "CompanyRole" NOT NULL,
    "status" "MembershipStatus" NOT NULL DEFAULT 'ACTIVE',
    "revision" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "CompanyMembership_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RefreshSession" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "familyId" UUID NOT NULL,
    "expiresAt" TIMESTAMPTZ NOT NULL,
    "revokedAt" TIMESTAMPTZ,
    "rotatedAt" TIMESTAMPTZ,
    "successorId" UUID,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RefreshSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PasswordResetToken" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMPTZ NOT NULL,
    "consumedAt" TIMESTAMPTZ,
    "revokedAt" TIMESTAMPTZ,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PasswordResetToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuthSecurityEvent" (
    "id" UUID NOT NULL,
    "userId" UUID,
    "kind" TEXT NOT NULL,
    "networkHash" TEXT,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuthSecurityEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CompanyInvitation" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "normalizedEmail" TEXT NOT NULL,
    "role" "CompanyRole" NOT NULL,
    "issuerMembershipId" UUID NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "generation" INTEGER NOT NULL DEFAULT 1,
    "expiresAt" TIMESTAMPTZ NOT NULL,
    "consumedAt" TIMESTAMPTZ,
    "revokedAt" TIMESTAMPTZ,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "CompanyInvitation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProcessingOperation" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "status" "OperationStatus" NOT NULL DEFAULT 'PENDING',
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "leaseGeneration" INTEGER NOT NULL DEFAULT 0,
    "leaseExpiresAt" TIMESTAMPTZ,
    "availableAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deadlineAt" TIMESTAMPTZ NOT NULL,
    "failureCode" TEXT,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "ProcessingOperation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OutboxEvent" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "operationId" UUID NOT NULL,
    "topic" TEXT NOT NULL,
    "schemaVersion" INTEGER NOT NULL DEFAULT 1,
    "availableAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "publishedAt" TIMESTAMPTZ,
    "leaseExpiresAt" TIMESTAMPTZ,
    "leaseGeneration" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OutboxEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "actorMembershipId" UUID NOT NULL,
    "actorType" TEXT NOT NULL DEFAULT 'MEMBER',
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" UUID NOT NULL,
    "requestId" UUID NOT NULL,
    "summary" JSONB NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificationDelivery" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "operationId" UUID NOT NULL,
    "invitationId" UUID NOT NULL,
    "template" TEXT NOT NULL,
    "templateVersion" INTEGER NOT NULL DEFAULT 1,
    "generation" INTEGER NOT NULL DEFAULT 1,
    "status" "DeliveryStatus" NOT NULL DEFAULT 'PENDING',
    "ciphertext" TEXT,
    "keyVersion" TEXT,
    "payloadExpiresAt" TIMESTAMPTZ NOT NULL,
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "leaseGeneration" INTEGER NOT NULL DEFAULT 0,
    "leaseExpiresAt" TIMESTAMPTZ,
    "availableAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "smtpAcceptedAt" TIMESTAMPTZ,
    "failureCode" TEXT,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "NotificationDelivery_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuthNotificationDelivery" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "resetTokenId" UUID NOT NULL,
    "operationKey" TEXT NOT NULL,
    "template" TEXT NOT NULL,
    "templateVersion" INTEGER NOT NULL DEFAULT 1,
    "generation" INTEGER NOT NULL DEFAULT 1,
    "status" "DeliveryStatus" NOT NULL DEFAULT 'PENDING',
    "ciphertext" TEXT,
    "keyVersion" TEXT,
    "payloadExpiresAt" TIMESTAMPTZ NOT NULL,
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "leaseGeneration" INTEGER NOT NULL DEFAULT 0,
    "leaseExpiresAt" TIMESTAMPTZ,
    "availableAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "smtpAcceptedAt" TIMESTAMPTZ,
    "failureCode" TEXT,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "AuthNotificationDelivery_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuthOutboxEvent" (
    "id" UUID NOT NULL,
    "deliveryId" UUID NOT NULL,
    "topic" TEXT NOT NULL,
    "schemaVersion" INTEGER NOT NULL DEFAULT 1,
    "availableAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "publishedAt" TIMESTAMPTZ,
    "leaseExpiresAt" TIMESTAMPTZ,
    "leaseGeneration" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuthOutboxEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_normalizedEmail_key" ON "User"("normalizedEmail");

-- CreateIndex
CREATE INDEX "CompanyMembership_userId_idx" ON "CompanyMembership"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "CompanyMembership_companyId_id_key" ON "CompanyMembership"("companyId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "CompanyMembership_companyId_userId_key" ON "CompanyMembership"("companyId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "RefreshSession_tokenHash_key" ON "RefreshSession"("tokenHash");

-- CreateIndex
CREATE UNIQUE INDEX "RefreshSession_successorId_key" ON "RefreshSession"("successorId");

-- CreateIndex
CREATE INDEX "RefreshSession_familyId_idx" ON "RefreshSession"("familyId");

-- CreateIndex
CREATE INDEX "RefreshSession_userId_expiresAt_idx" ON "RefreshSession"("userId", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "RefreshSession_userId_familyId_id_key" ON "RefreshSession"("userId", "familyId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "PasswordResetToken_tokenHash_key" ON "PasswordResetToken"("tokenHash");

-- CreateIndex
CREATE INDEX "PasswordResetToken_userId_expiresAt_idx" ON "PasswordResetToken"("userId", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "PasswordResetToken_userId_id_key" ON "PasswordResetToken"("userId", "id");

-- CreateIndex
CREATE INDEX "AuthSecurityEvent_userId_createdAt_idx" ON "AuthSecurityEvent"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "AuthSecurityEvent_createdAt_idx" ON "AuthSecurityEvent"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "CompanyInvitation_tokenHash_key" ON "CompanyInvitation"("tokenHash");

-- CreateIndex
CREATE INDEX "CompanyInvitation_companyId_issuerMembershipId_idx" ON "CompanyInvitation"("companyId", "issuerMembershipId");

-- CreateIndex
CREATE INDEX "CompanyInvitation_companyId_expiresAt_idx" ON "CompanyInvitation"("companyId", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "CompanyInvitation_companyId_id_key" ON "CompanyInvitation"("companyId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "ProcessingOperation_companyId_id_key" ON "ProcessingOperation"("companyId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "ProcessingOperation_companyId_kind_idempotencyKey_key" ON "ProcessingOperation"("companyId", "kind", "idempotencyKey");

-- CreateIndex
CREATE INDEX "OutboxEvent_companyId_operationId_idx" ON "OutboxEvent"("companyId", "operationId");

-- CreateIndex
CREATE UNIQUE INDEX "OutboxEvent_companyId_id_key" ON "OutboxEvent"("companyId", "id");

-- CreateIndex
CREATE INDEX "AuditLog_companyId_actorMembershipId_idx" ON "AuditLog"("companyId", "actorMembershipId");

-- CreateIndex
CREATE INDEX "AuditLog_companyId_createdAt_id_idx" ON "AuditLog"("companyId", "createdAt", "id");

-- CreateIndex
CREATE UNIQUE INDEX "AuditLog_companyId_id_key" ON "AuditLog"("companyId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "NotificationDelivery_operationId_key" ON "NotificationDelivery"("operationId");

-- CreateIndex
CREATE INDEX "NotificationDelivery_companyId_invitationId_idx" ON "NotificationDelivery"("companyId", "invitationId");

-- CreateIndex
CREATE UNIQUE INDEX "NotificationDelivery_companyId_id_key" ON "NotificationDelivery"("companyId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "NotificationDelivery_companyId_operationId_key" ON "NotificationDelivery"("companyId", "operationId");

-- CreateIndex
CREATE UNIQUE INDEX "AuthNotificationDelivery_operationKey_key" ON "AuthNotificationDelivery"("operationKey");

-- CreateIndex
CREATE INDEX "AuthNotificationDelivery_userId_resetTokenId_idx" ON "AuthNotificationDelivery"("userId", "resetTokenId");

-- CreateIndex
CREATE INDEX "AuthOutboxEvent_deliveryId_idx" ON "AuthOutboxEvent"("deliveryId");

-- AddForeignKey
ALTER TABLE "CompanyMembership" ADD CONSTRAINT "CompanyMembership_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompanyMembership" ADD CONSTRAINT "CompanyMembership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RefreshSession" ADD CONSTRAINT "RefreshSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RefreshSession" ADD CONSTRAINT "RefreshSession_userId_familyId_successorId_fkey" FOREIGN KEY ("userId", "familyId", "successorId") REFERENCES "RefreshSession"("userId", "familyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PasswordResetToken" ADD CONSTRAINT "PasswordResetToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuthSecurityEvent" ADD CONSTRAINT "AuthSecurityEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompanyInvitation" ADD CONSTRAINT "CompanyInvitation_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompanyInvitation" ADD CONSTRAINT "CompanyInvitation_companyId_issuerMembershipId_fkey" FOREIGN KEY ("companyId", "issuerMembershipId") REFERENCES "CompanyMembership"("companyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProcessingOperation" ADD CONSTRAINT "ProcessingOperation_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OutboxEvent" ADD CONSTRAINT "OutboxEvent_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OutboxEvent" ADD CONSTRAINT "OutboxEvent_companyId_operationId_fkey" FOREIGN KEY ("companyId", "operationId") REFERENCES "ProcessingOperation"("companyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_companyId_actorMembershipId_fkey" FOREIGN KEY ("companyId", "actorMembershipId") REFERENCES "CompanyMembership"("companyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationDelivery" ADD CONSTRAINT "NotificationDelivery_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationDelivery" ADD CONSTRAINT "NotificationDelivery_companyId_operationId_fkey" FOREIGN KEY ("companyId", "operationId") REFERENCES "ProcessingOperation"("companyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationDelivery" ADD CONSTRAINT "NotificationDelivery_companyId_invitationId_fkey" FOREIGN KEY ("companyId", "invitationId") REFERENCES "CompanyInvitation"("companyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuthNotificationDelivery" ADD CONSTRAINT "AuthNotificationDelivery_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuthNotificationDelivery" ADD CONSTRAINT "AuthNotificationDelivery_userId_resetTokenId_fkey" FOREIGN KEY ("userId", "resetTokenId") REFERENCES "PasswordResetToken"("userId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuthOutboxEvent" ADD CONSTRAINT "AuthOutboxEvent_deliveryId_fkey" FOREIGN KEY ("deliveryId") REFERENCES "AuthNotificationDelivery"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Expired invitations are explicitly revoked before reissuing. No volatile now() predicate.
CREATE UNIQUE INDEX "CompanyInvitation_live_email" ON "CompanyInvitation" ("companyId", "normalizedEmail") WHERE "consumedAt" IS NULL AND "revokedAt" IS NULL;
ALTER TABLE "User" ADD CONSTRAINT "User_normalized_email" CHECK ("normalizedEmail" = lower(btrim("normalizedEmail")) AND length("normalizedEmail") BETWEEN 3 AND 254);
ALTER TABLE "CompanyInvitation" ADD CONSTRAINT "CompanyInvitation_normalized_email" CHECK ("normalizedEmail" = lower(btrim("normalizedEmail")) AND length("normalizedEmail") BETWEEN 3 AND 254), ADD CONSTRAINT "CompanyInvitation_lifecycle" CHECK ("generation" > 0 AND "expiresAt" > "createdAt" AND NOT ("consumedAt" IS NOT NULL AND "revokedAt" IS NOT NULL));
ALTER TABLE "RefreshSession" ADD CONSTRAINT "RefreshSession_rotation" CHECK (("rotatedAt" IS NULL) = ("successorId" IS NULL)), ADD CONSTRAINT "RefreshSession_expiry" CHECK ("expiresAt" > "createdAt" AND "successorId" IS DISTINCT FROM "id");
ALTER TABLE "PasswordResetToken" ADD CONSTRAINT "PasswordResetToken_lifecycle" CHECK ("expiresAt" > "createdAt" AND NOT ("consumedAt" IS NOT NULL AND "revokedAt" IS NOT NULL));
ALTER TABLE "Company" ADD CONSTRAINT "Company_revisions" CHECK ("revision" > 0 AND "retentionDays" > 0 AND "retentionPolicyVersion" > 0);
ALTER TABLE "CompanyMembership" ADD CONSTRAINT "CompanyMembership_revision" CHECK ("revision" > 0);
ALTER TABLE "ProcessingOperation" ADD CONSTRAINT "ProcessingOperation_bounds" CHECK ("attemptCount" >= 0 AND "leaseGeneration" >= 0 AND "deadlineAt" > "createdAt");
CREATE INDEX "ProcessingOperation_due" ON "ProcessingOperation" ("availableAt", "leaseExpiresAt") WHERE "status" IN ('PENDING','RETRY_WAIT','RUNNING');
CREATE INDEX "OutboxEvent_due" ON "OutboxEvent" ("availableAt") WHERE "publishedAt" IS NULL;
CREATE INDEX "AuthOutboxEvent_due" ON "AuthOutboxEvent" ("availableAt") WHERE "publishedAt" IS NULL;
ALTER TABLE "RefreshSession" ADD CONSTRAINT "RefreshSession_hash" CHECK ("tokenHash" ~ '^[a-f0-9]{64}$');
ALTER TABLE "PasswordResetToken" ADD CONSTRAINT "PasswordResetToken_hash" CHECK ("tokenHash" ~ '^[a-f0-9]{64}$');
ALTER TABLE "CompanyInvitation" ADD CONSTRAINT "CompanyInvitation_hash" CHECK ("tokenHash" ~ '^[a-f0-9]{64}$');
ALTER TABLE "NotificationDelivery" ADD CONSTRAINT "NotificationDelivery_bounds" CHECK ("attemptCount" BETWEEN 0 AND 5 AND "leaseGeneration" >= 0 AND "generation" > 0 AND "templateVersion" > 0), ADD CONSTRAINT "NotificationDelivery_payload" CHECK (("ciphertext" IS NULL) = ("keyVersion" IS NULL) AND ("status" NOT IN ('SMTP_ACCEPTED','FAILED','CANCELLED','EXPIRED') OR "ciphertext" IS NULL)), ADD CONSTRAINT "NotificationDelivery_acceptance" CHECK (("status" = 'SMTP_ACCEPTED') = ("smtpAcceptedAt" IS NOT NULL));
CREATE INDEX "NotificationDelivery_due" ON "NotificationDelivery" ("availableAt", "leaseExpiresAt") WHERE "status" IN ('PENDING','RETRY_WAIT','SENDING');
ALTER TABLE "AuthNotificationDelivery" ADD CONSTRAINT "AuthNotificationDelivery_bounds" CHECK ("attemptCount" BETWEEN 0 AND 5 AND "leaseGeneration" >= 0 AND "generation" > 0 AND "templateVersion" > 0), ADD CONSTRAINT "AuthNotificationDelivery_payload" CHECK (("ciphertext" IS NULL) = ("keyVersion" IS NULL) AND ("status" NOT IN ('SMTP_ACCEPTED','FAILED','CANCELLED','EXPIRED') OR "ciphertext" IS NULL)), ADD CONSTRAINT "AuthNotificationDelivery_acceptance" CHECK (("status" = 'SMTP_ACCEPTED') = ("smtpAcceptedAt" IS NOT NULL));
CREATE INDEX "AuthNotificationDelivery_due" ON "AuthNotificationDelivery" ("availableAt", "leaseExpiresAt") WHERE "status" IN ('PENDING','RETRY_WAIT','SENDING');
-- Preserve append-only security attribution for the runtime role.
DO $$ BEGIN
 IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'smart_recruit_runtime') THEN
  REVOKE UPDATE, DELETE ON "AuditLog", "AuthSecurityEvent" FROM smart_recruit_runtime;
 END IF;
END $$;
