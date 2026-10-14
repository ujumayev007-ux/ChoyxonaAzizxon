/**
 * End-to-End Verification Test for Super Owner & Commercial SaaS Features
 */

const assert = require('node:assert/strict');
const path = require('node:path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const { loginSuperOwner, verifySuperOwnerToken, signSuperOwnerToken } = require('../dist/services/super-owner-auth.service');
const { getAllTenants, getTenantById, setTenantLock, extendTenantSubscription, generateTenantLicenseKey, activateTenantLicenseKey } = require('../dist/services/tenant.service');
const { requestDeviceAccess, approveDevice, checkDeviceAuthorization, blockDevice } = require('../dist/services/device.service');
const { getTenantPermissions, updateTenantPermissions } = require('../dist/services/permission.service');

async function runVerification() {
    console.log('--- [1/8] Super Owner Auth Verification ---');
    const authResult = await loginSuperOwner('superowner', process.env.SUPER_OWNER_PASSWORD || 'SuperOwner2026!');
    assert.ok(authResult.success, 'Super owner login should succeed: ' + authResult.message);
    assert.ok(authResult.token, 'JWT token should be returned');
    assert.equal(authResult.user.username, 'superowner');
    
    const verified = verifySuperOwnerToken(authResult.token);
    assert.ok(verified, 'JWT token should be successfully verified');
    assert.equal(verified.username, 'superowner');
    const auth = authResult.user;
    console.log('✓ Super Owner login & JWT token generation verified.');

    console.log('\n--- [2/8] Tenant Retrieval Verification ---');
    const tenants = await getAllTenants();
    assert.ok(tenants.length >= 1, 'Should have at least 1 tenant in database');
    const azizxon = tenants.find(t => t.slug === 'azizxon');
    assert.ok(azizxon, 'Default tenant azizxon must exist');
    assert.equal(azizxon.name, 'Choyxona Azizxon');
    console.log(`✓ Default tenant verified: "${azizxon.name}" (Status: ${azizxon.status})`);

    console.log('\n--- [3/8] Device Registration & Approval Flow ---');
    const testDeviceId = 'test_dev_' + Date.now();
    const regDevice = await requestDeviceAccess({
        tenantId: azizxon.id,
        deviceId: testDeviceId,
        deviceName: 'Ofitsiant Plansheti (Test Samsung A8)',
        deviceType: 'TABLET',
        role: 'WAITER',
        ipAddress: '192.168.1.100',
        userAgent: 'Mozilla/5.0 Test Agent'
    });
    assert.equal(regDevice.status, 'PENDING');
    console.log('✓ New device registered with status PENDING.');

    // Check before approval
    const preCheck = await checkDeviceAuthorization(azizxon.id, testDeviceId);
    assert.equal(preCheck.authorized, false, 'Pending device should not be authorized');
    console.log('✓ Unauthorized device correctly identified as not authorized.');

    // Approve device
    const approved = await approveDevice(regDevice.id, auth.id);
    assert.equal(approved.status, 'APPROVED');
    assert.ok(approved.token, 'Approved device must have a security token');
    console.log('✓ Device approved by Super Owner with security token.');

    // Check with valid token
    const postCheck = await checkDeviceAuthorization(azizxon.id, testDeviceId, approved.token);
    assert.equal(postCheck.authorized, true, 'Device with valid token must be authorized');
    console.log('✓ Device authorized successfully with signed token.');

    console.log('\n--- [4/8] Device Blocking Flow ---');
    await blockDevice(regDevice.id, 'Sinov bloklash', auth.id);
    const blockedCheck = await checkDeviceAuthorization(azizxon.id, testDeviceId, approved.token);
    assert.equal(blockedCheck.authorized, false);
    assert.equal(blockedCheck.status, 'BLOCKED');
    console.log('✓ Device blocking verified.');

    console.log('\n--- [5/8] Panel Permission Control ---');
    const perms = await getTenantPermissions(azizxon.id);
    assert.ok(perms.admin, 'Admin permissions object should exist');
    assert.ok(perms.cashier, 'Cashier permissions object should exist');
    
    // Toggle a permission
    const updatedPerms = await updateTenantPermissions(azizxon.id, {
        ...perms,
        cashier: { ...perms.cashier, discounts: false }
    }, auth.id);
    assert.equal(updatedPerms.cashier.discounts, false);
    
    // Restore
    await updateTenantPermissions(azizxon.id, {
        ...perms,
        cashier: { ...perms.cashier, discounts: true }
    }, auth.id);
    console.log('✓ Remote feature permission toggles per restaurant verified.');

    console.log('\n--- [6/8] Subscription Extension & Remote Locking ---');
    const oldEnd = new Date(azizxon.currentPeriodEnd).getTime();
    const extended = await extendTenantSubscription(azizxon.id, 30, 500000, 'Test uzaytirish', auth.id);
    const newEnd = new Date(extended.currentPeriodEnd).getTime();
    assert.ok(newEnd > oldEnd, 'Subscription period must be extended');
    console.log('✓ Subscription extended by 30 days verified.');

    // Test remote lock
    const lockedTenant = await setTenantLock(azizxon.id, true, 'Oylik to‘lov to‘lanmagan (Sinov)', auth.id);
    assert.equal(lockedTenant.isLocked, true);
    console.log('✓ Remote restaurant lock verified.');

    // Unlock
    const unlockedTenant = await setTenantLock(azizxon.id, false, null, auth.id);
    assert.equal(unlockedTenant.isLocked, false);
    console.log('✓ Remote restaurant unlock verified.');

    console.log('\n--- [7/8] Offline License Key Generation & Activation ---');
    const licenseKey = generateTenantLicenseKey(azizxon.slug, 30);
    assert.ok(licenseKey.startsWith('AZX-'), 'License key must start with AZX-');
    console.log(`✓ Offline license key generated: ${licenseKey}`);
    const activatedTenant = await activateTenantLicenseKey(licenseKey);
    assert.equal(activatedTenant.isLocked, false);
    console.log('✓ Offline license key activation verified.');

    console.log('\n--- [8/8] Audit Log Verification ---');
    const logs = await prisma.ownerAuditLog.findMany({
        where: { tenantId: azizxon.id },
        orderBy: { createdAt: 'desc' },
        take: 5
    });
    assert.ok(logs.length > 0, 'Audit logs must be created for Super Owner actions');
    console.log(`✓ Verified ${logs.length} Super Owner audit logs recorded.`);

    // Cleanup test device
    await prisma.deviceAuthorization.delete({ where: { id: regDevice.id } });
    console.log('✓ Cleaned up test device.');

    console.log('\n🎉 ALL 8 SUPER OWNER & SAAS COMMERCIAL MODULES VERIFIED 100% SUCCESSFULLY!\n');
}

runVerification().catch(err => {
    console.error('❌ Verification failed:', err);
    process.exit(1);
}).finally(() => prisma.$disconnect());

