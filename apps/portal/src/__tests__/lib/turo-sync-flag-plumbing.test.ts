/**
 * Turo Sync feature flag — the COLUMN-LIST and SQL-SNAPSHOT half of the wiring.
 *
 * WHAT THIS FILE GUARDS, AND WHY IT IS NOT A STYLE TEST
 *
 * `tenants.turo_bridge_enabled` is read on a path where getting the column list
 * wrong is not a degraded feature, it is a platform outage. `anon` holds
 * COLUMN-level SELECT grants on `public.tenants` and ZERO table-level grants
 * (242 individual column grants, measured on production 2026-09-05). Postgres
 * evaluates column privileges per STATEMENT, all-or-nothing: name one column the
 * role may not read and it refuses the ENTIRE ROW with 42501 — it does not hand
 * back the other 56 columns with a null in the gap. Both the booking site and
 * the portal's own login page resolve their tenant with the anon key before any
 * session exists, so one ungranted column in TENANT_CORE_COLUMNS strips branding
 * and login for all 63 tenants at once. That has already happened here, with
 * `customer_theme_mode`, and it presents as a CDN/branding bug rather than a
 * permissions one — the HTTP status is 401 and the body blames "table tenants",
 * never naming the column.
 *
 * The frontend's defence is the three-rung retry ladder in TenantContext.tsx,
 * and the ladder only helps columns that are OUTSIDE the core list: every rung
 * keeps TENANT_CORE_COLUMNS, so a core column has no rung below it. Hence the
 * flag lives in TENANT_OPTIONAL_COLUMNS, and hence test 1.
 *
 * The database's defence is the DEPLOY GATE query at the bottom of
 * turo-bridge-poc/sql/04-turo-sync-flag.sql, which walks a SNAPSHOT of
 * TENANT_CORE_COLUMNS against information_schema and reports every entry anon
 * cannot read. A snapshot is a copy, and a copy drifts: this one already drifted
 * to 58 entries against a real 57 and reported a "tenant-wide outage" for a
 * column whose entire design is to be sheddable. Drift in either direction is
 * invisible — under-report and the gate misses the next customer_theme_mode,
 * over-report and people learn to ignore it. Hence test 4, which is the reason
 * this file exists.
 *
 * HOW IT ASSERTS
 * Both column lists and the SQL snapshot are parsed out of the shipped files.
 * Nothing here is a hand-maintained copy of either, because a hand-maintained
 * copy is the exact bug under test. Edit TENANT_CORE_COLUMNS and this suite
 * changes answer; delete it and the lift throws.
 *
 * NOT ASSERTED HERE: whether the grant actually exists in the database. These
 * tests run offline in CI. Only the anon-key smoke test in the SQL file can
 * prove a live grant, and it says so.
 */

import { describe, it, expect } from 'vitest';
import { readPortalSource, readRepoSource, liftDeclaration, compile } from '../helpers/edge-source';

/** The flag this whole feature hangs off. */
const FLAG = 'turo_bridge_enabled';

const TENANT_CONTEXT_PATH = 'apps/portal/src/contexts/TenantContext.tsx';
const SQL_PATH = 'turo-bridge-poc/sql/04-turo-sync-flag.sql';

const tenantContextSource = readPortalSource('contexts/TenantContext.tsx');
const sqlSource = readRepoSource(SQL_PATH);

/**
 * `sqlSource` with every SQL comment removed, so the assertions below read what
 * Postgres would RUN rather than what the file merely SAYS.
 *
 * This is load-bearing, not hygiene. 04-turo-sync-flag.sql is 90% prose — it
 * argues at length about the GRANT and quotes the DEPLOY GATE in its own
 * commentary — so a `--` in front of either one leaves the text sitting right
 * where a regex finds it. Both were verified as live holes: commenting out
 * `GRANT SELECT (turo_bridge_enabled) ON public.tenants TO anon;` and commenting
 * out the whole `WITH core(col) AS (...)` gate each left all eight assertions
 * GREEN while the file did nothing. That is worse than having no test, because
 * the failure message then asserts the grant is present. Commenting a statement
 * out has to count as deleting it, because to Postgres it is.
 *
 * String-literal aware on purpose: this file has `--` INSIDE quoted text (the
 * COMMENT ON body, and `'NO anon SELECT GRANT -- Postgres 42501s the whole row'`
 * in the gate's CASE arm), and a naive line-comment strip would eat a closing
 * quote and desynchronise everything after it. Doubled-quote escapes (`tenant''s`)
 * are handled for the same reason.
 *
 * NOT handled: dollar quoting (`$$ … $$`). The one `DO $$` block in this file
 * carries no apostrophe outside a normal quoted string, so nothing desyncs
 * today; if that changes, the symptom is this suite going RED (the DEPLOY GATE
 * marker stops being findable, or the snapshot parses to something that is not
 * the core list) rather than quietly going green. Teach it `$tag$` then — do not
 * fall back to reading the raw file.
 */
