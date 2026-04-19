import { Injectable } from '@nestjs/common';
import {
  BONZAH_TOKEN_TTL_BUFFER_MS,
  BONZAH_TOKEN_TTL_MS,
} from './constants';
import type { CachedBonzahToken } from './types';

/**
 * In-memory Bonzah auth token cache.
 *
 * Keyed by `(username, apiUrl)` — never username alone. This prevents token
 * cross-pollination if the same email is ever used against both sandbox and
 * production (unlikely but cheap to defend against).
 *
 * TTL = 14 minutes (Bonzah spec: 15-minute idle) with a 1-minute safety buffer
 * so we refresh proactively rather than racing expiry mid-request.
 *
 * Single-instance only. Multi-backend deployments will need Redis — tracked
 * as Phase 2 in bonzah-plan.md.
 */
@Injectable()
export class BonzahTokenCache {
  private readonly cache = new Map<string, CachedBonzahToken>();

  private makeKey(username: string, apiUrl: string): string {
    return `${username}::${apiUrl}`;
  }

  get(username: string, apiUrl: string): CachedBonzahToken | null {
    const key = this.makeKey(username, apiUrl);
    const entry = this.cache.get(key);
    if (!entry) return null;
    if (entry.expiresAt <= Date.now()) {
      this.cache.delete(key);
      return null;
    }
    return entry;
  }

  set(username: string, apiUrl: string, token: string): CachedBonzahToken {
    const key = this.makeKey(username, apiUrl);
    const expiresAt =
      Date.now() + BONZAH_TOKEN_TTL_MS - BONZAH_TOKEN_TTL_BUFFER_MS;
    const entry: CachedBonzahToken = { token, expiresAt };
    this.cache.set(key, entry);
    return entry;
  }

  invalidate(username: string, apiUrl: string): void {
    this.cache.delete(this.makeKey(username, apiUrl));
  }

  /** Test-only: clear the entire cache. Not exposed in production flows. */
  clearAll(): void {
    this.cache.clear();
  }
}
