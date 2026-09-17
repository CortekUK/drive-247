/**
 * Team lead, Sep 16 2026 (v2 canary only):
 *
 *   1. Every clickable control shows the hand/pointer cursor on hover.
 *   2. Hovers are a light purple tint, never white or grey, and buttons never
 *      sit on a white background.
 *
 * Both are delivered WITHOUT changing what the other tenants see:
 *   - the cursor rules live in styles/v2-theme.css under `.v2-theme`;
 *   - `--accent` is swapped only inside `.v2-theme`;
 *   - the ui-v2 Button (which also renders for v1 tenants) reads
 *     `var(--v2-hover, <its old token>)`, and only `.v2-theme` defines
 *     `--v2-hover`, so the fallback is exactly the old colour everywhere else.
 *
 * Source-reading on purpose: jsdom has no cascade, so a render test could not
 * see a cursor or a hover colour. What it CAN pin is that the rules exist, stay
 * scoped, and never name a Tailwind utility as a class selector (that file
 * @applies utilities; a `.rounded-lg`-style selector is a circular-dependency
 * build error that 500s every page).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { buttonVariants } from '@/components/ui-v2/button';
import { cn } from '@/lib/utils';

const SRC = join(__dirname, '..', '..');
const read = (rel: string) => readFileSync(join(SRC, rel), 'utf8');

const theme = read('styles/v2-theme.css');

const stripComments = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, '');

/** The first `{ … }` body whose selector is exactly `selector`. */
function tokenBlock(selector: string): string {
  const css = stripComments(theme);
  const re = new RegExp(`(^|\\n)${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{([^}]*)\\}`);
  const m = css.match(re);
  if (!m) throw new Error(`no block for ${selector}`);
  return m[2];
}

const decl = (block: string, prop: string) => {
  const m = block.match(new RegExp(`${prop}:\\s*([^;]+);`));
  return m ? m[1].trim() : undefined;
};

const MARKER = 'Pointer cursor on clickable controls';
const END_MARKER = 'end: pointer cursor on clickable controls';

/** Every rule (selector + body) between the cursor block's two markers. */
function cursorRules(): { selector: string; body: string }[] {
  const at = theme.indexOf(MARKER);
  const end = theme.indexOf(END_MARKER);
  expect(at).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(at);
  const css = stripComments(theme.slice(theme.lastIndexOf('/*', at), theme.lastIndexOf('/*', end)));
  const rules: { selector: string; body: string }[] = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(css))) rules.push({ selector: m[1].trim(), body: m[2].trim() });
  return rules;
}