function stripSqlComments(sql: string): string {
  let out = '';
  let inString = false;

  for (let i = 0; i < sql.length; ) {
    if (inString) {
      if (sql[i] === "'" && sql[i + 1] === "'") {
        out += "''";
        i += 2;
        continue;
      }
      if (sql[i] === "'") inString = false;
      out += sql[i];
      i += 1;
      continue;
    }
    if (sql[i] === "'") {
      inString = true;
      out += "'";
      i += 1;
      continue;
    }
    if (sql[i] === '-' && sql[i + 1] === '-') {
      while (i < sql.length && sql[i] !== '\n') i += 1; // the \n itself is kept
      continue;
    }
    if (sql[i] === '/' && sql[i + 1] === '*') {
      let depth = 1; // Postgres block comments nest
      i += 2;
      while (i < sql.length && depth > 0) {
        if (sql[i] === '/' && sql[i + 1] === '*') {
          depth += 1;
          i += 2;
        } else if (sql[i] === '*' && sql[i + 1] === '/') {
          depth -= 1;
          i += 2;
        } else {
          i += 1;
        }
      }
      out += ' ';
      continue;
    }
    out += sql[i];
    i += 1;
  }
  return out;
}

/** The statements this file actually executes. */
const executableSql = stripSqlComments(sqlSource);

/**
 * The three real column lists, lifted from the shipped provider and compiled.
 * They are module-scope `const`s and not exported, so an import cannot reach
 * them — and importing TenantContext.tsx would drag in the Supabase client and
 * React anyway. `liftDeclaration` throws if any of them is renamed or inlined,
 * which is the correct outcome: the test should go red, not quietly pass
 * against a stale copy of a list that no longer exists.
 */
const liftColumnList = (name: string): string =>
  compile<string>([liftDeclaration(tenantContextSource, name, { tsx: true })], name);

const CORE = liftColumnList('TENANT_CORE_COLUMNS');
const INSHUR = liftColumnList('TENANT_INSHUR_COLUMNS');
const OPTIONAL = liftColumnList('TENANT_OPTIONAL_COLUMNS');

/**
 * Split a PostgREST `select=` list the way the DEPLOY GATE query does —
 * `btrim(unnest(string_to_array(<list>, ',')))`. Deliberately NOT filtering
 * empties: a stray `,,` has to survive as an empty entry so test 3 can see it.
 */
const splitColumns = (list: string): string[] => list.split(',').map((c) => c.trim());

const coreColumns = splitColumns(CORE);
const inshurColumns = splitColumns(INSHUR);
const optionalColumns = splitColumns(OPTIONAL);

/**
 * Read the first SQL string literal that follows `marker`, handling doubled-quote
 * escapes. Used to pull the DEPLOY GATE snapshot out of `string_to_array(...)`.
 */
function sqlStringLiteralAfter(sql: string, marker: string): string {
  const at = sql.indexOf(marker);
  if (at === -1) {
    throw new Error(
      `Could not find '${marker}' in the EXECUTABLE SQL of ${SQL_PATH}. The DEPLOY GATE query ` +
        'was rewritten, removed, or COMMENTED OUT — this test reads the file with SQL comments ' +
        'stripped, so a commented-out gate counts as no gate, which is what it is. Point this ' +
        'test at whatever replaced it — do not delete the assertion, the gate is the only thing ' +
        'that finds the next ungranted core column.',
    );
  }
  const open = sql.indexOf("'", at + marker.length);
  if (open === -1) throw new Error(`No string literal follows '${marker}' in ${SQL_PATH}.`);

  let out = '';
  for (let i = open + 1; i < sql.length; i += 1) {
    if (sql[i] !== "'") {
      out += sql[i];
      continue;
    }
    if (sql[i + 1] === "'") {
      out += "'";
      i += 1;
      continue;
    }
    return out;
  }
  throw new Error(`Unterminated string literal after '${marker}' in ${SQL_PATH}.`);
}

