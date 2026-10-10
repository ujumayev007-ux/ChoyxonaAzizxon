-- Additive migration: preserve all existing records and activity flags.
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "pinCodeHash" TEXT;
ALTER TABLE "InventoryProduct" ADD COLUMN IF NOT EXISTS "isActive" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "InventoryProduct" ADD COLUMN IF NOT EXISTS "lowStockNotified" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS "TelegramSubscriber" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "username" TEXT,
  "chatId" TEXT NOT NULL,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "TelegramSubscriber_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "TelegramSubscriber_chatId_key" ON "TelegramSubscriber"("chatId");

CREATE TABLE IF NOT EXISTS "RolePermission" (
  "id" TEXT NOT NULL,
  "role" "RoleType" NOT NULL,
  "permissionKey" TEXT NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "RolePermission_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "RolePermission_role_permissionKey_key" ON "RolePermission"("role", "permissionKey");
CREATE INDEX IF NOT EXISTS "RolePermission_role_idx" ON "RolePermission"("role");
