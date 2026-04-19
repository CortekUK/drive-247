import { createHash, randomBytes, timingSafeEqual } from 'crypto';

/**
 * Raw token entropy: 32 bytes = 256 bits. Encoded as base64url so it's
 * URL-safe without any transformation when placed in a QR code / URL path.
 *
 * Rule #2: QR tokens are cryptographically random.
 * Rule #3: Raw tokens are NEVER persisted. Only the SHA-256 hash is stored
 *          in `id_verifications.session_token_hash`.
 */
const TOKEN_BYTES = 32;

export interface GeneratedToken {
  /** The raw token — place in URL / QR only. Never store. */
  raw: string;
  /** SHA-256 hash of the raw token (base64url). This is what goes in the DB. */
  hash: string;
}

export function generateToken(): GeneratedToken {
  const raw = randomBytes(TOKEN_BYTES).toString('base64url');
  const hash = hashToken(raw);
  return { raw, hash };
}

export function hashToken(raw: string): string {
  return createHash('sha256').update(raw).digest('base64url');
}

/**
 * Constant-time compare of two token hashes. Used when we look up a
 * session by hash and want to confirm equality without giving a timing
 * oracle to anyone probing the API.
 */
export function tokensMatch(hashA: string, hashB: string): boolean {
  const a = Buffer.from(hashA);
  const b = Buffer.from(hashB);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export function isExpired(expiresAt: Date, now: Date = new Date()): boolean {
  return expiresAt.getTime() <= now.getTime();
}
