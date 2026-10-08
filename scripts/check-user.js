const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
(async () => {
    const rows = await prisma.user.findMany({
        where: { username: { in: ['smokeadmin', 'Admin'] } },
        select: { id: true, username: true, role: true, isActive: true, createdAt: true }
    });
    console.log(JSON.stringify(rows, null, 2));
    await prisma.$disconnect();
})();
