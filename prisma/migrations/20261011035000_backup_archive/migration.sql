ALTER TABLE "Order" ADD COLUMN "archivedAt" TIMESTAMP(3);
CREATE TABLE "DataBackup" ("id" TEXT NOT NULL, "actorId" TEXT NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "status" TEXT NOT NULL DEFAULT 'ISHLANMOQDA', "encryptedData" TEXT, "manifest" JSONB, CONSTRAINT "DataBackup_pkey" PRIMARY KEY ("id"));
CREATE INDEX "DataBackup_createdAt_idx" ON "DataBackup"("createdAt");
