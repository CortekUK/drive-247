#!/usr/bin/env node
/**
 * check-edge-function-scopes.mjs
 * ---------------------------------------------------------------------------
 * Finds identifiers that are READ but never DECLARED in any enclosing scope --
 * the `ReferenceError: x is not defined` class of bug.
 *
 * WHY THIS EXISTS: supabase/functions is the one part of this repo with no
 * safety net at all. There is no CI (.github/ does not exist), no deno check or
 * lint step, and supabase/functions sits outside every tsconfig, so `tsc` never
 * looks at it. `supabase functions deploy` does not typecheck either -- proven
 * empirically: boldsign-webhook shipped a bare `payload` reference to
 * production, threw ReferenceError on EVERY BoldSign callback for months, and
 * a surrounding catch downgraded it to a console.warn so nobody saw it. That
 * left additional-driver signing status permanently unsynced.
 *
 * This is deliberately CONSERVATIVE. A false positive here trains people to
 * ignore the check, which is worse than not having it, so anything ambiguous is
 * skipped: property names, object keys, type positions, labels, JSX, shorthand
 * patterns and every declaration form are all excluded. It aims to catch the
 * one thing that actually shipped, not to be a general linter.
 *
 *   node scripts/check-edge-function-scopes.mjs            # report
 *   node scripts/check-edge-function-scopes.mjs --json     # machine-readable
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const FN_DIR = join(ROOT, 'supabase', 'functions');

// Runtime globals available to a Deno edge function. Anything here is assumed
// declared. Kept broad on purpose: a missing global is a false POSITIVE, and
// false positives are the failure mode that kills adoption.
const GLOBALS = new Set([
  'Deno','console','fetch','Request','Response','Headers','URL','URLSearchParams','FormData','Blob','File',
  'JSON','Math','Date','Object','Array','String','Number','Boolean','Symbol','BigInt','RegExp','Function',
  'Promise','Error','TypeError','RangeError','SyntaxError','EvalError','ReferenceError','AggregateError',
  'Map','Set','WeakMap','WeakSet','WeakRef','Proxy','Reflect','Intl','globalThis','undefined','NaN','Infinity',
  'parseInt','parseFloat','isNaN','isFinite','encodeURIComponent','decodeURIComponent','encodeURI','decodeURI',
  'btoa','atob','setTimeout','clearTimeout','setInterval','clearInterval','queueMicrotask','structuredClone',
  'crypto','TextEncoder','TextDecoder','AbortController','AbortSignal','AbortError','performance',
  'Uint8Array','Uint16Array','Uint32Array','Int8Array','Int16Array','Int32Array','Float32Array','Float64Array',
  'BigInt64Array','BigUint64Array','Uint8ClampedArray','ArrayBuffer','SharedArrayBuffer','DataView','Atomics',
  'ReadableStream','WritableStream','TransformStream','EventTarget','Event','CustomEvent','MessageChannel',
  'addEventListener','removeEventListener','dispatchEvent','process','Buffer','require','module','exports',
  '__dirname','__filename','WebSocket','Worker','caches','navigator','location','self','window','document',
  'Iterator','AsyncIterator','FinalizationRegistry','escape','unescape','eval','arguments',
  'DOMException','DOMMatrix','ImageData','Headers','ProgressEvent','MessageEvent','CloseEvent',
]);

/** Names a node introduces into scope, including destructuring patterns. */
function bindingNames(name, out) {
  if (!name) return;
  if (ts.isIdentifier(name)) { out.add(name.text); return; }
  if (ts.isObjectBindingPattern(name) || ts.isArrayBindingPattern(name)) {
    for (const el of name.elements) {
      if (ts.isOmittedExpression(el)) continue;
      bindingNames(el.name, out);
    }
  }
}

