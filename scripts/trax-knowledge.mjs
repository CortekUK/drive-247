/** Offline, reviewable knowledge preparation. Neither mode publishes or contacts a service. */
import { readFile, writeFile, readdir, mkdir } from 'node:fs/promises';
import { resolve, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import ts from 'typescript';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = async (path) => (await readFile(resolve(ROOT, path), 'utf8')).replace(/\r\n/g, '\n');
const json = async (path) => JSON.parse(await read(path));
const hash = (text) => createHash('sha256').update(text).digest('hex');
const stringify = (value) => JSON.stringify(value, null, 2) + '\n';
const policyPaths = ['apps/portal/src/lib/permissions.ts', 'apps/portal/src/lib/v2.ts', 'apps/portal/src/lib/lean-areas.ts'];
const stagePath = 'apps/portal/src/components/rentals-v2/rental-detail/stages.ts';
const availabilityPath = 'v2/apps/web/src/lib/vehicles/availability-rules.ts';
const supportPath = 'supabase/functions/trax-support/support/';
const manifestPath = 'docs/trax/knowledge-manifest.json';

export async function staleSources(hashes, readSource) {
  const stale = [];
  for (const [path, expected] of Object.entries(hashes)) {
    try { if (hash((await readSource(path)).replace(/\r\n/g, '\n')) !== expected) stale.push(path); }
    catch { stale.push(path); }
  }
  return stale;
}

async function walk(path) {
  const result = [];
  for (const entry of await readdir(resolve(ROOT, path), { withFileTypes: true })) {
    const next = `${path}/${entry.name}`;
    if (entry.isDirectory()) result.push(...await walk(next));
    else result.push(next);
  }
  return result.sort();
}
function compile(source) {
  return ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, removeComments: true } }).outputText;
}
function section(source, id, locale) {
  const marker = `<!-- trax:${id}:${locale} -->`;
  if (source.split(marker).length !== 2) throw new Error(`Expected one prepared section: ${id}/${locale}`);
  const value = source.split(marker)[1].split('<!-- /trax -->')[0].trim();
  if (!value || value.length > 2400 || /https?:\/\/|\]\(|<script|sk_live_|rk_live_|eyJ[A-Za-z0-9_-]{30}/.test(value)) {
    throw new Error(`Unsafe or oversized prepared section: ${id}/${locale}`);
  }
  return value;
}

