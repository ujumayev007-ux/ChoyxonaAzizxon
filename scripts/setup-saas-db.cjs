/**
 * Safe SaaS & Multi-Tenant Database Setup Script
 * Creates Tenant, SuperOwner, DeviceAuthorization, TenantPayment,
 * OwnerAuditLog, and TelegramBotConfig tables non-destructively.
 */

const { PrismaClient } = require('@prisma/client');
const { crypto, scryptSync, randomBytes } = require('crypto');
const path = require('path');
const { spawnSync } = require('child_process');

require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const prisma = new PrismaClient();

function hashPasswordSync(password) {
    const salt = randomBytes(16).toString('hex');
    const derived = scryptSync(password, salt, 64);
    return `${salt}:${derived.toString('hex')}`;
}

async function main() {
    console.log('\n[1/3] ⚙️ Generating Prisma Client with SaaS models...');
    try {
        spawnSync(process.execPath, [path.join(__dirname, 'generate-prisma.cjs')], { stdio: 'inherit' });
    } catch (e) {
        console.warn('generate-prisma warning:', e?.message);
    }

    console.log('\n[2/3] 🗄️ Creating SaaS tables safely (IF NOT EXISTS)...');
    
    // Create enums if not exist
    const enumQueries = [
        `DO $$ BEGIN
            IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'TenantStatus') THEN
                CREATE TYPE "TenantStatus" AS ENUM ('PENDING_APPROVAL', 'ACTIVE', 'SUSPENDED', 'LOCKED', 'REJECTED');
            END IF;
        END $$;`,
        `DO $$ BEGIN
            IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'DeviceStatus') THEN
                CREATE TYPE "DeviceStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'BLOCKED', 'REVOKED');
            END IF;
        END $$;`,
        `DO $$ BEGIN
            IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'DeviceType') THEN
                CREATE TYPE "DeviceType" AS ENUM ('PC', 'TABLET', 'PHONE', 'POS', 'TV', 'OTHER');
            END IF;
        END $$;`
    ];

    for (const q of enumQueries) {
        await prisma.$executeRawUnsafe(q);
    }

    // Create Tables
    const tableQueries = [
        `CREATE TABLE IF NOT EXISTS "Tenant" (
            "id" TEXT NOT NULL PRIMARY KEY,
            "slug" TEXT NOT NULL UNIQUE,
            "name" TEXT NOT NULL,
            "ownerName" TEXT NOT NULL,
            "ownerPhone" TEXT NOT NULL,
            "status" "TenantStatus" NOT NULL DEFAULT 'PENDING_APPROVAL',
            "statusReason" TEXT,
            "address" TEXT,
            "timezone" TEXT NOT NULL DEFAULT 'Asia/Tashkent',
            "subscriptionPlan" TEXT NOT NULL DEFAULT 'STANDART',
            "monthlyFee" DECIMAL(65,30) NOT NULL DEFAULT 500000,
            "subscriptionDueDay" INTEGER NOT NULL DEFAULT 1,
            "currentPeriodStart" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
            "currentPeriodEnd" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
            "gracePeriodDays" INTEGER NOT NULL DEFAULT 3,
            "isLocked" BOOLEAN NOT NULL DEFAULT false,
            "lockReason" TEXT,
            "licenseKey" TEXT UNIQUE,
            "licenseExpiresAt" TIMESTAMP(3),
            "panelPermissions" JSONB,
            "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
            "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
        );`,

        `CREATE TABLE IF NOT EXISTS "SuperOwner" (
            "id" TEXT NOT NULL PRIMARY KEY,
            "username" TEXT NOT NULL UNIQUE,
            "passwordHash" TEXT NOT NULL,
            "fullName" TEXT NOT NULL DEFAULT 'Super Admin',
            "phone" TEXT,
            "mfaSecret" TEXT,
            "mfaEnabled" BOOLEAN NOT NULL DEFAULT false,
            "telegramId" TEXT,
            "telegramChatId" TEXT,
            "isActive" BOOLEAN NOT NULL DEFAULT true,
            "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
            "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
        );`,

        `CREATE TABLE IF NOT EXISTS "DeviceAuthorization" (
            "id" TEXT NOT NULL PRIMARY KEY,
            "tenantId" TEXT NOT NULL REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE,
            "deviceId" TEXT NOT NULL,
            "deviceName" TEXT NOT NULL,
            "deviceType" "DeviceType" NOT NULL DEFAULT 'PC',
            "role" "RoleType" NOT NULL DEFAULT 'WAITER',
            "status" "DeviceStatus" NOT NULL DEFAULT 'PENDING',
            "ipAddress" TEXT,
            "userAgent" TEXT,
            "fingerprint" TEXT,
            "token" TEXT UNIQUE,
            "isOnline" BOOLEAN NOT NULL DEFAULT false,
            "lastSeenAt" TIMESTAMP(3),
            "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
            "approvedAt" TIMESTAMP(3),
            "approvedById" TEXT,
            "rejectionReason" TEXT,
            "blockedReason" TEXT,
            "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
            "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
            CONSTRAINT "DeviceAuthorization_tenantId_deviceId_key" UNIQUE ("tenantId", "deviceId")
        );`,

        `CREATE TABLE IF NOT EXISTS "TenantPayment" (
            "id" TEXT NOT NULL PRIMARY KEY,
            "tenantId" TEXT NOT NULL REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE,
            "amount" DECIMAL(65,30) NOT NULL,
            "currency" TEXT NOT NULL DEFAULT 'UZS',
            "periodStart" TIMESTAMP(3) NOT NULL,
            "periodEnd" TIMESTAMP(3) NOT NULL,
            "status" TEXT NOT NULL DEFAULT 'TOLANDI',
            "paymentMethod" TEXT NOT NULL DEFAULT 'BANK_TRANSFER',
            "transactionRef" TEXT,
            "notes" TEXT,
            "confirmedById" TEXT,
            "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
        );`,

        `CREATE TABLE IF NOT EXISTS "OwnerAuditLog" (
            "id" TEXT NOT NULL PRIMARY KEY,
            "superOwnerId" TEXT REFERENCES "SuperOwner"("id") ON DELETE SET NULL ON UPDATE CASCADE,
            "tenantId" TEXT REFERENCES "Tenant"("id") ON DELETE SET NULL ON UPDATE CASCADE,
            "action" TEXT NOT NULL,
            "entity" TEXT NOT NULL,
            "entityId" TEXT,
            "details" JSONB,
            "ipAddress" TEXT,
            "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
        );`,

        `CREATE TABLE IF NOT EXISTS "TelegramBotConfig" (
            "id" TEXT NOT NULL PRIMARY KEY DEFAULT 'default',
            "botToken" TEXT,
            "botUsername" TEXT,
            "ownerChatIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
            "notifyOnDevice" BOOLEAN NOT NULL DEFAULT true,
            "notifyOnRegistration" BOOLEAN NOT NULL DEFAULT true,
            "notifyOnUnpaid" BOOLEAN NOT NULL DEFAULT true,
            "notifyOnExpiry" BOOLEAN NOT NULL DEFAULT true,
            "secureApproveEnabled" BOOLEAN NOT NULL DEFAULT true,
            "webhookSecret" TEXT,
            "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
            "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
        );`
    ];

    for (const q of tableQueries) {
        await prisma.$executeRawUnsafe(q);
    }

    console.log('\n[3/3] 🌱 Seeding Default Restaurant Tenant & Super Owner...');
    
    // 1. Ensure Default Tenant
    const existingTenant = await prisma.tenant.findFirst({ where: { slug: 'azizxon' } });
    if (!existingTenant) {
        await prisma.tenant.create({
            data: {
                id: 'choyxona-azizxon-default-tenant',
                slug: 'azizxon',
                name: 'Choyxona Azizxon',
                ownerName: 'Azamatjon & Umidjon',
                ownerPhone: '+998 90 000-00-00',
                status: 'ACTIVE',
                subscriptionPlan: 'PREMIUM',
                monthlyFee: 500000,
                currentPeriodStart: new Date(),
                currentPeriodEnd: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000), // 1 year
                isLocked: false,
                panelPermissions: {
                    admin: { reports: true, inventory: true, finance: true, employees: true },
                    cashier: { discounts: true, refunds: true, debts: true },
                    waiter: { callService: true, takeaway: true },
                    kitchen: { tvDisplay: true, fishSection: true }
                }
            }
        });
        console.log('✅ Asosiy "Choyxona Azizxon" restorani SaaS tenant sifatida kiritildi.');
    } else {
        console.log('✓ "Choyxona Azizxon" restorani allaqachon mavjud.');
    }

    // 2. Ensure Super Owner account
    const superOwnerUsername = process.env.SUPER_OWNER_USERNAME || 'superowner';
    const superOwnerPassword = process.env.SUPER_OWNER_PASSWORD || 'SuperOwner2026!';
    
    const existingSuperOwner = await prisma.superOwner.findUnique({ where: { username: superOwnerUsername } });
    if (!existingSuperOwner) {
        await prisma.superOwner.create({
            data: {
                username: superOwnerUsername,
                passwordHash: hashPasswordSync(superOwnerPassword),
                fullName: 'Super Administrator (Dastur Egasi)',
                isActive: true
            }
        });
        console.log(`✅ Super Owner hisobi yaratildi: username="${superOwnerUsername}"`);
    } else {
        console.log(`✓ Super Owner hisobi mavjud: "${superOwnerUsername}".`);
    }

    // 3. Ensure TelegramBotConfig
    const existingBot = await prisma.telegramBotConfig.findUnique({ where: { id: 'default' } });
    if (!existingBot) {
        await prisma.telegramBotConfig.create({
            data: {
                id: 'default',
                botToken: process.env.TELEGRAM_OWNER_BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN || null,
                ownerChatIds: process.env.TELEGRAM_OWNER_CHAT_ID ? [process.env.TELEGRAM_OWNER_CHAT_ID] : [],
                notifyOnDevice: true,
                notifyOnRegistration: true,
                notifyOnUnpaid: true,
                notifyOnExpiry: true,
                secureApproveEnabled: true
            }
        });
        console.log('✅ Telegram Bot konfiguratsiyasi yaratildi.');
    }

    console.log('\n🎉 SAAS & MULTI-TENANT BAZASI MUVAFFAQIYATLI SOZLANDI!\n');
}

main().catch(e => {
    console.error('❌ Xatolik:', e);
    process.exit(1);
}).finally(() => prisma.$disconnect());

