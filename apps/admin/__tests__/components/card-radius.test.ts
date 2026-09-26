/**
 * One card shape, on every page.
 *
 * Reported Sep 26 2026: "the edges and shapes are not good — correct them for
 * all pages, not this one only." The app had eight different corner radii in
 * use. Most of that is fine and always will be — a badge is `rounded-full`, an
 * input is `rounded-md`, a 32px icon tile is `rounded-lg` — so the count on its
 * own says nothing.
 *
 * What matters is the CARD SURFACE: a panel with `bg-card` that a page puts
 * content on. There the house shape is `rounded-4xl` (26px, set by
 * `--v2-radius-4xl`) with `shadow-sm ring-1 ring-foreground/10` — the same
 * treatment `components/ui/card.tsx` gives every `<Card>`. It was used 26
 * times and contradicted 4 times by hand-rolled panels that reached for
 * `rounded-xl` and a border instead.
 *
 * The exceptions below are listed individually because "it's nested" is a real
 * reason and "I forgot" is not — a 26px radius inside another 26px radius
 * reads as a bubble, so an inner strip SHOULD be tighter than the card holding
 * it. Each entry has to say which it is.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(__dirname, '../..');

function tsxFiles(dir: string): string[] {
  return readdirSync(resolve(ROOT, dir), { withFileTypes: true }).flatMap((e) => {
    const rel = `${dir}/${e.name}`;
    if (e.isDirectory()) return e.name === 'node_modules' ? [] : tsxFiles(rel);
    return e.name.endsWith('.tsx') ? [rel] : [];
  });
}

/**
 * Surfaces that carry `bg-card` with a radius smaller than the house one, and
 * why each is allowed to.
 */
const NESTED_BY_DESIGN: Record<string, string> = {
  // An empty-state line INSIDE the integrations card.
  'app/admin/(protected)/integrations/page.tsx:466': 'nested in a card',
  // The Production/Test segmented control — a 28px-tall switch, not a panel.
  'app/admin/(protected)/rentals/[id]/page.tsx:1702': 'a control, not a surface',
  // FilterShell is a verbatim port of the portal's own filter panel. Its
  // `rounded-2xl` is Northwind's, and `admin-responsive-chrome` asserts the
  // two files agree — changing it here would break that parity on purpose.
  'components/admin/filter-primitives.tsx:123': 'matches the portal byte for byte',
  // Rows inside the notifications list container, which IS rounded-4xl.
  'components/admin/notifications-v2/notification-item-panel.tsx:365': 'nested row',
  'components/admin/notifications-v2/notification-item-panel.tsx:638': 'nested fieldset',
  'components/admin/notifications-v2/notification-item-panel.tsx:815': 'nested alert',
};

const SMALL_RADIUS_ON_CARD =
  /className="[^"]*rounded-(sm|md|lg|xl|2xl|3xl)\b[^"]*bg-card|className="[^"]*bg-card[^"]*rounded-(sm|md|lg|xl|2xl|3xl)\b/;

describe('card surfaces share one radius', () => {
  const files = tsxFiles('app').concat(tsxFiles('components'));

  it('has cards to check', () => {
    const housed = files.filter((f) => /rounded-4xl[^"]*bg-card|bg-card[^"]*rounded-4xl/.test(readFileSync(resolve(ROOT, f), 'utf8')));
    expect(housed.length).toBeGreaterThan(3);
  });

  it('has no unexplained odd one out', () => {
    const offenders: string[] = [];
    for (const f of files) {
      const lines = readFileSync(resolve(ROOT, f), 'utf8').split('\n');
      lines.forEach((line, i) => {
        if (!SMALL_RADIUS_ON_CARD.test(line)) return;
        const key = `${f}:${i + 1}`;
        if (key in NESTED_BY_DESIGN) return;
        offenders.push(`${key} — ${line.trim().slice(0, 90)}`);
      });
    }
    // A new one here is not automatically wrong. It needs a line in
    // NESTED_BY_DESIGN saying why it is nested, or the house shape.
    expect(offenders).toEqual([]);
  });

  it('keeps the allow-list honest', () => {
    // An entry that no longer matches anything is stale and hides the next
    // real offender behind a false sense of coverage.
    const stale: string[] = [];
    for (const key of Object.keys(NESTED_BY_DESIGN)) {
      const [f, n] = key.split(':');
      const line = readFileSync(resolve(ROOT, f), 'utf8').split('\n')[Number(n) - 1] ?? '';
      if (!SMALL_RADIUS_ON_CARD.test(line)) stale.push(key);
    }
    expect(stale).toEqual([]);
  });

  it('pins the house shape in the primitive everything else copies', () => {
    const card = readFileSync(resolve(ROOT, 'components/ui/card.tsx'), 'utf8');
    expect(card).toContain('rounded-4xl');
    expect(card).toContain('ring-1 ring-foreground/10');
    expect(card).toContain('shadow-sm');
  });

  it('defines the radius it names, rather than silently rendering square', () => {
    // Tailwind 3 ships no `rounded-4xl`. Without this entry the class would
    // compile to nothing and every card in the app would have sharp corners.
    const cfg = readFileSync(resolve(ROOT, 'tailwind.config.ts'), 'utf8');
    expect(cfg).toMatch(/"4xl":\s*"var\(--v2-radius-4xl/);
  });
});
