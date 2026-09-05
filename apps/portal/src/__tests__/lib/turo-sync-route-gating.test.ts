import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import ts from 'typescript';

import { ROUTE_TO_TAB, TAB_KEYS, getTabKeyForRoute } from '@/lib/permissions';
import {
  readPortalSource,
  readEdgeSource,
  liftDeclaration,
  compile,
  compileExpression,
} from '../helpers/edge-source';

/**
 * THE TWO GATES ON TURO SYNC — manager permissions, and the tenant feature flag.
 *
 * They answer different questions and neither substitutes for the other:
 *   ROUTE_TO_TAB['/turo-bridge']  → "may THIS MANAGER see the page?"
 *   tenants.turo_bridge_enabled   → "does THIS TENANT use the feature?"
 *
 * WHY THIS FILE PARSES SOURCE INSTEAD OF RENDERING
 * The flag is read inside React components, and this workspace cannot render
 * them (see helpers/edge-source.ts for the React 18/19 split). Copying the guard
 * into the test would prove only that the copy works, and the copy is exactly
 * what stops tracking the original. So the permission functions are LIFTED from
 * `use-manager-permissions.ts` and executed for real, the route map is IMPORTED
 * for real, and the component guards are asserted on by parsing the shipped file
 * with the TypeScript compiler — structure, never a regex that a comment
 * mentioning "loading" could satisfy.
 *
 * THE FOUR BUGS THESE ASSERTIONS EXIST TO CATCH
 *  1. A route renamed without moving ROUTE_TO_TAB. getTabKeyForRoute() returns
 *     null for an unlisted route and canAccessRoute() treats null as ALLOWED, so
 *     the page silently opens to every manager. The route here is therefore
 *     DERIVED from the filesystem, not typed as a literal.
 *  2. A new tab key instead of reusing 'rentals' — which would then have to be
 *     mirrored into three hardcoded edge-function allow-lists and backfilled.
 *  3. The page guard checking `enabled` before `loading`. `=== true` against an
 *     unresolved tenant is false, so that order shows "Turo Sync is turned off"
 *     to an operator who has it ON, on every hard refresh.
 *  4. A reader switching from `=== true` to truthiness. The column lives in
 *     TENANT_OPTIONAL_COLUMNS precisely so a missing anon GRANT can shed it, so
 *     `undefined` is a real, expected value rather than an error state.
 */

/* ---------------------------------------------------------------------------
 * Derivations — everything below is read out of the shipped code, so a rename
 * turns this file red rather than leaving it passing against a stale literal.
 * ------------------------------------------------------------------------ */

const PORTAL_SRC = resolve(__dirname, '../..');
const DASHBOARD_DIR = resolve(PORTAL_SRC, 'app/(dashboard)');

/**
 * The Turo Sync route, derived from the App Router directory that owns the
 * page — identified by the only thing that cannot be coincidence, its import of
 * the screens in `components/turo-bridge/`.
 *
 * Deriving it is the whole point of bug 1 above: hardcoding '/turo-bridge' here
 * would keep passing after someone renamed the directory, which is the exact
 * moment ROUTE_TO_TAB stops matching and the page opens to everyone.
 */
