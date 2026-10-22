export default () => ({
  app: {
    name: process.env.APP_NAME ?? 'Revaltrix Platform API',
    environment: process.env.NODE_ENV ?? 'development',
    port: Number(process.env.PORT ?? 5001),
    apiPrefix: process.env.API_PREFIX ?? 'api',
    webAppUrl: process.env.WEB_APP_URL ?? 'http://localhost:5173',
    corsOrigins: (process.env.CORS_ORIGINS ?? 'http://localhost:5173')
      .split(',')
      .map((origin) => origin.trim())
      .filter(Boolean),
  },

  storage: {
    endpoint: process.env.STORAGE_ENDPOINT ?? '',
    region: process.env.STORAGE_REGION ?? 'auto',
    bucket: process.env.STORAGE_BUCKET ?? '',
    accessKeyId: process.env.STORAGE_ACCESS_KEY_ID ?? '',
    secretAccessKey: process.env.STORAGE_SECRET_ACCESS_KEY ?? '',
    forcePathStyle: process.env.STORAGE_FORCE_PATH_STYLE === 'true',
    localPath: process.env.STORAGE_LOCAL_PATH ?? 'var/private-storage',
  },

  family: {
    adolescentMinimumAge: Number(process.env.FAMILY_ADOLESCENT_MINIMUM_AGE ?? 13),
    adolescentRestrictedPermissions:
      process.env.FAMILY_ADOLESCENT_RESTRICTED_PERMISSIONS ??
      'lab-results.read,prescriptions.read,documents.read',
  },

  notifications: {
    webPush: {
      publicKey: process.env.WEB_PUSH_PUBLIC_KEY ?? '',
      privateKey: process.env.WEB_PUSH_PRIVATE_KEY ?? '',
      subject: process.env.WEB_PUSH_SUBJECT ?? 'mailto:admin@revaltrix.com',
    },
  },

  payments: {
    daraja: {
      enabled: process.env.DARAJA_ENABLED === 'true',
      settlementApproved: process.env.DARAJA_SETTLEMENT_APPROVED === 'true',
      environment: process.env.DARAJA_ENVIRONMENT === 'production' ? 'production' : 'sandbox',
      consumerKey: process.env.DARAJA_CONSUMER_KEY ?? '',
      consumerSecret: process.env.DARAJA_CONSUMER_SECRET ?? '',
      shortcode: process.env.DARAJA_SHORTCODE ?? '',
      passkey: process.env.DARAJA_PASSKEY ?? '',
      callbackUrl: process.env.DARAJA_CALLBACK_URL ?? '',
      callbackToken: process.env.DARAJA_CALLBACK_TOKEN ?? '',
    },
  },
});
