/**
 * Nothing goes in a narrow column unless its insides can survive one.
 *
 * I broke the rental company page this way on Sep 26 2026. The Management tab
 * was seven stacked full-width cards, six of them only a few rows tall, so I
 * put those six in a 2-up/3-up grid to use the empty right half.
 *
 * It looked obviously right and was obviously wrong. Each of those cards lays
 * its own facts out with `grid-cols-2 md:grid-cols-4`, and `md:` is a VIEWPORT
 * breakpoint, not a container one. On a wide screen the viewport is wide, so
 * `md:` stays satisfied and every card went on rendering FOUR internal columns
 * — inside a 380px cell. "Disabled" printed on top of an email address;
 * "Switch" printed on top of the note next to it.
 *
 * The lesson generalises past that one tab, which is why this file is not
 * about that tab: putting a component somewhere narrower is only safe when the
 * component reflows, and a viewport breakpoint means it does not. Tailwind has
 * no warning for this — the classes are all valid, the build is clean, and the
 * damage is only visible on screen, which is exactly what nobody can see here
 * because every page sits behind a sign-in.
 *
 * So: a rail may not contain viewport-driven column counts. Anywhere in the
 * app, on any page. If a card needs to move into one, its inner grid has to
 * become container-relative (`@container` / `@md:`) first.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, join } from 'node:path';

const ROOT = resolve(__dirname, '../..');

function sourceFiles(dir: string): string[] {
  return readdirSync(resolve(ROOT, dir), { withFileTypes: true }).flatMap((e) => {
    const rel = `${dir}/${e.name}`;
    if (e.isDirectory()) return e.name === 'node_modules' ? [] : sourceFiles(rel);
    return e.name.endsWith('.tsx') ? [rel] : [];
  });
}

/** Every `<aside>…</aside>` region in a file. Rails are always asides here. */
function rails(src: string): string[] {
  const out: string[] = [];
  let from = 0;
  for (;;) {
    const open = src.indexOf('<aside', from);
    if (open === -1) break;
    const close = src.indexOf('</aside>', open);
    if (close === -1) break;
    out.push(src.slice(open, close));
    from = close + 1;
  }
  return out;
}

/** `md:grid-cols-3`, `lg:grid-cols-4`, … — a column count set by the WINDOW. */
const VIEWPORT_COLUMNS = /\b(sm|md|lg|xl|2xl):grid-cols-\d/g;

describe('a rail never holds something that needs the whole window', () => {
  const files = sourceFiles('app').concat(sourceFiles('components'));

  it('finds rails to check', () => {
    const withRails = files.filter((f) => rails(readFileSync(resolve(ROOT, f), 'utf8')).length);
    expect(withRails.length).toBeGreaterThan(0);
  });

  it('finds no viewport-driven column count inside one', () => {
    const offenders: string[] = [];
    for (const f of files) {
      for (const region of rails(readFileSync(resolve(ROOT, f), 'utf8'))) {
        for (const hit of region.match(VIEWPORT_COLUMNS) ?? []) {
          offenders.push(`${f}: "${hit}" inside an <aside>`);
        }
      }
    }
    // A rail is ~21rem no matter how wide the window is. A `md:` inside it
    // asks the window how many columns to draw and gets the wrong answer.
    expect(offenders).toEqual([]);
  });
});

describe("the integration details never overlap", () => {
  const page = () =>
    readFileSync(resolve(ROOT, 'app/admin/(protected)/rentals/[id]/page.tsx'), 'utf8');

  // Comments explain the history by quoting class names, so read markup only.
  function integrationsTab(src: string): string {
    const start = src.indexOf('<TabsContent value="integrations"');
    expect(start).toBeGreaterThan(-1);
    return src.slice(start, src.indexOf('</TabsContent>', start)).replace(/\{\/\*[\s\S]*?\*\/\}/g, '');
  }

  /*
   * Twice now a fixed column grid has let a long value run over its
   * neighbour. The detail rows were `grid-cols-2 md:grid-cols-4`, and `md:`
   * is a VIEWPORT breakpoint: first they were boxed into a 380px page-grid
   * cell and still drew four columns; then, in the Integrations dialog
   * (Sep 26 2026), a Bonzah login email ran straight over the Mode badge.
   * The dialog now uses label/value rows like the portal's panel kit.
   */
  it('lays the details out as label/value rows, not a column grid', () => {
    const tab = integrationsTab(page());
    expect(tab).not.toContain('md:grid-cols-4');
    expect(tab).toContain('<PanelRow label="Credentials">');
  });

  it('lets the tiles take the 4-up grid, since they hold only logo, name and status', () => {
    const tab = integrationsTab(page());
    const tiles = tab.slice(0, tab.indexOf('<Dialog'));
    expect(tiles).toContain('sm:grid-cols-2 lg:grid-cols-4');
    expect(tiles).not.toContain('<PanelRow');
  });

  it('wraps a long value instead of letting it run under the next one', () => {
    const src = page();
    const row = src.slice(src.indexOf('function PanelRow('), src.indexOf('function PanelNote('));
    expect(row).toContain('min-w-0');
    expect(row).toContain('shrink-0');
  });
});
