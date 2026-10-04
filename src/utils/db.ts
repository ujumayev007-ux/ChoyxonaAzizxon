import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export default prisma;
// Yoki named export ishlatgan bo'lsangiz:
// export { prisma };
