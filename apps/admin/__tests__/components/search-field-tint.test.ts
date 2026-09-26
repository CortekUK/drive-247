/**
 * A search field is a tinted object, the same one in both products.
 *
 * Asked for Sep 26 2026 with the two screens side by side: the portal's search
 * bar is washed in lavender and the Super Admin's was `bg-card`, so it was a
 * white box on a white page. The two stopped looking like one product at the
 * control an operator uses most.
 *
 * The values are the portal's, copied rather than matched by eye — see the
 * `FIELD` constant in `apps/portal/src/components/shared/layout/top-bar-v2.tsx`:
 * a 7% wash of `primary` inside a 25% rim, deepening to 10% on hover and on
 * focus. They are low enough that placeholder text keeps its contrast against
 * the tint, which is why they are copied and not rounded up to something more
 * obviously purple.
 *
 * The icon counts too. At rest it is `text-primary`, not grey: the field reads
 * as one object — rim, fill and glyph all drawn from the brand — and a grey
 * magnifier sitting in a lavender field is the detail that gives it away.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(__dirname, '../..');
const read = (p: string) => readFileSync(resolve(ROOT, p), 'utf8');

const TINT = 'bg-primary/[0.07]';
const RIM = 'border-primary/25';

describe('the search field carries the portal tint', () => {
  const primitives = () => read('components/admin/filter-primitives.tsx');

  it('fills and rims the field from the brand, not from the card', () => {
    const s = primitives();
    expect(s).toContain(TINT);
    expect(s).toContain(RIM);
    // `bg-card` is what made it a white box on a white page.
    expect(s).not.toMatch(/border-border\/60 bg-card pl-9/);
  });

  it('deepens on hover and on focus rather than staying flat', () => {
    const s = primitives();
    expect(s).toContain('hover:bg-primary/10');
    expect(s).toContain('focus-visible:bg-primary/10');
    expect(s).toContain('focus-visible:border-primary/50');
  });

  it('colours the magnifier at rest', () => {
    // Previously `text-muted-foreground` with a `group-focus-within` swap, so
    // it was grey until you clicked into it.
    const s = primitives();
    const icon = s.slice(s.indexOf('<Search'), s.indexOf('<Input'));
    expect(icon).toContain('text-primary');
    expect(icon).not.toContain('text-muted-foreground');
  });

  it('uses the same numbers the portal does', () => {
    // If the portal restyles its field, this fails and the two are re-matched
    // deliberately instead of drifting apart again.
    const portal = readFileSync(
      resolve(ROOT, '../portal/src/components/shared/layout/top-bar-v2.tsx'),
      'utf8',
    );
    expect(portal).toContain('bg-primary/[0.07]');
    expect(portal).toContain('border-primary/25');
    expect(portal).toContain('hover:bg-primary/10');
  });
});

describe('every search box in the app is tinted, not just the shared one', () => {
  /*
   * Two search fields do not go through `FilterSearch`: the tenant picker in
   * the audit-logs filter popover (a raw `<input>`) and the one in the
   * announcements tenant dialog. They are still filters, so they still get the
   * tint — "apply at every super admin filter" was the ask, and a lone white
   * box inside a popover is exactly the kind of thing a shared-component fix
   * misses.
   */
  const standalone = [
    'app/admin/(protected)/audit-logs/page.tsx',
    'components/announcements/tenant-picker-dialog.tsx',
  ];

  it.each(standalone)('%s tints its search field', (f) => {
    const s = read(f);
    const line = s.split('\n').find((l) => l.includes(TINT));
    expect(line, `${f} has no ${TINT}`).toBeDefined();
  });

  it('leaves no untinted search box behind', () => {
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const e of readdirSync(resolve(ROOT, dir), { withFileTypes: true })) {
        const rel = `${dir}/${e.name}`;
        if (e.isDirectory()) { if (e.name !== 'node_modules') walk(rel); }
        else if (e.name.endsWith('.tsx')) files.push(rel);
      }
    };
    walk('app');
    walk('components');

    const untinted: string[] = [];
    for (const f of files) {
      const src = read(f);
      // A file that draws a search box must either use the shared component
      // or carry the tint itself.
      if (!/placeholder="Search/.test(src)) continue;
      if (src.includes('FilterSearch') || src.includes(TINT)) continue;
      untinted.push(f);
    }
    expect(untinted).toEqual([]);
  });
});
