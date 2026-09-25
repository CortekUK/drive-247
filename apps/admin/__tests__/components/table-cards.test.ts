/**
 * A table that fills a rounded card is clipped by it.
 *
 * Reported Sep 25 2026 with both top corners of the Rental Companies table
 * circled in red: the card is `rounded-4xl`, 26px, but the table's header row
 * carries `bg-primary/5` and painted a solid rectangle straight over the
 * radius. The corners were drawn — they were simply underneath a square.
 *
 * The fix is one class, and the reason it is not obvious is that
 * `components/ui/table.tsx` ALREADY wraps its table in
 * `relative w-full overflow-auto`. That inner wrapper scrolls, but it does not
 * round anything, and it is not the element with the radius. The clip has to
 * be on the card.
 *
 * Which also means `overflow-hidden` is safe here: horizontal scrolling still
 * works, because the div inside the table does it. That is worth stating,
 * because the opposite mistake has been made in this repo before — a
 * `overflow-hidden` on a container whose table had no inner scroller clipped
 * the columns past the fold with no way to reach them, and the comment on
 * blacklist's table still records it.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, join } from 'node:path';

const ROOT = resolve(__dirname, '../..');
const src = (p: string) => readFileSync(resolve(ROOT, p), 'utf8');

function tsxFiles(dir: string): string[] {
  return readdirSync(resolve(ROOT, dir), { withFileTypes: true }).flatMap((e) => {
    const rel = `${dir}/${e.name}`;
    if (e.isDirectory()) return e.name === 'node_modules' ? [] : tsxFiles(rel);
    return e.name.endsWith('.tsx') ? [rel] : [];
  });
}

/**
 * Every container whose first real child is a table, with the classes it
 * carries. A `CardContent` in between is transparent for this purpose — it has
 * no radius of its own, so the clip still has to be on the thing outside it.
 */
function tableContainers(source: string): { attrs: string; line: number }[] {
  const found: { attrs: string; line: number }[] = [];
  const pattern = /<(Card|div)([^>]*)>[^<]*(?:<CardContent([^>]*)>[^<]*)?(?=<[Tt]able[ >])/g;
  for (const m of source.matchAll(pattern)) {
    found.push({
      attrs: `${m[2] ?? ''} ${m[3] ?? ''}`.trim(),
      line: source.slice(0, m.index ?? 0).split('\n').length,
    });
  }
  return found;
}

const CLIPS = /overflow-hidden|overflow-x-auto|overflow-auto/;

describe('table containers clip their own corners', () => {
  const files = tsxFiles('app').concat(tsxFiles('components'));

  it('finds the containers at all', () => {
    const total = files.reduce((n, f) => n + tableContainers(src(f)).length, 0);
    // Vacuous-pass guard: if the pattern stops matching, every assertion
    // below would pass while nothing was checked.
    expect(total).toBeGreaterThan(10);
  });

  it('leaves none of them unclipped', () => {
    const bare: string[] = [];
    for (const f of files) {
      for (const c of tableContainers(src(f))) {
        // `components/ui/table.tsx` IS the inner scroller — it is the thing
        // being relied on, not a container that forgot to clip.
        if (f === 'components/ui/table.tsx') continue;
        if (!CLIPS.test(c.attrs)) bare.push(`${f}:${c.line} — ${c.attrs || '<Card> with no className'}`);
      }
    }
    expect(bare).toEqual([]);
  });

  it('keeps the inner scroller the table relies on', () => {
    // If this ever goes away, `overflow-hidden` on the cards above stops being
    // safe and starts clipping columns instead of corners.
    expect(src('components/ui/table.tsx')).toContain('relative w-full overflow-auto');
  });
});

/*
 * One card shape for every list.
 *
 * The brief asked for this "universally across every module and list page",
 * and the spread was real: `rounded-lg` with legacy `dark-card`/`dark-border`
 * on two, `rounded-xl` with a border on two more, against the house
 * `rounded-4xl` + ring that the Card primitive and three other pages already
 * used.
 */
describe('list containers wear the house card', () => {
  const listContainers = [
    'app/admin/(protected)/feedbacks/page.tsx',
    'app/admin/(protected)/integrations/page.tsx',
    'app/admin/(protected)/admins/page.tsx',
    'app/admin/(protected)/blacklist/page.tsx',
    'app/admin/(protected)/contacts/page.tsx',
    'components/admin/tenant-credits-tab.tsx',
  ];

  it.each(listContainers)('%s uses the 26px radius and the ring, not a border', (page) => {
    const s = src(page);
    // The hand-rolled list containers on these pages all carry the house card.
    expect(s).toMatch(/rounded-4xl bg-card[^"]*ring-1 ring-foreground\/10/);
    // And none of them still wear the legacy dark-* surface on a list.
    expect(s).not.toMatch(/rounded-lg border border-dark-border bg-dark-card/);
    expect(s).not.toMatch(/bg-dark-card rounded-lg border border-dark-border/);
  });

  it('the Card primitive still sets the radius everything else matches', () => {
    // These hand-rolled containers exist because they hold a raw <table>
    // rather than the Table component. They only stay consistent while they
    // agree with the primitive, so pin the number in one place.
    expect(src('components/ui/card.tsx')).toContain('rounded-4xl');
    expect(src('components/ui/card.tsx')).toContain('ring-1 ring-foreground/10');
  });
});
