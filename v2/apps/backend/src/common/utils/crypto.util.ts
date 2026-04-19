import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

/**
 * AES-256-GCM encryption for sensitive credentials stored at rest.
 *
 * Output format (base64):
 *   [12-byte IV][16-byte auth tag][N-byte ciphertext]
 *
 * Keys must be 32 bytes (64 hex chars) supplied as a hex-encoded string —
 * validated by env.config.ts at boot.
 */

const ALGORITHM = 'aes-256-gcm';
const KEY_LENGTH_BYTES = 32;
const IV_LENGTH_BYTES = 12;
const AUTH_TAG_LENGTH_BYTES = 16;

function parseKey(hexKey: string): Buffer {
  const buf = Buffer.from(hexKey, 'hex');
  if (buf.length !== KEY_LENGTH_BYTES) {
    throw new Error(
      `Encryption key must be ${KEY_LENGTH_BYTES} bytes (${KEY_LENGTH_BYTES * 2} hex chars)`,
    );
  }
  return buf;
}

export function encrypt(plaintext: string, hexKey: string): string {
  const key = parseKey(hexKey);
  const iv = randomBytes(IV_LENGTH_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);

  const ciphertext = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();

  return Buffer.concat([iv, authTag, ciphertext]).toString('base64');
}

export function decrypt(encryptedBase64: string, hexKey: string): string {
  const key = parseKey(hexKey);
  const data = Buffer.from(encryptedBase64, 'base64');

  if (data.length < IV_LENGTH_BYTES + AUTH_TAG_LENGTH_BYTES) {
    throw new Error('Ciphertext is malformed or truncated');
  }

  const iv = data.subarray(0, IV_LENGTH_BYTES);
  const authTag = data.subarray(
    IV_LENGTH_BYTES,
    IV_LENGTH_BYTES + AUTH_TAG_LENGTH_BYTES,
  );
  const ciphertext = data.subarray(IV_LENGTH_BYTES + AUTH_TAG_LENGTH_BYTES);

  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);

  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString(
    'utf8',
  );
}

/**
 * Generate a new 32-byte encryption key, hex-encoded.
 * Intended for one-time key generation during tenant setup — NOT for runtime.
 */
export function generateEncryptionKey(): string {
  return randomBytes(KEY_LENGTH_BYTES).toString('hex');
}
