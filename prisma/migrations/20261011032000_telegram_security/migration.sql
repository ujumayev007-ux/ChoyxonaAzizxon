ALTER TABLE "TelegramSubscriber" ADD COLUMN "verifiedAt" TIMESTAMP(3), ADD COLUMN "verificationHash" TEXT, ADD COLUMN "verificationExpiresAt" TIMESTAMP(3), ADD COLUMN "verificationAttempts" INTEGER NOT NULL DEFAULT 0;
CREATE TABLE "TelegramDelivery" ("id" TEXT NOT NULL, "chatId" TEXT NOT NULL, "kind" TEXT NOT NULL, "status" TEXT NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, CONSTRAINT "TelegramDelivery_pkey" PRIMARY KEY ("id"));
CREATE INDEX "TelegramDelivery_createdAt_idx" ON "TelegramDelivery"("createdAt");
