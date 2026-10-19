/**
 * Multi Chat §1 — security boundaries that must not regress.
 *
 *  - CROSS-TENANT: a staff user of tenant A must not be able to text or email
 *    tenant B's customer, nor write into B's conversation or unknown-number
 *    thread. send-sms-message / send-email-message run with the service-role
 *    key (RLS bypassed), so the only thing standing in the way is
 *    _shared/conversation-ownership.ts. These tests drive it with an in-memory
 *    fake of the Supabase query builder that applies every .eq() filter, so a
 *    lookup that forgets the tenant filter really does find B's row and fails.
 *  - SECRETS: no edge function may read or write the plaintext Twilio columns
 *    any more; they go through _shared/twilio-secrets.ts (Vault).
 *  - INTERNAL TOOLS: the four functions that were callable with the public anon
 *    key now gate on requireInternalCaller before doing anything.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  loadOwnedConversation,
  loadOwnedUnknownThread,
  resolveStaffSender,
} from '@fn/_shared/conversation-ownership.ts';

const TENANT_A = 'aaaaaaaa-0000-0000-0000-00000000000a';
const TENANT_B = 'bbbbbbbb-0000-0000-0000-00000000000b';

type Row = Record<string, unknown>;

/** Minimal PostgREST-shaped builder: select → eq* → maybeSingle, filters applied for real. */
function fakeDb(tables: Record<string, Row[]>) {
  return {
    from(table: string) {
      const filters: Array<[string, unknown]> = [];
      const builder = {
        select: () => builder,
        eq: (col: string, val: unknown) => {
          filters.push([col, val]);
          return builder;
        },
        maybeSingle: async () => {
          const hits = (tables[table] ?? []).filter((r) => filters.every(([c, v]) => r[c] === v));
          if (hits.length > 1) return { data: null, error: { message: 'multiple rows' } };
          return { data: hits[0] ?? null, error: null };
        },
      };
      return builder;
    },
  };
}

const db = fakeDb({
  app_users: [
    { id: 'staff-a', auth_user_id: 'auth-staff-a', tenant_id: TENANT_A, role: 'admin', is_super_admin: false, is_active: true },
    { id: 'staff-a-off', auth_user_id: 'auth-staff-a-off', tenant_id: TENANT_A, role: 'admin', is_super_admin: false, is_active: false },
    { id: 'super', auth_user_id: 'auth-super', tenant_id: null, role: 'head_admin', is_super_admin: true, is_active: true },
  ],
  customers: [
    { id: 'cust-a', tenant_id: TENANT_A, phone: '+15550000001', email: 'a@example.test', name: 'A' },
    { id: 'cust-b', tenant_id: TENANT_B, phone: '+15550000002', email: 'b@example.test', name: 'B' },
  ],
  chat_channels: [
    { id: 'chan-a', tenant_id: TENANT_A, customer_id: 'cust-a' },
    { id: 'chan-a2', tenant_id: TENANT_A, customer_id: 'cust-a2' },
    { id: 'chan-b', tenant_id: TENANT_B, customer_id: 'cust-b' },
  ],
  sms_unknown_threads: [
    { id: 'thread-a', tenant_id: TENANT_A, phone_number: '+15550000003' },
    { id: 'thread-b', tenant_id: TENANT_B, phone_number: '+15550000004' },
  ],
});

describe('resolveStaffSender', () => {
  it('pins ordinary staff to their own tenant even when the body names another', async () => {
    const r = await resolveStaffSender(db, 'auth-staff-a', TENANT_B);
    expect(r).toMatchObject({ ok: true, tenantId: TENANT_A });
  });

  it('lets only a super admin choose the tenant', async () => {
    expect(await resolveStaffSender(db, 'auth-super', TENANT_B)).toMatchObject({ ok: true, tenantId: TENANT_B });
    expect(await resolveStaffSender(db, 'auth-super', undefined)).toMatchObject({ ok: false, status: 403 });
  });

  it('rejects a renter session (no app_users row) and deactivated staff', async () => {
    expect(await resolveStaffSender(db, 'auth-some-renter', TENANT_A)).toMatchObject({ ok: false, status: 403 });
    expect(await resolveStaffSender(db, 'auth-staff-a-off', TENANT_A)).toMatchObject({ ok: false, status: 403 });
  });
});

