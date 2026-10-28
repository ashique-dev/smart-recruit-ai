BEGIN;
CREATE FUNCTION pg_temp.expect_error(statement text, expected text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
 BEGIN
  EXECUTE statement;
 EXCEPTION WHEN OTHERS THEN
  IF SQLSTATE = expected THEN RETURN; END IF;
  RAISE EXCEPTION 'Expected %, received %', expected, SQLSTATE;
 END;
 RAISE EXCEPTION 'Expected % but statement succeeded', expected;
END $$;
INSERT INTO "User" (id,"normalizedEmail","passwordHash","displayName","updatedAt") VALUES
 ('10000000-0000-4000-8000-000000000001','one@example.test','synthetic','One',now()),
 ('10000000-0000-4000-8000-000000000002','two@example.test','synthetic','Two',now());
INSERT INTO "Company" (id,name,"updatedAt") VALUES
 ('20000000-0000-4000-8000-000000000001','A',now()),('20000000-0000-4000-8000-000000000002','B',now());
INSERT INTO "CompanyMembership" (id,"companyId","userId",role,"updatedAt") VALUES
 ('30000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','COMPANY_ADMIN',now()),
 ('30000000-0000-4000-8000-000000000002','20000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000001','VIEWER',now());
SELECT pg_temp.expect_error($q$INSERT INTO "CompanyMembership" (id,"companyId","userId",role,"updatedAt") VALUES (gen_random_uuid(),'20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','RECRUITER',now())$q$,'23505');
SELECT pg_temp.expect_error($q$INSERT INTO "User" (id,"normalizedEmail","passwordHash","displayName","updatedAt") VALUES (gen_random_uuid(),'one@example.test','x','x',now())$q$,'23505');
SELECT pg_temp.expect_error($q$UPDATE "User" SET "normalizedEmail"='ONE@example.test'$q$,'23514');
INSERT INTO "CompanyInvitation" (id,"companyId","normalizedEmail",role,"issuerMembershipId","tokenHash","expiresAt","updatedAt") VALUES ('40000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','invite@example.test','VIEWER','30000000-0000-4000-8000-000000000001',repeat('a',64),now()+interval '7 days',now());
SELECT pg_temp.expect_error($q$UPDATE "CompanyInvitation" SET "companyId"='20000000-0000-4000-8000-000000000002'$q$,'23503');
SELECT pg_temp.expect_error($q$INSERT INTO "CompanyInvitation" SELECT gen_random_uuid(),"companyId","normalizedEmail",role,"issuerMembershipId",repeat('b',64),generation,"expiresAt","consumedAt","revokedAt","createdAt","updatedAt" FROM "CompanyInvitation"$q$,'23505');
SELECT pg_temp.expect_error($q$UPDATE "CompanyInvitation" SET "tokenHash"='plaintext'$q$,'23514');
SELECT pg_temp.expect_error($q$UPDATE "CompanyInvitation" SET "expiresAt"="createdAt"$q$,'23514');
SELECT pg_temp.expect_error($q$UPDATE "CompanyInvitation" SET "consumedAt"=now(),"revokedAt"=now()$q$,'23514');
INSERT INTO "RefreshSession" (id,"userId","tokenHash","familyId","expiresAt") VALUES ('50000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001',repeat('c',64),gen_random_uuid(),now()+interval '1 day');
SELECT pg_temp.expect_error($q$UPDATE "RefreshSession" SET "rotatedAt"=now()$q$,'23514');
SELECT pg_temp.expect_error($q$UPDATE "RefreshSession" SET "expiresAt"="createdAt"$q$,'23514');
INSERT INTO "ProcessingOperation" (id,"companyId",kind,"idempotencyKey","deadlineAt","updatedAt") VALUES ('60000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','TEAM_INVITATION','test',now()+interval '1 day',now());
SELECT pg_temp.expect_error($q$INSERT INTO "OutboxEvent" (id,"companyId","operationId",topic) VALUES (gen_random_uuid(),'20000000-0000-4000-8000-000000000002','60000000-0000-4000-8000-000000000001','notification')$q$,'23503');
SELECT pg_temp.expect_error($q$INSERT INTO "NotificationDelivery" (id,"companyId","operationId","invitationId",template,"payloadExpiresAt","updatedAt") VALUES (gen_random_uuid(),'20000000-0000-4000-8000-000000000002','60000000-0000-4000-8000-000000000001','40000000-0000-4000-8000-000000000001','team',now()+interval '1 day',now())$q$,'23503');
INSERT INTO "PasswordResetToken" (id,"userId","tokenHash","expiresAt") VALUES ('70000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001',repeat('d',64),now()+interval '30 minutes');
SELECT pg_temp.expect_error($q$INSERT INTO "AuthNotificationDelivery" (id,"userId","resetTokenId","operationKey",template,"payloadExpiresAt","updatedAt") VALUES (gen_random_uuid(),'10000000-0000-4000-8000-000000000002','70000000-0000-4000-8000-000000000001','reset','reset',now()+interval '30 minutes',now())$q$,'23503');
INSERT INTO "AuthNotificationDelivery" (id,"userId","resetTokenId","operationKey",template,"payloadExpiresAt","updatedAt") VALUES ('80000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','70000000-0000-4000-8000-000000000001','reset','reset',now()+interval '30 minutes',now());
SELECT pg_temp.expect_error($q$UPDATE "AuthNotificationDelivery" SET status='FAILED',ciphertext='secret',"keyVersion"='v1'$q$,'23514');
SELECT pg_temp.expect_error($q$UPDATE "AuthNotificationDelivery" SET "attemptCount"=6$q$,'23514');
SELECT pg_temp.expect_error($q$UPDATE "AuthNotificationDelivery" SET status='SMTP_ACCEPTED'$q$,'23514');
DO $$ DECLARE n integer; BEGIN
 SELECT count(*) INTO n FROM pg_indexes WHERE indexname IN ('CompanyInvitation_live_email','ProcessingOperation_due','OutboxEvent_due','AuthOutboxEvent_due','NotificationDelivery_due','AuthNotificationDelivery_due');
 IF n<>6 THEN RAISE EXCEPTION 'Missing required partial indexes'; END IF;
 IF EXISTS (SELECT 1 FROM pg_class c JOIN pg_roles r ON r.oid=c.relowner WHERE c.relnamespace='public'::regnamespace AND r.rolname='smart_recruit_runtime') THEN RAISE EXCEPTION 'Runtime owns schema objects'; END IF;
END $$;
SET LOCAL ROLE smart_recruit_runtime;
SELECT count(*) FROM "CompanyMembership";
UPDATE "Company" SET name='Allowed DML' WHERE name='A';
SELECT pg_temp.expect_error('CREATE TABLE public.forbidden (id int)','42501');
SELECT pg_temp.expect_error('ALTER TABLE "Company" ADD COLUMN forbidden text','42501');
SELECT pg_temp.expect_error('UPDATE "AuditLog" SET action=action','42501');
SELECT pg_temp.expect_error('DELETE FROM "AuthSecurityEvent"','42501');
SELECT pg_temp.expect_error('UPDATE "InfrastructureState" SET version=2','42501');
RESET ROLE;
ROLLBACK;
