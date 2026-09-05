/**
 * THE TENANT COLUMN RETRY LADDER — apps/portal/src/contexts/TenantContext.tsx
 *
 * What this file guards, in one sentence: the mechanism that turns a missing
 * column GRANT from a 63-tenant branding-and-login outage into a quietly hidden
 * feature.
 *
 * WHY THE LADDER EXISTS
 * `anon` holds COLUMN-level SELECT grants on `public.tenants` and no table-level
 * grant. Postgres does not null out an ungranted column — it refuses the WHOLE
 * ROW with 42501 and answers "permission denied for table tenants", never naming
 * the column. The portal loads its tenant row with the anon key on the login
 * page, before any session exists, so ONE ungranted column in that select takes
 * branding and login down for every tenant at once. It has happened here, with
 * `customer_theme_mode`.
 *
 * The ladder is the fix: a new flag goes in TENANT_OPTIONAL_COLUMNS, and if its
 * GRANT has not landed yet the select sheds it instead of dying.
 *
 * HOW THIS FILE TESTS IT
 * We cannot import the module — it is a React context that pulls in the supabase
 * client, and this workspace cannot render portal components at all (see
 * helpers/edge-source.ts for the React 18/19 split). So we do the thing this
 * codebase insists on instead of pasting the logic into the test: the REAL
 * `loadTenant`, the REAL `extractTenantSlug` / `isPlatformDomain`, and the REAL
 * three column constants are lifted verbatim out of the shipped .tsx and
 * compiled, with only the genuine runtime inputs injected — a fake supabase, a
 * fake `window`, a recording `console`, and the four React setters.
 *
 * So these tests EXECUTE the shipped ladder and observe the column lists it
 * actually asks Postgres for. Reorder the rungs, delete the middle one, shed the
 * groups in the wrong order, or start retrying on PGRST116, and this suite
 * changes answer. Delete the ladder and the lift throws. Nothing here would
 * still pass against a stale copy, because there is no copy.
 */

import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  readPortalSource,
  readRepoSource,
  liftDeclaration,
  compileExpression,
  compile,
} from '../helpers/edge-source';

const tenantContextSource = readPortalSource('contexts/TenantContext.tsx');

/** Every lift below is TSX — TenantContext is a component file. */
const lift = (name: string) => liftDeclaration(tenantContextSource, name, { tsx: true });

// ---------------------------------------------------------------------------
// The three real column groups, read out of the shipped file.
// ---------------------------------------------------------------------------

const groups = compile<{ core: string; inshur: string; optional: string }>(
  [lift('TENANT_CORE_COLUMNS'), lift('TENANT_INSHUR_COLUMNS'), lift('TENANT_OPTIONAL_COLUMNS')],
  '({ core: TENANT_CORE_COLUMNS, inshur: TENANT_INSHUR_COLUMNS, optional: TENANT_OPTIONAL_COLUMNS })',
);

const columnsOf = (select: string): Set<string> =>
  new Set(
    select
      .split(',')
      .map((c) => c.trim())
      .filter(Boolean),
  );

const union = (...sets: Set<string>[]): Set<string> => {
  const out = new Set<string>();
  sets.forEach((s) => s.forEach((v) => out.add(v)));
  return out;
};

const CORE = columnsOf(groups.core);
const INSHUR = columnsOf(groups.inshur);
const OPTIONAL = columnsOf(groups.optional);

// ---------------------------------------------------------------------------
// A rig that runs the REAL loadTenant against a scripted supabase.
// ---------------------------------------------------------------------------

type QueryResult = {
  data: Record<string, unknown> | null;
  error: { code?: string; message: string } | null;
};

/** 42501 — the ungranted-column answer. Postgres blames the table, not the column. */
const denied = (message = 'permission denied for table tenants'): QueryResult => ({
  data: null,
  error: { code: '42501', message },
});

