/**
 * Never compute a total from a truncated result (design §6). PostgREST answers
 * at most 1,000 rows per request; these tests hand the pager a fake that does
 * the same and prove a 1,001-row table is read — and summed — completely.
 */
import { describe, expect, it } from 'vitest';
import { chunk, fetchAllByIds, fetchAllPages, FinanceLoadError, PAGE_SIZE } from '@/lib/finances/paging';
import { toCents } from '@/lib/finances/balance';

/** A table behind a PostgREST-like cap: any request returns at most 1,000 rows. */
function cappedTable<T>(rows: T[]) {
  const calls: [number, number][] = [];
  const fetchPage = (from: number, to: number) => {
    calls.push([from, to]);
    const end = Math.min(to + 1, from + 1000);
    return Promise.resolve({ data: rows.slice(from, end), error: null });
  };
  return { calls, fetchPage };
}

describe('fetchAllPages', () => {
  it('reads all 1,001 rows in two pages and the sum is complete', async () => {
    const rows = Array.from({ length: 1001 }, (_, i) => ({ id: `k${i}`, remaining_amount: 1.0 }));
    const t = cappedTable(rows);
    const got = await fetchAllPages('charges', t.fetchPage);
    expect(PAGE_SIZE).toBe(1000);
    expect(got).toHaveLength(1001);
    expect(t.calls).toEqual([
      [0, 999],
      [1000, 1999],
    ]);
    // 1,001 × $1.00 = 100100 cents — the first page alone would say 100000.
    expect(got.reduce((s, r) => s + toCents(r.remaining_amount), 0)).toBe(100100);
  });

  it('asks once more after exactly one full page, and stops on the empty page', async () => {
    const t = cappedTable(Array.from({ length: 1000 }, (_, i) => i));
    expect(await fetchAllPages('x', t.fetchPage)).toHaveLength(1000);
    expect(t.calls).toEqual([
      [0, 999],
      [1000, 1999],
    ]);
  });

  it('turns { error } into a thrown error — never a partial or empty result', async () => {
    let n = 0;
    const fetchPage = () => {
      n += 1;
      return Promise.resolve(
        n === 1
          ? { data: Array.from({ length: 1000 }, (_, i) => i), error: null }
          : { data: null, error: { message: 'canceling statement due to statement timeout', code: '57014' } },
      );
    };
    const err = await fetchAllPages('payments', fetchPage).catch((e) => e);
    expect(err).toBeInstanceOf(FinanceLoadError);
    expect(err.message).toBe('Could not load payments: canceling statement due to statement timeout');
  });

  it('refuses to total an unbounded read rather than truncate it', async () => {
    const fetchPage = (from: number, to: number) => Promise.resolve({ data: Array.from({ length: to - from + 1 }, () => 1), error: null });
    await expect(fetchAllPages('ledger', fetchPage, { pageSize: 10, maxRows: 50 })).rejects.toThrow(/refusing to total a partial read/);
  });
});

describe('fetchAllByIds', () => {
  it('chunks ids, drops blanks and repeats, and pages every chunk', async () => {
    const ids = [...Array.from({ length: 170 }, (_, i) => `id${i}`), 'id0', null, '', undefined];
    const seen: string[][] = [];
    const rows = await fetchAllByIds('customers', ids, (chunkIds) => {
      seen.push(chunkIds);
      return (from) => Promise.resolve({ data: from === 0 ? chunkIds.map((id) => ({ id })) : [], error: null });
    });
    expect(seen.map((c) => c.length)).toEqual([80, 80, 10]);
    expect(rows).toHaveLength(170);
  });

  it('reads nothing for no ids', async () => {
    let asked = false;
    const rows = await fetchAllByIds('x', [], () => {
      asked = true;
      return () => Promise.resolve({ data: [], error: null });
    });
    expect([rows, asked]).toEqual([[], false]);
  });

  it('chunk splits evenly', () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  });
});
