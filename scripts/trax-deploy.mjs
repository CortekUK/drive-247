#!/usr/bin/env node
/**
 * Deploy the `trax-support` edge function through the Supabase Management API.
 *
 *   SUPABASE_ACCESS_TOKEN=<personal access token> node scripts/trax-deploy.mjs
 *
 * Flags
 *   --dry-run    list what would be uploaded and stop
 *   --snapshot   save the currently deployed version to artifacts/ first (default on)
 *   --project=   override the project ref
 *
 * What it does, in order:
 *   1. works out the exact module set the entrypoint reaches, with esbuild, so
 *      nothing needed is missed and nothing unnecessary is shipped;
 *   2. pre-flights that graph — a syntax error or missing import fails here,
 *      before anything is sent;
 *   3. saves the metadata of the version currently live, so it can be identified
 *      again if a rollback is needed;
 *   4. uploads the files and prints the new version number;
 *   5. verifies the function answers, and that it rejects an unauthenticated
 *      request rather than erroring — which is how you know it booted.
 *
 * It does NOT touch the database, credentials, storage buckets or any other
 * function, and it keeps `verify_jwt` as the live version has it.
 *
 * Reports stay off after this: they need docs/trax/pending-migrations/01-trax-report-jobs.sql
 * applied and TRAX_REPORTS=enabled, which are separate decisions.
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SLUG = 'trax-support';
const ENTRY = 'supabase/functions/trax-support/index.ts';
const EXTRA = ['supabase/functions/deno.json'];

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const projectArg = args.find((a) => a.startsWith('--project='));
const REF = projectArg ? projectArg.split('=')[1] : (process.env.SUPABASE_PROJECT_REF ?? 'hviqoaokxvlancmftwuo');
const TOKEN = process.env.SUPABASE_ACCESS_TOKEN;

if (!dryRun && !TOKEN) {
  console.error('SUPABASE_ACCESS_TOKEN is not set. Export a personal access token with access to the project, then run again.');
  console.error('The token is a credential: do not paste it into a terminal that is being recorded, and do not commit it.');
  process.exit(2);
}

const api = async (path, init = {}) => {
  const response = await fetch(`https://api.supabase.com/v1${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${TOKEN}`, ...(init.headers ?? {}) },
  });
  const text = await response.text();
  let body; try { body = JSON.parse(text); } catch { body = text; }
  return { status: response.status, ok: response.ok, body };
};

/* 1 + 2. The module set, and the pre-flight. */
const { build } = await import('esbuild');
let metafile;
try {
  ({ metafile } = await build({
    entryPoints: [resolve(ROOT, ENTRY)],
    bundle: true, platform: 'neutral', format: 'esm', target: 'es2022',
    // Deno resolves these itself at runtime; they are not bundled or uploaded.
    external: ['https://*', 'npm:*', 'node:*', 'jsr:*'],
    logLevel: 'silent', metafile: true, write: false,
  }));
} catch (error) {
  console.error('pre-flight FAILED — nothing was sent.');
  console.error(String(error.message ?? error).slice(0, 4000));
  process.exit(1);
}

const posix = (p) => p.split('\\').join('/');
const files = [...new Set(Object.keys(metafile.inputs)
  .map((input) => posix(relative(ROOT, resolve(process.cwd(), input)))))]
  .filter((p) => !p.startsWith('..'))
  .concat(EXTRA)
  .sort();

let bytes = 0;
for (const file of files) {
  const path = resolve(ROOT, file);
  if (!fs.existsSync(path)) { console.error(`missing file in graph: ${file}`); process.exit(1); }
  bytes += fs.statSync(path).size;
}
console.log(`pre-flight OK — ${files.length} modules, ${(bytes / 1024).toFixed(1)} KiB`);
console.log(`project: ${REF}   function: ${SLUG}   entrypoint: ${ENTRY}`);

if (dryRun) {
  console.log('\nwould upload:');
  for (const file of files) console.log(`  ${file}`);
  console.log('\nDRY RUN — nothing sent.');
  process.exit(0);
}

/* 3. Identify the version being replaced. */
const before = await api(`/projects/${REF}/functions/${SLUG}`);
if (!before.ok) { console.error(`could not read the current function: ${before.status}`, before.body); process.exit(1); }
const verifyJwt = before.body.verify_jwt !== false;
await mkdir(resolve(ROOT, 'artifacts/trax-deploy'), { recursive: true });
await writeFile(resolve(ROOT, `artifacts/trax-deploy/before-v${before.body.version}.json`), JSON.stringify(before.body, null, 2));
console.log(`replacing version ${before.body.version} (status ${before.body.status}, verify_jwt ${verifyJwt}) — saved to artifacts/trax-deploy/`);

/* 4. Upload. */
const form = new FormData();
form.append('metadata', JSON.stringify({ name: SLUG, entrypoint_path: ENTRY, verify_jwt: verifyJwt, static_patterns: [] }));
for (const file of files) {
  const content = await readFile(resolve(ROOT, file));
  form.append('file', new Blob([content], { type: 'application/typescript' }), file);
}
const deployed = await api(`/projects/${REF}/functions/deploy?slug=${SLUG}`, { method: 'POST', body: form });
if (!deployed.ok) {
  console.error(`\ndeploy FAILED (${deployed.status}). The live version is unchanged.`);
  console.error(typeof deployed.body === 'string' ? deployed.body.slice(0, 2000) : JSON.stringify(deployed.body, null, 2).slice(0, 2000));
  process.exit(1);
}
console.log(`\ndeployed: version ${deployed.body.version} (was ${before.body.version}), status ${deployed.body.status}`);

/* 5. Verify it booted. An unauthenticated call must be REFUSED, not error. */
const url = `https://${REF}.supabase.co/functions/v1/${SLUG}`;
const probe = await fetch(url, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: 'deployment check' }),
});
const probeText = (await probe.text()).slice(0, 200);
console.log(`\nunauthenticated probe: HTTP ${probe.status}`);
if (probe.status === 401 || probe.status === 403) {
  console.log('  refused, as it must be — the function is up and rejecting unauthenticated calls.');
} else if (probe.status >= 500) {
  console.log(`  SERVER ERROR: ${probeText}`);
  console.log('  This suggests the function did not boot. Check the function logs, and consider rolling back.');
  process.exitCode = 1;
} else {
  console.log(`  unexpected: ${probeText}`);
  process.exitCode = 1;
}

console.log('\nNot changed by this deploy:');
console.log('  reports        still off (needs the pending migration and TRAX_REPORTS=enabled)');
console.log('  tenant reach   still V2-gated, so northwind only');
console.log('  database       untouched: no migration, policy, grant or credential was altered');
console.log('\nTo roll back, redeploy the previous commit of supabase/functions/trax-support with this script.');
