import { PrismaClient, PermissionScope, PermissionEffect, RoleScope } from '@prisma/client';

const prisma = new PrismaClient();

const permissionsToAdd = [
  {
    resource: 'management_portal',
    action: 'read',
    description: 'Read access to management portal data (tenants, stats, users, audit, security)',
  },
  {
    resource: 'tenant_ownership',
    action: 'review',
    description: 'Review tenant ownership identity evidence and access requests',
  },
  {
    resource: 'super_admin',
    action: 'review_approvals',
    description: 'Review platform approval queues for tenant documents, ownership, activation, and patient verification',
  },
];

async function main() {
  console.log('Adding missing platform permissions to PLATFORM_ADMIN role...');

  // Find the PLATFORM_ADMIN role
  const platformRole = await prisma.role.findFirst({
    where: { scope: RoleScope.PLATFORM, code: 'PLATFORM_ADMIN' },
    include: { platformAssignments: true },
  });

  if (!platformRole) {
    throw new Error('PLATFORM_ADMIN role not found. Run create-super-admin.ts first.');
  }

  console.log('  Found role:', platformRole.name, '(id:', platformRole.id + ')');

  // Get existing role permissions to avoid duplicates
  const existingRolePermissions = await prisma.rolePermission.findMany({
    where: { roleId: platformRole.id },
    select: { permissionId: true },
  });
  const existingPermissionIds = new Set(existingRolePermissions.map((rp) => rp.permissionId));

  for (const permDef of permissionsToAdd) {
    // Create the permission if it doesn't exist
    let permission = await prisma.permission.findFirst({
      where: {
        scope: PermissionScope.PLATFORM,
        resource: permDef.resource,
        action: permDef.action,
      },
    });

    if (!permission) {
      permission = await prisma.permission.create({
        data: {
          resource: permDef.resource,
          action: permDef.action,
          effect: PermissionEffect.ALLOW,
          scope: PermissionScope.PLATFORM,
          description: permDef.description,
          status: 'ACTIVE',
        },
      });
      console.log(`  Created permission: ${permDef.resource}:${permDef.action}`);
    } else {
      console.log(`  Permission already exists: ${permDef.resource}:${permDef.action}`);
    }

    // Assign to role if not already assigned
    if (!existingPermissionIds.has(permission.id)) {
      await prisma.rolePermission.create({
        data: { roleId: platformRole.id, permissionId: permission.id },
      });
      console.log(`  Assigned ${permDef.resource}:${permDef.action} to PLATFORM_ADMIN role`);
    } else {
      console.log(`  ${permDef.resource}:${permDef.action} already assigned to PLATFORM_ADMIN role`);
    }
  }

  // Verify all platform role assignments still work
  const assignments = await prisma.platformRoleAssignment.findMany({
    where: { roleId: platformRole.id },
    select: { userId: true },
  });
  console.log(`  Role assigned to ${assignments.length} user(s)`);

  await prisma.$disconnect();
  console.log('\nDone! You should now have full platform admin access including Approvals.');
}

main().catch((err) => {
  console.error('Failed to add permissions:', err);
  process.exit(1);
});
