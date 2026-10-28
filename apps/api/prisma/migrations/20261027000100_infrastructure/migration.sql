CREATE TABLE "InfrastructureState" (
  "id" INTEGER PRIMARY KEY CHECK ("id" = 1),
  "version" INTEGER NOT NULL,
  "installedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO "InfrastructureState" ("id", "version") VALUES (1, 1);
CREATE TABLE "WorkerHeartbeat" (
  "id" TEXT PRIMARY KEY,
  "updatedAt" TIMESTAMPTZ NOT NULL
);
