import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { OPERATIONAL_SOURCE_TABLES, FINANCE_SOURCE_TABLES } from '../../hooks/use-trax-support';

/*
 * The client's source-table allowlist, held against the tools that produce them.
 *
 * use-trax-support.ts refuses any answer citing a `table` it does not recognise —
 * a guard against a stale or rogue endpoint. The failure mode is quiet and total:
 * a tool ships server-side, the table is missing here, and every answer using it
 * becomes "The application-guidance service is not available in this environment"
 * with no hint that a list is out of date.
 *
 * That is exactly what happened when the business query layer shipped, so this
 * test exists to make it fail loudly instead.
 */
const SUPPORT = resolve(__dirname, '../../../../../supabase/functions/trax-support/support');

/** Every `table: '…'` a support module attaches to a source it returns. */
function tablesEmittedByTools(): Map<string, string[]> {
  const found = new Map<string, string[]>();
  for (const file of readdirSync(SUPPORT).filter((name) => name.endsWith('.ts'))) {
    const source = readFileSync(resolve(SUPPORT, file), 'utf8');
    for (const match of source.matchAll(/table:\s*'([a-z_]+)'/g)) {
      const table = match[1];
      // Only count it where it is part of a source/evidence object the client sees.
      const context = source.slice(Math.max(0, match.index - 200), match.index + 60);
      if (!/sources\s*:|sourceFor|id:\s*[`'"]/.test(context)) continue;
      found.set(table, [...(found.get(table) ?? []), file]);
    }
  }
  return found;
}

const allowed = new Set<string>([...OPERATIONAL_SOURCE_TABLES, ...FINANCE_SOURCE_TABLES]);

describe('the client accepts every source table the backend can cite', () => {
  it('finds the tables the tools emit', () => {
    const emitted = tablesEmittedByTools();
    // A sanity floor: if this collapses to nothing the scan has broken, and the
    // test below would pass vacuously.
    expect(emitted.size).toBeGreaterThanOrEqual(3);
    expect([...emitted.keys()]).toContain('business_query');
  });

  it('allows each of them', () => {
    const emitted = tablesEmittedByTools();
    const missing = [...emitted.entries()]
      .filter(([table]) => !allowed.has(table))
      .map(([table, files]) => `${table} (emitted by ${[...new Set(files)].join(', ')})`);
    expect(missing, 'add these to OPERATIONAL_SOURCE_TABLES in use-trax-support.ts').toEqual([]);
  });

  it('keeps the business query layer and reports on the operational list, not behind finance', () => {
    // A vehicle count is not a finance question; gating these behind the finance
    // capability would hide ordinary answers from a role that may read them.
    expect(OPERATIONAL_SOURCE_TABLES).toContain('business_query');
    expect(OPERATIONAL_SOURCE_TABLES).toContain('trax_report_jobs');
    expect(FINANCE_SOURCE_TABLES).not.toContain('business_query');
  });

  it('keeps the Stripe-specific tables behind the finance capability', () => {
    for (const table of ['payment_check', 'stripe_account_summary', 'payment_evidence']) {
      expect(FINANCE_SOURCE_TABLES).toContain(table);
      expect(OPERATIONAL_SOURCE_TABLES).not.toContain(table);
    }
  });

});

/*
 * Deliberately not asserted: that every allowed table is still produced by
 * something. Several are attached through helpers rather than a `table: '…'`
 * literal, so the scan cannot see them and would report false positives. This
 * test guards the direction that actually breaks the product — a tool the client
 * refuses — not the harmless direction of a stale allowlist entry.
 */
