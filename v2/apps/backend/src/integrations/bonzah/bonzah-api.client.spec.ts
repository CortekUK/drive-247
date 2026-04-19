import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { BonzahApiClient } from './bonzah-api.client';
import { BonzahTokenCache } from './bonzah-token-cache.service';
import {
  BonzahApiError,
  BonzahAuthError,
  BonzahInsufficientBalanceError,
} from './errors';
import { BonzahMode } from '@drive247/shared-types';
import type { ResolvedBonzahCredentials } from './types';

const creds: ResolvedBonzahCredentials = {
  username: 'neema@cortek.uk',
  password: 'secret',
  mode: BonzahMode.TEST,
  apiUrl: 'https://bonzah.sb.example',
};

// Minimal credentials service that returns fixed creds
const credsServiceStub = {
  loadForTenant: vi.fn(async () => creds),
  encryptPassword: vi.fn(() => 'enc'),
} as unknown as import('./bonzah-credentials.service').BonzahCredentialsService;

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status });
}

describe('BonzahApiClient', () => {
  let cache: BonzahTokenCache;
  let client: BonzahApiClient;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let fetchSpy: any;

  beforeEach(() => {
    cache = new BonzahTokenCache();
    client = new BonzahApiClient(credsServiceStub, cache);
    fetchSpy = vi.spyOn(global, 'fetch');
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it('authenticate() caches token and returns it', async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse({ status: 0, txt: '', token: 'tok' }));
    const token = await client.authenticate(creds);
    expect(token).toBe('tok');
    expect(cache.get(creds.username, creds.apiUrl)?.token).toBe('tok');
  });

  it('authenticate() throws BonzahAuthError on HTTP failure', async () => {
    fetchSpy.mockResolvedValueOnce(new Response('Unauthorized', { status: 401 }));
    await expect(client.authenticate(creds)).rejects.toBeInstanceOf(BonzahAuthError);
  });

  it('authenticate() throws when token is missing in response', async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse({ status: 1, txt: 'bad' }));
    await expect(client.authenticate(creds)).rejects.toBeInstanceOf(BonzahAuthError);
  });

  it('call() uses cached token when available', async () => {
    cache.set(creds.username, creds.apiUrl, 'cached-tok');
    fetchSpy.mockResolvedValueOnce(
      jsonResponse({ status: 0, txt: '', data: { hello: 'world' } }),
    );
    const result = await client.callWithCredentials(creds, 'POST', '/test', {});
    expect(result).toEqual({ hello: 'world' });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    // ensure auth was NOT called
    const headers = (fetchSpy.mock.calls[0][1] as RequestInit).headers as Record<string, string>;
    expect(headers['in-auth-token']).toBe('cached-tok');
  });

  it('call() refreshes token on 401 and retries once', async () => {
    cache.set(creds.username, creds.apiUrl, 'stale-tok');
    fetchSpy
      // First call returns 401
      .mockResolvedValueOnce(new Response('', { status: 401 }))
      // Re-auth returns new token
      .mockResolvedValueOnce(jsonResponse({ status: 0, txt: '', token: 'fresh' }))
      // Retry succeeds
      .mockResolvedValueOnce(
        jsonResponse({ status: 0, txt: '', data: { ok: true } }),
      );
    const result = await client.callWithCredentials(creds, 'GET', '/probe');
    expect(result).toEqual({ ok: true });
    expect(fetchSpy).toHaveBeenCalledTimes(3);
  });

  it('call() translates non-zero status into BonzahApiError', async () => {
    cache.set(creds.username, creds.apiUrl, 'tok');
    fetchSpy.mockResolvedValueOnce(
      jsonResponse({ status: 4, txt: 'bad state' }),
    );
    await expect(
      client.callWithCredentials(creds, 'POST', '/x', {}),
    ).rejects.toBeInstanceOf(BonzahApiError);
  });

  it('call() detects balance errors by keyword', async () => {
    cache.set(creds.username, creds.apiUrl, 'tok');
    fetchSpy.mockResolvedValueOnce(
      jsonResponse({
        status: 5,
        txt: 'Insufficient balance to issue policy',
      }),
    );
    await expect(
      client.callWithCredentials(creds, 'POST', '/payment', {}),
    ).rejects.toBeInstanceOf(BonzahInsufficientBalanceError);
  });

  it('call() rejects non-JSON response', async () => {
    cache.set(creds.username, creds.apiUrl, 'tok');
    fetchSpy.mockResolvedValueOnce(
      new Response('<html>oops</html>', { status: 500 }),
    );
    await expect(
      client.callWithCredentials(creds, 'GET', '/x'),
    ).rejects.toBeInstanceOf(BonzahApiError);
  });
});
