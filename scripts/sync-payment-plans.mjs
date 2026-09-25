/**
 * Mirror the payment-plans core into the portal. --check never writes.
 *
 *   node scripts/sync-payment-plans.mjs          copy, delete stale copies
 *   node scripts/sync-payment-plans.mjs --check  exit 1 if the mirror differs
 *
 * The canonical files live in supabase/functions/_shared/payment-plans/ (Deno
 * edge functions import them there). The portal — the plan form's preview, the
 * plan card, the /dev simulator — needs the SAME engine, byte for byte, so the
 * preview can never show a schedule the server would not store and the
 * simulator can never pass a scenario the cron would fail. So the portal copy
 * is generated, never edited, and apps/portal/src/__tests__/lib/
 * payment-plans-sync.test.ts fails the moment the two differ.
 *
 * Copying byte-identically only works because every file obeys the rules at
 * the top of types.ts. This script enforces them before it copies anything:
 *   - HEADER: each file says where its canonical copy lives (the
 *     "Canonical copy: supabase/functions/_shared/payment-plans/" line, or
 *     types.ts's KEEP-IN-SYNC block), so nobody edits the mirror by mistake;
 *   - IMPORTS: only relative `./x.ts` imports of siblings — no npm:, jsr:,
 *     URL, bare or `@/` specifiers, no dynamic import();
 *   - RUNTIME: no `Deno.`, `process.` or `window.` in code (comments may name
 *     them), because the same file runs in Deno, Next/browser and Node.
 * A violation stops the sync with the file and line, and nothing is written.
 */
import { readdir, readFile, writeFile, mkdir, unlink } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve, dirname, join } from 'node:path';
import ts from 'typescript';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const CANONICAL_DIR = resolve(root, 'supabase/functions/_shared/payment-plans');
export const MIRROR_DIR = resolve(root, 'apps/portal/src/lib/payment-plans');

const HEADER_MARKERS = ['Canonical copy: supabase/functions/_shared/payment-plans/', 'KEEP-IN-SYNC'];
const RELATIVE_SIBLING = /^\.\/[A-Za-z0-9_.-]+\.ts$/;
const FORBIDDEN_GLOBALS = new Set(['Deno', 'process', 'window']);

/** Every rule violation in one file's source, as "file:line: message". */
export function checkSource(name, source) {
  const problems = [];
  // The header is the file's leading block comment.
  const end = source.indexOf('*/');
  const head = end === -1 ? '' : source.slice(0, end);
  if (!HEADER_MARKERS.some((m) => head.includes(m))) {
    problems.push(`${name}:1: missing the canonical-copy header ("${HEADER_MARKERS[0]}")`);
  }
  const sf = ts.createSourceFile(name, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const lineOf = (node) => sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
  const visit = (node) => {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      const spec = node.moduleSpecifier.text;
      if (!RELATIVE_SIBLING.test(spec)) problems.push(`${name}:${lineOf(node)}: import "${spec}" is not a relative ./x.ts sibling`);
    }
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      problems.push(`${name}:${lineOf(node)}: dynamic import() is not allowed`);
    }
    if (ts.isImportEqualsDeclaration(node)) problems.push(`${name}:${lineOf(node)}: import = require() is not allowed`);
    if (ts.isPropertyAccessExpression(node) && ts.isIdentifier(node.expression) && FORBIDDEN_GLOBALS.has(node.expression.text)) {
      problems.push(`${name}:${lineOf(node)}: ${node.expression.text}.* does not exist in every runtime this file runs in`);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return problems;
}

async function listTs(dir) {
  if (!existsSync(dir)) return [];
  return (await readdir(dir, { withFileTypes: true }))
    .filter((e) => e.isFile() && e.name.endsWith('.ts'))
    .map((e) => e.name)
    .sort();
}

export async function synchronize(check = false) {
  const names = await listTs(CANONICAL_DIR);
  if (names.length === 0) throw new Error(`No .ts files in ${CANONICAL_DIR}`);

  const sources = new Map();
  const problems = [];
  for (const name of names) {
    const source = await readFile(join(CANONICAL_DIR, name));
    sources.set(name, source);
    problems.push(...checkSource(name, source.toString('utf8')));
  }
  if (problems.length > 0) {
    throw new Error(`payment-plans rules broken — nothing was synced:\n  ${problems.join('\n  ')}`);
  }

  const mirrored = await listTs(MIRROR_DIR);
  const stale = mirrored.filter((n) => !sources.has(n));
  const differing = [];
  for (const [name, source] of sources) {
    const target = join(MIRROR_DIR, name);
    const current = existsSync(target) ? await readFile(target) : null;
    if (!current || !current.equals(source)) differing.push(name);
  }

  if (check) {
    if (differing.length || stale.length) {
      throw new Error(
        `apps/portal/src/lib/payment-plans is out of date (${[...differing.map((n) => `${n} differs`), ...stale.map((n) => `${n} is stale`)].join(', ')}). ` +
          'Run: node scripts/sync-payment-plans.mjs',
      );
    }
    return { written: [], deleted: [] };
  }

  await mkdir(MIRROR_DIR, { recursive: true });
  for (const name of differing) await writeFile(join(MIRROR_DIR, name), sources.get(name));
  for (const name of stale) await unlink(join(MIRROR_DIR, name));
  return { written: differing, deleted: stale };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const check = process.argv.includes('--check');
  synchronize(check).then(
    ({ written, deleted }) => {
      if (check) console.log('apps/portal/src/lib/payment-plans matches the canonical files.');
      else console.log(`payment-plans synced: ${written.length} written${written.length ? ` (${written.join(', ')})` : ''}, ${deleted.length} deleted${deleted.length ? ` (${deleted.join(', ')})` : ''}.`);
    },
    (error) => {
      console.error(error.message);
      process.exitCode = 1;
    },
  );
}
