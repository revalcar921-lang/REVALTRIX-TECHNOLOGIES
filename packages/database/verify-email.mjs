import { PrismaClient, IdentityType } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const email = process.argv[2];

  if (!email) {
    console.error('Usage: node verify-email.mjs <email-address>');
    console.error('Example: node verify-email.mjs revaltrixtechnologies@gmail.com');
    process.exit(1);
  }

  const normalizedEmail = email.toLowerCase().trim();

  console.log(`Verifying email: ${email}`);

  const identity = await prisma.identity.findUnique({
    where: {
      type_normalizedValue: {
        type: IdentityType.EMAIL,
        normalizedValue: normalizedEmail,
      },
    },
  });

  if (!identity) {
    console.error(`No email identity found for: ${email}`);
    await prisma.$disconnect();
    process.exit(1);
  }

  if (identity.verifiedAt) {
    console.log(`Email ${email} is already verified.`);
    await prisma.$disconnect();
    return;
  }

  const now = new Date();
  await prisma.identity.update({
    where: { id: identity.id },
    data: { verifiedAt: now },
  });

  console.log(`\n✓ Email ${email} has been verified at ${now.toISOString()}.`);
  console.log('You can now log in to the management portal and receive a security code.');
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error('Failed to verify email:', err);
  process.exit(1);
});