describe('cross-tenant sends are rejected', () => {
  it("tenant A cannot load tenant B's customer + conversation", async () => {
    const r = await loadOwnedConversation(db, TENANT_A, 'cust-b', 'chan-b', 'phone');
    expect(r).toEqual({ ok: false, status: 404, message: 'Customer not found' });
  });

  it("tenant A cannot pair its own customer with tenant B's conversation", async () => {
    const r = await loadOwnedConversation(db, TENANT_A, 'cust-a', 'chan-b', 'phone');
    expect(r).toEqual({ ok: false, status: 404, message: 'Conversation not found' });
  });

  it("a conversation must belong to the named customer, even inside one tenant", async () => {
    const r = await loadOwnedConversation(db, TENANT_A, 'cust-a', 'chan-a2', 'phone');
    expect(r).toEqual({ ok: false, status: 404, message: 'Conversation not found' });
  });

  it("tenant A cannot reach tenant B's unknown-number thread", async () => {
    expect(await loadOwnedUnknownThread(db, TENANT_A, 'thread-b')).toMatchObject({ ok: false, status: 404 });
  });

  it('own-tenant sends still resolve', async () => {
    expect(await loadOwnedConversation(db, TENANT_A, 'cust-a', 'chan-a', 'phone')).toMatchObject({
      ok: true,
      customer: { id: 'cust-a' },
    });
    expect(await loadOwnedUnknownThread(db, TENANT_A, 'thread-a')).toMatchObject({
      ok: true,
      thread: { phone_number: '+15550000003' },
    });
  });

  it('a super admin acting for tenant B reaches B, and only B', async () => {
    const sender = await resolveStaffSender(db, 'auth-super', TENANT_B);
    if (!sender.ok) throw new Error('expected ok');
    expect(await loadOwnedConversation(db, sender.tenantId, 'cust-b', 'chan-b', 'phone')).toMatchObject({ ok: true });
    expect(await loadOwnedConversation(db, sender.tenantId, 'cust-a', 'chan-a', 'phone')).toMatchObject({ ok: false });
  });
});

const FN_DIR = path.resolve(__dirname, '../../../supabase/functions');
const read = (rel: string) => readFileSync(path.join(FN_DIR, rel), 'utf8');

describe('the senders actually use the ownership checks', () => {
  for (const fn of ['send-sms-message', 'send-email-message']) {
    it(`${fn} resolves the tenant and loads the conversation through conversation-ownership.ts`, () => {
      const src = read(`${fn}/index.ts`);
      expect(src).toContain('resolveStaffSender(');
      expect(src).toContain('loadOwnedConversation');
      // No direct, unscoped lookups left behind.
      expect(src).not.toMatch(/from\(['"]customers['"]\)/);
      expect(src).not.toMatch(/from\(['"]sms_unknown_threads['"]\)\s*\.select/);
    });
  }
});

function allFunctionSources(): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const full = path.join(dir, name);
      if (statSync(full).isDirectory()) walk(full);
      else if (name.endsWith('.ts')) out.push([path.relative(FN_DIR, full), readFileSync(full, 'utf8')]);
    }
  };
  walk(FN_DIR);
  return out;
}

describe('Twilio secrets never touch the plaintext columns', () => {
  it('no edge function reads or writes tenants.twilio_auth_token / twilio_api_key_secret', () => {
    const offenders = allFunctionSources()
      .filter(([, src]) => {
        const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
        return /['"\s,(]twilio_auth_token['"\s,:)]/.test(code) || /['"\s,(]twilio_api_key_secret['"\s,:)]/.test(code);
      })
      .map(([file]) => file);
    expect(offenders).toEqual([]);
  });
});

describe('internal tools refuse the public anon key', () => {
  for (const fn of ['send-tenant-sms', 'diag-twilio-a2p', 'diag-twilio-voice', 'ops-twilio-repoint-sms']) {
    it(`${fn} gates on requireInternalCaller before reading the body`, () => {
      const src = read(`${fn}/index.ts`);
      const gate = src.indexOf('requireInternalCaller(req');
      expect(gate).toBeGreaterThan(-1);
      const body = src.indexOf('req.json()');
      expect(body === -1 || gate < body).toBe(true);
    });
  }
});
