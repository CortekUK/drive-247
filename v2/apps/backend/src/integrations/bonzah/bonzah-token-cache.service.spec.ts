import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { BonzahTokenCache } from './bonzah-token-cache.service';

describe('BonzahTokenCache', () => {
  let cache: BonzahTokenCache;
  const user = 'neema@cortek.uk';
  const sandbox = 'https://bonzah.sb.insillion.com';
  const live = 'https://bonzah.insillion.com';

  beforeEach(() => {
    cache = new BonzahTokenCache();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns null on miss', () => {
    expect(cache.get(user, sandbox)).toBeNull();
  });

  it('round-trips a token', () => {
    cache.set(user, sandbox, 'tok-123');
    expect(cache.get(user, sandbox)?.token).toBe('tok-123');
  });

  it('keys by (username, apiUrl) — same user different env gets separate tokens', () => {
    cache.set(user, sandbox, 'sandbox-tok');
    cache.set(user, live, 'live-tok');
    expect(cache.get(user, sandbox)?.token).toBe('sandbox-tok');
    expect(cache.get(user, live)?.token).toBe('live-tok');
  });

  it('invalidate removes one key without affecting the other', () => {
    cache.set(user, sandbox, 'a');
    cache.set(user, live, 'b');
    cache.invalidate(user, sandbox);
    expect(cache.get(user, sandbox)).toBeNull();
    expect(cache.get(user, live)?.token).toBe('b');
  });

  it('expires entries after TTL (with buffer)', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));

    cache.set(user, sandbox, 'x');
    expect(cache.get(user, sandbox)?.token).toBe('x');

    // Advance past TTL (14 min - 1 min buffer = 13 min valid window)
    vi.advanceTimersByTime(13 * 60 * 1000 + 1);
    expect(cache.get(user, sandbox)).toBeNull();
  });

  it('does NOT expire before TTL', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));

    cache.set(user, sandbox, 'x');
    vi.advanceTimersByTime(12 * 60 * 1000);
    expect(cache.get(user, sandbox)?.token).toBe('x');
  });

  it('clearAll removes every entry', () => {
    cache.set(user, sandbox, 'a');
    cache.set('other@example.com', live, 'b');
    cache.clearAll();
    expect(cache.get(user, sandbox)).toBeNull();
    expect(cache.get('other@example.com', live)).toBeNull();
  });
});