/**
 * Column names this SQL file actually grants to `anon`, in file order.
 *
 * Read off `executableSql`, never off `sqlSource`: this file discusses the
 * GRANT in prose at length, and a `--` in front of the real statement would
 * otherwise still satisfy the match.
 */
const anonGrantedColumns = (): string[] =>
  [
    ...executableSql.matchAll(
      // `ON TABLE public.tenants` is the same statement to Postgres as
      // `ON public.tenants`, so tolerate the optional keyword. Without it a
      // reformat that changes nothing about the database turns this assertion
      // red and teaches the reader that it cries wolf — the exact reflex that
      // let the DEPLOY GATE drift to 58 entries.
      /GRANT\s+SELECT\s*\(\s*([^)]*?)\s*\)\s+ON\s+(?:TABLE\s+)?public\.tenants\s+TO\s+anon\b/gi,
    ),
  ]
    .map((m) => m[1])
    .flatMap((cols) => cols.split(',').map((c) => c.trim()));

describe('Turo Sync flag — column-list plumbing (TenantContext.tsx)', () => {
  it(`keeps ${FLAG} in TENANT_OPTIONAL_COLUMNS and OUT of TENANT_CORE_COLUMNS`, () => {
    const why =
      `\n\nWHY THIS TEST EXISTS — read this before "fixing" it by moving the column.\n` +
      `\n'${FLAG}' must stay in TENANT_OPTIONAL_COLUMNS. Moving it into ` +
      'TENANT_CORE_COLUMNS looks like tidying up. It is not.\n' +
      '\n  * The 42501 retry ladder in TenantContext.tsx keeps TENANT_CORE_COLUMNS on EVERY ' +
      'rung. A core column therefore has no rung below it — there is nothing left to shed.\n' +
      '  * `anon` has column-level grants on public.tenants and no table grant, and the portal ' +
      'login page + every booking site resolve their tenant with the ANON key, before any ' +
      'session exists.\n' +
      '  * Postgres evaluates column privileges per statement, all-or-nothing. One ungranted ' +
      'column makes it refuse the WHOLE ROW with 42501 (served as HTTP 401, body blaming ' +
      '"table tenants" and never naming the column).\n' +
      `\nSo this one-line move takes branding and login down for every tenant at once, and ` +
      'reads as a CDN or branding bug for the hours it takes anyone to suspect a GRANT. It has ' +
      'already happened on this project once, with customer_theme_mode.\n' +
      '\nIn TENANT_OPTIONAL_COLUMNS the ungranted case degrades instead: the ladder sheds the ' +
      `column, the flag reads undefined, undefined is not === true, the feature hides itself. ` +
      'Fail-closed, no outage.\n' +
      `\nIf it genuinely must move: apply ${SQL_PATH} first and PROVE the grant with a real ` +
      'anon-key read (the SMOKE TEST in that file), then move it.\n';

    expect(optionalColumns, `${FLAG} is missing from TENANT_OPTIONAL_COLUMNS.${why}`).toContain(
      FLAG,
    );
    expect(coreColumns, `${FLAG} was promoted into TENANT_CORE_COLUMNS.${why}`).not.toContain(FLAG);
  });

  it('keeps the three column lists pairwise disjoint', () => {
    const overlap = (a: string[], b: string[]) => a.filter((c) => b.includes(c));

    // The lists are concatenated into one `select=` on rung 1 and pairwise on
    // rung 2, so a column in two lists is sent to PostgREST twice. Beyond being
    // wasteful it makes the ladder incoherent: a column in both CORE and
    // OPTIONAL cannot be shed at all, so it silently gains core semantics —
    // exactly the promotion test 1 forbids, arrived at by accident.
    expect(
      overlap(coreColumns, inshurColumns),
      'Column(s) in BOTH TENANT_CORE_COLUMNS and TENANT_INSHUR_COLUMNS. They are concatenated ' +
        'into one select, so this sends the column twice — and it can never be shed, because ' +
        'rung 2 keeps the core list.',
    ).toEqual([]);

    expect(
      overlap(coreColumns, optionalColumns),
      'Column(s) in BOTH TENANT_CORE_COLUMNS and TENANT_OPTIONAL_COLUMNS. Every rung of the ' +
        'ladder keeps the core list, so such a column is NOT sheddable however optional it ' +
        'looks — it has quietly become a core column, with a core column\'s outage risk.',
    ).toEqual([]);

    expect(
      overlap(inshurColumns, optionalColumns),
      'Column(s) in BOTH TENANT_INSHUR_COLUMNS and TENANT_OPTIONAL_COLUMNS. Rung 2 keeps the ' +
        'optional list, so this column is not actually shed with the INSHUR group — the two ' +
        'rungs stop meaning different things.',
    ).toEqual([]);
  });

  it('has no duplicate column inside any one list', () => {
    const dupes = (cols: string[]) => cols.filter((c, i) => cols.indexOf(c) !== i);

    expect(dupes(coreColumns), 'TENANT_CORE_COLUMNS names a column twice.').toEqual([]);
    expect(dupes(inshurColumns), 'TENANT_INSHUR_COLUMNS names a column twice.').toEqual([]);
    expect(dupes(optionalColumns), 'TENANT_OPTIONAL_COLUMNS names a column twice.').toEqual([]);
  });

  it('spells every column in all three lists as a bare identifier', () => {
    // A typo here is a different failure from a missing grant, and the DEPLOY
    // GATE cannot catch it in the same way: an unquoted stray character makes
    // PostgREST reject the select with a 400 before Postgres ever evaluates a
    // privilege. Empty entries (a stray `,,` or a trailing comma) land here too.
    const identifier = /^[a-z_][a-z0-9_]*$/;
    const named: Array<[string, string[]]> = [
      ['TENANT_CORE_COLUMNS', coreColumns],
      ['TENANT_INSHUR_COLUMNS', inshurColumns],
      ['TENANT_OPTIONAL_COLUMNS', optionalColumns],
    ];

    for (const [listName, cols] of named) {
      expect(cols.length, `${listName} is empty.`).toBeGreaterThan(0);

      const bad = cols.filter((c) => !identifier.test(c));
      expect(
        bad,
        `${listName} contains ${bad.length} entr${bad.length === 1 ? 'y' : 'ies'} that is not a ` +
          `bare lower-case Postgres identifier: ${JSON.stringify(bad)}. An empty entry means a ` +
          'stray or doubled comma; a quote, space or dot means a typo. Either way PostgREST 400s ' +
          'the whole select, and no grant check will tell you which column did it.',
      ).toEqual([]);
    }
  });
});

