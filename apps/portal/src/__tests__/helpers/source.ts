/**
 * Read a module-scope constant out of an app source file and make it callable.
 *
 * Why not just import the module? The deposit-hold work lives in React
 * components, and this workspace cannot render them: apps/portal pins React
 * 18.3.1 while the monorepo root hoists React 19 for admin/web, so every
 * root-hoisted UI package (@radix-ui/*, lucide-react, @tanstack/react-query,
 * react-hook-form) resolves `react` to the root copy and hands React-19 element
 * objects to portal's React-18 renderer ("Objects are not valid as a React
 * child"). Importing the component therefore explodes before a single assertion
 * runs. See the note in docs/GMT_GATE0_TEST_PLAN.md for the one-line fix.
 *
 * Until that is fixed, the pure helpers those components define at module scope
 * are still worth exercising for real — so we lift the actual source text and
 * compile it, rather than copying the implementation into the test and proving
 * only that the copy works.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import ts from 'typescript';

const SRC_ROOT = resolve(__dirname, '../..');

export const readAppSource = (relPath: string): string =>
  readFileSync(resolve(SRC_ROOT, relPath), 'utf8');

/**
 * Slice `const <name> = … };` out of a source file. Module-scope declarations in
 * this codebase all terminate on a column-0 `};`.
 */
export function sliceModuleConst(source: string, name: string): string {
  // `const foo =`, `const foo: Type =` and `const foo = (` all have to match.
  const start = source.search(new RegExp(`^const ${name}\\b`, 'm'));
  if (start === -1) throw new Error(`const ${name} not found`);
  const end = source.indexOf('\n};', start);
  if (end === -1) throw new Error(`Could not find the end of ${name}`);
  return source.slice(start, end + 3);
}

/** Compile one or more sliced declarations and hand back the last one named. */
export function evalModuleConsts<T>(snippets: string[], returns: string): T {
  const js = ts.transpileModule(snippets.join('\n'), {
    compilerOptions: { target: ts.ScriptTarget.ES2020 },
  }).outputText;
  // eslint-disable-next-line no-new-func
  return new Function(`${js}; return ${returns};`)() as T;
}
