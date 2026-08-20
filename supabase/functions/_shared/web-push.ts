// ---------------------------------------------------------------------------
// Web Push — RFC 8030 (delivery), RFC 8291 (payload encryption), RFC 8292 (VAPID)
//
// Why hand-rolled instead of `npm:web-push`: that library is built on Node's
// `crypto`/`https` modules. Under Deno's node-compat shim its ECDH + HKDF path
// is the exact surface most likely to break on a runtime upgrade, and a silent
// break here looks like "push just stopped arriving" — the least debuggable
// failure mode there is. Everything below is WebCrypto, which Deno implements
// natively, so there is no compat layer to rot.
//
// One keypair reaches every platform. The push SERVICE differs per browser
// (FCM for Chrome, web.push.apple.com for Safari/iOS, Mozilla autopush for
// Firefox) but the protocol does not, so there is no per-platform branch here.
// The endpoint URL the browser hands us already encodes which service to talk to.
//
// The push service never sees the notification text: the payload is encrypted
// end-to-end against keys only the subscribing browser holds.
// ---------------------------------------------------------------------------

export interface PushSubscriptionKeys {
  endpoint: string;
  /** UA public key, base64url, uncompressed P-256 point (65 bytes). */
  p256dh: string;
  /** UA auth secret, base64url (16 bytes). */
  auth: string;
}

export interface VapidKeys {
  publicKey: string;
  privateKey: string;
  subject: string;
}

export interface PushResult {
  ok: boolean;
  status: number;
  /** True when the push service says this subscription is permanently gone. */
  expired: boolean;
  error?: string;
}

// --- base64url helpers -----------------------------------------------------

export function b64uToBytes(input: string): Uint8Array {
  const normalised = input.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalised + '='.repeat((4 - (normalised.length % 4)) % 4);
  const binary = atob(padded);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

export function bytesToB64u(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}

const utf8 = (s: string) => new TextEncoder().encode(s);

// --- VAPID -----------------------------------------------------------------

/**
 * A VAPID public key is a raw uncompressed P-256 point (0x04 || X || Y).
 * WebCrypto will only import a private key as JWK or PKCS#8, and JWK needs X/Y
 * alongside D — so the coordinates are sliced back out of the public key rather
 * than stored separately. Keeping one canonical public key avoids a class of
 * bug where X/Y drift out of sync with D and every send fails signature checks.
 */
async function importVapidSigningKey(publicKeyB64u: string, privateKeyB64u: string): Promise<CryptoKey> {
  const pub = b64uToBytes(publicKeyB64u);
  if (pub.length !== 65 || pub[0] !== 0x04) {
    throw new Error('VAPID public key must be a 65-byte uncompressed P-256 point');
  }
  const jwk: JsonWebKey = {
    kty: 'EC',
    crv: 'P-256',
    x: bytesToB64u(pub.slice(1, 33)),
    y: bytesToB64u(pub.slice(33, 65)),
    d: privateKeyB64u,
    ext: true,
  };
  return await crypto.subtle.importKey(
    'jwk',
    jwk,
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign'],
  );
}

/**
 * Signed assertion that identifies US (the application server) to the push
 * service. `aud` MUST be the endpoint's origin — a token minted for FCM is
 * rejected by Apple, so it cannot be cached across endpoints of different
 * browsers. It IS safe to reuse per-origin within its lifetime.
 */
async function createVapidToken(endpoint: string, vapid: VapidKeys): Promise<string> {
  const audience = new URL(endpoint).origin;
  const header = { typ: 'JWT', alg: 'ES256' };
  const payload = {
    aud: audience,
    // 12h. The spec caps this at 24h; staying well inside avoids clock-skew
    // rejections from push services that validate strictly.
    exp: Math.floor(Date.now() / 1000) + 12 * 60 * 60,
    sub: vapid.subject,
  };

  const signingInput = `${bytesToB64u(utf8(JSON.stringify(header)))}.${bytesToB64u(utf8(JSON.stringify(payload)))}`;
  const key = await importVapidSigningKey(vapid.publicKey, vapid.privateKey);
  // WebCrypto emits the raw r||s pair ES256 wants — no DER unwrapping needed.
  const signature = new Uint8Array(
    await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, utf8(signingInput)),
  );
  return `${signingInput}.${bytesToB64u(signature)}`;
}

// --- Payload encryption (RFC 8291, aes128gcm) ------------------------------

async function hkdf(
  ikm: Uint8Array,
  salt: Uint8Array,
  info: Uint8Array,
  lengthBytes: number,
): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt, info },
    key,
    lengthBytes * 8,
  );
  return new Uint8Array(bits);
}