describe(`Turo Sync flag — DEPLOY GATE snapshot (${SQL_PATH})`, () => {
  /**
   * THE DRIFT GUARD. The single most valuable assertion in this file.
   *
   * The DEPLOY GATE is a hand-pasted COPY of TENANT_CORE_COLUMNS, and its whole
   * job is to find the next column that anon cannot read before it ships. A copy
   * that has fallen behind fails silently in both directions:
   *   * missing an entry  -> the gate reports zero rows while a real outage is
   *                          queued behind the next deploy;
   *   * carrying an extra  -> the gate reports a "tenant-wide outage" for a
   *                          column that is designed to be shed, people stop
   *                          believing it, and then it is worth nothing when it
   *                          is finally right. This already happened: the
   *                          snapshot drifted to 58 entries against a real 57.
   * Nobody reviewing a one-line change to TENANT_CORE_COLUMNS thinks to open a
   * .sql file in a PoC directory. This test is what makes them.
   */
  it('matches TENANT_CORE_COLUMNS exactly — same entries, same order', () => {
    // Comments stripped first: the snapshot only guards anything while the gate
    // is a statement Postgres would run. A commented-out gate that still holds a
    // perfectly up-to-date literal is a gate that finds nothing.
    const snapshot = splitColumns(sqlStringLiteralAfter(executableSql, 'string_to_array('));

    const remedy =
      '\n\nHOW TO FIX (do NOT "fix" it by editing this test):\n' +
      `  1. Open ${SQL_PATH}, scroll to the DEPLOY GATE block at the bottom.\n` +
      "  2. Replace the string literal inside string_to_array(...) with the CURRENT value of " +
      `TENANT_CORE_COLUMNS from ${TENANT_CONTEXT_PATH}, verbatim.\n` +
      '  3. Re-run the DEPLOY GATE against production. It must return ZERO rows before the ' +
      'change to TENANT_CORE_COLUMNS ships — any row it returns is a tenant-wide branding and ' +
      'login outage waiting on your deploy.\n' +
      '\nOnly genuine TENANT_CORE_COLUMNS entries belong in the snapshot. The INSHUR columns and ' +
      'TENANT_OPTIONAL_COLUMNS are shed by the 42501 retry by design; listing them makes the ' +
      'gate cry wolf, which is how it drifted to 58 entries against a real 57.\n';

    expect(
      snapshot,
      `The DEPLOY GATE snapshot has drifted from TENANT_CORE_COLUMNS (snapshot ` +
        `${snapshot.length} entries, real list ${coreColumns.length}).${remedy}`,
    ).toEqual(coreColumns);
  });

  it('states the core-column count that TENANT_CORE_COLUMNS actually has', () => {
    // The DEPLOY GATE header records how many core columns were verified as
    // granted. Someone who fixes the drift above by re-pasting the literal will
    // not think to touch the prose, and a stale count is a stale claim about
    // production.
    //
    // This is the ONE assertion that reads `sqlSource` rather than
    // `executableSql`, and deliberately so: the claim IS a comment — a sentence
    // about what was measured against production. Do not "consistently" switch
    // it to the stripped text; there would be nothing left to match.
    const claim = /all\s+(\d+)\s+of\s+them\s+are\s+granted/.exec(sqlSource);

    expect(
      claim,
      `Could not find the "all N of them are granted" claim in ${SQL_PATH}. If that sentence was ` +
        'reworded, re-point this assertion at the new wording rather than dropping it.',
    ).not.toBeNull();

    expect(
      Number(claim![1]),
      `${SQL_PATH} claims ${claim![1]} core columns were verified as granted, but ` +
        `TENANT_CORE_COLUMNS now has ${coreColumns.length}. Update the number AND re-run the ` +
        'DEPLOY GATE — the claim is about production, not about the list.',
    ).toBe(coreColumns.length);
  });
});