function analyse(file, src) {
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.ESNext, true, ts.ScriptKind.TS);
  const findings = [];

  // Pre-pass: every name declared ANYWHERE in the file. Using a flat set rather
  // than true lexical scoping is the conservative choice -- it can miss a
  // use-before-declare in a sibling scope, but it cannot invent a false
  // positive for a name that genuinely exists somewhere.
  const declared = new Set();
  (function collect(node) {
    if (ts.isImportDeclaration(node) && node.importClause) {
      const { name, namedBindings } = node.importClause;
      if (name) declared.add(name.text);
      if (namedBindings) {
        if (ts.isNamespaceImport(namedBindings)) declared.add(namedBindings.name.text);
        else for (const s of namedBindings.elements) declared.add(s.name.text);
      }
    }
    if (ts.isVariableDeclaration(node)) bindingNames(node.name, declared);
    if (ts.isParameter(node)) bindingNames(node.name, declared);
    if (ts.isBindingElement(node)) bindingNames(node.name, declared);
    if (ts.isFunctionDeclaration(node) && node.name) declared.add(node.name.text);
    if (ts.isClassDeclaration(node) && node.name) declared.add(node.name.text);
    if (ts.isEnumDeclaration(node) && node.name) declared.add(node.name.text);
    if (ts.isModuleDeclaration(node) && node.name && ts.isIdentifier(node.name)) declared.add(node.name.text);
    if (ts.isCatchClause(node) && node.variableDeclaration) bindingNames(node.variableDeclaration.name, declared);
    if (ts.isTypeAliasDeclaration(node) && node.name) declared.add(node.name.text);
    if (ts.isInterfaceDeclaration(node) && node.name) declared.add(node.name.text);
    if (ts.isTypeParameterDeclaration(node) && node.name) declared.add(node.name.text);
    if ((ts.isFunctionExpression(node) || ts.isClassExpression(node)) && node.name) declared.add(node.name.text);
    ts.forEachChild(node, collect);
  })(sf);

  /** Is this identifier a genuine value READ, rather than a name in some other position? */
  function isValueRead(id) {
    const p = id.parent;
    if (!p) return false;
    // obj.PROP  -- the property half is not a variable
    if (ts.isPropertyAccessExpression(p) && p.name === id) return false;
    // { KEY: v } and { KEY }
    if (ts.isPropertyAssignment(p) && p.name === id) return false;
    if (ts.isShorthandPropertyAssignment(p)) return false;
    // declarations, params, labels, imports/exports, member names
    if (ts.isBindingElement(p) && p.propertyName === id) return false;
    if (ts.isVariableDeclaration(p) && p.name === id) return false;
    if (ts.isParameter(p) && p.name === id) return false;
    if (ts.isFunctionDeclaration(p) || ts.isClassDeclaration(p) || ts.isEnumDeclaration(p)) return false;
    if (ts.isMethodDeclaration(p) || ts.isPropertyDeclaration(p) || ts.isPropertySignature(p)) return false;
    if (ts.isMethodSignature(p) || ts.isEnumMember(p) || ts.isTypeParameterDeclaration(p)) return false;
    if (ts.isImportSpecifier(p) || ts.isExportSpecifier(p) || ts.isNamespaceImport(p) || ts.isImportClause(p)) return false;
    if (ts.isLabeledStatement(p) || ts.isBreakOrContinueStatement(p)) return false;
    if (ts.isTypeAliasDeclaration(p) || ts.isInterfaceDeclaration(p)) return false;
    if (ts.isQualifiedName(p)) return false;
    if (ts.isJsxAttribute(p)) return false;
    // import attributes: `with { type: "json" }` -- `type` there is a key, not a variable
    if (ts.isImportAttribute && ts.isImportAttribute(p)) return false;
    if (p.kind === ts.SyntaxKind.ImportAttribute || p.kind === ts.SyntaxKind.AssertEntry) return false;
    // any type position: TypeReference, TypeQuery, heritage clauses, etc.
    for (let n = p; n; n = n.parent) {
      if (ts.isTypeNode(n) || ts.isTypeReferenceNode(n) || ts.isTypeQueryNode(n)) return false;
      if (ts.isHeritageClause(n)) return false;
      if (ts.isSourceFile(n)) break;
    }
    return true;
  }

  (function walk(node) {
    if (ts.isIdentifier(node) && isValueRead(node) && !GLOBALS.has(node.text) && !declared.has(node.text)) {
      const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
      findings.push({ name: node.text, line: line + 1 });
    }
    ts.forEachChild(node, walk);
  })(sf);

  // De-dupe: one report per name per file is enough to act on.
  const seen = new Set();
  return findings.filter((f) => (seen.has(f.name) ? false : seen.add(f.name)));
}

function walkFns(dir, acc = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) walkFns(p, acc);
    else if (e.name.endsWith('.ts') && !e.name.endsWith('.d.ts')) acc.push(p);
  }
  return acc;
}

if (!existsSync(FN_DIR)) { console.error('no supabase/functions directory'); process.exit(0); }
const files = walkFns(FN_DIR);
const all = [];
for (const f of files) {
  for (const hit of analyse(f, readFileSync(f, 'utf8'))) {
    all.push({ file: relative(ROOT, f), ...hit });
  }
}

if (process.argv.includes('--json')) {
  console.log(JSON.stringify(all, null, 2));
} else if (all.length) {
  console.error(`\n  ${all.length} undefined reference(s) across ${files.length} edge-function files:\n`);
  for (const f of all) console.error(`    ${f.file}:${f.line}  '${f.name}' is never declared`);
  console.error('\n  These throw ReferenceError at runtime. Nothing else in this repo');
  console.error('  typechecks supabase/functions.\n');
} else {
  console.log(`  no undefined references across ${files.length} edge-function files`);
}
process.exit(all.length ? 1 : 0);