export async function prepare(check = false) {
  const catalog = await json('docs/trax/feature-catalog.json');
  const navigation = await json('docs/trax/navigation-map.json');
  const manifest = await json(manifestPath);
  if (manifest.deploymentVerified !== false || manifest.reviewStatus !== 'pending') {
    throw new Error('Phase 1 artifacts are repository review candidates, not verified deployment manifests.');
  }
  if (!/^[a-f0-9]{40}$/.test(manifest.sourceCommit) || !/^\d{4}-\d{2}-\d{2}$/.test(manifest.verifiedAt)) throw new Error('Missing source provenance.');
  const inputs = new Set(['TRAX_APPLICATION_CONTEXT.md', 'docs/trax/feature-catalog.json', 'docs/trax/navigation-map.json', ...policyPaths, stagePath]);
  inputs.add('apps/portal/src/app/api/trax-support/route.ts');
  inputs.add('tests/trax/finance-fixtures.mjs');
  for (const path of await walk('shared/trax-support')) inputs.add(path);
  for (const path of ['supabase/migrations/20260915200000_trax_support_messaging.sql','supabase/functions/trax-messaging/index.ts','supabase/functions/trax-support-notifications/index.ts','ops/trax-support-notification-schedule.sql','apps/admin/components/admin/Sidebar.tsx','apps/admin/lib/use-support-messaging.ts','apps/admin/app/admin/(protected)/support/page.tsx','apps/admin/app/api/trax-messaging/route.ts','apps/portal/src/app/api/trax-messaging/route.ts','apps/portal/src/hooks/use-support-messaging.ts']) inputs.add(path);

  for(const path of ['supabase/migrations/20260915190000_trax_v2_support.sql','apps/portal/src/components/trax/support/SupportWorkspace.tsx','apps/portal/src/__tests__/lib/trax-escalation.test.ts','tests/trax/support-storage.mjs','tests/trax/support-fixtures.mjs','tests/trax/browser.mjs'])inputs.add(path);
  for (const path of [availabilityPath, 'v2/apps/web/src/hooks/use-vehicles.ts', 'v2/apps/web/src/hooks/use-vehicle-availability.ts', 'v2/apps/web/src/components/fleet/fleet-seed.ts', 'v2/apps/web/src/lib/booking/create-booking.ts', 'apps/portal/src/hooks/use-key-handover.ts']) inputs.add(path);
  for (const path of await walk('docs/trax')) if (path.endsWith('.md')) inputs.add(path);
  for (const path of await walk(supportPath.replace(/\/$/, ''))) if (!path.includes('.generated.')) inputs.add(path);
  for (const path of ['supabase/functions/trax-support/index.ts', 'apps/portal/src/components/trax/trax-launcher.tsx', 'apps/portal/src/components/trax/support/TraxSupportDialog.tsx', 'apps/portal/src/components/trax/support/ChatMessage.tsx', 'apps/portal/src/types/trax-support.ts', 'apps/portal/src/hooks/use-trax-support.ts', 'apps/portal/src/lib/trax-session.ts', 'scripts/trax-knowledge.mjs']) inputs.add(path);
  const guides = [];
  const ids = new Set();
  for (const f of catalog.features) {
    if (ids.has(f.id) || !['verified','partially_documented','unsupported','requiring_confirmation'].includes(f.status)) throw new Error(`Invalid feature: ${f.id}`);
    ids.add(f.id);
    if (!f.scope || !f.document || !f.limits || !f.sources.length) throw new Error(`Incomplete inventory: ${f.id}`);
    inputs.add(f.document);
    const source = await read(f.document);
    for (const ref of f.sources) {
      inputs.add(ref.path);
      const text = await read(ref.path);
      for (const symbol of ref.symbols) if (!text.includes(symbol)) throw new Error(`Missing source symbol ${symbol} in ${ref.path}`);
    }
    for (const test of f.tests) { inputs.add(test); await read(test); }
    for (const g of f.guides) {
      if (!['verified','partially_documented'].includes(f.status) || g.verification !== 'repository_verified') throw new Error(`Unverified retrieval source: ${g.id}`);
      for (const nav of g.navigation) if (!navigation.targets.some((n) => n.id === nav)) throw new Error(`Unknown navigation ${nav}`);
      guides.push({ id:g.id, title:f.title, permissions:f.permissionKeys, keywords:g.keywords, navigation:g.navigation,
        en:section(source,g.id,'en'), 'ur-Latn':section(source,g.id,'ur-Latn') });
    }
  }
  const pages = (await walk('apps/portal/src/app/(dashboard)')).filter((p) => p.endsWith('/page.tsx'));
  const inventory = pages.map((p) => {
    const route = p.replace('apps/portal/src/app/(dashboard)', '').replace(/\/page\.tsx$/, '') || '/';
    const feature = catalog.features.filter((f) => f.routePrefixes.some((prefix) => prefix === '/' ? route === '/' : route === prefix || route.startsWith(prefix + '/')))
      .sort((a,b) => Math.max(...b.routePrefixes.map((x)=>x.length)) - Math.max(...a.routePrefixes.map((x)=>x.length)))[0];
    return { route, source:p, feature:feature?.id ?? null, status:feature?.status ?? 'requiring_confirmation' };
  });
  if (inventory.some((p) => !p.feature)) throw new Error(`Uncatalogued portal routes: ${inventory.filter((p)=>!p.feature).map((p)=>p.route).join(', ')}`);
  for (const p of pages) inputs.add(p); // Detect page behavior changes, not just new routes.
  for (const n of navigation.targets) {
    inputs.add(n.source);
    const pathname = n.href.split('?')[0].replace('{id}', '[id]');
    if (!inventory.some((p) => p.route === pathname)) throw new Error(`Navigation route missing: ${n.id}`);
    if (!n.permission || !n.href.startsWith('/') || n.href.startsWith('//')) throw new Error(`Unrestricted navigation: ${n.id}`);
  }
  const permissionSource = await read(policyPaths[0]);
  const permissionModule = await import(`data:text/javascript;base64,${Buffer.from(compile(permissionSource)).toString('base64')}`);
  const uncoveredKeys = permissionModule.TAB_KEYS.filter((key) => !catalog.features.some((f) => f.id === key || f.permissionKeys.includes(key)));
  if (uncoveredKeys.length) throw new Error(`Uncatalogued permission keys: ${uncoveredKeys.join(', ')}`);
  const sourceHashes = {};
  for (const path of [...inputs].sort()) sourceHashes[path] = hash(await read(path));
  const coverage = {
    knowledgeVersion:manifest.knowledgeVersion, sourceCommit:manifest.sourceCommit, verifiedAt:manifest.verifiedAt,
    productionReleaseVerified:false, completeApplicationCoverage:false,
    features:catalog.features.map(({id,title,status,scope,limits})=>({id,title,status,scope,limits})),
    counts:Object.fromEntries(['verified','partially_documented','unsupported','requiring_confirmation'].map((s)=>[s,catalog.features.filter((f)=>f.status===s).length])),
    permissionKeys:permissionModule.TAB_KEYS, portalRoutes:inventory,
    otherSurfaces: ['apps/booking','apps/admin','apps/web','v2/apps/web'].map((path)=>({path,status:'requiring_confirmation'})),
  };
  const outputs = new Map();
  const availability = compile(await read(availabilityPath));
  if (/\bimport\s/.test(availability)) throw new Error('Availability rules must remain pure.');
  outputs.set(supportPath+'availability-rules.generated.js', `// Generated from ${availabilityPath}; do not edit.\n`+availability);
  const prepared = {version:manifest.knowledgeVersion, sourceCommit:manifest.sourceCommit, verifiedAt:manifest.verifiedAt,
    applicationRelease:manifest.applicationRelease, deploymentVerified:false, guides, navigation:navigation.targets};
  outputs.set(supportPath+'knowledge.generated.ts', '// Generated by scripts/trax-knowledge.mjs from prepared documentation. Do not edit.\nexport const KNOWLEDGE = '+JSON.stringify(prepared,null,2)+' as const;\n');
  for (const [i,name] of ['portal-permissions','portal-v2','portal-lean'].entries()) {
    const source = await read(policyPaths[i]);
    const body = compile(source);
    if (/\bimport\s/.test(body)) throw new Error(`Policy now has runtime imports; review generator: ${policyPaths[i]}`);
    outputs.set(supportPath+name+'.generated.js', `// Generated from ${policyPaths[i]}; checked by scripts/trax-knowledge.mjs.\n`+body);
  }
  const stageSource = await read(stagePath);
  const stageAst = ts.createSourceFile('stages.ts',stageSource,ts.ScriptTarget.Latest,true);
  const stage = stageAst.statements.find((s)=>ts.isFunctionDeclaration(s) && s.name.text==='stageHref');
  if (!stage) throw new Error('stageHref missing; review rental navigation.');
  outputs.set(supportPath+'rental-navigation.generated.js', `// Generated from ${stagePath}:stageHref.\n`+compile(stage.getText(stageAst)));
  outputs.set('docs/trax/generated/coverage-report.json', stringify(coverage));
  outputs.set(manifestPath, stringify({...manifest,sourceHashes}));
  const stale = [];
  for (const [path,expected] of outputs) {
    if (check) {
      let actual; try { actual=await read(path); } catch { actual=''; }
      if (actual !== expected) stale.push(path);
    } else {
      await mkdir(dirname(resolve(ROOT,path)),{recursive:true});
      await writeFile(resolve(ROOT,path),expected,'utf8');
    }
  }
  if (stale.length) {
    const changed=await staleSources(manifest.sourceHashes,read);
    const affected=catalog.features.filter((f)=>changed.includes(f.document)||f.sources.some((s)=>changed.includes(s.path))).map((f)=>f.document);
    throw new Error(`TRAX knowledge is stale: ${stale.join(', ')}. Changed sources: ${changed.join(', ')}. Affected documents: ${[...new Set(affected)].join(', ') || 'review coverage and permission rules'}. Review before running node scripts/trax-knowledge.mjs --build.`);
  }
  return coverage.counts;
}
if (process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  if (!process.argv.includes('--check') && !process.argv.includes('--build')) throw new Error('Use --check or --build (local only).');
  prepare(process.argv.includes('--check')).then((counts)=>console.log(JSON.stringify({status:'ok',counts,productionReleaseVerified:false})),(error)=>{console.error(error.message);process.exitCode=1;});
}
