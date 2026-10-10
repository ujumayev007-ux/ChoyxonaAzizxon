import { RoleType } from '@prisma/client';
import { prisma } from './db';

export async function hasPermission(role: RoleType, permissionKey: string): Promise<boolean> {
  const perm = await prisma.rolePermission.findUnique({
    where: { role_permissionKey: { role, permissionKey } },
    select: { enabled: true }
  });
  return perm?.enabled ?? false;
}
