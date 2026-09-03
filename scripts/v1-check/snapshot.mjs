#!/usr/bin/env node
/**
 * snapshot.mjs — record what v1 looks like right now, so check.mjs can tell
 * whether anything under it has moved.
 *
 *   SUPABASE_ACCESS_TOKEN=sbp_... npm run v1:snapshot
 *
 * Writes scripts/v1-check/baseline.json: the production schema (tables,
 * columns, constraints, indexes, function signatures, triggers), a hash per
 * edge-function directory, and a hash per v1 source file.
 *
 * READ ONLY. This script issues SELECTs and writes one local file. It never
 * touches production.
 *
 * WHEN TO RE-RUN
 *
 * Only after a change to v1 that you have decided is correct — and then commit
 * the new baseline in the same commit as the change, with the reason in the
 * message. Re-running it to silence a failing check is the one way to make this
 * whole directory worthless: the baseline is the record of what was agreed, and
 * a baseline that is regenerated whenever it complains records nothing.
 */
import { writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import {
  BASELINE_PATH,
  PROJECT_REF,
  REPO,
  readSchema,
  edgeFunctionHashes,
  v1FileHashes,
} from './shared.mjs';

const gitSha = (() => {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: REPO })
      .toString()
      .trim();
  } catch {
    return null;
  }
})();

process.stdout.write('reading production schema … ');
const schema = await readSchema();
process.stdout.write('ok\n');

process.stdout.write('hashing edge functions … ');
const edgeFunctions = edgeFunctionHashes();
process.stdout.write('ok\n');

process.stdout.write('hashing v1 source … ');
const v1Files = v1FileHashes();
process.stdout.write('ok\n');

const baseline = {
  meta: {
    generatedAt: new Date().toISOString(),
    projectRef: PROJECT_REF,
    gitSha,
    note:
      'Baseline of v1. Regenerate ONLY together with an intentional, reviewed ' +
      'change to v1, and commit both in the same commit.',
  },
  schema,
  edgeFunctions,
  v1Files,
};

writeFileSync(BASELINE_PATH, JSON.stringify(baseline, null, 2) + '\n');

const tableCount = Object.keys(schema.tables).length;
const columnCount = Object.values(schema.tables).reduce(
  (n, t) => n + Object.keys(t.columns).length,
  0
);
const rlsOff = Object.values(schema.tables).filter((t) => !t.rls).length;

console.log('');
console.log(`  baseline written  ${BASELINE_PATH}`);
console.log(`  project           ${PROJECT_REF}`);
console.log(`  git               ${gitSha ?? '(unknown)'}`);
console.log('');
console.log(`  tables            ${tableCount}  (${rlsOff} without RLS)`);
console.log(`  columns           ${columnCount}`);
console.log(`  constraints       ${Object.keys(schema.constraints).length}`);
console.log(`  indexes           ${Object.keys(schema.indexes).length}`);
console.log(`  functions         ${Object.keys(schema.functions).length}`);
console.log(`  triggers          ${Object.keys(schema.triggers).length}`);
console.log(`  edge functions    ${Object.keys(edgeFunctions).length}`);
console.log(`  v1 source files   ${Object.keys(v1Files).length}`);
console.log('');
console.log('  commit this file.');
console.log('');
