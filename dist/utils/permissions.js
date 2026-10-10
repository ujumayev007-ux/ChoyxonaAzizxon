"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.hasPermission = hasPermission;
const db_1 = require("./db");
async function hasPermission(role, permissionKey) {
    const perm = await db_1.prisma.rolePermission.findUnique({
        where: { role_permissionKey: { role, permissionKey } },
        select: { enabled: true }
    });
    return perm?.enabled ?? false;
}
