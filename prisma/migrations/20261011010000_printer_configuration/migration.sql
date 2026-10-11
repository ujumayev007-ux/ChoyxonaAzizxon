ALTER TABLE "Printer" ADD COLUMN "categoryIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "Printer" ADD COLUMN "connectionType" TEXT NOT NULL DEFAULT 'TCP';
CREATE TABLE "PrintConfig" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "header" TEXT NOT NULL DEFAULT 'ChoyxonaAzizxon',
    "footer" TEXT NOT NULL DEFAULT 'Yoqimli ishtaha!',
    "agentTokenHash" TEXT,
    CONSTRAINT "PrintConfig_pkey" PRIMARY KEY ("id")
);
