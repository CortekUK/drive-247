import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

/*
 * Deleting a tenant must not fail on a foreign key nobody remembered.
 *
 * `admin-delete-tenant` clears rows from a HAND-WRITTEN list before it deletes
 * the tenant row. Any FK to tenants(id) that is not ON DELETE CASCADE will
 * refuse that final delete, so a table missing from the list means the whole
 * call 500s with a message naming one constraint:
 *
 *   violates foreign key constraint
 *   "platform_promo_codes_owner_tenant_id_fkey" on table "platform_promo_codes"
 *
 * The list said "verified against prod" and carried four tables. It had fallen
 * ELEVEN behind — the referral and promo-code tables arrived later and nobody
 * came back to it. Worse, each fix only moves the failure: clear the promo
 * codes and the next attempt dies on `referrals` instead.
 *
 * So the list is held against the migrations rather than against anyone's
 * memory. A new non-cascading FK to tenants fails this test the day it lands,
 * which is the only moment it is cheap to fix.
 */

const ROOT = resolve(__dirname, '../../../../../');
const MIGRATIONS = resolve(ROOT, 'supabase/migrations');
const FUNCTION = resolve(ROOT, 'supabase/functions/admin-delete-tenant/index.ts');

/** Every (table, column) with a FK to tenants(id) that has no delete action. */
function blockingForeignKeys(): Map<string, string> {
  const found = new Map<string, string>();
  const action = (tail: string) =>
    /on\s+delete\s+(cascade|set\s+null)/i.exec(tail)?.[1]?.toUpperCase() ?? 'NO ACTION';

  for (const file of readdirSync(MIGRATIONS).filter((n) => n.endsWith('.sql'))) {
    const sql = readFileSync(resolve(MIGRATIONS, file), 'utf8');

    // ALTER TABLE x ADD CONSTRAINT … FOREIGN KEY (col) REFERENCES tenants(id) …
    const alter =
      /alter\s+table\s+(?:only\s+)?(?:public\.)?"?([a-z_0-9]+)"?[\s\S]{0,300}?foreign\s+key\s*\(\s*"?([a-z_0-9]+)"?\s*\)\s*references\s+(?:public\.)?tenants\s*\(\s*id\s*\)([^;]*)/gim;
    for (let m = alter.exec(sql); m; m = alter.exec(sql)) {
      found.set(`${m[1]}.${m[2]}`, action(m[3]));
    }

    // Inline:  CREATE TABLE x ( … col uuid REFERENCES tenants(id) … )
    const creates =
      /create\s+table\s+(?:if\s+not\s+exists\s+)?(?:public\.)?"?([a-z_0-9]+)"?\s*\(([\s\S]*?)\n\s*\);/gim;
    for (let t = creates.exec(sql); t; t = creates.exec(sql)) {
      const inline =
        /^\s*"?([a-z_0-9]+)"?\s+uuid[^,\n]*?references\s+(?:public\.)?tenants\s*\(\s*id\s*\)([^,\n]*)/gim;
      for (let c = inline.exec(t[2]); c; c = inline.exec(t[2])) {
        found.set(`${t[1]}.${c[1]}`, action(c[2]));
      }
    }
  }
  return found;
}

const source = readFileSync(FUNCTION, 'utf8');
const all = blockingForeignKeys();
const blocking = [...all.entries()].filter(([, a]) => a === 'NO ACTION').map(([k]) => k).sort();

describe('the scan itself is working', () => {
  it('finds foreign keys to tenants at all', () => {
    // A floor, so the coverage test below cannot pass by finding nothing.
    expect(all.size).toBeGreaterThan(20);
  });

  it('finds the one that caused the outage', () => {
    expect(blocking).toContain('platform_promo_codes.owner_tenant_id');
  });
});

describe('admin-delete-tenant clears every row that would block the delete', () => {
  it.each(blocking)('%s', (key) => {
    const [table] = key.split('.');
    expect(source).toContain(`'${table}'`);
  });
});

describe('the delete is scoped by the column each table actually uses', () => {
  it('does not assume every table has tenant_id', () => {
    // platform_promo_codes uses owner_tenant_id. A bare `.eq('tenant_id', …)`
    // silently deletes nothing there and reports success.
    expect(source).toMatch(/\.eq\(column, tenant_id\)/);
    expect(source).toMatch(/\['platform_promo_codes', 'owner_tenant_id'\]/);
  });
});

/*
 * The referral chain, which a flat list cannot express and which failed twice
 * against prod before it was walked properly:
 *
 *   referral_events -> referrals -> promo_code_redemptions -> platform_promo_codes
 */
describe('the referral chain is unpicked from the far end', () => {
  it('deletes the children of a referral by referral_id, not by tenant_id', () => {
    // A referral joins TWO tenants, and the event hanging off it can belong to
    // the OTHER one — deleting events by tenant_id leaves exactly the row that
    // blocks the referral.
    expect(source).toMatch(/\['referral_events', 'referral_id'\]/);
    expect(source).toMatch(/\['referral_claims', 'resolved_referral_id'\]/);
  });

  it('finds the referrals from either end', () => {
    expect(source).toMatch(/referrer_tenant_id\.eq\.\$\{tenant_id\},referred_tenant_id\.eq\.\$\{tenant_id\}/);
  });

  it('clears what points at the promo code, not only what points at the tenant', () => {
    expect(source).toMatch(/found_promo_code_id/);
    expect(source).toMatch(/\.in\('promo_code_id', codeIds\)/);
  });

  it('runs before the flat list, which assumes the chain is already gone', () => {
    const chain = source.indexOf('await unpickReferrals()');
    const flat = source.indexOf('const tenantScopedRows');
    expect(chain).toBeGreaterThan(-1);
    expect(chain).toBeLessThan(flat);
  });
});