const turoRouteDirs = readdirSync(DASHBOARD_DIR, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .filter((entry) => {
    const page = resolve(DASHBOARD_DIR, entry.name, 'page.tsx');
    return existsSync(page) && readFileSync(page, 'utf8').includes('@/components/turo-bridge/');
  })
  .map((entry) => entry.name);

const TURO_ROUTE = `/${turoRouteDirs[0] ?? '__no-turo-page-found__'}`;
const TURO_PAGE_REL = `app/(dashboard)${TURO_ROUTE}/page.tsx`;

/** The tenant column, read out of TenantContext's own optional-column list. */
const tenantContextSource = readPortalSource('contexts/TenantContext.tsx');

const columnList = (name: string): string[] =>
  compile<string>([liftDeclaration(tenantContextSource, name, { tsx: true })], name)
    .split(',')
    .map((column) => column.trim())
    .filter(Boolean);

const optionalColumns = columnList('TENANT_OPTIONAL_COLUMNS');
const coreColumns = columnList('TENANT_CORE_COLUMNS');
const TURO_FLAG_COLUMN = optionalColumns.find((column) => column.includes('turo')) ?? '';

/* ---------------------------------------------------------------------------
 * The real permission functions, lifted and made callable.
 * ------------------------------------------------------------------------ */

const permissionsHookSource = readPortalSource('hooks/use-manager-permissions.ts');

type Perm = { tab_key: string; access_level: 'viewer' | 'editor' };

/**
 * `canAccessRoute` closes over `isManager`, `permissions` (via `canView`) and
 * the imported `getTabKeyForRoute`. The first two are genuine runtime inputs and
 * are injected; the third is the REAL function imported from `@/lib/permissions`
 * — not a stand-in — so the route map under test is the shipped one.
 */
const routeGateFor = (isManager: boolean, permissions: Perm[]) =>
  compileExpression<
    (
      isManager: boolean,
      permissions: Perm[],
      getTabKey: (pathname: string) => string | null,
    ) => (pathname: string) => boolean
  >(
    ['isManager', 'permissions', 'getTabKeyForRoute'],
    [
      liftDeclaration(permissionsHookSource, 'canView'),
      liftDeclaration(permissionsHookSource, 'canAccessRoute'),
    ],
    'canAccessRoute',
  )(isManager, permissions, getTabKeyForRoute);

const viewerOn = (...tabs: string[]): Perm[] =>
  tabs.map((tab_key) => ({ tab_key, access_level: 'viewer' as const }));
const editorOn = (...tabs: string[]): Perm[] =>
  tabs.map((tab_key) => ({ tab_key, access_level: 'editor' as const }));

/** The hardcoded allow-lists the edge functions validate incoming grants against. */
const edgeAllowedTabKeys = (fn: string): string[] =>
  compile<string[]>(
    [liftDeclaration(readEdgeSource(`${fn}/index.ts`), 'ALLOWED_TAB_KEYS')],
    'ALLOWED_TAB_KEYS',
  );

/* ---------------------------------------------------------------------------
 * AST helpers — assertions on structure, so prose about the code cannot satisfy
 * them and a reordering cannot slip past.
 * ------------------------------------------------------------------------ */

const parseTsx = (source: string, name: string): ts.SourceFile =>
  ts.createSourceFile(name, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

const identifiersIn = (node: ts.Node): Set<string> => {
  const found = new Set<string>();
  const walk = (n: ts.Node): void => {
    if (ts.isIdentifier(n)) found.add(n.text);
    ts.forEachChild(n, walk);
  };
  walk(node);
  return found;
};

const hookCallsIn = (node: ts.Node): string[] => {
  const calls: string[] = [];
  const walk = (n: ts.Node): void => {
    if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && /^use[A-Z]/.test(n.expression.text)) {
      calls.push(n.expression.text);
    }
    ts.forEachChild(n, walk);
  };
  walk(node);
  return calls;
};

const jsxTagOf = (expression: ts.Expression | undefined): string | null => {
  if (!expression) return null;
  if (ts.isJsxSelfClosingElement(expression)) return expression.tagName.getText();
  if (ts.isJsxElement(expression)) return expression.openingElement.tagName.getText();
  return null;
};

/** The component named by the first `return <Something />` inside `node`. */
const returnedComponent = (node: ts.Node): string | null => {
  const tags: string[] = [];
  const walk = (n: ts.Node): void => {
    if (tags.length) return;
    if (ts.isReturnStatement(n)) {
      const tag = jsxTagOf(n.expression);
      if (tag) tags.push(tag);
    }
    ts.forEachChild(n, walk);
  };
  walk(node);
  return tags.length ? tags[0] : null;
};

/** Every `x.<column>` / `x?.<column>` READ in a file (writes and strings excluded). */
const flagReadsIn = (sourceFile: ts.SourceFile, column: string): ts.PropertyAccessExpression[] => {
  const reads: ts.PropertyAccessExpression[] = [];
  const walk = (n: ts.Node): void => {
    if (ts.isPropertyAccessExpression(n) && n.name.text === column) reads.push(n);
    ts.forEachChild(n, walk);
  };
  walk(sourceFile);
  return reads;
};

const isStrictTrueComparison = (read: ts.PropertyAccessExpression): boolean => {
  const parent = read.parent;
  return (
    !!parent &&
    ts.isBinaryExpression(parent) &&
    parent.left === read &&
    parent.operatorToken.kind === ts.SyntaxKind.EqualsEqualsEqualsToken &&
    parent.right.kind === ts.SyntaxKind.TrueKeyword
  );
};

const functionNamed = (sourceFile: ts.SourceFile, name: string): ts.FunctionDeclaration | null => {
  const match = sourceFile.statements.find(
    (statement) => ts.isFunctionDeclaration(statement) && statement.name?.text === name,
  );
  return match ? (match as ts.FunctionDeclaration) : null;
};

/* ---------------------------------------------------------------------------
 * The parsed pages.
 * ------------------------------------------------------------------------ */

const pageSource = readPortalSource(TURO_PAGE_REL);
const pageFile = parseTsx(pageSource, 'turo-bridge-page.tsx');

const sidebarSource = readPortalSource('components/shared/layout/app-sidebar.tsx');
const sidebarFile = parseTsx(sidebarSource, 'app-sidebar.tsx');

const settingsSource = readPortalSource('app/(dashboard)/settings/page.tsx');
const settingsFile = parseTsx(settingsSource, 'settings-page.tsx');

const defaultExport = (() => {
  const match = pageFile.statements.find(
    (statement) =>
      ts.isFunctionDeclaration(statement) &&
      ts.canHaveModifiers(statement) &&
      (ts.getModifiers(statement) ?? []).some((m) => m.kind === ts.SyntaxKind.DefaultKeyword),
  );
  return match ? (match as ts.FunctionDeclaration) : null;
})();

const guardStatements: ts.Statement[] =
  defaultExport && defaultExport.body ? [...defaultExport.body.statements] : [];

/* =========================================================================
 * A. THE MANAGER GATE — ROUTE_TO_TAB
 * ====================================================================== */

describe('gate 1: ROUTE_TO_TAB maps the Turo Sync route to a manager tab', () => {
  it('resolves exactly one App Router directory as the Turo Sync page', () => {
    // If this fails the derivations below are pointing at the wrong file, and
    // every assertion in this suite is worthless — so it is checked first.
    expect(turoRouteDirs).toHaveLength(1);

    // The sidebar has to link at the directory that actually exists. This is
    // NOT a restatement of the filter above (asserting `pageSource` contains
    // the import would be — that string is what selected the directory, so it
    // could never fail): the href is a separate literal in a separate file, and
    // a rename that moves the page without moving it leaves every operator a
    // nav entry that 404s.
    const sidebarTuroRoutes = new Set<string>();
    const collectRoutes = (node: ts.Node): void => {
      if (ts.isStringLiteral(node) && node.text.startsWith('/turo')) sidebarTuroRoutes.add(node.text);
      ts.forEachChild(node, collectRoutes);
    };
    collectRoutes(sidebarFile);
    expect([...sidebarTuroRoutes]).toEqual([TURO_ROUTE]);
  });

  it("maps the route to 'rentals'", () => {
    // The route is derived from the directory name, so renaming the directory
    // without moving this entry fails here instead of silently opening the page.
    expect(ROUTE_TO_TAB[TURO_ROUTE]).toBe('rentals');
  });

  it('engages: getTabKeyForRoute returns the tab key rather than null for the route', () => {
    expect(getTabKeyForRoute(TURO_ROUTE)).toBe('rentals');
    // …and for nested routes under it, via the prefix rule.
    expect(getTabKeyForRoute(`${TURO_ROUTE}/mappings`)).toBe('rentals');
  });

  it("reuses an existing tab key, so no new key has to be mirrored anywhere", () => {
    const tabKey = ROUTE_TO_TAB[TURO_ROUTE];
    expect((TAB_KEYS as readonly string[]).includes(tabKey)).toBe(true);
    // The three edge functions each carry their OWN hardcoded copy of the
    // allow-list. A brand-new key would be rejected by all three until every
    // copy was edited and existing managers backfilled; 'rentals' is already in
    // each of them, which is the entire reason for reusing it.
    for (const fn of ['update-manager-permissions', 'admin-create-user', 'admin-update-role']) {
      expect(edgeAllowedTabKeys(fn), `${fn} allow-list`).toContain(tabKey);
    }
  });
});

describe('gate 1: the real canAccessRoute, executed', () => {
  it('refuses a manager who does not hold the rentals grant', () => {
    expect(routeGateFor(true, [])(TURO_ROUTE)).toBe(false);
    expect(routeGateFor(true, viewerOn('vehicles', 'customers'))(TURO_ROUTE)).toBe(false);
  });

  it('allows a manager who holds the rentals grant, at either access level', () => {
    expect(routeGateFor(true, viewerOn('rentals'))(TURO_ROUTE)).toBe(true);
    expect(routeGateFor(true, editorOn('rentals'))(TURO_ROUTE)).toBe(true);
  });

  it('applies the same answer to nested routes under it', () => {
    expect(routeGateFor(true, [])(`${TURO_ROUTE}/mappings`)).toBe(false);
    expect(routeGateFor(true, viewerOn('rentals'))(`${TURO_ROUTE}/mappings`)).toBe(true);
  });

  it('leaves non-managers alone', () => {
    // head_admin / admin / ops never carry permission rows; the gate is a no-op.
    expect(routeGateFor(false, [])(TURO_ROUTE)).toBe(true);

    // …and on the routes canAccessRoute refuses BEFORE it ever consults a
    // grant. This second assertion is the one with teeth: on the line above,
    // `canView` carries its own `if (!isManager) return true`, so the answer
    // stays true even if canAccessRoute's own non-manager exemption is deleted.
    // The hardcoded `/users` refusal sits above that call, so only the
    // exemption at the top of canAccessRoute keeps a head_admin out of it —
    // delete that line and user management shuts on every admin on the
    // platform, which is exactly the regression this test claims to catch.
    expect(routeGateFor(false, [])('/users')).toBe(true);
  });

  it('is the shipped function, not a stub: /users stays closed to a fully granted manager', () => {
    expect(routeGateFor(true, editorOn('rentals', 'settings'))('/users')).toBe(false);
  });

  it('THE TRAP: an unmapped route returns null and null is treated as ALLOWED', () => {
    // This is why the ROUTE_TO_TAB line is load-bearing rather than decorative.
    // The gate FAILS OPEN. Delete the '/turo-bridge' entry — or rename the route
    // directory and forget to move it — and the page below is reachable by every
    // manager on the platform, whatever their grants say.
    const unmapped = `${TURO_ROUTE}-renamed-and-not-remapped`;
    expect(getTabKeyForRoute(unmapped)).toBeNull();
    expect(routeGateFor(true, [])(unmapped)).toBe(true);

    // Same manager, same empty grants — the ONLY difference is the mapping.
    expect(routeGateFor(true, [])(TURO_ROUTE)).toBe(false);
  });
});

/* =========================================================================
 * B. THE TENANT GATE — the route guard in the page's default export
 * ====================================================================== */

describe('gate 2: the Turo Sync page guard', () => {
  it('exists as a default-exported function', () => {
    expect(defaultExport).not.toBeNull();
    expect(guardStatements.length).toBeGreaterThan(0);
  });

  it('reads BOTH `loading` and the tenant from useTenant()', () => {
    const bound: string[] = [];
    for (const statement of guardStatements) {
      if (!ts.isVariableStatement(statement)) continue;
      for (const declaration of statement.declarationList.declarations) {
        const init = declaration.initializer;
        const isUseTenant =
          !!init &&
          ts.isCallExpression(init) &&
          ts.isIdentifier(init.expression) &&
          init.expression.text === 'useTenant';
        if (!isUseTenant || !ts.isObjectBindingPattern(declaration.name)) continue;
        for (const element of declaration.name.elements) {
          if (ts.isIdentifier(element.name)) bound.push(element.name.text);
        }
      }
    }
    // Without `loading` in this list there is nothing to branch on, and the
    // guard cannot tell "switched off" apart from "not resolved yet".
    expect(bound).toContain('loading');
    expect(bound).toContain('tenant');
  });

  it('derives the flag with `=== true`, never truthiness', () => {
    const enabledDeclarations = guardStatements
      .filter(ts.isVariableStatement)
      .flatMap((statement) => [...statement.declarationList.declarations])
      .filter((declaration) => ts.isIdentifier(declaration.name) && declaration.name.text === 'enabled');

    expect(enabledDeclarations).toHaveLength(1);
    const initializer = enabledDeclarations[0].initializer;
    expect(initializer && ts.isBinaryExpression(initializer)).toBe(true);

    const comparison = initializer as ts.BinaryExpression;
    expect(comparison.operatorToken.kind).toBe(ts.SyntaxKind.EqualsEqualsEqualsToken);
    expect(comparison.right.kind).toBe(ts.SyntaxKind.TrueKeyword);
    expect(ts.isPropertyAccessExpression(comparison.left)).toBe(true);
    expect((comparison.left as ts.PropertyAccessExpression).name.text).toBe(TURO_FLAG_COLUMN);
  });

  it('THE ONE THAT MATTERS: the `loading` branch comes BEFORE the `!enabled` branch', () => {
    const loadingIndex = guardStatements.findIndex(
      (statement) => ts.isIfStatement(statement) && identifiersIn(statement.expression).has('loading'),
    );
    const enabledIndex = guardStatements.findIndex(
      (statement) => ts.isIfStatement(statement) && identifiersIn(statement.expression).has('enabled'),
    );
    const screenIndex = guardStatements.findIndex(
      (statement) => ts.isReturnStatement(statement) && jsxTagOf(statement.expression) !== null,
    );

    expect(loadingIndex, 'no branch on `loading`').toBeGreaterThanOrEqual(0);
    expect(enabledIndex, 'no branch on `enabled`').toBeGreaterThanOrEqual(0);
    expect(screenIndex, 'the screen is never returned').toBeGreaterThanOrEqual(0);

    // Swap these two and every operator who has Turo Sync switched ON is shown
    // "Turo Sync is turned off" on each hard refresh, because `=== true` against
    // a tenant that has not resolved yet is false. Fold them into one
    // `if (loading || !enabled)` and the indices collide, which also fails here.
    expect(loadingIndex).toBeLessThan(enabledIndex);
    expect(enabledIndex).toBeLessThan(screenIndex);
  });

  it('the loading branch does not reach for the off-screen, and does not consult the flag', () => {
    const loadingBranch = guardStatements.find(
      (statement) => ts.isIfStatement(statement) && identifiersIn(statement.expression).has('loading'),
    ) as ts.IfStatement;
    const offBranch = guardStatements.find(
      (statement) => ts.isIfStatement(statement) && identifiersIn(statement.expression).has('enabled'),
    ) as ts.IfStatement;

    // The condition is `loading` alone — an unresolved tenant is not evidence
    // about the flag either way.
    expect(identifiersIn(loadingBranch.expression).has('enabled')).toBe(false);

    const whileLoading = returnedComponent(loadingBranch.thenStatement);
    const whenOff = returnedComponent(offBranch.thenStatement);
    expect(whileLoading).not.toBeNull();
    expect(whenOff).not.toBeNull();
    // Distinct components, because they say opposite things to the operator:
    // "still checking" versus "someone switched this off".
    expect(whileLoading).not.toBe(whenOff);
  });

  it('WRAPS the screen rather than early-returning inside it', () => {
    const screenReturn = guardStatements.find(
      (statement) => ts.isReturnStatement(statement) && jsxTagOf(statement.expression) !== null,
    ) as ts.ReturnStatement;
    const screenName = jsxTagOf(screenReturn.expression);
    expect(screenName).not.toBeNull();

    // The guard itself may consult the tenant and nothing else.
    expect(hookCallsIn(defaultExport as ts.Node)).toEqual(['useTenant']);

    // The screen is a separate component…
    const screen = functionNamed(pageFile, screenName as string);
    expect(screen, `${screenName} is not declared in this file`).not.toBeNull();

    // …and it calls hooks — state plus its data queries. That is the whole
    // reason the guard has to wrap it: an early return inside this function
    // would either break hook order the moment the flag flipped, or fire the
    // RLS-scoped queries for a tenant who has the feature switched off.
    const screenHooks = hookCallsIn(screen as ts.Node);
    expect(screenHooks).toContain('useState');
    expect(screenHooks.length).toBeGreaterThan(2);
  });
});

/* =========================================================================
 * C. THE FLAG COLUMN — one spelling, one comparison, four sites
 * ====================================================================== */

describe('gate 2: the flag column is spelled and compared identically everywhere', () => {
  it('is carried in TENANT_OPTIONAL_COLUMNS and kept out of TENANT_CORE_COLUMNS', () => {
    // Not a style preference. `anon` holds COLUMN-level grants on `tenants` and
    // no table grant, and Postgres refuses the whole ROW (42501) when any
    // selected column is ungranted — so a flag promoted into the core list
    // before its GRANT lands takes branding and login down for every tenant at
    // once. It has happened here, with customer_theme_mode.
    expect(optionalColumns).toContain('turo_bridge_enabled');
    expect(coreColumns).not.toContain('turo_bridge_enabled');
    // Exactly one Turo flag, so the name derived above is unambiguous.
    expect(optionalColumns.filter((column) => column.includes('turo'))).toHaveLength(1);
    expect(TURO_FLAG_COLUMN).toBe('turo_bridge_enabled');
  });

  it.each([
    ['the route guard', () => pageFile],
    ['the sidebar entry', () => sidebarFile],
    ['the settings toggle', () => settingsFile],
  ])('%s reads the column by that exact name, with `=== true`', (_label, getFile) => {
    const reads = flagReadsIn(getFile(), TURO_FLAG_COLUMN);

    // Byte-identical to the name TenantContext selects. A camelCased or
    // renamed read compiles fine and is simply always undefined.
    expect(reads.length).toBeGreaterThan(0);

    // `=== true` at every single read, because the column is sheddable by
    // design: on the anon login path an ungranted column is dropped rather than
    // failing the row, so `undefined` is a real and expected value. Truthiness
    // would still read false there — but it also silently accepts anything
    // else the column could ever come back as, which is how a boolean flag
    // starts behaving differently in two of the three places that read it.
    for (const read of reads) {
      expect(isStrictTrueComparison(read), `not compared with === true: ${read.getText()}`).toBe(true);
    }
  });
});
