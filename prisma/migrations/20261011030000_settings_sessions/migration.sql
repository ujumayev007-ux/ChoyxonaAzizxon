CREATE TABLE "AuthSession" ("id" TEXT PRIMARY KEY, "userId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
"createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
"expiresAt" TIMESTAMP(3) NOT NULL, "revokedAt" TIMESTAMP(3), "userAgent" TEXT);
CREATE INDEX "AuthSession_userId_expiresAt_idx" ON "AuthSession"("userId", "expiresAt");
CREATE TABLE "AppSetting" ("key" TEXT PRIMARY KEY, "value" JSONB NOT NULL, "updatedAt" TIMESTAMP(3) NOT NULL);
CREATE TABLE "SettingRevision" ("id" TEXT PRIMARY KEY, "key" TEXT NOT NULL, "actorId" TEXT NOT NULL,
"previous" JSONB NOT NULL, "value" JSONB NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE INDEX "SettingRevision_key_createdAt_idx" ON "SettingRevision"("key", "createdAt");
