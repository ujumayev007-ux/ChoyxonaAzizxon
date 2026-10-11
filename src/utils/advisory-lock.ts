import { Prisma } from '@prisma/client';

export async function lockTransaction(tx: Prisma.TransactionClient, key: string): Promise<void> {
    // PostgreSQL returns void here. Execute the statement without deserializing a result row.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${key}))`;
}