describe('v2 pointer cursor block (styles/v2-theme.css)', () => {
  const rules = cursorRules();
  const selectors = rules.map((r) => r.selector).join('\n');

  it('exists, and only ever sets cursor: pointer', () => {
    expect(rules.length).toBeGreaterThanOrEqual(2);
    for (const r of rules) expect(r.body).toBe('cursor: pointer;');
  });

  it('covers menu, select and cmdk items, tabs, toggles and native controls', () => {
    for (const needle of [
      '[role="menuitem"]',
      '[role="menuitemcheckbox"]',
      '[role="menuitemradio"]',
      '[role="option"]',
      '[role="tab"]',
      '[role="switch"]',
      '[role="checkbox"]',
      '[role="radio"]',
      'input[type="checkbox"]',
      'input[type="radio"]',
      'input[type="color"]',
      'summary',
    ]) {
      expect(selectors).toContain(needle);
    }
    expect(selectors).toMatch(/(^|[\s,(])select\s*,/);
    // Toggle labels.
    expect(selectors).toContain('label:has(');
  });

  it('leaves disabled controls alone, and never excludes on a bare [data-disabled]', () => {
    expect(selectors).toContain(':disabled');
    expect(selectors).toContain('[data-disabled=""]');
    // cmdk writes data-disabled="false" on ENABLED items; a bare attribute
    // match would take the hand away from every cmdk result.
    expect(selectors).toContain('[data-disabled="true"]');
    expect(selectors).not.toMatch(/\[data-disabled\]/);
    expect(selectors).toContain('[aria-disabled="true"]');
    for (const keep of ['cursor-not-allowed', 'cursor-grab', 'cursor-move', 'cursor-help', 'cursor-text']) {
      expect(selectors).toContain(`[class~="${keep}"]`);
    }
  });

  it('does not touch [role=button] (drag handles), [role=combobox] (cmdk input) or a bare label[for]', () => {
    expect(selectors).not.toContain('[role="button"]');
    // The control list of the first rule (everything before its `):not(`).
    const controlList = rules[0].selector.slice(0, rules[0].selector.indexOf('):not('));
    expect(controlList).toContain('[role="menuitem"]');
    expect(controlList).not.toContain('[role="combobox"]');
    expect(controlList).not.toContain('label');
    expect(selectors).not.toMatch(/\.v2-theme label\[for\]\s*(,|$)/m);
  });

  it('is scoped to .v2-theme, and names no class other than .v2-theme', () => {
    for (const r of rules) {
      for (const sel of r.selector.split(/,(?![^(]*\))/)) {
        expect(sel.trim().startsWith('.v2-theme ')).toBe(true);
      }
      // Any `.name` class token other than the scope is a potential Tailwind
      // utility redefinition (circular @apply). Attribute strings such as
      // [class~="cursor-grab"] are fine and are removed before the check.
      const classTokens = r.selector
        .replace(/\[[^\]]*\]/g, '')
        .match(/\.[A-Za-z_\\-][\w\\:/-]*/g) ?? [];
      expect(classTokens.filter((t) => t !== '.v2-theme')).toEqual([]);
    }
  });
});

describe('v2 hover tokens (styles/v2-theme.css)', () => {
  const light = tokenBlock('.v2-theme');
  const dark = tokenBlock('.dark .v2-theme');

  it('light: --accent and --v2-hover are the light purple, the outline fill is transparent', () => {
    expect(decl(light, '--accent')).toBe('248 68% 95%');
    expect(decl(light, '--v2-hover')).toBe('248 68% 95%');
    expect(decl(light, '--v2-outline-fill')).toBe('transparent');
    // Deliberately unchanged: destructive menu items use it, and --muted is a resting fill.
    expect(decl(light, '--accent-foreground')).toBe('0 0% 9%');
    expect(decl(light, '--muted')).toBe('0 0% 96%');
  });

  it('dark: --accent and --v2-hover are the dark indigo tint', () => {
    expect(decl(dark, '--accent')).toBe('246 35% 17%');
    expect(decl(dark, '--v2-hover')).toBe('246 35% 17%');
    expect(decl(dark, '--accent-foreground')).toBe('0 0% 98%');
    expect(decl(dark, '--muted')).toBe('0 0% 15%');
  });

  it('--v2-hover and --v2-outline-fill are defined nowhere outside .v2-theme', () => {
    const global = read('global.css');
    expect(global).not.toContain('--v2-hover');
    expect(global).not.toContain('--v2-outline-fill');
  });
});

