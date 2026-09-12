// The full portal check also reports existing errors outside this change.
// Check the timeline and each integration using the same project/types/aliases.
const ts = require('typescript');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const portal = path.resolve(__dirname, '../apps/portal');
const config = ts.readConfigFile(path.join(portal, 'tsconfig.json'), ts.sys.readFile);
if (config.error) throw new Error(ts.flattenDiagnosticMessageText(config.error.messageText, '\n'));
const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, portal);
const names = [
  'src/components/rentals-v2/rentals-list-v2.tsx',
  'src/components/rentals-v2/rental-detail/rental-detail-v2.tsx',
  'src/components/rentals-v2/rental-detail/right-rail.tsx',
  'src/components/customers-v2/customer-detail/customer-detail-v2.tsx',
  'src/components/customers-v2/customer-detail/overview-rail.tsx',
  'src/components/vehicles-v2/vehicle-detail-v2.tsx',
  'src/components/vehicles-v2/overview-rail.tsx',
  'src/app/playground/_force-light.tsx',
  'src/__tests__/lib/timeline-v2.test.ts',
  'src/__tests__/lib/rental-period-days.test.ts',
  'src/__tests__/components/timeline-data.test.tsx',
];
for (const dir of ['src/components/timeline-v2', 'src/app/playground/timeline']) {
  for (const file of fs.readdirSync(path.join(portal, dir))) {
    if (/\.tsx?$/.test(file)) names.push(`${dir}/${file}`);
  }
}
const program = ts.createProgram(parsed.fileNames, { ...parsed.options, incremental: false });
const diagnostics = [];
for (const name of names) {
  const source = program.getSourceFile(path.join(portal, name));
  if (!source) throw new Error(`Missing source ${name}`);
  diagnostics.push(...program.getSyntacticDiagnostics(source), ...program.getSemanticDiagnostics(source));
}
// Legacy pages already have type errors unrelated to the timeline. Inspect the
// new imports/route composition against the real project without hiding errors
// in any new timeline module, and report how many old diagnostics were excluded.
const routes = ['rentals/page.tsx', 'rentals/[id]/page.tsx', 'customers/[id]/page.tsx', 'vehicles/[id]/page.tsx'];
let existingRouteErrors = 0;
for (const route of routes) {
  const file = `src/app/(dashboard)/${route}`;
  const source = program.getSourceFile(path.join(portal, file));
  const diff = execFileSync('git', ['diff', '--unified=0', '--', `apps/portal/${file}`], { cwd: path.resolve(portal, '../..'), encoding: 'utf8' });
  const ranges = [...diff.matchAll(/^@@ .* \+(\d+)(?:,(\d+))? @@/gm)].map(m => [Number(m[1]), Number(m[1]) + Math.max(1, Number(m[2] ?? 1))]);
  diagnostics.push(...program.getSyntacticDiagnostics(source));
  for (const diagnostic of program.getSemanticDiagnostics(source)) {
    const line = source.getLineAndCharacterOfPosition(diagnostic.start ?? 0).line + 1;
    if (ranges.some(([from, to]) => line >= from && line < to)) diagnostics.push(diagnostic);
    else existingRouteErrors++;
  }
}
if (diagnostics.length) {
  console.error(ts.formatDiagnosticsWithColorAndContext(diagnostics, { getCanonicalFileName: f => f, getCurrentDirectory: () => portal, getNewLine: () => '\n' }));
  process.exitCode = 1;
} else console.log(`Timeline type check passed: ${names.length} full source files and ${routes.length} changed legacy routes (${existingRouteErrors} existing route diagnostics outside changed lines).`);
