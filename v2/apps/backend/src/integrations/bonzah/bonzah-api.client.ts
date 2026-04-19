import { Injectable, Logger } from '@nestjs/common';
import {
  BONZAH_AUTH_HEADER,
  BONZAH_BALANCE_ERROR_KEYWORDS,
  BONZAH_PATHS,
  BONZAH_SUCCESS_STATUS,
} from './constants';
import {
  BonzahApiError,
  BonzahAuthError,
  BonzahInsufficientBalanceError,
} from './errors';
import type {
  BonzahApiResponse,
  BonzahAuthResponse,
  ResolvedBonzahCredentials,
} from './types';
import { BonzahCredentialsService } from './bonzah-credentials.service';
import { BonzahTokenCache } from './bonzah-token-cache.service';

/**
 * Low-level Bonzah HTTP client.
 *
 * Responsibilities:
 *  - Acquire & cache auth tokens per (username, apiUrl)
 *  - Inject auth header on every authenticated call
 *  - Retry once on 401 (token expired mid-call)
 *  - Translate Bonzah's `{status, txt, data}` envelope into typed results
 *  - Detect balance errors via keyword match and throw a distinct typed error
 *
 * **All** Bonzah API access must go through this class. Services never call
 * `fetch` directly — this is Rule #9 in the business rules.
 */
@Injectable()
export class BonzahApiClient {
  private readonly logger = new Logger(BonzahApiClient.name);

  constructor(
    private readonly credentialsService: BonzahCredentialsService,
    private readonly tokenCache: BonzahTokenCache,
  ) {}

  /**
   * Authenticate against Bonzah /auth and return a token.
   * Also populates the token cache.
   */
  async authenticate(creds: ResolvedBonzahCredentials): Promise<string> {
    const url = `${creds.apiUrl}${BONZAH_PATHS.AUTH}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: creds.username, pwd: creds.password }),
    });

    if (!res.ok) {
      throw new BonzahAuthError(
        `Bonzah auth failed with HTTP ${res.status}`,
      );
    }

    const body = (await res.json()) as BonzahApiResponse<BonzahAuthResponse> & {
      token?: string;
    };
    // Bonzah auth response is slightly different — token is top-level
    const token =
      (body as unknown as { token?: string }).token ??
      body.data?.token;
    if (!token) {
      throw new BonzahAuthError(body.txt || 'Bonzah auth returned no token');
    }

    this.tokenCache.set(creds.username, creds.apiUrl, token);
    return token;
  }

  /**
   * Authenticated call against an arbitrary Bonzah endpoint.
   *
   * Automatically refreshes the token on 401 (one retry). Translates the
   * Bonzah envelope — non-zero `status` becomes a typed error.
   */
  async call<T>(
    tenantId: string,
    method: 'GET' | 'POST',
    path: string,
    body?: unknown,
  ): Promise<T> {
    const creds = await this.credentialsService.loadForTenant(tenantId);
    return this.callWithCredentials<T>(creds, method, path, body);
  }

  /**
   * Variant for cases where we already have credentials (e.g. the
   * verify-credentials endpoint doesn't have a stored tenant yet).
   */
  async callWithCredentials<T>(
    creds: ResolvedBonzahCredentials,
    method: 'GET' | 'POST',
    path: string,
    body?: unknown,
  ): Promise<T> {
    let attempt = 0;
    let token = await this.getTokenForCreds(creds);

    while (attempt < 2) {
      const res = await fetch(`${creds.apiUrl}${path}`, {
        method,
        headers: {
          'Content-Type': 'application/json',
          [BONZAH_AUTH_HEADER]: token,
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });

      if (res.status === 401 && attempt === 0) {
        // Token expired mid-flight — invalidate and retry once
        this.tokenCache.invalidate(creds.username, creds.apiUrl);
        token = await this.authenticate(creds);
        attempt++;
        continue;
      }

      const bodyText = await res.text();
      let parsed: BonzahApiResponse<T>;
      try {
        parsed = JSON.parse(bodyText) as BonzahApiResponse<T>;
      } catch {
        throw new BonzahApiError(
          `Bonzah returned non-JSON response (HTTP ${res.status})`,
          { status: res.status, bonzahText: bodyText.slice(0, 500) },
        );
      }

      // Debug log for quote/payment endpoints — temporary, remove once
      // payment_id issue is resolved
      if (path.endsWith('/quote') || path.endsWith('/payment')) {
        this.logger.log(
          `Bonzah ${path} raw response: ${bodyText.slice(0, 6000)}`,
        );
      }

      if (parsed.status !== BONZAH_SUCCESS_STATUS) {
        const msg = parsed.txt || 'Bonzah API error';
        if (this.isBalanceError(msg)) {
          throw new BonzahInsufficientBalanceError(msg);
        }
        throw new BonzahApiError(msg, {
          status: res.status,
          bonzahStatus: parsed.status,
          bonzahText: parsed.txt,
        });
      }

      return parsed.data as T;
    }

    throw new BonzahApiError('Bonzah API retry loop exhausted');
  }

  private async getTokenForCreds(
    creds: ResolvedBonzahCredentials,
  ): Promise<string> {
    const cached = this.tokenCache.get(creds.username, creds.apiUrl);
    if (cached) return cached.token;
    return this.authenticate(creds);
  }

  private isBalanceError(message: string): boolean {
    const lower = message.toLowerCase();
    return BONZAH_BALANCE_ERROR_KEYWORDS.some((kw) => lower.includes(kw));
  }
}
