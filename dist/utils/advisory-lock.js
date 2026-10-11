"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.lockTransaction = lockTransaction;
async function lockTransaction(tx, key) {
    // PostgreSQL returns void here. Execute the statement without deserializing a result row.
    await tx.$executeRaw `SELECT pg_advisory_xact_lock(hashtext(${key}))`;
}
