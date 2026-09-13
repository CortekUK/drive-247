/** Reproduce the Deno copies from their portal sources. --check never writes. */
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';
import ts from 'typescript';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = async (path) => (await readFile(resolve(root, path), 'utf8')).replace(/\r\n/g, '\n');
const line = '// ============================================================================\n';
const quoteHeader = `${line}// GENERATED FILE — DO NOT EDIT.\n//\n// Produced by scripts/sync-fleet-quote.mjs from\n//   apps/portal/src/lib/fleet-quote.ts\n// Everything below the prologue is byte-identical to that file. Edit the portal\n// copy and re-run the generator; a hand-edit here will be silently overwritten\n// and will make the API disagree with the operator's Fleet Quotes screen.\n${line}`;
const priceHeader = `${line}// GENERATED FILE — DO NOT EDIT.\n//\n// Produced by scripts/sync-fleet-quote.mjs from\n//   apps/portal/src/lib/calculate-rental-price.ts\n// Byte-identical to that file (it has no imports of its own, so nothing is\n// rewritten). Edit the portal copy and re-run the generator.\n${line}`;
const rewrites = new Map([
  ['@/lib/calculate-rental-price', './calculate-rental-price.ts'],
  ['date-fns-tz', 'npm:date-fns-tz@3.2.0'],
  ['@/lib/format-utils', './format-utils.ts'],
]);

function parse(source) {
  return ts.createSourceFile('source.ts', source, ts.ScriptTarget.Latest, true);
}
function declaration(source, name) {
  const found = parse(source).statements.find((s) => s.name?.text === name);
  if (!found) throw new Error(`Required declaration missing: ${name}`);
  return source.slice(found.getStart(), found.end);
}

export async function synchronize(check = false) {
  let quote = await read('apps/portal/src/lib/fleet-quote.ts');
  const imports = parse(quote).statements.filter(ts.isImportDeclaration);
  if (imports.length !== rewrites.size || imports.some((i) => !rewrites.has(i.moduleSpecifier.text))) {
    throw new Error('Fleet quote imports changed; review Deno dependency rewrites.');
  }
  for (const node of [...imports].reverse()) {
    quote = quote.slice(0, node.moduleSpecifier.getStart() + 1)
      + rewrites.get(node.moduleSpecifier.text)
      + quote.slice(node.moduleSpecifier.end - 1);
  }
  const price = await read('apps/portal/src/lib/calculate-rental-price.ts');
  if (parse(price).statements.some(ts.isImportDeclaration) || /\bimport\s*\(/.test(price)) {
    throw new Error('Pricing now imports dependencies; review server generation before continuing.');
  }
  const portalFormat = await read('apps/portal/src/lib/format-utils.ts');
  const serverFormat = await read('supabase/functions/_shared/format-utils.ts');
  for (const name of ['CURRENCY_LOCALE_MAP', 'formatCurrency']) {
    // Variable declarations have names on the declaration, not VariableStatement.
    const extract = (source) => name === 'CURRENCY_LOCALE_MAP'
      ? parse(source).statements.filter(ts.isVariableStatement)
        .find((s) => s.declarationList.declarations.some((d) => d.name.getText() === name))?.getText()
      : declaration(source, name);
    if (!extract(portalFormat) || extract(portalFormat) !== extract(serverFormat)) {
      throw new Error(`${name} differs between portal and server; review currency formatting.`);
    }
  }
  for (const [path, expected] of [
    ['supabase/functions/_shared/fleet-quote.ts', quoteHeader + quote],
    ['supabase/functions/_shared/calculate-rental-price.ts', priceHeader + price],
  ]) {
    if (check) {
      if (await read(path) !== expected) throw new Error(`${path} is stale. Run node scripts/sync-fleet-quote.mjs.`);
    } else {
      await writeFile(resolve(root, path), expected, 'utf8');
    }
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  synchronize(process.argv.includes('--check')).then(
    () => console.log(process.argv.includes('--check') ? 'Fleet quote copies match their sources.' : 'Fleet quote copies generated from source.'),
    (error) => { console.error(error.message); process.exitCode = 1; },
  );
}
