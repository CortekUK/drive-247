/**
 * A stand-in for the PostgREST query builder that actually applies every filter,
 * so a test exercises the real query code rather than a mock that agrees with it.
 *
 * Not a test file: it has no assertions and is imported by the suites that need a
 * database-shaped object. For isolation proven against real SQL, see
 * tests/trax/business-storage.mjs.
 */
export type Row = Record<string, unknown>;
export interface Statement { table: string; filters: string[]; columns: string; head: boolean }

export function postgrestShim(tables: () => Record<string, Row[]>, statements: Statement[] = []) {
  const database = {
    from(table: string) {
      return {
        select(columns: string, options?: { count?: 'exact'; head?: boolean }) {
          const log: Statement = { table, filters: [], columns, head: !!options?.head };
          statements.push(log);
          let rows = [...(tables()[table] ?? [])];
          const keep = (predicate: (row: Row) => boolean, note: string) => { log.filters.push(note); rows = rows.filter(predicate); return query; };
          let matched = 0;
          const query: Record<string, unknown> = {
            eq: (c: string, v: unknown) => keep((r) => String(r[c]) === String(v), `${c}=eq.${String(v)}`),
            neq: (c: string, v: unknown) => keep((r) => String(r[c]) !== String(v), `${c}=neq.${String(v)}`),
            in: (c: string, v: unknown[]) => keep((r) => v.map(String).includes(String(r[c])), `${c}=in.(${v.join(',')})`),
            gt: (c: string, v: unknown) => keep((r) => Number(r[c] ?? 0) > Number(v), `${c}=gt.${String(v)}`),
            gte: (c: string, v: unknown) => keep((r) => String(r[c]) >= String(v), `${c}=gte.${String(v)}`),
            lt: (c: string, v: unknown) => keep((r) => String(r[c]) < String(v), `${c}=lt.${String(v)}`),
            lte: (c: string, v: unknown) => keep((r) => String(r[c]) <= String(v), `${c}=lte.${String(v)}`),
            is: (c: string) => keep((r) => r[c] === null || r[c] === undefined, `${c}=is.null`),
            not: (c: string) => keep((r) => r[c] !== null && r[c] !== undefined, `${c}=not.is.null`),
            ilike: (c: string, p: string) => keep((r) => String(r[c] ?? '').toLowerCase().includes(p.replaceAll('%', '').toLowerCase()), `${c}=ilike.${p}`),
            order: () => query,
            // PostgREST reports the filtered total in the header, before the range.
            range: (from: number, to: number) => { matched = rows.length; rows = rows.slice(from, to + 1); return query; },
            then: (ok: (value: unknown) => unknown, no?: (e: unknown) => unknown) =>
              Promise.resolve().then(() => ok({
                data: options?.head ? null : rows,
                error: null,
                count: matched || rows.length,
              }), no),
          };
          return query;
        },
      };
    },
  };
  return { database, statements };
}
