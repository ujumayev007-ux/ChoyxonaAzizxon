/* Opt-in PostgreSQL regression: random advisory locks only, no business records written. */
require('dotenv').config();
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { PrismaClient } = require('@prisma/client');
const { lockTransaction } = require('../dist/utils/advisory-lock');
const db = new PrismaClient();

(async () => {
    const key = 'service-lock-test:' + randomUUID();
    let release, acquired;
    const released = new Promise(resolve => { release = resolve; });
    const ready = new Promise(resolve => { acquired = resolve; });
    const holding = db.$transaction(async tx => {
        await tx.$executeRaw`SET TRANSACTION READ ONLY`;
        await lockTransaction(tx, key);
        await lockTransaction(tx, key); // Reentrant within the same transaction.
        acquired();
        await released;
    }, { timeout: 15000 });
    try {
        await Promise.race([ready, holding]);
        const blocked = await db.$transaction(async tx => {
            await tx.$executeRaw`SET TRANSACTION READ ONLY`;
            return tx.$queryRaw`SELECT pg_try_advisory_xact_lock(hashtext(${key})) AS acquired`;
        });
        assert.equal(blocked[0].acquired, false, 'Another transaction must not acquire the same lock');
    } finally {
        release();
        await holding;
    }
    const after = await db.$transaction(async tx => {
        await tx.$executeRaw`SET TRANSACTION READ ONLY`;
        return tx.$queryRaw`SELECT pg_try_advisory_xact_lock(hashtext(${key})) AS acquired`;
    });
    assert.equal(after[0].acquired, true, 'Transaction completion must release the lock');
    console.log('PostgreSQL service locks passed: no void decoding, concurrent exclusion, automatic release. No business records written.');
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => db.$disconnect());