/** PGRST116 — `.single()` matched no row. A legitimately empty result, NOT a grant problem. */
const noRows = (): QueryResult => ({
  data: null,
  error: { code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned' },
});

const ok = (extra: Record<string, unknown> = {}): QueryResult => ({
  data: { id: 'tenant-1', company_name: 'Acme Rentals', slug: 'acme', ...extra },
  error: null,
});

interface LadderRun {
  /** The column string handed to `.select()` on each attempt, in order. */
  selects: string[];
  logs: { level: string; text: string }[];
  setTenant: unknown[];
  setError: unknown[];
  setLoading: unknown[];
  setTenantSlug: unknown[];
}

const runLoadTenant = async (responses: QueryResult[]): Promise<LadderRun> => {
  const selects: string[] = [];
  const logs: LadderRun['logs'] = [];
  const setTenant: unknown[] = [];
  const setError: unknown[] = [];
  const setLoading: unknown[] = [];
  const setTenantSlug: unknown[] = [];

  const supabase = {
    from: () => {
      const chain: Record<string, unknown> = {};
      chain.select = (columns: string) => {
        selects.push(columns);
        return chain;
      };
      chain.eq = () => chain;
      chain.in = () => chain;
      chain.single = async () => {
        const scripted = responses[selects.length - 1];
        if (!scripted) {
          throw new Error(
            `The ladder made ${selects.length} attempt(s) but this test only scripted ` +
              `${responses.length}. A rung was ADDED to TenantContext.loadTenant — decide ` +
              'whether the new rung is correct, then teach this suite about it.',
          );
        }
        if (!scripted.data) return scripted;

        // PostgREST hands back the columns that were ASKED FOR and nothing else,
        // and modelling that is load-bearing rather than pedantry: without it a
        // scripted `ok({ turo_bridge_enabled: true })` returns the flag no matter
        // which columns the rung requested, so "rung 2 delivers the flag" would
        // restate the script instead of testing the code. Mutation-checked: with
        // the row handed back whole, deleting the middle rung left that test
        // green. Projected, a rung that stops requesting the flag cannot return it.
        const asked = columnsOf(selects[selects.length - 1]);
        return {
          data: Object.fromEntries(Object.entries(scripted.data).filter(([k]) => asked.has(k))),
          error: null,
        };
      };
      return chain;
    },
  };

  const record = (level: string) => (...args: unknown[]) =>
    void logs.push({ level, text: args.map((a) => String(a)).join(' ') });

  const loadTenant = compileExpression<
    (
      supabase: unknown,
      window: unknown,
      console: unknown,
      setTenant: unknown,
      setLoading: unknown,
      setError: unknown,
      setTenantSlug: unknown,
    ) => () => Promise<void>
  >(
    ['supabase', 'window', 'console', 'setTenant', 'setLoading', 'setError', 'setTenantSlug'],
    [
      lift('PLATFORM_DOMAINS'),
      lift('isPlatformDomain'),
      lift('extractTenantSlug'),
      lift('TENANT_CORE_COLUMNS'),
      lift('TENANT_INSHUR_COLUMNS'),
      lift('TENANT_OPTIONAL_COLUMNS'),
      lift('loadTenant'),
    ],
    'loadTenant',
  )(
    supabase,
    // A real portal hostname, so the shipped extractTenantSlug resolves a slug
    // and the query path under test is the one operators actually hit.
    { location: { hostname: 'acme.portal.drive-247.com' } },
    { log: record('log'), warn: record('warn'), error: record('error') },
    (v: unknown) => void setTenant.push(v),
    (v: unknown) => void setLoading.push(v),
    (v: unknown) => void setError.push(v),
    (v: unknown) => void setTenantSlug.push(v),
  );

  await loadTenant();
  return { selects, logs, setTenant, setError, setLoading, setTenantSlug };
};

/**
 * The error the UI is finally left showing. loadTenant clears `setError(null)`
 * at the top of every run, so index 0 is always that reset, never a verdict.
 */
const finalError = (run: LadderRun): unknown => run.setError[run.setError.length - 1];

const allDenied = () => runLoadTenant([denied(), denied(), denied()]);

// ---------------------------------------------------------------------------

describe('TenantContext column ladder — the rungs', () => {
  it('resolves a slug and issues a tenant select at all (rig sanity)', async () => {
    const run = await runLoadTenant([ok()]);

    // If this fails, every other assertion in this file is meaningless: it means
    // the lifted loadTenant never reached its query, so the ladder was never
    // exercised and the suite would be green for the wrong reason.
    expect(run.setTenantSlug).toEqual(['acme']);
    expect(run.selects.length).toBeGreaterThan(0);
  });

  it('climbs exactly THREE rungs: CORE+INSHUR+OPTIONAL -> CORE+OPTIONAL -> CORE', async () => {
    const run = await allDenied();

    expect(
      run.selects.length,
      'The ladder must make exactly three queryTenant attempts. It was briefly TWO ' +
        '(everything -> core-only), and that silently made the whole optional group ' +
        'unreadable on every logged-out load, because anon holds no grant on any INSHUR ' +
        'column and so rung 1 fails 100% of the time on the anon path.',
    ).toBe(3);

    expect(columnsOf(run.selects[0])).toEqual(union(CORE, INSHUR, OPTIONAL));
    expect(columnsOf(run.selects[1])).toEqual(union(CORE, OPTIONAL));
    expect(columnsOf(run.selects[2])).toEqual(CORE);
  });

  it('keeps the OPTIONAL columns on the MIDDLE rung', async () => {
    const run = await allDenied();

    expect(
      run.selects.length,
      'There is no middle rung. The ladder collapsed back to two rungs (everything -> ' +
        'core-only). anon can never read the INSHUR columns, so rung 1 always fails on ' +
        'the logged-out login page, and a two-rung ladder therefore drops ' +
        `TENANT_OPTIONAL_COLUMNS (${groups.optional}) on EVERY anonymous load — grant or ` +
        'no grant. And nothing refetches: loadTenant runs once on mount with [] deps and ' +
        'signing in uses router.replace(), which keeps this provider mounted, so the ' +
        'tenant object assembled anonymously is the one the authenticated dashboard uses ' +
        'for the rest of the session. An operator with Turo Sync ON would see no sidebar ' +
        'entry until their next hard refresh, which reads as a broken toggle.',
    ).toBeGreaterThanOrEqual(2);

    const middle = columnsOf(run.selects[1]);
    OPTIONAL.forEach((column) => {
      expect(
        middle.has(column),
        `Rung 2 dropped the optional column '${column}'. The middle rung exists precisely ` +
          'to give the optional group its own chance after the INSHUR group is shed. ' +
          'Without it the flag reads undefined for the whole session on every anon load.',
      ).toBe(true);
    });
  });

  it('sheds INSHUR BEFORE OPTIONAL, never the other way round', async () => {
    const run = await allDenied();
    const middle = columnsOf(run.selects[1]);

    INSHUR.forEach((column) => {
      expect(
        middle.has(column),
        `Rung 2 still carries the INSHUR column '${column}'. INSHUR is the group KNOWN to ` +
          'be ungranted for anon, so it must be shed FIRST; shedding OPTIONAL first means ' +
          'rung 2 fails for the same reason rung 1 did and the optional flags are lost ' +
          'anyway — which is exactly the two-rung bug wearing three rungs as a disguise.',
      ).toBe(false);
    });

    expect(
      columnsOf(run.selects[1]),
      'Rung 2 is CORE + INSHUR. The shedding order is inverted.',
    ).not.toEqual(union(CORE, INSHUR));
  });

  it('keeps TENANT_CORE_COLUMNS on every single rung', async () => {
    const run = await allDenied();

    run.selects.forEach((select, i) => {
      const asked = columnsOf(select);
      CORE.forEach((column) => {
        expect(
          asked.has(column),
          `Rung ${i + 1} dropped the core column '${column}'. Core has NO fallback by ` +
            'design — a rung that sheds part of it hands the portal a tenant object ' +
            'missing fields every page assumes are present, which is worse than the ' +
            'outage the ladder is there to prevent.',
        ).toBe(true);
      });
    });
  });

  it('asks for nothing on the final rung beyond the core list', async () => {
    const run = await allDenied();

    // The bottom rung is the one that has to succeed for anyone to log in. If a
    // column creeps into it, the ladder has no rung left to shed it from.
    expect(columnsOf(run.selects[run.selects.length - 1])).toEqual(CORE);
  });
});

describe('TenantContext column ladder — what does and does not trigger a retry', () => {
  it('does NOT retry on PGRST116 — an empty result is not a grant problem', async () => {
    const run = await runLoadTenant([noRows()]);

    expect(
      run.selects.length,
      'PGRST116 means .single() matched no row — a legitimately absent tenant. Retrying ' +
        'on it would fire two extra pointless queries for every bad slug, and would ' +
        'end by reporting a permissions failure for what is really a 404.',
    ).toBe(1);

    expect(run.setTenant).toEqual([null]);
    expect(String(finalError(run))).toMatch(/not found or inactive/i);
  });

  it('retries on 42501 (the ungranted-column code)', async () => {
    const run = await runLoadTenant([denied(), ok()]);
    expect(run.selects).toHaveLength(2);
  });

  it('retries on any other Postgres error code too, not just 42501', async () => {
    // 42703 is "column ... does not exist" — what you get when the flag has not
    // been added to the table yet at all. It must fall down the ladder just the
    // same, otherwise merging the client before the DDL is an outage.
    const run = await runLoadTenant([
      { data: null, error: { code: '42703', message: 'column tenants.turo_bridge_enabled does not exist' } },
      ok(),
    ]);

    expect(
      run.selects,
      'The retry condition is `queryError && queryError.code !== "PGRST116"`. Narrowing ' +
        'it to an explicit 42501 check would leave 42703 (column does not exist) fatal, ' +
        'so shipping this file before the DDL would take login down.',
    ).toHaveLength(2);

    // Counting the attempts is not enough. Narrowing only the FIRST gate to an
    // explicit 42501 check still produces two attempts — but the second one is
    // the CORE-ONLY bottom rung, because the 42703 skipped the middle rung and
    // was caught by the second gate instead. The count looks like a healthy
    // retry while the optional group was shed alongside INSHUR in one step:
    // the two-rung bug again, reached by a different error code. So assert
    // WHICH rung it fell to, not merely that it fell.
    expect(
      columnsOf(run.selects[1]),
      'A 42703 fell straight to the core-only rung instead of the middle one, so the ' +
        'optional columns were shed as collateral damage from a failure that had nothing ' +
        'to do with them. Every gate in the ladder must use the same ' +
        '`code !== "PGRST116"` test.',
    ).toEqual(union(CORE, OPTIONAL));
  });

  it('stops climbing the moment a rung succeeds', async () => {
    const first = await runLoadTenant([ok({ turo_bridge_enabled: true })]);
    expect(first.selects).toHaveLength(1);
    expect(first.setTenant[0]).toMatchObject({ turo_bridge_enabled: true });

    // It has to be the LAST setError call, not merely "null appears somewhere".
    // loadTenant calls setError(null) at the TOP of every run, so asserting the
    // array CONTAINS null is a tautology that holds however the run ends —
    // mutation-checked: making the success path finish with setError('boom')
    // left `toContain(null)` green while every operator saw a stale error banner
    // over a tenant that had loaded perfectly.
    expect(
      finalError(first),
      'A successful load left an error on screen. Nothing clears it afterwards: this ' +
        'provider fetches once on mount with [] deps.',
    ).toBeNull();
  });

  it('serves the optional flag from rung 2 when only INSHUR is ungranted', async () => {
    // The production shape once the flag's GRANT has landed: anon cannot read
    // INSHUR, can read turo_bridge_enabled. The whole point of the middle rung.
    const run = await runLoadTenant([denied(), ok({ turo_bridge_enabled: true })]);

    expect(run.selects).toHaveLength(2);
    expect(
      run.setTenant[0],
      'Rung 2 succeeded but the tenant came back without the flag — the middle rung is ' +
        'not actually requesting the optional columns.',
    ).toMatchObject({ turo_bridge_enabled: true });
  });

  it('halts on PGRST116 even when it arrives on a later rung', async () => {
    const run = await runLoadTenant([denied(), noRows()]);

    expect(
      run.selects.length,
      'Rung 2 answered "no such tenant", which is a final answer. Falling through to ' +
        'rung 3 would burn another query to be told the same thing.',
    ).toBe(2);
    expect(String(finalError(run))).toMatch(/not found or inactive/i);
  });

  it('always clears the loading flag, on every outcome', async () => {
    for (const script of [[ok()], [noRows()], [denied(), denied(), denied()]]) {
      const run = await runLoadTenant(script);
      expect(
        run.setLoading[run.setLoading.length - 1],
        'loadTenant left `loading` true. Every consumer that checks loading before ' +
          'reading a flag would hang on a spinner forever.',
      ).toBe(false);
    }
  });
});

describe('TenantContext column ladder — the 42501 diagnostic on the bottom rung', () => {
  it('names the real cause when the LAST rung is refused', async () => {
    const run = await allDenied();
    const errors = run.logs.filter((l) => l.level === 'error').map((l) => l.text);

    expect(
      errors.length,
      'The final failure path logged nothing at console.error level. 42501 on the bottom ' +
        'rung means an ungranted column in TENANT_CORE_COLUMNS — branding and login are ' +
        'down for EVERY tenant — and Postgres will not say so: it answers HTTP 401 with ' +
        '"permission denied for table tenants", blaming the table and never naming the ' +
        'column. Without an explicit diagnostic here, a one-line GRANT costs an afternoon ' +
        'chasing a phantom auth bug.',
    ).toBeGreaterThan(0);

    const diagnostic = errors.join('\n');

    expect(diagnostic).toMatch(/GRANT/);
    expect(
      diagnostic,
      'The diagnostic does not name TENANT_CORE_COLUMNS, so it does not tell the reader ' +
        'WHICH list to go looking in.',
    ).toMatch(/TENANT_CORE_COLUMNS/);

    // "Points somewhere useful" has to mean a place that exists.
    const pointer = diagnostic.match(/[\w./-]*04-turo-sync-flag\.sql/)?.[0];
    expect(
      pointer,
      'The diagnostic does not point at the DEPLOY GATE query that finds the offending ' +
        'column. A message that says "a column is ungranted" without saying how to find ' +
        'which one leaves the reader exactly where Postgres did.',
    ).toBeTruthy();
    expect(
      existsSync(resolve(__dirname, '../../../../..', pointer as string)),
      `The diagnostic points at '${pointer}', which does not exist in this repo. A stale ` +
        'pointer is worse than none — it sends the on-call reader to a dead end during ' +
        'a login outage.',
    ).toBe(true);

    // And it must still surface to the UI rather than only to the console: a
    // console-only diagnostic leaves the operator staring at an unbranded page
    // with nothing on screen to quote to support.
    expect(
      String(finalError(run)),
      'The bottom-rung 42501 was logged but never handed to setError, so the screen says ' +
        'nothing at all about why the tenant failed to load.',
    ).toMatch(/permission denied/i);
    expect(run.setTenant).toEqual([null]);
  });

  it('does NOT cry wolf when a lower rung recovers', async () => {
    const run = await runLoadTenant([denied(), ok()]);
    const errors = run.logs.filter((l) => l.level === 'error');

    expect(
      errors,
      'A rung that fell back successfully logged a COLUMN GRANT MISSING error. That is ' +
        'the ladder working as designed; escalating it to console.error trains everyone ' +
        'to ignore the one message that means the site is down.',
    ).toHaveLength(0);
  });

  it('warns — but does not error — on each intermediate fallback', async () => {
    const run = await allDenied();
    const warns = run.logs.filter((l) => l.level === 'warn');

    // Two sheds happened, so both should have left a trace. Silent degradation
    // is how a feature ends up "randomly off" with nothing in the logs.
    expect(warns.length).toBeGreaterThanOrEqual(2);
    expect(warns.map((w) => w.text).join('\n')).toMatch(/INSHUR/);
  });
});

describe('TenantContext column ladder — the flag is on the sheddable side', () => {
  it('keeps turo_bridge_enabled in TENANT_OPTIONAL_COLUMNS, out of TENANT_CORE_COLUMNS', () => {
    expect(
      OPTIONAL.has('turo_bridge_enabled'),
      'turo_bridge_enabled left TENANT_OPTIONAL_COLUMNS. The ladder can only protect a ' +
        'column it is allowed to shed.',
    ).toBe(true);

    expect(
      CORE.has('turo_bridge_enabled'),
      'turo_bridge_enabled was promoted into TENANT_CORE_COLUMNS. Core has no fallback: ' +
        'if its anon GRANT is ever missing or dropped, Postgres refuses the whole row and ' +
        'branding and login go down for every tenant. That has happened here once already ' +
        '(customer_theme_mode). Promoting it buys nothing — the dashboard holds a ' +
        'table-level grant and reads it on rung 1 regardless.',
    ).toBe(false);
  });

  it('never lets the same column sit in two groups', () => {
    // A column in both CORE and OPTIONAL would make the ladder a no-op for it:
    // rung 3 would still ask for it and still be refused.
    const overlap = Array.from(OPTIONAL).filter((c) => CORE.has(c) || INSHUR.has(c));
    expect(overlap).toEqual([]);
  });
});

describe('the flag must not leak into the booking site', () => {
  const bookingSource = readRepoSource('apps/booking/src/contexts/TenantContext.tsx');

  it('apps/booking TenantContext mentions turo nowhere at all', () => {
    const hits = bookingSource.match(/turo/gi) ?? [];

    expect(
      hits,
      'The booking site is the OTHER anon consumer of `tenants`, and it has NO retry ' +
        'ladder of its own — one ungranted column in its column list refuses the whole ' +
        'row and every booking site falls back to default branding. It also never reads ' +
        'this flag. Adding turo_bridge_enabled there is all downside.',
    ).toEqual([]);
  });

  it('apps/booking TenantContext does not reference the flag by name', () => {
    expect(bookingSource).not.toContain('turo_bridge_enabled');
  });

  it('booking really does still load tenants (so the assertion above is not vacuous)', () => {
    // Guards against the file being renamed or gutted, which would make a
    // "contains no turo" assertion pass for the wrong reason.
    expect(bookingSource).toContain("from('tenants')");
  });
});