describe('ui-v2 Button hover (components/ui-v2/button.tsx)', () => {
  const variants = ['outline', 'ghost', 'secondary'] as const;

  it.each(variants)('%s: no grey or white hover, and the hover reads --v2-hover', (variant) => {
    const cls = buttonVariants({ variant }).split(/\s+/);
    const hovers = cls.filter((c) => /(^|:)hover:bg-/.test(c) || /(^|:)aria-expanded:bg-/.test(c));
    expect(hovers.length).toBeGreaterThan(0);
    for (const h of hovers) {
      expect(h).toContain('var(--v2-hover,');
      expect(h).not.toMatch(/hover:bg-(muted|secondary|background|white|input)(\/|$)/);
    }
    expect(cls).not.toContain('hover:bg-muted');
    expect(cls).not.toContain('hover:bg-background');
    expect(cls).not.toContain('hover:bg-white');
  });

  it('outline: the resting fill is not a bare white bg-background', () => {
    const cls = buttonVariants({ variant: 'outline' }).split(/\s+/);
    expect(cls).not.toContain('bg-background');
    expect(cls).toContain('bg-[var(--v2-outline-fill,hsl(var(--background)))]');
  });

  it('falls back to exactly the old v1 tokens when --v2-hover is undefined', () => {
    const outline = buttonVariants({ variant: 'outline' });
    expect(outline).toContain('hover:bg-[hsl(var(--v2-hover,var(--muted)))]');
    expect(outline).toContain('dark:hover:bg-[hsl(var(--v2-hover,var(--input)_/_0.3))]');
    expect(outline).toContain('dark:bg-transparent');
    const ghost = buttonVariants({ variant: 'ghost' });
    expect(ghost).toContain('hover:bg-[hsl(var(--v2-hover,var(--muted)))]');
    expect(ghost).toContain('dark:hover:bg-[hsl(var(--v2-hover,var(--muted)_/_0.5))]');
    const secondary = buttonVariants({ variant: 'secondary' });
    expect(secondary).toContain('hover:bg-[hsl(var(--v2-hover,var(--secondary)_/_0.8))]');
  });

  it("a call site's own hover still wins over the variant's (tailwind-merge)", () => {
    const merged = cn(buttonVariants({ variant: 'ghost', className: 'hover:bg-primary/10' })).split(/\s+/);
    expect(merged).toContain('hover:bg-primary/10');
    expect(merged.some((c) => c.startsWith('hover:bg-[hsl(var(--v2-hover'))).toBe(false);
    const outline = cn(buttonVariants({ variant: 'outline', className: 'bg-card' })).split(/\s+/);
    expect(outline).toContain('bg-card');
    expect(outline.some((c) => c.startsWith('bg-[var(--v2-outline-fill'))).toBe(false);
  });
});

describe('v2-only primitives highlight with the purple, not grey', () => {
  it('ui-v2 dropdown content no longer paints items bg-foreground/15 (items use their own focus:bg-accent)', () => {
    const dd = read('components/ui-v2/dropdown-menu.tsx');
    const lightContent = dd.split('\n').find((l) => l.includes('min-w-48') && l.includes('rounded-3xl'))!;
    expect(lightContent).toBeDefined();
    expect(lightContent).not.toContain('bg-foreground/15');
    expect(dd).not.toMatch(/\[data-slot\$=-item\][^\s"]*\]:bg-foreground\//);
  });

  it('ui-v2 select: the dark-tone island uses a literal indigo, the surface tone falls back to the item accent', () => {
    const sel = read('components/ui-v2/select.tsx');
    expect(sel).not.toMatch(/\[data-slot\$=-item\][^\s"]*\]:bg-foreground\//);
    expect(sel).toContain('[&[data-tone=dark]_[data-slot$=-item][data-highlighted]]:bg-indigo-300/20');
    expect(sel).toContain('focus:bg-accent');
  });

  it('ui-v2 table rows hover and select in primary, not muted', () => {
    const table = read('components/ui-v2/table.tsx');
    expect(table).toContain('hover:bg-primary/5');
    expect(table).toContain('data-[state=selected]:bg-primary/10');
    expect(table).not.toContain('hover:bg-muted/50');
  });

  it('messages (shared with v1) reads --v2-hover with the old foreground/10 as its fallback', () => {
    expect(read('components/messages-v2/attachment-list.tsx')).toContain(
      'hover:bg-[hsl(var(--v2-hover,var(--foreground)_/_0.1))]',
    );
    expect(read('components/messages-v2/conversation-view.tsx')).toContain(
      'hover:bg-[hsl(var(--v2-hover,var(--foreground)_/_0.1))]',
    );
  });
});
