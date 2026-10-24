import { PrismaClient, IdentityType, RecordStatus, RoleScope, PermissionScope, PermissionEffect } from '@prisma/client';
import * as argon2 from 'argon2';

const prisma = new PrismaClient();

async function main() {
  const email = 'sp@revaltrixtechnologies.com';
  const password = '38895790@Adminrevaltrix';
  const displayName = 'wilson Nyaanga';
  const normalizedEmail = email.toLowerCase();

  console.log('Creating super admin credentials...');
  console.log('  Email:', email);
  console.log('  Display name:', displayName);

  const credentialHash = await argon2.hash(password, {
    type: argon2.argon2id,
    memoryCost: 19456,
    timeCost: 2,
    parallelism: 1,
  });
  console.log('  Password hashed');

  let user = await prisma.user.findFirst({
    where: {
      OR: [
        { identities: { some: { type: IdentityType.EMAIL, normalizedValue: normalizedEmail } } },
        { displayName },
      ],
    },
  });

  if (!user) {
    user = await prisma.user.create({
      data: { displayName, status: RecordStatus.ACTIVE },
    });
    console.log('  User created:', user.id);
  } else {
    console.log('  User already exists:', user.id);
  }

  const existingIdentity = await prisma.identity.findUnique({
    where: {
      type_normalizedValue: {
        type: IdentityType.EMAIL,
        normalizedValue: normalizedEmail,
      },
    },
  });

  if (existingIdentity && existingIdentity.userId !== user.id) {
    throw new Error(`Email ${email} is already associated with another user`);
  }

  if (existingIdentity) {
    await prisma.identity.update({
      where: { id: existingIdentity.id },
      data: { credentialHash, status: RecordStatus.ACTIVE, value: email, userId: user.id },
    });
    console.log('  Identity updated:', email);
  } else {
    await prisma.identity.create({
      data: {
        userId: user.id,
        type: IdentityType.EMAIL,
        value: email,
        normalizedValue: normalizedEmail,
        credentialHash,
        status: RecordStatus.ACTIVE,
      },
    });
    console.log('  Identity created:', email);
  }

  let platformRole = await prisma.role.findFirst({
    where: { scope: RoleScope.PLATFORM, code: 'PLATFORM_ADMIN' },
  });

  if (!platformRole) {
    platformRole = await prisma.role.create({
      data: {
        name: 'Platform Administrator',
        code: 'PLATFORM_ADMIN',
        scope: RoleScope.PLATFORM,
        description: 'Full platform administration access',
        status: RecordStatus.ACTIVE,
      },
    });
    console.log('  Platform role created: PLATFORM_ADMIN');
  } else {
    console.log('  Platform role already exists: PLATFORM_ADMIN');
  }

  let permission = await prisma.permission.findFirst({
    where: { scope: PermissionScope.PLATFORM, resource: 'management_portal', action: 'access' },
  });

  if (!permission) {
    permission = await prisma.permission.create({
      data: {
        resource: 'management_portal',
        action: 'access',
        effect: PermissionEffect.ALLOW,
        scope: PermissionScope.PLATFORM,
        description: 'Access to the Revaltrix management portal',
        status: RecordStatus.ACTIVE,
      },
    });
    console.log('  Permission created: management_portal:access');
  } else {
    console.log('  Permission already exists: management_portal:access');
  }

  const existingRolePermission = await prisma.rolePermission.findFirst({
    where: { roleId: platformRole.id, permissionId: permission.id },
  });

  if (!existingRolePermission) {
    await prisma.rolePermission.create({ data: { roleId: platformRole.id, permissionId: permission.id } });
    console.log('  Permission assigned to role');
  } else {
    console.log('  Permission already assigned to role');
  }

  const existingAssignment = await prisma.platformRoleAssignment.findFirst({
    where: { userId: user.id, roleId: platformRole.id },
  });

  if (!existingAssignment) {
    await prisma.platformRoleAssignment.create({ data: { userId: user.id, roleId: platformRole.id } });
    console.log('  Role assigned to user');
  } else {
    console.log('  Role already assigned to user');
  }

  const identity = await prisma.identity.findUnique({
    where: { type_normalizedValue: { type: IdentityType.EMAIL, normalizedValue: normalizedEmail } },
    select: { id: true, credentialHash: true, user: { select: { id: true, status: true, deletedAt: true } } },
  });

  if (identity && identity.credentialHash) {
    const valid = await argon2.verify(identity.credentialHash, password);
    if (valid) {
      console.log('\nSuper admin credentials ready!');
      console.log('  Login URL: http://localhost:5173/management');
      console.log('  Email:', email);
      console.log('  Password:', password);
    } else {
      console.log('\nPassword verification failed');
    }
  }

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error('Failed to create super admin credentials:', err);
  process.exit(1);
});
