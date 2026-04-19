import { describe, it, expect } from 'vitest';
import { decrypt, encrypt, generateEncryptionKey } from './crypto.util';

describe('crypto.util (AES-256-GCM)', () => {
  const key = generateEncryptionKey();

  it('round-trips a plaintext string', () => {
    const plain = 'hunter2-correct-horse-battery-staple';
    const ct = encrypt(plain, key);
    expect(decrypt(ct, key)).toBe(plain);
  });

  it('produces a different ciphertext on each call (random IV)', () => {
    const plain = 'same-input';
    const a = encrypt(plain, key);
    const b = encrypt(plain, key);
    expect(a).not.toBe(b);
    expect(decrypt(a, key)).toBe(plain);
    expect(decrypt(b, key)).toBe(plain);
  });

  it('rejects wrong key on decrypt', () => {
    const ct = encrypt('secret', key);
    const otherKey = generateEncryptionKey();
    expect(() => decrypt(ct, otherKey)).toThrow();
  });

  it('rejects tampered ciphertext', () => {
    const ct = encrypt('secret', key);
    // Flip a byte in the middle
    const buf = Buffer.from(ct, 'base64');
    buf[buf.length - 1] ^= 0xff;
    const tampered = buf.toString('base64');
    expect(() => decrypt(tampered, key)).toThrow();
  });

  it('rejects a key of the wrong length', () => {
    expect(() => encrypt('x', 'deadbeef')).toThrow(/32 bytes/);
  });

  it('handles empty strings', () => {
    const ct = encrypt('', key);
    expect(decrypt(ct, key)).toBe('');
  });

  it('handles unicode content', () => {
    const plain = '密码-🔐-ñoño';
    const ct = encrypt(plain, key);
    expect(decrypt(ct, key)).toBe(plain);
  });
});
