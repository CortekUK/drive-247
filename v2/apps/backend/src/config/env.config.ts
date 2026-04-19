import { z } from 'zod';

const envSchema = z.object({
  // Server
  NODE_ENV: z
    .enum(['development', 'production', 'test'])
    .default('development'),
  BACKEND_PORT: z.coerce.number().default(4000),
  FRONTEND_PORT: z.coerce.number().default(3001),

  // Database
  POSTGRES_USER: z.string(),
  POSTGRES_PASSWORD: z.string(),
  POSTGRES_DB: z.string(),
  DATABASE_URL: z.string().url(),

  // JWT Auth
  JWT_SECRET: z.string().min(32),
  JWT_REFRESH_SECRET: z.string().min(32),
  JWT_EXPIRES_IN: z.string().default('15m'),
  JWT_REFRESH_EXPIRES_IN: z.string().default('7d'),

  // URLs (comma-separated for multiple origins: portal, admin, booking)
  ALLOWED_ORIGINS: z.string().default('http://localhost:3001,http://localhost:3003'),

  // Portal base URL — used when building customer-facing links (e.g. ID
  // verification QR codes). Should be the public URL the customer will open
  // on their phone (e.g. https://<tenant>.portal.drive-247.com) in prod;
  // localhost in dev is fine for same-machine testing.
  PORTAL_BASE_URL: z
    .string()
    .url()
    .default('http://localhost:3001')
    .describe(
      'Base URL used to construct ID-verification QR links. The public mobile ' +
        'page lives at {PORTAL_BASE_URL}/verify/{token}.',
    ),

  // Seed (first admin — optional, used by db:seed script)
  SEED_ADMIN_EMAIL: z.string().email().optional(),
  SEED_ADMIN_PASSWORD: z.string().min(8).optional(),
  SEED_ADMIN_NAME: z.string().optional(),
  SEED_TENANT_SLUG: z.string().optional(),
  SEED_TENANT_NAME: z.string().optional(),

  // --- Bonzah insurance integration ---
  BONZAH_API_URL_SANDBOX: z
    .string()
    .url()
    .default('https://bonzah.sb.insillion.com')
    .describe('Bonzah sandbox base URL (used when a tenant is in test mode)'),
  BONZAH_API_URL_LIVE: z
    .string()
    .url()
    .default('https://bonzah.insillion.com')
    .describe('Bonzah production base URL (used when a tenant is in live mode)'),
  BONZAH_PLATFORM_USERNAME: z
    .string()
    .optional()
    .describe(
      'Platform-shared Bonzah test account email — used by tenants in test mode',
    ),
  BONZAH_PLATFORM_PASSWORD: z
    .string()
    .optional()
    .describe('Platform-shared Bonzah test account password'),
  BONZAH_CREDS_ENCRYPTION_KEY: z
    .string()
    .regex(/^[0-9a-fA-F]{64}$/, 'Must be 64 hex characters (32 bytes)')
    .describe(
      'AES-256-GCM key for encrypting tenant Bonzah passwords. Generate once and never rotate without a migration plan.',
    ),

  // --- OpenAI (used by Bonzah eligibility check + ID-verification OCR) ---
  OPENAI_API_KEY: z
    .string()
    .optional()
    .describe(
      'OpenAI API key. Used for Bonzah vehicle-eligibility fuzzy-match AND ' +
        'ID-verification document OCR via Vision API. ' +
        'Eligibility fails open if absent (matches V1). OCR fails closed — ' +
        'verifications are marked review_required when OCR is unavailable.',
    ),

  // --- AWS (used by ID verification — S3 for document storage, Rekognition for face match) ---
  AWS_REGION: z
    .string()
    .optional()
    .describe(
      'AWS region for S3 bucket and Rekognition API. Required when ID ' +
        'verification is enabled for any tenant.',
    ),
  AWS_ACCESS_KEY_ID: z
    .string()
    .optional()
    .describe('AWS access key ID for S3 + Rekognition.'),
  AWS_SECRET_ACCESS_KEY: z
    .string()
    .optional()
    .describe('AWS secret access key for S3 + Rekognition.'),
  AWS_S3_BUCKET: z
    .string()
    .optional()
    .describe(
      'S3 bucket name for storing ID-verification documents + selfies. ' +
        'Must be private (no public reads). Served via short-lived signed URLs only.',
    ),
});

export type Env = z.infer<typeof envSchema>;

let cachedEnv: Env | null = null;

export function validateEnv(): Env {
  if (cachedEnv) return cachedEnv;

  const result = envSchema.safeParse(process.env);
  if (!result.success) {
    const errors = result.error.issues
      .map((issue) => `  ${issue.path.join('.')} — ${issue.message}`)
      .join('\n');

    console.error(`\n❌ Invalid environment variables:\n${errors}\n`);
    console.error(
      'Hint: copy .env.example to .env.local and fill in missing values.',
    );
    console.error('  cp .env.example .env.local\n');
    process.exit(1);
  }

  cachedEnv = result.data;
  return cachedEnv;
}

export function getEnv(): Env {
  if (!cachedEnv) return validateEnv();
  return cachedEnv;
}