describe(`Turo Sync flag — the anon GRANT (${SQL_PATH})`, () => {
  it('grants anon SELECT on the flag, spelled exactly as the column list spells it', () => {
    const granted = anonGrantedColumns();

    expect(
      granted.length,
      `${SQL_PATH} contains no "GRANT SELECT (<column>) ON public.tenants TO anon" statement. ` +
        'That statement is the load-bearing line in the file — without it the tenant row built ' +
        'anonymously on the login page carries no flag, and because this provider fetches once ' +
        'on mount and router.replace() keeps it mounted through sign-in, an operator with Turo ' +
        'Sync ON sees no sidebar entry until their next hard refresh. That reads as a broken ' +
        'toggle.',
    ).toBeGreaterThan(0);

    // Matching on the string lifted from TENANT_OPTIONAL_COLUMNS, not on a
    // literal typed here: a grant for `turo_bridge_enable` would be accepted by
    // Postgres against no column at all and silently do nothing.
    const fromOptional = optionalColumns.find((c) => c === FLAG);
    expect(
      fromOptional,
      `${FLAG} is not in TENANT_OPTIONAL_COLUMNS, so there is nothing for the GRANT to match.`,
    ).toBe(FLAG);

    expect(
      granted,
      `${SQL_PATH} does not grant anon SELECT on '${fromOptional}'. It grants ` +
        `${JSON.stringify(granted)}. A grant naming a column that does not exist is applied ` +
        'happily and does nothing — check the spelling character for character against ' +
        'TENANT_OPTIONAL_COLUMNS.',
    ).toContain(fromOptional);
  });

  it('grants anon nothing that is not a real column in one of the three lists', () => {
    const known = new Set([...coreColumns, ...inshurColumns, ...optionalColumns]);
    const unknown = anonGrantedColumns().filter((c) => !known.has(c));

    expect(
      unknown,
      `${SQL_PATH} grants anon SELECT on ${JSON.stringify(unknown)}, which appear in none of ` +
        'TENANT_CORE_COLUMNS / TENANT_INSHUR_COLUMNS / TENANT_OPTIONAL_COLUMNS. Either the ' +
        'grant is a typo (Postgres will not tell you — it applies against the catalog, and a ' +
        'misspelling simply grants nothing the portal reads), or the column was renamed in ' +
        `${TENANT_CONTEXT_PATH} and the SQL was left behind.`,
    ).toEqual([]);
  });
});
