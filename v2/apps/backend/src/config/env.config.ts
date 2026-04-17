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

  // Seed (first admin — optional, used by db:seed script)
  SEED_ADMIN_EMAIL: z.string().email().optional(),
  SEED_ADMIN_PASSWORD: z.string().min(8).optional(),
  SEED_ADMIN_NAME: z.string().optional(),
  SEED_TENANT_SLUG: z.string().optional(),
  SEED_TENANT_NAME: z.string().optional(),
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
