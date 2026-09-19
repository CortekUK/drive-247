import { beforeEach, describe, expect, it } from 'vitest';
import { readIntegrationStatus, createIntegrationReads, type IntegrationDatabase, type IntegrationReads } from '../../../../../supabase/functions/trax-support/support/integration-status';
import type { SupportContext } from '../../../../../supabase/functions/trax-support/support/types';

/*
 * Integration status.
 *
 * The rules here were read out of the portal panels that paint the same chips, so
 * these tests pin the parts that are easy to get flatteringly wrong:
 *
 * - a Stripe account the provider has restricted must never read as "connected";
 *   showing a healthy chip for a paused account is the failure that took a live
 *   operator offline for two days;
 * - a read that FAILS is unknown, never disconnected — "your integration is off"
 *   is a damaging thing to say wrongly;
 * - accounting_connections.last_synced_at is always NULL and unwritten, so it is
 *   never reported as a sync time;
 * - nothing here contacts a provider, and the answer says so.
 */
const tenant = '00000000-0000-4000-8000-000000000001';
const now = Date.parse('2026-09-19T09:00:00Z');

const auth = (): SupportContext => ({
  userId: 'user', staffId: 'staff', tenant: { id: tenant, slug: 'northwind', status: 'active' } as never,
  role: 'admin', superAdmin: false, permissions: [], scope: 'scope',
} as SupportContext);

let tenantRow: Record<string, unknown>;
let squareRow: Record<string, unknown> | null;
let accountingRow: Record<string, unknown> | null;
let syncRow: Record<string, unknown> | null;
let reads: IntegrationReads;

const find = async (key: string) => (await readIntegrationStatus(auth(), reads, now)).integrations.find((i) => i.key === key)!;

beforeEach(() => {
  tenantRow = { id: tenant, payment_provider: 'stripe', payment_model: 'own', stripe_mode: 'live',
    own_stripe_account_id: 'acct_liveABCD', own_stripe_connected_at: '2026-09-15T09:33:47Z',
    stripe_requirements_due: [], stripe_charges_enabled: true, stripe_status_synced_at: '2026-09-18T10:00:00Z' };
  squareRow = null; accountingRow = null; syncRow = null;
  reads = {
    tenant: async () => tenantRow,
    square: async () => squareRow,
    accounting: async () => accountingRow,
    accountingSync: async () => syncRow,
  };
});

describe('Stripe status never reads healthier than the account is', () => {
  it('reports a connected own account with the mode and a masked id', async () => {
    const stripe = await find('stripe');
    expect(stripe.health).toBe('connected');
    expect(stripe.mode).toBe('live');
    expect(stripe.account).toBe('…ABCD');
    expect(stripe.summary).toContain('live mode');
  });

  it('never says connected when Stripe has restricted the account', async () => {
    tenantRow.stripe_account_disabled_reason = 'requirements.past_due';
    const stripe = await find('stripe');
    expect(stripe.health).toBe('attention');
    expect(stripe.error).toBe('requirements.past_due');
  });

  it('never says connected when Stripe is waiting on requirements', async () => {
    tenantRow.stripe_requirements_due = ['individual.verification.document'];
    expect((await find('stripe')).health).toBe('attention');
  });

  it('never says connected when charges are disabled', async () => {
    tenantRow.stripe_charges_enabled = false;
    expect((await find('stripe')).health).toBe('attention');
  });

  it('flags live with no connected account, which breaks every charge', async () => {
    tenantRow.own_stripe_account_id = null;
    const stripe = await find('stripe');
    expect(stripe.health).toBe('attention');
    expect(stripe.summary).toMatch(/live card payments cannot be taken/);
  });

  // The own model does not maintain these columns, so reading them there is the bug.
  it('does not judge an own account by the managed account’s onboarding column', async () => {
    tenantRow.stripe_onboarding_complete = false;
    expect((await find('stripe')).health).toBe('connected');
  });

  it('says Stripe is not this account’s processor when it uses Square', async () => {
    tenantRow.payment_provider = 'square';
    expect((await find('stripe')).health).toBe('unavailable');
  });
});

describe('a failed read is unknown, never disconnected', () => {
  it('reports Square as unknown when its row cannot be read', async () => {
    reads.square = async () => { throw new Error('read failed'); };
    const square = await find('square');
    expect(square.health).toBe('unknown');
    expect(square.summary).toMatch(/has not been reported as disconnected/);
  });

  it('still answers for every other integration when one read fails', async () => {
    reads.accounting = async () => { throw new Error('read failed'); };
    const all = await readIntegrationStatus(auth(), reads, now);
    expect(all.integrations.find((i) => i.key === 'xero')!.health).toBe('unknown');
    expect(all.integrations.find((i) => i.key === 'stripe')!.health).toBe('connected');
  });
});

