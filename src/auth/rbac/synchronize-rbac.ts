import { PrismaClient, RoleName } from '@prisma/client';
import {
  PERMISSION_DEFINITIONS,
  ROLE_PERMISSION_SLUGS,
  TARGET_ROLE_NAMES,
} from './permission-matrix';

export async function removeObsoleteObserverAssignments(
  prisma: PrismaClient,
): Promise<void> {
  await prisma.$executeRaw`
    DELETE FROM "UserRole"
    WHERE "roleId" IN (
      SELECT "id" FROM "Role" WHERE "name"::text = 'OBSERVER'
    )
  `;
  await prisma.$executeRaw`
    DELETE FROM "RolePermission"
    WHERE "roleId" IN (
      SELECT "id" FROM "Role" WHERE "name"::text = 'OBSERVER'
    )
  `;
  await prisma.$executeRaw`
    DELETE FROM "Role" WHERE "name"::text = 'OBSERVER'
  `;
}

export async function synchronizeRbac(
  prisma: PrismaClient,
): Promise<Map<RoleName, { id: string }>> {
  await removeObsoleteObserverAssignments(prisma);

  const roles = new Map<RoleName, { id: string }>();
  const permissions = new Map<string, { id: string }>();

  for (const roleName of TARGET_ROLE_NAMES) {
    const role = await prisma.role.upsert({
      where: { name: roleName },
      update: { description: `${roleName} role` },
      create: {
        name: roleName,
        description: `${roleName} role`,
      },
      select: { id: true },
    });
    roles.set(roleName, role);
  }

  for (const [slug, description] of PERMISSION_DEFINITIONS) {
    const permission = await prisma.permission.upsert({
      where: { slug },
      update: { description },
      create: { slug, description },
      select: { id: true },
    });
    permissions.set(slug, permission);
  }

  for (const roleName of TARGET_ROLE_NAMES) {
    const role = roles.get(roleName);
    if (!role) {
      throw new Error(`Role not seeded: ${roleName}`);
    }

    const slugs = ROLE_PERMISSION_SLUGS[roleName];
    const permissionIds: string[] = [];

    for (const slug of slugs) {
      const permission = permissions.get(slug);
      if (!permission) {
        throw new Error(`Permission not seeded: ${slug}`);
      }

      permissionIds.push(permission.id);

      await prisma.rolePermission.upsert({
        where: {
          roleId_permissionId: {
            roleId: role.id,
            permissionId: permission.id,
          },
        },
        update: {},
        create: {
          roleId: role.id,
          permissionId: permission.id,
        },
      });
    }

    await prisma.rolePermission.deleteMany({
      where: {
        roleId: role.id,
        permissionId: { notIn: permissionIds },
      },
    });
  }

  return roles;
}