async function encryptPayload(
  payload: string,
  subscription: PushSubscriptionKeys,
): Promise<Uint8Array> {
  const uaPublic = b64uToBytes(subscription.p256dh);
  const authSecret = b64uToBytes(subscription.auth);

  // Ephemeral keypair, fresh per message — reuse would let the push service
  // correlate messages and weakens the forward secrecy the spec assumes.
  const ephemeral = await crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' },
    true,
    ['deriveBits'],
  ) as CryptoKeyPair;
  const asPublic = new Uint8Array(await crypto.subtle.exportKey('raw', ephemeral.publicKey));

  const uaKey = await crypto.subtle.importKey(
    'raw',
    uaPublic,
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    [],
  );
  const ecdhSecret = new Uint8Array(
    await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey }, ephemeral.privateKey, 256),
  );

  // §3.3 — the key derivation is bound to BOTH public keys, so a payload cannot
  // be replayed against a different subscription.
  const keyInfo = concat(utf8('WebPush: info\0'), uaPublic, asPublic);
  const ikm = await hkdf(ecdhSecret, authSecret, keyInfo, 32);

  const salt = crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(ikm, salt, utf8('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(ikm, salt, utf8('Content-Encoding: nonce\0'), 12);

  const contentKey = await crypto.subtle.importKey('raw', cek, { name: 'AES-GCM' }, false, ['encrypt']);
  // 0x02 is the RFC 8188 delimiter marking this as the FINAL record. Sending
  // 0x01 (non-final) makes browsers wait for a record that never comes, and the
  // notification is silently dropped.
  const plaintext = concat(utf8(payload), new Uint8Array([0x02]));
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce, tagLength: 128 }, contentKey, plaintext),
  );

  // RFC 8188 header: salt(16) | record_size(4, BE) | idlen(1) | keyid | ciphertext
  const recordSize = new Uint8Array(4);
  new DataView(recordSize.buffer).setUint32(0, 4096, false);
  return concat(salt, recordSize, new Uint8Array([asPublic.length]), asPublic, ciphertext);
}

// --- Send ------------------------------------------------------------------

export interface PushPayload {
  title: string;
  body?: string;
  url?: string;
  icon?: string;
  badge?: string;
  tag?: string;
  requireInteraction?: boolean;
  data?: Record<string, unknown>;
}

/**
 * Largest payload that survives a 4096-byte record after the header block,
 * GCM tag and delimiter are accounted for. Overshooting returns 413 from the
 * push service, so we truncate deliberately rather than lose the message.
 */
export const MAX_PAYLOAD_BYTES = 3900;

export async function sendWebPush(
  subscription: PushSubscriptionKeys,
  payload: PushPayload,
  vapid: VapidKeys,
  options: { ttlSeconds?: number; urgency?: 'very-low' | 'low' | 'normal' | 'high' } = {},
): Promise<PushResult> {
  try {
    const serialised = JSON.stringify(payload);
    if (utf8(serialised).length > MAX_PAYLOAD_BYTES) {
      return { ok: false, status: 0, expired: false, error: 'Notification payload too large' };
    }

    const [body, token] = await Promise.all([
      encryptPayload(serialised, subscription),
      createVapidToken(subscription.endpoint, vapid),
    ]);

    const response = await fetch(subscription.endpoint, {
      method: 'POST',
      headers: {
        'Authorization': `vapid t=${token}, k=${vapid.publicKey}`,
        'Content-Encoding': 'aes128gcm',
        'Content-Type': 'application/octet-stream',
        'TTL': String(options.ttlSeconds ?? 24 * 60 * 60),
        'Urgency': options.urgency ?? 'normal',
      },
      body,
    });

    if (response.ok) {
      return { ok: true, status: response.status, expired: false };
    }

    // 404/410 are the push service telling us the subscription is permanently
    // dead (PWA deleted, browser data cleared). Anything else may be transient,
    // so only these two retire the row.
    const expired = response.status === 404 || response.status === 410;
    const text = await response.text().catch(() => '');
    return {
      ok: false,
      status: response.status,
      expired,
      error: text.slice(0, 500) || `Push service returned ${response.status}`,
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      expired: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/** Reads the VAPID keypair from the function environment, or throws with a fixable message. */
export function getVapidKeys(): VapidKeys {
  const publicKey = Deno.env.get('VAPID_PUBLIC_KEY') ?? '';
  const privateKey = Deno.env.get('VAPID_PRIVATE_KEY') ?? '';
  const subject = Deno.env.get('VAPID_SUBJECT') ?? 'mailto:support@drive-247.com';
  if (!publicKey || !privateKey) {
    throw new Error('VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY are not set on this project');
  }
  return { publicKey, privateKey, subject };
}