describe('accounting reports only timestamps that mean something', () => {
  beforeEach(() => {
    accountingRow = { provider: 'xero', status: 'active', token_expires_at: '2027-01-01T00:00:00Z',
      external_org_name: 'Northwind Ltd', last_error: null, connected_at: '2026-08-01T00:00:00Z' };
  });

  it('uses the sync queue’s attempt time, not the dead last_synced_at column', async () => {
    syncRow = { provider: 'xero', state: 'synced', last_attempt_at: '2026-09-19T08:00:00Z', synced_at: '2026-09-19T08:00:00Z', last_error: null };
    const xero = await find('xero');
    expect(xero.health).toBe('connected');
    expect(xero.recordedAt).toBe('2026-09-19T08:00:00Z');
  });

  it('flags a connected Xero whose last sync failed', async () => {
    syncRow = { provider: 'xero', state: 'failed', last_attempt_at: '2026-09-19T08:00:00Z', last_error: 'invoice rejected' };
    const xero = await find('xero');
    expect(xero.health).toBe('attention');
    expect(xero.error).toBe('invoice rejected');
  });

  it('treats an expired token as needing reconnection', async () => {
    accountingRow.token_expires_at = '2026-01-01T00:00:00Z';
    expect((await find('xero')).health).toBe('attention');
  });

  // Xero and Zoho genuinely disagree about a null expiry; the difference is kept.
  it('keeps Zoho’s stricter rule for a missing expiry', async () => {
    accountingRow = { provider: 'zoho', status: 'active', token_expires_at: null, external_org_name: 'Northwind', last_error: null };
    expect((await find('zoho')).health).toBe('attention');
    accountingRow = { provider: 'xero', status: 'active', token_expires_at: null, external_org_name: 'Northwind', last_error: null };
    expect((await find('xero')).health).toBe('connected');
  });
});

describe('what the answer promises', () => {
  it('states that nothing was contacted', async () => {
    const all = await readIntegrationStatus(auth(), reads, now);
    expect(all.basis).toMatch(/No integration was contacted/);
  });

  it('marks preview-only cards as unavailable rather than disconnected', async () => {
    const all = await readIntegrationStatus(auth(), reads, now);
    for (const key of ['turo', 'checkmydriver']) {
      expect(all.integrations.find((i) => i.key === key)!.health).toBe('unavailable');
    }
  });

  it('never reports a custom domain as connected, because DNS is not visible here', async () => {
    tenantRow.custom_booking_domain = 'book.northwind.test';
    const domain = await find('custom_domain');
    expect(domain.health).toBe('attention');
    expect(domain.summary).toMatch(/cannot be verified/);
  });

  it('refuses when the tenant row is not this account', async () => {
    reads.tenant = async () => ({ id: '00000000-0000-4000-8000-000000000002' });
    await expect(readIntegrationStatus(auth(), reads, now)).rejects.toMatchObject({ code: 'record_unavailable' });
  });
});

describe('every read is scoped to the authenticated account', () => {
  it('filters each table by this tenant and reads no token columns', async () => {
    const calls: { table: string; columns: string; filters: string[] }[] = [];
    const db = {
      from(table: string) {
        return {
          select(columns: string) {
            const log = { table, columns, filters: [] as string[] };
            calls.push(log);
            const q: Record<string, unknown> = {
              eq: (c: string, v: unknown) => { log.filters.push(`${c}=${String(v)}`); return q; },
              order: () => q,
              limit: () => Promise.resolve({ data: [], error: null }),
              maybeSingle: () => Promise.resolve({ data: null, error: null }),
              then: (ok: (value: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(ok),
            };
            return q;
          },
        };
      },
    } as unknown as IntegrationDatabase;

    const live = createIntegrationReads(db);
    await live.tenant(tenant);
    await live.square(tenant);
    await live.accounting(tenant, 'xero');
    await live.accountingSync(tenant, 'zoho');

    expect(calls.map((c) => c.table)).toEqual(['tenants', 'square_connections_public', 'accounting_connections_public', 'financial_event_sync_state']);
    for (const call of calls) expect(call.filters.some((f) => f.endsWith(tenant))).toBe(true);
    /* The public views exist so token VALUES are unreachable; assert we never name
       one. tesla_fleet_*_secret_id is deliberately allowed: those are Vault
       pointers, read only to see whether a token was ever stored, and they carry
       no credential themselves. twilio_auth_token is the one the portal itself
       refuses to select, so it is named explicitly here. */
    const selected = calls.map((c) => c.columns).join(',');
    for (const forbidden of ['access_token', 'refresh_token,', 'twilio_auth_token', 'bonzah_password', 'client_secret']) {
      expect(selected).not.toContain(forbidden);
    }
    expect(selected).toContain('tesla_fleet_api_token_secret_id');
  });
});
