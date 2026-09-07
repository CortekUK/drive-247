/**
 * Lift real declarations out of source files — including the Deno edge
 * functions — and make them callable under Vitest.
 *
 * WHY THIS EXISTS
 * The deposit-hold engine lives in `supabase/functions/**`, which is Deno: the
 * modules import from `https://esm.sh/...` and are transitively pulled in by
 * `_shared/stripe-client.ts`, so Vitest cannot `import` any of them. The
 * temptation is to paste the logic into the test and assert on the paste — but
 * that proves only that the paste works, and the paste is exactly what stops
 * tracking the original.
 *
 * So instead: parse the real file with the TypeScript compiler, pull out the
 * EXACT source text of the named declaration, compile that text, and call it.
 * The function under test IS the shipped function. If someone edits it, this
 * suite sees the edit; if someone deletes or renames it, the lift throws and
 * the suite goes red rather than silently passing against a stale copy.
 *
 * `helpers/source.ts` does the same thing for module-scope consts inside
 * apps/portal. This file generalises it:
 *   * any repo file, not just `apps/portal/src`
 *   * `function` / `async function` declarations, not only `const`
 *   * declarations nested INSIDE a component body (`chargeAmount` and friends
 *     are computed inside `AddPaymentDialog`, not at module scope)
 *   * `.tsx`, parsed as TSX
 *
 * WHAT IT CANNOT DO
 * A lifted declaration is compiled on its own, so anything it references has to
 * be lifted alongside it (`compile([...], 'name')` takes a list) or injected as
 * a parameter (`compileExpression`). Where a decision is spread across a
 * function body rather than living in a named declaration — `recordFailure`'s
 * status ladder, for instance — the test says so explicitly and pins the real
 * code with source assertions instead of pretending to execute it.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import ts from 'typescript';

/** apps/portal/src/__tests__/helpers -> the monorepo root. */
const REPO_ROOT = resolve(__dirname, '../../../../..');
const PORTAL_SRC = resolve(__dirname, '../..');

/**
 * Line endings are normalised to LF on every read, and that is load-bearing
 * rather than tidiness.
 *
 * These suites assert on SOURCE TEXT, so they are reading whatever git handed
 * the checkout. `core.autocrlf` gives a Windows working tree CRLF for the same
 * commit a Linux checkout gets as LF, and two kinds of assertion then fail on
 * one machine and pass on the other for the same code:
 *
 *   * a newline written literally in the pattern — `indexOf("  payments_ready\n")`
 *     never matches `payments_ready\r\n`, so it returns -1 and reads as
 *     "the column is missing" when the column is right there;
 *   * any fixed-width window — `slice(0, 900)` buys ~20 fewer characters of
 *     code once every line costs an extra byte, so a match that sits near the
 *     end of the window falls out of it.
 *
 * Both were live: two Square suites failed on a Windows checkout against source
 * that was correct. Normalising here fixes every caller at once and cannot
 * weaken an assertion — no test in this repo asserts on a carriage return, and
 * a CR is not part of any pattern being matched.
 */
const toLf = (source: string): string => source.replace(/\r\n/g, '\n');

/** Read a file by its path relative to the monorepo root. */
export const readRepoSource = (relPath: string): string =>
  toLf(readFileSync(resolve(REPO_ROOT, relPath), 'utf8'));

/** Read a Supabase edge-function file, e.g. `_shared/deposit-hold-refresh.ts`. */
export const readEdgeSource = (relPath: string): string =>
  readRepoSource(`supabase/functions/${relPath}`);

/** Read an apps/portal file, e.g. `components/shared/dialogs/add-payment-dialog.tsx`. */
export const readPortalSource = (relPath: string): string =>
  toLf(readFileSync(resolve(PORTAL_SRC, relPath), 'utf8'));

const parse = (source: string, isTsx: boolean): ts.SourceFile =>
  ts.createSourceFile(
    isTsx ? 'lifted.tsx' : 'lifted.ts',
    source,
    ts.ScriptTarget.Latest,
    true,
    isTsx ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );

/**
 * The exact source text of the declaration called `name`, wherever it sits —
 * module scope or nested inside a function/component body.
 *
 * Returns a standalone statement: `const x = …;` or `function f(…) {…}`, with
 * any `export` modifier stripped so the text can be compiled in isolation.
 */
export function liftDeclaration(source: string, name: string, opts: { tsx?: boolean } = {}): string {
  const sf = parse(source, opts.tsx ?? false);
  let found: string | null = null;

  const visit = (node: ts.Node): void => {
    if (found) return;
    if (
      (ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node)) &&
      node.name?.getText(sf) === name
    ) {
      found = node.getText(sf);
      return;
    }
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === name) {
      // `getText()` on the declaration omits the `const`/`let` keyword and the
      // trailing `;`, so put them back — the caller needs a valid statement.
      found = `const ${node.getText(sf)};`;
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);

  if (found === null) {
    throw new Error(
      `Could not find a declaration named '${name}'. It was renamed, deleted or inlined — ` +
        'update the test to match the code it is guarding rather than deleting the assertion.',
    );
  }
  return String(found).replace(/^export\s+/, '');
}

/**
 * The same, for a member of an object literal — `hasRole: (role) => {…}` inside
 * the Zustand store, which is neither a function declaration nor a variable.
 * Returned as `const <name> = <initializer>;` so it composes with `compile`.
 */
export function liftProperty(source: string, name: string, opts: { tsx?: boolean } = {}): string {
  const sf = parse(source, opts.tsx ?? false);
  let found: string | null = null;

  const visit = (node: ts.Node): void => {
    if (found) return;
    if (
      ts.isPropertyAssignment(node) &&
      (ts.isIdentifier(node.name) || ts.isStringLiteral(node.name)) &&
      node.name.text === name
    ) {
      found = `const ${name} = ${node.initializer.getText(sf)};`;
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);

  if (found === null) {
    throw new Error(
      `Could not find an object property named '${name}'. It was renamed, deleted or moved — ` +
        'update the test to match the code it is guarding rather than deleting the assertion.',
    );
  }
  return found;
}

/** Transpile a bundle of lifted declarations and hand back the one named. */
export function compile<T>(snippets: string[], returns: string): T {
  const js = ts.transpileModule(snippets.join('\n\n'), {
    compilerOptions: { target: ts.ScriptTarget.ES2020 },
  }).outputText;
  // eslint-disable-next-line no-new-func
  return new Function(`${js}\nreturn ${returns};`)() as T;
}

/**
 * Compile lifted declarations that reference things we do not want to lift
 * (React state, props, hook results) by turning those into parameters.
 *
 * Used for the decisions computed INSIDE a component body — the charge amount,
 * the charge intent, the manual-verification permission — where the expression
 * is the real one but its inputs have to be supplied.
 */
export function compileExpression<T extends (...args: never[]) => unknown>(
  params: string[],
  snippets: string[],
  returns: string,
): T {
  const js = ts.transpileModule(snippets.join('\n'), {
    compilerOptions: { target: ts.ScriptTarget.ES2020 },
  }).outputText;
  // eslint-disable-next-line no-new-func
  return new Function(...params, `${js}\nreturn ${returns};`) as T;
}

/** Strip comments so an assertion cannot be satisfied by prose ABOUT the code. */
export const codeOnly = (s: string): string =>
  s
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
