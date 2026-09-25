/**
 * Hooks before guards.
 *
 * `/admin/rentals/<id>` threw a client-side exception in production, and
 * `/admin/welcome-pack` would have as soon as anyone opened it. Both for the
 * same reason: I put `useState` and `useRegisterSidebarSections` next to the
 * JSX that uses them, which is BELOW `if (loading) return …` and
 * `if (!tenant) return …`.
 *
 * On the first render the component returns early and those hooks never run.
 * On the render after the data lands they do, so React sees more hooks than
 * last time and throws. It is the first rule of hooks, and nothing I run
 * caught it: `tsc --noEmit` was clean, the dev server answered 200, and every
 * page here is behind a sign-in so it never rendered in a check.
 *
 * This reads the source rather than mounting anything. Standing a 3,600-line
 * page up against a mocked Supabase would be a fixture that rots faster than
 * the rule it protects, and the rule is visible textually: in a component, no
 * `use*` call may follow an early return.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, join } from 'node:path';

const ROOT = resolve(__dirname, '../..');

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = join(dir, e.name);
    if (e.isDirectory()) return e.name === 'node_modules' ? [] : sourceFiles(full);
    return e.name.endsWith('.tsx') ? [full] : [];
  });
}

/**
 * Hook calls that follow an early return in the same component body.
 *
 * Two shapes count as a guard. A bare `return` at two spaces, and — the far
 * commoner one, which the first version of this missed entirely — an
 * `if (…) {` at two spaces whose `return` is indented inside it at four.
 *
 * Only hooks at two spaces are reported. A hook inside a callback is indented
 * further and is not governed by this rule; ignoring that distinction is what
 * took the first attempt to 86 false positives.
 */
function hooksAfterReturn(source: string): string[] {
  const lines = source.split('\n');
  const offenders: string[] = [];
  let seenGuard = false;
  let inGuardBlock = false;

  for (const line of lines) {
    /*
     * Any declaration at column 0 starts a fresh function, and the guard state
     * must not leak across one. The first version only matched
     * `export default function`, so `export function Header()` did not reset
     * and inherited the `return` from the hook defined above it — 86 false
     * positives, all of them hooks sitting correctly at the top of their own
     * component.
     */
    if (/^(export )?(default )?(async )?function \w/.test(line) || /^(export )?const \w+ = /.test(line)) {
      seenGuard = false;
      inGuardBlock = false;
      continue;
    }

    if (/^ {2}return[ (;]/.test(line)) seenGuard = true;

    if (/^ {2}if \(/.test(line)) inGuardBlock = true;
    if (inGuardBlock && /^ {4}return[ (;]/.test(line)) seenGuard = true;
    if (/^ {2}\}/.test(line)) inGuardBlock = false;

    const hook = line.match(/^ {2}(?:const .*= )?(use[A-Z]\w*)\(/);
    if (hook && seenGuard) offenders.push(hook[1] + ' after an early return');
  }
  return offenders;
}

describe('no component calls a hook after an early return', () => {
  const files = sourceFiles(resolve(ROOT, 'app')).concat(sourceFiles(resolve(ROOT, 'components')));

  it('scans the app at all', () => {
    expect(files.length).toBeGreaterThan(50);
  });

  it('finds none', () => {
    const bad: string[] = [];
    for (const f of files) {
      for (const hit of hooksAfterReturn(readFileSync(f, 'utf8'))) {
        bad.push(f.slice(ROOT.length + 1).replace(/\\/g, '/') + ': ' + hit);
      }
    }
    expect(bad).toEqual([]);
  });

  it('catches the shape that broke production', () => {
    // Exactly the arrangement from `rentals/[id]`: a loading guard, then hooks.
    const broken = [
      'export default function Page() {',
      '  const [a] = useState(1);',
      '  if (loading) {',
      '    return <p>loading</p>;',
      '  }',
      '  const [tab, setTab] = useState("details");',
      '  return <div />;',
      '}',
    ].join('\n');
    expect(hooksAfterReturn(broken)).toHaveLength(1);
  });

  it('does not flag a return inside a callback', () => {
    const fine = [
      'export default function Page() {',
      '  const [a] = useState(1);',
      '  const rows = items.map((i) => {',
      '    return i.id;',
      '  });',
      '  const [b] = useState(2);',
      '  return <div />;',
      '}',
    ].join('\n');
    expect(hooksAfterReturn(fine)).toEqual([]);
  });
});
