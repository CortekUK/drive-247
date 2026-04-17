// --- Auth ---
export const REFRESH_COOKIE = 'refresh_token';
export const REFRESH_COOKIE_PATH = '/api/auth';
export const REFRESH_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
export const ACCESS_TOKEN_EXPIRY_SECS = 15 * 60; // 15 minutes
export const REFRESH_TOKEN_EXPIRY_SECS = 7 * 24 * 60 * 60; // 7 days

// --- Password ---
export const BCRYPT_ROUNDS = 12;
export const MIN_PASSWORD_LENGTH = 8;

// --- Tenants ---
export const RESERVED_SLUGS = [
  'www',
  'admin',
  'portal',
  'api',
  'app',
  'mail',
  'blog',
  'docs',
  'help',
  'support',
  'status',
] as const;

export const SLUG_MIN_LENGTH = 3;
export const SLUG_MAX_LENGTH = 50;
export const SLUG_REGEX = /^[a-z0-9][a-z0-9-]*[a-z0-9]$/;

// --- Pagination ---
export const DEFAULT_PAGE = 1;
export const DEFAULT_LIMIT = 20;
export const MAX_LIMIT = 100;
