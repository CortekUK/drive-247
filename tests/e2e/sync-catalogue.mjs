/**
 * Mirror the E2E scenario catalogue into the e2e-runner edge function.
 *
 *   node tests/e2e/sync-catalogue.mjs          copy, delete stale copies
 *   node tests/e2e/sync-catalogue.mjs --check  exit 1 if the mirror differs
 *
 * The ONE catalogue is tests/e2e/scenarios/*.ts. The runner is a Deno edge
 * function, and `supabase functions deploy` bundles what sits under
 * supabase/functions/ (the way every function reaches ../_shared/), so it
 * carries a byte-identical copy in supabase/functions/e2e-runner/catalogue/.
 * The copy is generated, never edited: tests/e2e/catalogue-sync.test.ts fails
 * the moment the two differ — the same arrangement as the payment-plans
 * portal mirror (scripts/sync-payment-plans.mjs).
 *
 * Copying byte-identically only works because every catalogue file obeys
 * three rules, enforced here before anything is written:
 *   - HEADER: the leading comment names the canonical copy;
 *   - IMPORTS: only relative `./x.ts` siblings — no npm:, jsr:, URL, bare or
 *     `@/` specifiers, no dynamic import();
 *   - RUNTIME: no `Deno.`, `process.` or `window.` in code.
 */
import { readdir, readFile, writeFile, mkdir, unlink } from "node:fs/promises";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve, dirname, join } from "node:path";
import ts from "typescript";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
export const CANONICAL_DIR = resolve(root, "tests/e2e/scenarios");
export const MIRROR_DIR = resolve(root, "supabase/functions/e2e-runner/catalogue");
export const HEADER_MARKER = "Canonical copy: tests/e2e/scenarios/";

const RELATIVE_SIBLING = /^\.\/[A-Za-z0-9_.-]+\.ts$/;
const FORBIDDEN_GLOBALS = new Set(["Deno", "process", "window"]);

/** Every rule violation in one file's source, as "file:line: message". */
export function checkSource(name, source) {
  const problems = [];
  const end = source.indexOf("*/");
  const head = end === -1 ? "" : source.slice(0, end);
  if (!head.includes(HEADER_MARKER)) problems.push(`${name}:1: missing the canonical-copy header ("${HEADER_MARKER}")`);
  const sf = ts.createSourceFile(name, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const lineOf = (node) => sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
  const visit = (node) => {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      const spec = node.moduleSpecifier.text;
      if (!RELATIVE_SIBLING.test(spec)) problems.push(`${name}:${lineOf(node)}: import "${spec}" is not a relative ./x.ts sibling`);
    }
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) problems.push(`${name}:${lineOf(node)}: dynamic import() is not allowed`);
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
  return (await readdir(dir, { withFileTypes: true })).filter((e) => e.isFile() && e.name.endsWith(".ts")).map((e) => e.name).sort();
}

export async function synchronize(check = false) {
  const names = await listTs(CANONICAL_DIR);
  if (names.length === 0) throw new Error(`No .ts files in ${CANONICAL_DIR}`);
  const problems = [];
  const sources = new Map();
  for (const n of names) {
    const src = await readFile(join(CANONICAL_DIR, n), "utf8");
    sources.set(n, src);
    problems.push(...checkSource(n, src));
  }
  if (problems.length) {
    const e = new Error(`catalogue files break the mirror rules:\n  ${problems.join("\n  ")}`);
    e.problems = problems;
    throw e;
  }
  const mirror = await listTs(MIRROR_DIR);
  const stale = mirror.filter((n) => !sources.has(n));
  const differing = [];
  for (const [n, src] of sources) {
    const target = join(MIRROR_DIR, n);
    const cur = existsSync(target) ? await readFile(target, "utf8") : null;
    if (cur !== src) differing.push(n);
  }
  if (check) return { differing, stale };
  await mkdir(MIRROR_DIR, { recursive: true });
  for (const n of differing) await writeFile(join(MIRROR_DIR, n), sources.get(n));
  for (const n of stale) await unlink(join(MIRROR_DIR, n));
  return { differing, stale };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const check = process.argv.includes("--check");
  synchronize(check)
    .then(({ differing, stale }) => {
      if (check) {
        if (differing.length || stale.length) {
          console.error(`catalogue mirror is out of date — differing: [${differing.join(", ")}], stale: [${stale.join(", ")}]. Run: node tests/e2e/sync-catalogue.mjs`);
          process.exit(1);
        }
        console.log("catalogue mirror is in sync");
      } else {
        console.log(`mirrored ${differing.length} file(s), removed ${stale.length} stale`);
      }
    })
    .catch((e) => {
      console.error(e.message);
      process.exit(1);
    });
}
