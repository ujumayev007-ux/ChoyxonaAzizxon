ALTER TABLE "PrintConfig" ADD COLUMN "autoPrint" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "PrintJob" ALTER COLUMN "orderId" DROP NOT NULL;
CREATE TABLE "SystemAlert" ("id" TEXT NOT NULL, "kind" TEXT NOT NULL, "message" TEXT NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "resolvedAt" TIMESTAMP(3), CONSTRAINT "SystemAlert_pkey" PRIMARY KEY ("id"));
CREATE INDEX "SystemAlert_resolvedAt_createdAt_idx" ON "SystemAlert"("resolvedAt", "createdAt");
