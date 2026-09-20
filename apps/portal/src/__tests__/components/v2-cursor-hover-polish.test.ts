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

import { render } from '@testing-library/react';
import { createElement } from 'react';
import { describe, expect, it } from 'vitest';

import { buttonVariants } from '@/components/ui-v2/button';
import { V2_BRAND_VAR_NAMES } from '@/lib/appearance/color';
import { TableRow } from '@/components/ui-v2/table';
import { toggleVariants } from '@/components/ui-v2/toggle';
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

/** The default brand parameters declared on `.v2-theme`. */
function stylesheetBrand(): Record<string, string> {
  const light = tokenBlock('.v2-theme');
  return {
    '--brand-h': decl(light, '--brand-h')!,
    '--brand-s': decl(light, '--brand-s')!,
    '--brand-l': decl(light, '--brand-l')!,
  };
}

/**
 * A brand-derived token as it computes with the stylesheet's default brand
 * (the `--brand-*` values on `.v2-theme`) and none of the hook's optional vars.
 * Resolves `var()` innermost-first (an unset optional var takes its fallback),
 * then `calc(a ± b)`, then normalises spacing.
 */
function withDefaultBrand(value: string, defaults: Record<string, string> = stylesheetBrand()): string {
  let out = value;
  const innermostVar = /var\((--[\w-]+)\s*(?:,\s*([^()]*))?\)/;
  for (let m = out.match(innermostVar); m; m = out.match(innermostVar)) {
    const resolved = defaults[m[1]] ?? m[2]?.trim();
    if (resolved === undefined) throw new Error(`${m[1]} has no default and no fallback in: ${value}`);
    out = out.replace(m[0], resolved);
  }
  out = out.replace(/calc\(\s*(-?[\d.]+)(%?)\s*([+-])\s*([\d.]+)(%?)\s*\)/g, (_all, a, pa, op, b, pb) => {
    const n = op === '+' ? Number(a) + Number(b) : Number(a) - Number(b);
    return `${Number(n.toFixed(4))}${pa || pb ? '%' : ''}`;
  });
  return out.replace(/\s+/g, ' ').trim();
}

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

  it('light: --accent and --v2-hover are the light brand tint, the outline fill is transparent', () => {
    // Derived from the brand (S20b), so a saved colour re-tints every hover…
    expect(decl(light, '--accent')).toBe('var(--brand-h) var(--brand-s) 95%');
    expect(decl(light, '--v2-hover')).toBe('var(--brand-h) var(--brand-s) 95%');
    // …and with the default brand they are exactly the old light purple.
    expect(withDefaultBrand(decl(light, '--accent')!)).toBe('248 68% 95%');
    expect(withDefaultBrand(decl(light, '--v2-hover')!)).toBe('248 68% 95%');
    expect(decl(light, '--v2-outline-fill')).toBe('transparent');
    // Deliberately unchanged: destructive menu items use it, and --muted is a resting fill.
    expect(decl(light, '--accent-foreground')).toBe('0 0% 9%');
    expect(decl(light, '--muted')).toBe('0 0% 96%');
  });

  it('dark: --accent and --v2-hover are the dark brand tint', () => {
    expect(decl(dark, '--accent')).toBe('calc(var(--brand-h) - 2) calc(var(--brand-s) - 33%) 17%');
    expect(decl(dark, '--v2-hover')).toBe('calc(var(--brand-h) - 2) calc(var(--brand-s) - 33%) 17%');
    expect(withDefaultBrand(decl(dark, '--accent')!)).toBe('246 35% 17%');
    expect(withDefaultBrand(decl(dark, '--v2-hover')!)).toBe('246 35% 17%');
    expect(decl(dark, '--accent-foreground')).toBe('0 0% 98%');
    expect(decl(dark, '--muted')).toBe('0 0% 15%');
  });

  it('--v2-row-hover is the half tint in light and the full tint in dark', () => {
    expect(decl(light, '--v2-row-hover')).toBe('var(--brand-h) var(--brand-s) 97.5%');
    expect(withDefaultBrand(decl(light, '--v2-row-hover')!)).toBe('248 68% 97.5%');
    expect(withDefaultBrand(decl(dark, '--v2-row-hover')!)).toBe('246 35% 17%');
  });

  it('--v2-hover, --v2-row-hover and --v2-outline-fill are defined nowhere outside .v2-theme', () => {
    const global = read('global.css');
    expect(global).not.toContain('--v2-hover');
    expect(global).not.toContain('--v2-row-hover');
    expect(global).not.toContain('--v2-outline-fill');
  });
});

describe('ui-v2 Button hover (components/ui-v2/button.tsx)', () => {
  const variants = ['outline', 'ghost', 'secondary'] as const;
  /** What <Button> actually renders: the cva output through tailwind-merge. */
  const merged = (variant: (typeof variants)[number] | 'link' | 'default' | 'destructive', className?: string) =>
    cn(buttonVariants({ variant, className })).split(/\s+/);

  it.each(variants)('%s: no grey or white hover, and the hover reads --v2-hover', (variant) => {
    const cls = merged(variant);
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
    const cls = merged('outline');
    expect(cls).not.toContain('bg-background');
    expect(cls).toContain('bg-[var(--v2-outline-fill,hsl(var(--background)))]');
  });

  it('falls back to exactly the old v1 tokens when --v2-hover is undefined', () => {
    const outline = merged('outline');
    expect(outline).toContain('hover:bg-[hsl(var(--v2-hover,var(--muted)))]');
    expect(outline).toContain('dark:hover:bg-[hsl(var(--v2-hover,var(--input)_/_0.3))]');
    expect(outline).toContain('dark:bg-transparent');
    const ghost = merged('ghost');
    expect(ghost).toContain('hover:bg-[hsl(var(--v2-hover,var(--muted)))]');
    expect(ghost).toContain('dark:hover:bg-[hsl(var(--v2-hover,var(--muted)_/_0.5))]');
    const secondary = merged('secondary');
    expect(secondary).toContain('hover:bg-[hsl(var(--v2-hover,var(--secondary)_/_0.8))]');
  });

  it("a call site's own hover still wins over the variant's (tailwind-merge)", () => {
    const ghost = merged('ghost', 'hover:bg-primary/10');
    expect(ghost).toContain('hover:bg-primary/10');
    expect(ghost.some((c) => c.startsWith('hover:bg-[hsl(var(--v2-hover'))).toBe(false);
    const outline = merged('outline', 'bg-card');
    expect(outline).toContain('bg-card');
    expect(outline.some((c) => c.startsWith('bg-[var(--v2-outline-fill'))).toBe(false);
    const link = merged('link', 'text-muted-foreground');
    expect(link).toContain('text-muted-foreground');
    expect(link.some((c) => c.startsWith('text-[hsl(var(--v2-link'))).toBe(false);
  });

  // Lens 4 (shared v1 files only ADD lines): this Button renders for v1 tenants,
  // so the v2 tints ride in `compoundVariants` and the variant strings stay
  // byte-for-byte what they were at 40a523be.
  const ORIGINAL = {
    outline: 'border-border bg-background hover:bg-muted hover:text-foreground aria-expanded:bg-muted aria-expanded:text-foreground dark:bg-transparent dark:hover:bg-input/30',
    secondary: 'bg-secondary text-secondary-foreground hover:bg-secondary/80 aria-expanded:bg-secondary aria-expanded:text-secondary-foreground',
    ghost: 'hover:bg-muted hover:text-foreground aria-expanded:bg-muted aria-expanded:text-foreground dark:hover:bg-muted/50',
    link: 'text-primary underline-offset-4 hover:underline',
  };
  // What <Button> rendered at HEAD f2d267de, where those strings were rewritten in place.
  const RENDERED_BEFORE = {
    outline: 'border-border bg-[var(--v2-outline-fill,hsl(var(--background)))] hover:bg-[hsl(var(--v2-hover,var(--muted)))] hover:text-foreground aria-expanded:bg-[hsl(var(--v2-hover,var(--muted)))] aria-expanded:text-foreground dark:bg-transparent dark:hover:bg-[hsl(var(--v2-hover,var(--input)_/_0.3))]',
    secondary: 'bg-secondary text-secondary-foreground hover:bg-[hsl(var(--v2-hover,var(--secondary)_/_0.8))] aria-expanded:bg-[hsl(var(--v2-hover,var(--secondary)))] aria-expanded:text-secondary-foreground',
    ghost: 'hover:bg-[hsl(var(--v2-hover,var(--muted)))] hover:text-foreground aria-expanded:bg-[hsl(var(--v2-hover,var(--muted)))] aria-expanded:text-foreground dark:hover:bg-[hsl(var(--v2-hover,var(--muted)_/_0.5))]',
  };

  it('keeps the original variant strings verbatim, with the v2 tints in compoundVariants', () => {
    const src = read('components/ui-v2/button.tsx');
    for (const [variant, str] of Object.entries(ORIGINAL)) {
      expect(src, variant).toContain(`"${str}"`);
    }
    expect(src).toContain('compoundVariants: [');
  });

  it.each(['outline', 'secondary', 'ghost'] as const)('%s: renders exactly the same class set as before the move', (variant) => {
    const base = cn(buttonVariants({ variant: 'default' })).split(/\s+/).filter((c) => !['bg-primary', 'text-primary-foreground', 'hover:bg-primary/80'].includes(c));
    const expected = new Set(cn([...base, RENDERED_BEFORE[variant]].join(' ')).split(/\s+/));
    expect(new Set(merged(variant))).toEqual(expected);
  });

  it('link: v2 reads --v2-link (the brand, readable), v1 falls back to --primary', () => {
    const link = merged('link');
    expect(link).toContain('text-[hsl(var(--v2-link,var(--primary)))]');
    expect(link).not.toContain('text-primary');
    const css = stripComments(theme);
    // Dark: light brand text, indigo-300's 82% by default.
    expect(withDefaultBrand(decl(tokenBlock('.dark .v2-theme'), '--v2-link')!)).toBe('230 94% 82%');
    // Light: the brand at its own lightness, or the deeper --brand-link-l the
    // hook writes for a pale brand. By default it is --primary exactly, so the
    // link variant renders as it did before light v2 defined the token.
    const lightLink = decl(tokenBlock('.v2-theme'), '--v2-link')!;
    expect(lightLink).toBe('var(--brand-h) var(--brand-s) var(--brand-link-l, var(--brand-l))');
    expect(withDefaultBrand(lightLink)).toBe(withDefaultBrand(decl(tokenBlock('.v2-theme'), '--primary')!));
    expect(withDefaultBrand(lightLink)).toBe('248 68% 51%');
    expect(css.match(/--v2-link\s*:/g)?.length).toBe(2);
    expect(read('global.css')).not.toContain('--v2-link');
  });
});

describe('v2-only primitives highlight with the purple, not grey', () => {
  // Each reads `--v2-hover` with its OLD token as the fallback, so outside
  // `.v2-theme` (v1, or a tenant widened for chrome but not theme) the primitive
  // renders exactly as it did, instead of the tenant's solid accent colour.
  it('ui-v2 dropdown content: item, trigger and destructive highlights read --v2-hover over the old foreground/15', () => {
    const dd = read('components/ui-v2/dropdown-menu.tsx');
    const content = dd.split('\n').find((l) => l.includes('min-w-48') && l.includes('rounded-3xl'))!;
    expect(content).toBeDefined();
    const F15 = 'bg-[hsl(var(--v2-hover,var(--foreground)_/_0.15))]';
    expect(content).toContain(`[&_[data-slot$=-item]:focus]:${F15}`);
    expect(content).toContain(`[&_[data-slot$=-item][data-highlighted]]:${F15}`);
    expect(content).toContain(`[&_[data-slot$=-trigger][aria-expanded=true]]:!${F15}`);
    expect(content).toContain(`[&_[data-variant=destructive]:focus]:!${F15}`);
    expect(content).not.toContain('bg-foreground/15');
  });

  it('forced-dark islands (dark-tone Select, dropdown submenu) set their own violet --v2-hover and an ivory highlighted label', () => {
    // Inside a `.dark` island the page's light --v2-hover would be a pale bar
    // under ivory text, and v1's dark --accent-foreground is near-black.
    // violet-500/30 (258 90% 66%) by default, as a brand offset: hue +10,
    // saturation +22 points. The var fallbacks are the default brand, so a v1
    // render (no --brand-*) computes to 258 90% 66% exactly.
    const island = '[--v2-hover:calc(var(--brand-h,248)_+_10)_calc(var(--brand-s,68%)_+_22%)_66%_/_0.3] [--accent-foreground:var(--popover-foreground)]';
    // No --brand-* at all (v1): the fallbacks alone.
    expect(withDefaultBrand('calc(var(--brand-h,248) + 10) calc(var(--brand-s,68%) + 22%) 66%', {})).toBe('258 90% 66%');
    const sel = read('components/ui-v2/select.tsx');
    expect(sel).toContain(`tone === "dark" ? "dark bg-popover/70 ${island}"`);
    expect(sel).toContain('[&_[data-slot$=-item][data-highlighted]]:bg-[hsl(var(--v2-hover,var(--foreground)_/_0.1))]');
    expect(sel).not.toContain('indigo-300/20');
    expect(sel).toContain('focus:text-accent-foreground');
    const dd = read('components/ui-v2/dropdown-menu.tsx');
    const sub = dd.split('\n').find((l) => l.includes('"dark ') && l.includes('min-w-36'))!;
    expect(sub).toContain(`"dark ${island}`);
    expect(sub).toContain('[&_[data-slot$=-item][data-highlighted]]:bg-[hsl(var(--v2-hover))]');
    expect(sub).not.toContain('indigo-300/20');
  });

  it('ui-v2 command and toggle fall back to their old muted fill', () => {
    expect(read('components/ui-v2/command.tsx')).toContain('data-[selected=true]:bg-[hsl(var(--v2-hover,var(--muted)))]');
    const toggle = toggleVariants({ variant: 'outline' });
    expect(toggle).toContain('hover:bg-[hsl(var(--v2-hover,var(--muted)))]');
    expect(toggle).toContain('aria-pressed:bg-[hsl(var(--v2-hover,var(--muted)))]');
    // Dark --primary is a deep indigo: as text on a dark surface it measures ~1.9:1.
    expect(toggle).not.toMatch(/(^|\s)aria-pressed:text-primary(\s|$)/);
    expect(toggle).not.toMatch(/bg-primary\/1[05]/);
  });

  it('ui-v2 table rows: one hover class with the old muted fallback, and a call site\'s hover:bg-transparent wins in the class list', () => {
    const table = read('components/ui-v2/table.tsx');
    expect(table).toContain('hover:bg-[hsl(var(--v2-row-hover,var(--muted)_/_0.5))]');
    expect(table).toContain('data-[state=selected]:bg-[hsl(var(--v2-hover,var(--muted)))]');
    // A `dark:hover:` twin out-ranks a call site's `hover:bg-transparent` in the
    // cascade and tailwind-merge keeps both, which tinted every list header.
    expect(table).not.toMatch(/dark:hover:bg-/);

    const row = (className: string) => {
      const { container } = render(createElement('table', null, createElement('tbody', null, createElement(TableRow, { className }))));
      return container.querySelector('tr')!.className.split(/\s+/);
    };
    const header = row('border-b hover:bg-transparent');
    expect(header).toContain('hover:bg-transparent');
    expect(header.filter((c) => /(^|:)hover:bg-/.test(c))).toEqual(['hover:bg-transparent']);
    const pinned = row('bg-muted/30 hover:bg-muted/30');
    expect(pinned.filter((c) => /(^|:)hover:bg-/.test(c))).toEqual(['hover:bg-muted/30']);
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

/**
 * Light brand text for dark mode. It started as Tailwind's `indigo-300`; S20b
 * (saved colour re-themes the v2 portal) moved every owned v2 surface to
 * `--v2-link`, which is indigo-300's 230 94% 82% by default and follows the
 * brand. ui-v2 primitives, which can render outside `.v2-theme`, fall back to
 * indigo-300 itself (#a5b4fc = hsl(229.66 93.55% 81.76%)); v2-only files fall
 * back to --primary. Shared files owned elsewhere still carry `indigo-300`.
 */
const V2_LINK_CLASS = String.raw`\[hsl\(var\(--v2-link,(?:var\(--primary\)|229\.66_93\.55%_81\.76%)\)\)\]`;
const DARK_LIGHT_TEXT = String.raw`(?:indigo-300|${V2_LINK_CLASS})`;
const DARK_LIGHT_RIM = String.raw`(?:indigo-300\/(?:30|40|50)\b|\[hsl\(var\(--v2-link,(?:var\(--primary\)|229\.66_93\.55%_81\.76%)\)_\/_0\.[345]\)\])`;
const LINK = 'hsl(var(--v2-link,var(--primary)))';
/** The same token as a border tint: `hsl(<link> / <alpha>)`, Tailwind-escaped. */
const RIM = (alpha: number) => `hsl(var(--v2-link,var(--primary))_/_${alpha})`;
const UI_LINK = 'hsl(var(--v2-link,229.66_93.55%_81.76%))';

describe('v2 dark hovers stay visible and readable', () => {
  const FILES = [
    'app/(dashboard)/insights/_receipt.tsx',
    'app/(dashboard)/integrations/_panels/_kit.tsx',
    'app/(dashboard)/integrations/_panels/custom-domain.tsx',
    'app/(dashboard)/integrations/_panels/twilio-calling.tsx',
    'app/(dashboard)/integrations/_panels/twilio-messages.tsx',
    'app/(dashboard)/integrations/integrations-board.tsx',
    'components/availability-v2/day-editor.tsx',
    'components/availability-v2/week-calendar.tsx',
    'components/cms-v2/cms-page-editor.tsx',
    'components/customers-v2/customer-detail/kit.tsx',
    'components/rentals-v2/booking-mode-selector.tsx',
    'components/rentals-v2/customer-step.tsx',
    'components/rentals-v2/rental-create-v2.tsx',
    'components/rentals-v2/rental-detail/_kit.tsx',
    'components/rentals-v2/rental-detail/payments-segments.tsx',
    'components/rentals-v2/rental-detail/rail-extensions.tsx',
    'components/rentals-v2/vehicle-step.tsx',
    'components/shared/filter-primitives.tsx',
    'components/shared/layout/app-sidebar-v2.tsx',
    'components/shared/layout/org-switcher.tsx',
    'components/shared/layout/sidebar-customizer-dialog.tsx',
    'components/shared/layout/user-menu-v2.tsx',
    'components/turo-bridge/vehicle-mapping-queue.tsx',
    'components/ui-v2/badge.tsx',
    'components/ui-v2/date-time-picker.tsx',
    'components/vehicles-v2/kit.tsx',
    // Team lead review, Sep 17 2026: list tables, dashboard, availability and
    // the user menu (v2-only), plus the messages and guides markup that v1
    // shares, which reads --v2-hover with its old token as the fallback.
    'app/(dashboard)/blocked-customers/page.tsx',
    'components/admin-v2/audit-logs-table-v2.tsx',
    'components/admin-v2/users-table-v2.tsx',
    'components/agreements-v2/agreements-table-v2.tsx',
    'components/availability-v2/availability-v2.tsx',
    'components/availability-v2/weekly-hours-card.tsx',
    'components/blacklist-v2/global-blacklist-table-v2.tsx',
    'components/cms-v2/blog-categories-table-v2.tsx',
    'components/cms-v2/blog-posts-table-v2.tsx',
    'components/credits-v2/credit-transactions-table-v2.tsx',
    'components/customers-v2/blocked-customers-tables-v2.tsx',
    'components/dashboard-v2/money-at-risk.tsx',
    'components/dashboard-v2/needs-you-now.tsx',
    'components/dashboard-v2/on-the-move-today.tsx',
    'components/dashboard-v2/setup-guide.tsx',
    'components/dashboard-v2/where-you-stand.tsx',
    'components/explainers/explainer.tsx',
    'components/fleet-v2/pending-bookings-table-v2.tsx',
    'components/fleet-v2/plates-table-v2.tsx',
    'components/insurance-v2/insurance-policies-table-v2.tsx',
    'components/insurance-v2/insurance-verifications-table-v2.tsx',
    'components/invoices-v2/invoices-table-v2.tsx',
    'components/invoices-v2/payment-requests-table-v2.tsx',
    'components/messages-v2/attach-menu.tsx',
    'components/messages-v2/conversation-rail.tsx',
    'components/messages-v2/customer-context.tsx',
    'components/settings-v2/extras-table-v2.tsx',
    'components/settings-v2/promo-codes-table-v2.tsx',
    'components/shared/hero-chart-v2.tsx',
    'components/vehicles-v2/vehicles-overview.tsx',
    // InstallmentSettings and usage-dashboard are NOT here: their v1 branch
    // keeps `hover:bg-muted/40` verbatim on purpose. See the shared-markup block below.
  ];
  /** Every string literal (quoted or template) that carries a class list. */
  const classStrings = (src: string) => src.match(/"[^"\n]*"|'[^'\n]*'|`[^`]*`/g) ?? [];
  /**
   * A hover equal to its own resting fill is no hover at all: the global
   * blacklist's expanded details row pins `bg-muted/30 hover:bg-muted/30` so
   * the ui-v2 row tint does not flash over it. Removed before the grey check.
   */
  const withoutPinnedFills = (src: string) => src.replace(/(^|[\s"'`])bg-([\w/.[\]-]+) hover:bg-\2(?=[\s"'`])/g, '$1');

  it.each(FILES)('%s: no dark primary/10-15 hover wash (it measures ~1.05:1 on the dark card)', (file) => {
    const src = read(file);
    expect(src).not.toMatch(/dark:(hover:|data-\[state=open\]:)?bg-primary\/1[05]\b/);
    expect(withoutPinnedFills(src)).not.toMatch(/(^|[\s"'`])hover:bg-muted(\/\d+)?(?=[\s"'`])/);
  });

  it('the pinned-fill exception only removes a hover that repeats its own resting fill', () => {
    expect(withoutPinnedFills('"bg-muted/30 hover:bg-muted/30"')).toBe('""');
    expect(withoutPinnedFills('"bg-card hover:bg-muted/30"')).toMatch(/hover:bg-muted\/30/);
    expect(withoutPinnedFills('"bg-muted/30 hover:bg-muted/40"')).toMatch(/hover:bg-muted\/40/);
  });

  const V2_DARK = /dark:(\[a&\]:)?hover:bg-\[hsl\(var\(--v2-hover,var\(--muted\)\)\)\]/;

  it.each(FILES)('%s: a faint light option hover (border + primary/5) has a dark tint and a dark border beside it', (file) => {
    for (const str of classStrings(read(file))) {
      if (/hover:border-primary\/(30|40)\b/.test(str) && /(^|[\s"'`])hover:bg-primary\/5(?=[\s"'`])/.test(str)) {
        expect(str, str).toMatch(V2_DARK);
        // primary/30-40 over the dark card is darker than the resting 10% white hairline.
        expect(str, str).toMatch(new RegExp(`dark:hover:border-${DARK_LIGHT_RIM}`));
      }
    }
  });

  it.each(FILES)('%s: a control that tints on hover AND turns primary carries a light indigo for dark', (file) => {
    // Scoped to the class strings this polish touched (they carry the
    // --v2-hover dark tint); older untouched `hover:text-primary` sites are a
    // separate follow-up.
    for (const str of classStrings(read(file))) {
      if (V2_DARK.test(str) && /(^|[\s"'`])(\[a&\]:)?hover:text-primary(?=[\s"'`])/.test(str)) {
        // Dark --primary (246 61% 42%) is ~1.7:1 as text on the dark sidebar.
        expect(str, str).toMatch(new RegExp(String.raw`dark:(\[a&\]:)?hover:text-${DARK_LIGHT_TEXT}`));
      }
    }
  });

  it('the sidebar back links, org switcher, user menu and integration pin are among them', () => {
    const LIGHT_HOVER_TEXT = new RegExp(String.raw`dark:(\[a&\]:)?hover:text-${DARK_LIGHT_TEXT}`);
    const count = (file: string) => classStrings(read(file)).filter((str) => V2_DARK.test(str) && LIGHT_HOVER_TEXT.test(str)).length;
    // 7 since Sep 20 2026: the booking-site row's pencil (hover → Branding)
    // is the seventh control in this rail that tints and turns primary.
    expect(count('components/shared/layout/app-sidebar-v2.tsx')).toBe(7);
    // 0 since Sep 20 2026. The org row stopped being a pill wrapping a gear
    // and a menu caret — both of which were controls of this shape — and
    // became ONE link to /settings. Its gear is now decoration inside that
    // link and follows it on `group-hover`, so there is no `hover:text-primary`
    // control left in the file for this rule to have an opinion about. The
    // dark tint on the row itself is still there and still asserted by the
    // grey-hover rule above.
    expect(count('components/shared/layout/org-switcher.tsx')).toBe(0);
    expect(count('components/shared/layout/user-menu-v2.tsx')).toBe(2);
    expect(count('app/(dashboard)/integrations/integrations-board.tsx')).toBe(1);
    expect(count('components/ui-v2/badge.tsx')).toBe(2);
    const rc = classStrings(read('components/rentals-v2/rental-create-v2.tsx')).filter((str) => /hover:border-primary\/40/.test(str) && V2_DARK.test(str));
    expect(rc.length).toBe(6);
  });
});

/** Every `{ … }` rule in v2-theme.css (comments stripped), in source order. */
function allRules(): { selector: string; body: string }[] {
  const css = stripComments(theme).replace(/@keyframes[^{]*\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g, '');
  const out: { selector: string; body: string }[] = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(css))) out.push({ selector: m[1].trim(), body: m[2].trim() });
  return out;
}

describe('v2 table rows: hover, selected and the controls inside stay three distinct steps', () => {
  // Dark --v2-row-hover equalled --v2-hover, so a hovered row, a selected row,
  // a row whose menu is open, and the row's own "..." button hover were all one
  // colour (measured 1.000:1). Selected rows and controls inside rows now get
  // their own step through custom properties only: no background is set here,
  // so in light a call-site hover (hover:bg-transparent, hover:bg-primary/10)
  // still wins. In dark a ui-v2 Button keeps its `dark:hover:bg-…` through
  // tailwind-merge and that out-ranks a plain `hover:`, so a call site that
  // wants its own dark hover also needs the `dark:hover:` twin.
  const rules = allRules();
  const find = (selector: string) => {
    const r = rules.filter((x) => x.selector === selector);
    expect(r, selector).toHaveLength(1);
    return r[0];
  };
  const DARK_SELECTED = ':where(.dark .v2-theme [data-slot="table-row"][data-state="selected"])';
  const DARK_INSIDE = ':where(.dark .v2-theme [data-slot="table-row"]) *';
  const LIGHT_SELECTED_INSIDE = ':where(.v2-theme [data-slot="table-row"][data-state="selected"]) *';
  // Lightness of a derived value, as it computes with the default brand.
  const light = (v: string) => Number(withDefaultBrand(v).split(/\s+/)[2].replace('%', ''));

  it('exist, set only --v2-hover, and carry zero specificity', () => {
    // Hue and saturation follow the brand; the lightness steps are fixed. With
    // the default brand they are the values these rules used to hard-code.
    const WAS: Record<string, string> = {
      [LIGHT_SELECTED_INSIDE]: '248 68% 91%',
      [DARK_SELECTED]: '246 38% 23%',
      [DARK_INSIDE]: '246 38% 29%',
    };
    for (const sel of [DARK_SELECTED, DARK_INSIDE, LIGHT_SELECTED_INSIDE]) {
      const r = find(sel);
      expect(r.body).toMatch(/^--v2-hover:\s*[^;]*var\(--brand-h\)[^;]*var\(--brand-s\)[^;]*;$/);
      expect(withDefaultBrand(decl(r.body, '--v2-hover')!), sel).toBe(WAS[sel]);
      // Only .dark / .v2-theme are named as classes: never a Tailwind utility.
      const classTokens = sel.replace(/\[[^\]]*\]/g, '').match(/\.[A-Za-z_\\-][\w\\:/-]*/g) ?? [];
      expect(classTokens.filter((t) => t !== '.v2-theme' && t !== '.dark')).toEqual([]);
    }
  });

  it('dark: row hover < selected row < control inside a row (lightness), all distinct', () => {
    const darkTokens = tokenBlock('.dark .v2-theme');
    const rowHover = decl(darkTokens, '--v2-row-hover')!;
    const selected = decl(find(DARK_SELECTED).body, '--v2-hover')!;
    const inside = decl(find(DARK_INSIDE).body, '--v2-hover')!;
    expect(light(rowHover)).toBeLessThan(light(selected));
    expect(light(selected)).toBeLessThan(light(inside));
    expect(light(inside) - light(selected)).toBeGreaterThanOrEqual(5);
    expect(light(selected) - light(rowHover)).toBeGreaterThanOrEqual(5);
  });

  it('light: a control inside a selected row is a step deeper than the selected fill', () => {
    const selected = decl(tokenBlock('.v2-theme'), '--v2-hover')!;
    const inside = decl(find(LIGHT_SELECTED_INSIDE).body, '--v2-hover')!;
    expect(light(inside)).toBeLessThan(light(selected));
  });

  it('muted text in a tinted body row reads --v2-muted-on-tint: darker in light, the muted token itself in dark', () => {
    const sel = ':where(.v2-theme tbody > [data-slot="table-row"]:is(:hover, [data-state="selected"], :has([aria-expanded="true"])))';
    expect(find(sel).body).toBe('--muted-foreground: var(--v2-muted-on-tint);');
    expect(decl(tokenBlock('.v2-theme'), '--muted-foreground')).toBe('0 0% 45%');
    expect(decl(tokenBlock('.v2-theme'), '--v2-muted-on-tint')).toBe('0 0% 40%');
    expect(decl(tokenBlock('.dark .v2-theme'), '--v2-muted-on-tint')).toBe('var(--muted-foreground)');
    expect(read('global.css')).not.toContain('--v2-muted-on-tint');
  });

  it('the dark descendant rule comes after the light one (equal specificity, source order decides)', () => {
    const idx = (sel: string) => rules.findIndex((r) => r.selector === sel);
    expect(idx(DARK_INSIDE)).toBeGreaterThan(idx(LIGHT_SELECTED_INSIDE));
  });
});

describe('v2 dark: primary-coloured controls use a light indigo (dark --primary is ~1.9:1 on the dark ground)', () => {
  const classStrings = (src: string): string[] => src.match(/"[^"\n]*"|'[^'\n]*'|`[^`]*`/g) ?? [];
  const V2_HOVER_DARK = 'bg-[hsl(var(--v2-hover,var(--muted)))]';

  const FILES = [
    'components/ui-v2/sidebar.tsx',
    'components/shared/header-icon-button-v2.tsx',
    'components/onboarding/tab-tour-button.tsx',
    'components/shared/layout/top-bar-v2.tsx',
    'components/shared/layout/app-sidebar-v2.tsx',
    'components/shared/filter-primitives.tsx',
    'components/rentals-v2/customer-step.tsx',
    'components/vehicles-v2/kit.tsx',
    'components/rentals-v2/rental-detail/_kit.tsx',
    'components/rentals-v2/booking-mode-selector.tsx',
    'components/cms-v2/cms-page-editor.tsx',
    'app/(dashboard)/integrations/integrations-board.tsx',
  ];

  it.each(FILES)('%s: every hover/active/open text-primary has its dark indigo twin, and no dark primary/15 wash is left', (file) => {
    const src = read(file);
    // A hover/open wash only: a resting `dark:bg-primary/10` ground (the round
    // header icons) is a deliberate faint fill under an indigo ring.
    expect(src).not.toMatch(/dark:(hover:|aria-expanded:|\[&>button:hover\]:|\[&>button\[aria-expanded=true\]\]:)bg-primary\/1[05]\b/);
    for (const str of classStrings(src)) {
      const twin = (variant: string) => new RegExp(`dark:${variant}text-${DARK_LIGHT_TEXT}`);
      const pairs: [RegExp, RegExp][] = [
        [/(^|[\s"'`])hover:text-primary(?=[\s"'`])/, twin('hover:')],
        [/(^|[\s"'`])data-\[active=true\]:text-primary(?=[\s"'`])/, twin(String.raw`data-\[active=true\]:`)],
        [/(^|[\s"'`])\[&:hover_svg\]:text-primary(?=[\s"'`])/, twin(String.raw`\[&:hover_svg\]:`)],
        [/(^|[\s"'`])\[&\[data-active=true\]_svg\]:text-primary(?=[\s"'`])/, twin(String.raw`\[&\[data-active=true\]_svg\]:`)],
        [/(^|[\s"'`])\[&\[data-active=true\]>svg\]:text-primary(?=[\s"'`])/, twin(String.raw`\[&\[data-active=true\]>svg\]:`)],
        [/(^|[\s"'`])aria-expanded:text-primary(?=[\s"'`])/, twin('aria-expanded:')],
      ];
      for (const [light, dark] of pairs) if (light.test(str)) expect(str, `${file}: ${str}`).toMatch(dark);
    }
  });

  it('ui-v2 sidebar menu button: dark hover and active are the v2 tint with a light brand label and icon', () => {
    const src = read('components/ui-v2/sidebar.tsx');
    const base = classStrings(src).find((s) => s.includes('peer/menu-button'))!;
    expect(base).toContain(`dark:data-[active=true]:${V2_HOVER_DARK}`);
    expect(base).toContain(`dark:data-[active=true]:text-[${UI_LINK}]`);
    expect(base).toContain(`dark:[&[data-active=true]_svg]:text-[${UI_LINK}]`);
    const def = classStrings(src).find((s) => s.startsWith('"hover:bg-primary/10 hover:text-primary'))!;
    expect(def).toContain(`dark:hover:${V2_HOVER_DARK}`);
    expect(def).toContain(`dark:hover:text-[${UI_LINK}]`);
    expect(def).toContain(`dark:[&:hover_svg]:text-[${UI_LINK}]`);
    expect(classStrings(src).filter((str) => str.includes('indigo-'))).toEqual([]);
  });

  it.each(['components/shared/header-icon-button-v2.tsx', 'components/onboarding/tab-tour-button.tsx'])(
    '%s: the round header icon is the light brand at rest, on hover and while open, over the v2 tint',
    (file) => {
      const src = read(file);
      for (const needle of [
        `dark:text-[${LINK}]`,
        `dark:border-[${RIM(0.3)}]`,
        `dark:hover:${V2_HOVER_DARK}`,
        `dark:hover:text-[${LINK}]`,
        `dark:hover:border-[${RIM(0.5)}]`,
      ]) {
        expect(src, needle).toContain(needle);
      }
      if (file.includes('header-icon')) {
        expect(src).toContain(`dark:aria-expanded:${V2_HOVER_DARK}`);
        expect(src).toContain(`dark:aria-expanded:text-[${LINK}]`);
        expect(src).toContain(`dark:aria-expanded:border-[${RIM(0.5)}]`);
      }
      // The tenant's own colour, never Tailwind's indigo (it ignored the brand).
      expect(classStrings(src).filter((str) => str.includes('indigo-'))).toEqual([]);
    },
  );

  it('the resting primary text on the listed controls has a light brand twin for dark', () => {
    const has = (file: string, needle: string) => expect(read(file), `${file}: ${needle}`).toContain(needle);
    has('components/shared/filter-primitives.tsx', `"border-primary/40 bg-primary/10 text-primary dark:border-[${RIM(0.4)}] dark:text-[${LINK}]"`);
    has('components/rentals-v2/customer-step.tsx', `text-primary dark:text-[${LINK}]`);
    has('components/vehicles-v2/kit.tsx', `"text-primary hover:bg-primary-light hover:text-primary dark:text-[${LINK}] dark:hover:text-[${LINK}]"`);
    has('components/shared/layout/app-sidebar-v2.tsx', `? "text-primary dark:text-[${LINK}]"`);
    has('components/shared/layout/app-sidebar-v2.tsx', `? "bg-primary/15 text-primary dark:text-[${LINK}]"`);
    has('components/shared/layout/app-sidebar-v2.tsx', `? "font-medium text-primary dark:text-[${LINK}]"`);
    has('components/rentals-v2/rental-detail/_kit.tsx', `? "bg-primary/10 font-medium text-primary dark:bg-[hsl(var(--v2-hover,var(--muted)))] dark:text-[${LINK}]"`);
    has('app/(dashboard)/integrations/integrations-board.tsx', `? "text-primary hover:bg-primary/10 dark:text-[${LINK}] dark:hover:bg-[hsl(var(--v2-hover,var(--muted)))]"`);
  });

  it('top bar: every icon, the Trax label and the ⌘K hint are light brand text in dark, and every hover/open fill is the v2 tint', () => {
    const src = read('components/shared/layout/top-bar-v2.tsx');
    expect(src).not.toMatch(/dark:[^\s"]*bg-primary\/1[05]\b/);
    expect(src).not.toContain('indigo');
    expect(src.split(`<Search className="size-4 shrink-0 text-primary dark:text-[${LINK}]" aria-hidden />`).length - 1).toBe(2);
    expect(src).toContain(`text-primary dark:text-[${LINK}]">\n            ⌘K`);
    expect(src).toContain(`text-[13px] font-medium text-primary dark:text-[${LINK}] hover:bg-primary/10 hover:text-primary dark:hover:text-[${LINK}]`);
    expect(src).toContain(`dark:[&>button:hover]:${V2_HOVER_DARK}`);
    expect(src).toContain(`dark:[&>button[aria-expanded=true]]:${V2_HOVER_DARK}`);
    // Light hint text on the tinted field was 4.22:1 (4.01 hovered).
    expect(src).not.toMatch(/truncate text-\[13px\] text-muted-foreground/);
  });
});

describe('light: muted hints inside rows that tint on hover keep 4.5:1', () => {
  // Measured: customers Toggle hint 4.01 on primary/10, vehicles SwitchRow 4.36
  // on primary/5. The hint reads --v2-muted-on-tint while its OWN row is
  // hovered (a named group, so an outer `group` cannot trigger it). The token
  // is the muted colour in dark and undefined outside .v2-theme, so dark and
  // v1 render exactly as before.
  const TINT = 'text-[hsl(var(--v2-muted-on-tint,var(--muted-foreground)))]';
  it.each([
    ['components/customers-v2/customer-detail/kit.tsx', 'toggle'],
    ['components/vehicles-v2/kit.tsx', 'switchrow'],
  ])('%s', (file, group) => {
    const src = read(file);
    expect(src).toContain(`group/${group}`);
    expect(src).toContain(`text-muted-foreground group-hover/${group}:${TINT}`);
  });

  it('top bar: the ⌘K hint and the page field placeholder read the same token', () => {
    const src = read('components/shared/layout/top-bar-v2.tsx');
    expect(src).toContain(`truncate text-[13px] ${TINT}`);
    expect(src).toContain(`placeholder:${TINT}`);
  });
});

describe('Sep 17 review: grey and white hovers on v2-only surfaces are the purple', () => {
  const PAIR = 'hover:bg-primary/10 dark:hover:bg-[hsl(var(--v2-hover,var(--muted)))]';
  const count = (src: string, needle: string) => src.split(needle).length - 1;
  const GREY_OR_WHITE = /(^|[\s"'`])hover:bg-(muted|background|white|accent|secondary)(\/\d+)?(?=[\s"'`])/;

  // Counts are the class lists edited in each file, one by one.
  it.each([
    ['components/dashboard-v2/setup-guide.tsx', 4],
    ['components/dashboard-v2/money-at-risk.tsx', 1],
    ['components/dashboard-v2/on-the-move-today.tsx', 2],
    ['components/availability-v2/availability-v2.tsx', 1],
    ['components/availability-v2/weekly-hours-card.tsx', 1],
  ] as const)('%s: %i purple hover pair(s), and no grey or white hover left', (file, n) => {
    const src = read(file);
    expect(count(src, PAIR)).toBe(n);
    expect(src).not.toMatch(GREY_OR_WHITE);
  });

  it("user menu: the avatar trigger's own hover is the pair, not the grey accent", () => {
    const src = read('components/shared/layout/user-menu-v2.tsx');
    expect(src).toContain(`<Button variant="ghost" size="icon" className="relative ${PAIR} transition-colors cursor-pointer">`);
    expect(src).not.toMatch(GREY_OR_WHITE);
  });

  it('user menu: the initials on every avatar fallback are the light brand in dark', () => {
    // `text-primary` on `bg-primary/10`: in dark v2 that measured 1.91:1, so the
    // initials were all but invisible on the sidebar row, the menu and the
    // profile panel. Still four fallbacks — but one of them moved: the profile
    // left this menu for `profile-sheet-v2.tsx` on Sep 20 2026 (it opens from
    // the top now), taking its avatar with it. Both files are read, so the
    // rule cannot be escaped by moving markup between them.
    const src =
      read('components/shared/layout/user-menu-v2.tsx') +
      read('components/shared/layout/profile-sheet-v2.tsx');
    const fallbacks = src.match(/<AvatarFallback className="[^"]*"/g) ?? [];
    expect(fallbacks).toHaveLength(4);
    for (const fallback of fallbacks) expect(fallback, fallback).toContain(`dark:text-[${LINK}]`);
  });

  it('the two washed dashboard cards lighten with the purple token instead of white', () => {
    // On the saturated brand card a primary/10 hover is primary over primary
    // and cannot be seen, so these tint with --v2-hover itself: lighter in
    // light mode (as white/15 and white/40 did), deeper indigo in dark.
    const needs = read('components/dashboard-v2/needs-you-now.tsx');
    expect(needs).toContain('hover:bg-[hsl(var(--v2-hover,var(--muted))_/_0.2)] dark:hover:bg-[hsl(var(--v2-hover,var(--muted))_/_0.5)]');
    expect(needs).not.toMatch(/hover:bg-white/);
    const stand = read('components/dashboard-v2/where-you-stand.tsx');
    expect(count(stand, 'hover:bg-[hsl(var(--v2-hover,var(--muted))_/_0.6)] dark:hover:bg-[hsl(var(--v2-hover,var(--muted)))]')).toBe(2);
    expect(stand).not.toMatch(/hover:bg-white/);
  });

  it('no slash-opacity border token is left in the edited v2-only files (it is an invalid colour in dark v2)', () => {
    for (const file of ['components/dashboard-v2/setup-guide.tsx', 'components/availability-v2/weekly-hours-card.tsx']) {
      expect(read(file), file).not.toMatch(/border-(border|input)\/\d+/);
    }
  });
});

describe('Sep 17 review: shared v1+v2 markup keeps v1 byte-for-byte', () => {
  const PAIR = 'hover:bg-primary/10 dark:hover:bg-[hsl(var(--v2-hover,var(--muted)))]';
  const count = (src: string, needle: string) => src.split(needle).length - 1;

  it('messages read --v2-hover over the exact old accent alpha', () => {
    const rail = read('components/messages-v2/conversation-rail.tsx');
    expect(count(rail, 'hover:bg-[hsl(var(--v2-hover,var(--accent)_/_0.5))]')).toBe(1);
    expect(rail).not.toContain('hover:bg-accent/50');
    const context = read('components/messages-v2/customer-context.tsx');
    expect(count(context, 'hover:bg-[hsl(var(--v2-hover,var(--accent)_/_0.6))]')).toBe(2);
    expect(context).not.toContain('hover:bg-accent/60');
    const attach = read('components/messages-v2/attach-menu.tsx');
    expect(count(attach, 'hover:bg-[hsl(var(--v2-hover,var(--accent)_/_0.6))]')).toBe(3);
    expect(attach).not.toContain('hover:bg-accent/60');
  });

  it('the guides shelf reads --v2-hover over the old muted/60', () => {
    const src = read('components/explainers/explainer.tsx');
    expect(src).toContain('hover:bg-[hsl(var(--v2-hover,var(--muted)_/_0.6))]');
    expect(src).not.toContain('hover:bg-muted/60');
  });

  it('billing invoice rows: v2 gets the pair, v1 keeps its exact class list', () => {
    const src = read('components/settings/usage-dashboard.tsx');
    expect(src).toContain(`? "border-b transition-colors last:border-0 ${PAIR}"`);
    expect(src).toContain(': "border-b transition-colors last:border-0 hover:bg-muted/40"');
  });

  it('blocked identities customer picker: v2 gets the pair, v1 keeps its exact class list', () => {
    const src = read('app/(dashboard)/blocked-customers/page.tsx');
    expect(src).toContain(`? "relative flex cursor-pointer select-none items-center rounded-sm px-2 py-2 text-sm ${PAIR} hover:text-accent-foreground"`);
    expect(src).toContain(': "relative flex cursor-pointer select-none items-center rounded-sm px-2 py-2 text-sm hover:bg-accent hover:text-accent-foreground"');
  });

  it('installment pills: v2 is a pill with the pair, v1 keeps rounded-md and muted/40 verbatim', () => {
    const src = read('components/settings/InstallmentSettings.tsx');
    expect(src).toContain('? "px-3 py-1.5 rounded-full text-sm font-medium border transition-colors"');
    expect(src).toContain(': "px-3 py-1.5 rounded-md text-sm font-medium border transition-colors"');
    expect(src).toContain(`? "bg-card border-border text-muted-foreground ${PAIR}"`);
    expect(src).toContain(': "bg-card border-border text-muted-foreground hover:bg-muted/40"');
  });
});

describe('Sep 17 review: the rounded system for v1 primitives under .v2-theme (styles/v2-theme.css)', () => {
  const rules = allRules();
  const rule = (prefix: string) => {
    const found = rules.filter((r) => r.selector.startsWith(prefix));
    expect(found, prefix).toHaveLength(1);
    return found[0];
  };
  const JOINED = ['[class*="rounded-l-none"]', '[class*="rounded-r-none"]'];

  it('text inputs take the ui-v2 Input radius, skipping non-text inputs and joined edges', () => {
    const r = rule('.v2-theme input[class~="rounded-md"][class~="border-input"]');
    expect(r.body).toBe('border-radius: var(--v2-radius-3xl);');
    for (const skip of ['[type="checkbox"]', '[type="radio"]', '[type="color"]', '[type="range"]', ...JOINED]) {
      expect(r.selector).toContain(skip);
    }
  });

  it('textareas take the ui-v2 Textarea radius, skipping joined edges', () => {
    const r = rule('.v2-theme textarea[class~="rounded-md"][class~="border-input"]');
    expect(r.body).toBe('border-radius: var(--v2-radius-2xl);');
    for (const skip of JOINED) expect(r.selector).toContain(skip);
  });

  it("select triggers take the ui-v2 SelectTrigger radius and leave v1's Button to the Button rule", () => {
    const r = rule('.v2-theme button[role="combobox"][class~="rounded-md"][class~="border-input"]');
    expect(r.body).toBe('border-radius: var(--v2-radius-3xl);');
    for (const skip of ['[class~="whitespace-nowrap"]', ...JOINED]) expect(r.selector).toContain(skip);
  });

  it('menu, listbox and popover content, their items, and a cmdk list inside a popover', () => {
    expect(rule('.v2-theme :is([role="menu"], [role="listbox"], [role="dialog"])[class~="rounded-md"][class~="bg-popover"]').body).toBe(
      'border-radius: var(--v2-radius-2xl);',
    );
    expect(rule('.v2-theme [role="dialog"][class~="bg-popover"] > [cmdk-root][class~="rounded-md"]').body).toBe('border-radius: inherit;');
    expect(
      rule('.v2-theme :is([role="menuitem"], [role="menuitemcheckbox"], [role="menuitemradio"], [role="option"])[class~="rounded-sm"]').body,
    ).toBe('border-radius: var(--v2-radius-xl);');
  });

  it('dialogs take the ui-v2 Dialog radius from sm up only, where v1 rounds them at all', () => {
    expect(stripComments(theme)).toMatch(
      /@media \(min-width: 640px\) \{\s*\.v2-theme :is\(\[role="dialog"\], \[role="alertdialog"\]\)\[class~="sm:rounded-lg"\] \{\s*border-radius: var\(--v2-radius-4xl\);\s*\}\s*\}/,
    );
  });

  it('every radius rule names no class but .v2-theme, and no selector in the file names a rounded-* utility', () => {
    const radiusRules = rules.filter((r) => /^border-radius:/.test(r.body) && r.selector.startsWith('.v2-theme'));
    expect(radiusRules.length).toBeGreaterThanOrEqual(9);
    for (const r of radiusRules) {
      const classTokens = r.selector.replace(/\[[^\]]*\]/g, '').match(/\.[A-Za-z_\\-][\w\\:/-]*/g) ?? [];
      expect(classTokens.filter((t) => t !== '.v2-theme'), r.selector).toEqual([]);
    }
    for (const r of rules) expect(r.selector.replace(/\[[^\]]*\]/g, ''), r.selector).not.toMatch(/\.(sm\\:)?rounded-/);
  });

  it('settings v2 card titles (h3) are semibold', () => {
    expect(decl(tokenBlock('.v2-theme .settings-v2-body h3'), 'font-weight')).toBe('600');
  });
});

describe('Sep 17 review: v2 row menus, chart picker and overview link follow the rounded system', () => {
  const ROW_MENU_FILES = [
    'components/admin-v2/users-table-v2.tsx',
    'components/agreements-v2/agreements-table-v2.tsx',
    'components/cms-v2/blog-categories-table-v2.tsx',
    'components/cms-v2/blog-posts-table-v2.tsx',
    'components/customers-v2/blocked-customers-tables-v2.tsx',
    'components/fleet-v2/plates-table-v2.tsx',
    'components/insurance-v2/insurance-policies-table-v2.tsx',
    // The /insurance policy list's menu: the eleventh v2 table, switched in verification.
    'components/insurance-v2/insurance-policy-list-v2.tsx',
    'components/invoices-v2/invoices-table-v2.tsx',
    'components/settings-v2/extras-table-v2.tsx',
    'components/settings-v2/promo-codes-table-v2.tsx',
  ];

  it.each(ROW_MENU_FILES)('%s: the row menu is the ui-v2 menu, sized to its labels, with no doubled icon gap', (file) => {
    const src = read(file);
    expect(src).toContain('} from "@/components/ui-v2/dropdown-menu";');
    expect(src).not.toContain('@/components/ui/dropdown-menu');
    // ui-v2 content is trigger-wide (min 12rem); `w-auto` lets a long label keep one line.
    expect(src).not.toMatch(/<DropdownMenuContent align="end">/);
    expect(src).toMatch(/<DropdownMenuContent align="end" className="w-auto">/);
    // ui-v2 items already space the icon (gap-2.5).
    expect(src).not.toMatch(/\bmr-2\b/);
  });

  it('hero chart: the period trigger is a pill and the tooltip is rounded-xl', () => {
    const src = read('components/shared/hero-chart-v2.tsx');
    expect(src).toContain('const RANGE_PICKER = cn(PICKER, "-my-0.5 -ml-1.5 rounded-full py-0.5 pl-1.5 focus-visible:ring-inset");');
    expect(src).toContain('<div className="min-w-[200px] rounded-xl border bg-background px-3 py-2 text-xs shadow-md">');
    expect(cn('inline-flex items-center gap-1 rounded-md text-sm', 'rounded-full')).toBe('inline-flex items-center gap-1 text-sm rounded-full');
  });

  it("vehicles overview: the chart's Try again link is a pill", () => {
    const src = read('components/vehicles-v2/vehicles-overview.tsx');
    expect(src).toContain('className="rounded-full text-sm font-medium text-foreground underline-offset-4 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"');
    expect(src).not.toMatch(/rounded-md text-sm font-medium text-foreground underline-offset-4/);
  });
});

describe('S20b: a saved colour re-themes the whole v2 portal (styles/v2-theme.css)', () => {
  const light = tokenBlock('.v2-theme');
  const dark = tokenBlock('.dark .v2-theme');

  // Every brand-coloured token as it was hard-coded before S20b (git HEAD
  // 7ee9eb84). With the default brand each derived value must compute to
  // exactly this, so the canary sees no change until it saves a colour.
  const LIGHT_WAS: Record<string, string> = {
    '--primary': '248 68% 51%',
    '--primary-foreground': '226 100% 97%',
    '--primary-hover': '248 68% 45%',
    '--primary-light': '248 68% 95%',
    '--accent': '248 68% 95%',
    '--v2-hover': '248 68% 95%',
    '--v2-row-hover': '248 68% 97.5%',
    '--chart-1': '230 100% 82%',
    '--chart-2': '241 100% 69%',
    '--chart-3': '247 92% 60%',
    '--chart-4': '248 68% 51%',
    '--chart-5': '246 61% 42%',
    '--sidebar-background': '248 44% 98%',
    '--sidebar-primary': '247 92% 60%',
    '--sidebar-accent': '248 75% 94%',
    '--sidebar-accent-foreground': '248 60% 45%',
    '--sidebar-border': '248 25% 92%',
    '--sidebar-ring': '248 40% 70%',
    '--gradient-primary': 'linear-gradient(135deg, hsl(248 68% 51%), hsl(248 68% 61%))',
    '--ds-shadow-hover': '0 10px 15px -3px hsl(248 68% 51% / 0.15), 0 4px 6px -2px hsl(248 68% 51% / 0.1)',
    // New tokens: the light link is --primary, the wash is the old --primary.
    '--v2-link': '248 68% 51%',
    '--v2-wash': '248 68% 51%',
  };
  const DARK_WAS: Record<string, string> = {
    '--primary': '246 61% 42%',
    '--primary-foreground': '226 100% 97%',
    '--primary-hover': '246 61% 50%',
    '--primary-light': '246 61% 22%',
    '--accent': '246 35% 17%',
    '--v2-hover': '246 35% 17%',
    '--v2-row-hover': '246 35% 17%',
    '--v2-link': '230 94% 82%',
    '--chart-1': '230 100% 82%',
    '--chart-2': '241 100% 69%',
    '--chart-3': '247 92% 60%',
    '--chart-4': '248 68% 51%',
    '--chart-5': '246 61% 42%',
    '--sidebar-background': '248 14% 10%',
    '--sidebar-primary': '241 100% 69%',
    '--sidebar-accent': '248 18% 17%',
    '--sidebar-border': '248 30% 100% / 10%',
    '--sidebar-ring': '248 20% 45%',
    '--gradient-primary': 'linear-gradient(135deg, hsl(246 61% 42%), hsl(246 61% 52%))',
    '--ds-shadow-hover': '0 10px 15px -3px hsl(246 61% 42% / 0.3), 0 4px 6px -2px hsl(246 61% 42% / 0.2)',
    '--v2-wash': '246 61% 42%',
  };

  it('the default brand is the v2 indigo, #442DD7 = 248 68% 51%', () => {
    // #442DD7 by hand: l = (215+45)/510 = 51%, s = 0.6667/0.9804 = 68%,
    // h = (23/170 + 4) * 60 = 248.
    expect(stylesheetBrand()).toEqual({ '--brand-h': '248', '--brand-s': '68%', '--brand-l': '51%' });
    expect(read('global.css')).not.toContain('--brand-');
  });

  it.each(Object.entries(LIGHT_WAS))('light %s is brand-derived and computes to %s by default', (token, was) => {
    const value = decl(light, token)!;
    expect(value, token).toBeDefined();
    expect(value).toMatch(token === '--primary-foreground' ? /var\(--brand-fg,/ : /var\(--brand-h\)/);
    expect(withDefaultBrand(value)).toBe(was);
  });

  it.each(Object.entries(DARK_WAS))('dark %s is brand-derived and computes to %s by default', (token, was) => {
    const value = decl(dark, token)!;
    expect(value, token).toBeDefined();
    expect(value).toMatch(token === '--primary-foreground' ? /var\(--brand-fg-dark,/ : /var\(--brand-h\)/);
    expect(withDefaultBrand(value)).toBe(was);
  });

  it('the light primary takes the brand lightness; everything else keeps a fixed step', () => {
    // So the Graphite swatch (#1E293B = 217 33% 17%) paints graphite buttons,
    // not a mid-tone slate. (Near-black never gets here: v2BrandVars returns
    // null for it, so the default indigo stands.)
    const GRAPHITE = { '--brand-h': '217', '--brand-s': '33%', '--brand-l': '17%' };
    expect(decl(light, '--primary')).toBe('var(--brand-h) var(--brand-s) var(--brand-l)');
    expect(withDefaultBrand(decl(light, '--primary')!, GRAPHITE)).toBe('217 33% 17%');
    // A pale brand's link text is deepened by the hook, not the primary.
    expect(withDefaultBrand(decl(light, '--v2-link')!, { '--brand-h': '48', '--brand-s': '97%', '--brand-l': '77%', '--brand-link-l': '28%' })).toBe('48 97% 28%');
    // Dark keeps its own lightness whatever the brand's is:
    // hue 217 - 2 = 215, saturation 33 - 7 = 26, lightness fixed at 42.
    expect(withDefaultBrand(decl(dark, '--primary')!, GRAPHITE)).toBe('215 26% 42%');
  });

  it('neutral tokens stay fixed', () => {
    for (const block of [light, dark]) {
      for (const token of ['--background', '--foreground', '--card', '--popover', '--muted', '--muted-foreground', '--border', '--input', '--ring', '--secondary', '--destructive', '--success', '--warning', '--sidebar-foreground']) {
        expect(decl(block, token), token).toBeDefined();
        expect(decl(block, token), token).not.toContain('--brand');
      }
    }
  });

  it('no indigo hue is left hard-coded in either token block or the row rules', () => {
    const rowRules = allRules().filter((r) => r.selector.includes('[data-slot="table-row"]'));
    for (const body of [light, dark, ...rowRules.map((r) => r.body)]) {
      // --secondary is the neutral zinc (240 4%), not the brand.
      const withoutNeutral = body.replace(/--secondary(-foreground)?:[^;]*;/g, '');
      expect(withoutNeutral).not.toMatch(/(^|[\s(:])(23\d|24\d|25\d) \d+%/);
    }
  });

  it('every var the hook can write is one the stylesheet reads', () => {
    const css = stripComments(theme);
    for (const name of V2_BRAND_VAR_NAMES) expect(css, name).toContain(`var(${name}`);
  });
});

describe('S20a: the app wash stays put while the page scrolls (styles/v2-theme.css)', () => {
  const rules = allRules();
  const rule = (selector: string) => {
    const found = rules.filter((r) => r.selector === selector);
    expect(found, selector).toHaveLength(1);
    return found[0].body;
  };

  it('the element paints no background and keeps its own position; only non-wrapper elements isolate', () => {
    // No `position` anywhere: the Trax panel carries this class on a `fixed` element.
    expect(rules.filter((r) => r.selector === '.v2-theme .bg-app-gradient')).toEqual([]);
    // The dashboard wrapper must not become a stacking context: the first-run
    // wizard (fixed, z-70) lives inside it and has to stay above <body>-level
    // layers such as the Trax panel (z-40).
    expect(rule('.v2-theme .bg-app-gradient:not([data-slot="sidebar-wrapper"])')).toBe('isolation: isolate;');
    for (const r of rules.filter((x) => x.selector.includes('bg-app-gradient') && !x.selector.endsWith('::before'))) {
      expect(r.body, r.selector).not.toMatch(/(^|;\s*)(position|background|background-image|background-color):/);
    }
  });

  it('a viewport-fixed layer behind the content paints the wash', () => {
    const body = rule('.v2-theme .bg-app-gradient::before');
    expect(decl(body, 'content')).toBe('""');
    expect(decl(body, 'position')).toBe('fixed');
    expect(decl(body, 'inset')).toBe('0');
    expect(decl(body, 'z-index')).toBe('-1');
    expect(decl(body, 'pointer-events')).toBe('none');
    const image = decl(body, 'background-image')!;
    expect(image.match(/hsl\(var\(--v2-wash\)/g)?.length).toBe(3);
    expect(image).toContain('hsl(var(--chart-3) / 0.16)');
    expect(image).not.toContain('--primary');
    expect(stripComments(theme)).not.toMatch(/background-attachment/);
  });
});

describe('Sep 17 review follow-ups: missed hovers, the metric picker, a settings-row label cursor', () => {
  const PAIR = 'hover:bg-primary/10 dark:hover:bg-[hsl(var(--v2-hover,var(--muted)))]';
  const count = (src: string, needle: string) => src.split(needle).length - 1;
  const GREY = /(^|[\s"'`])hover:bg-(muted|accent|background|white)(\/\d+)?(?=[\s"'`])/;

  it('Trax composer attach button: --v2-hover over the exact old muted', () => {
    const src = read('components/trax/trax-composer.tsx');
    expect(src).toContain('canAttach ? "hover:bg-[hsl(var(--v2-hover,var(--muted)))] hover:text-foreground"');
    expect(src).not.toMatch(GREY);
  });

  it('Trax rail back buttons and the quick dock collapse handle use the purple pair', () => {
    const rail = read('components/trax/trax-rail.tsx');
    expect(count(rail, PAIR)).toBe(2);
    expect(rail).not.toMatch(GREY);
    const dock = read('components/shared/layout/quick-dock.tsx');
    expect(count(dock, PAIR)).toBe(1);
    expect(dock).not.toMatch(GREY);
  });

  it('hero chart: the metric picker is a pill with an inset ring, like the period picker', () => {
    const src = read('components/shared/hero-chart-v2.tsx');
    expect(src).toContain('const METRIC_PICKER = cn(PICKER, "-my-0.5 -ml-1.5 self-start rounded-full py-0.5 pl-1.5 focus-visible:ring-inset");');
    expect(src).toContain('<DropdownMenuTrigger className={METRIC_PICKER}');
    expect(src).not.toContain('cn(PICKER, "self-start")');
  });

  it('a SettingsRow label linked to its switch shows the hand', () => {
    // SettingsRow: <div><label for=…/>…</div><div><Switch/>…</div>. The control
    // is the first child of the NEXT column, which the direct-sibling rule
    // above it does not reach.
    const selectors = cursorRules().map((r) => r.selector).join('\n');
    expect(selectors).toContain(
      '.v2-theme div:has(+ div > :is([role="switch"], [role="checkbox"], [role="radio"]):first-child:not(:disabled, [data-disabled=""])) > label[for]:not(:has(~ :is(input:not([type="checkbox"], [type="radio"]), textarea, select, [role="combobox"])))',
    );
  });

  it('sidebar: the "More" label is full muted text (it measured under 4.5:1 at /50)', () => {
    const src = read('components/shared/layout/app-sidebar-v2.tsx');
    expect(src).toContain('<p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground px-2.5 pb-1">\n                        More');
  });

  it('owned v2 chrome carries no Tailwind indigo; ui-v2 primitives fall back to indigo-300 exactly', () => {
    for (const file of [
      'components/ui-v2/sidebar.tsx',
      'components/ui-v2/badge.tsx',
      'components/ui-v2/date-time-picker.tsx',
      'components/shared/layout/app-sidebar-v2.tsx',
      'components/shared/layout/top-bar-v2.tsx',
      'components/settings-v2/settings-index.tsx',
      // Sep 17 review, second pass: the header icons, the tour button, the
      // filter chips, the integration pin, the org and user menus, the business
      // rules links and the Branding page now follow the tenant's colour too.
      'components/shared/header-icon-button-v2.tsx',
      'components/onboarding/tab-tour-button.tsx',
      'components/shared/filter-primitives.tsx',
      'app/(dashboard)/integrations/integrations-board.tsx',
      'components/shared/layout/org-switcher.tsx',
      'components/shared/layout/user-menu-v2.tsx',
      'components/settings-v2/business-rules-pages.tsx',
      'components/settings/appearance/appearance-settings.tsx',
    ]) {
      const code = read(file).replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
      expect(code, file).not.toMatch(/(text|bg|border|ring)-indigo-/);
    }
    // #a5b4fc: r=165 g=180 b=252. max=b, min=r, delta=87.
    //   l = 417/510 = 81.765%, s = (87/255) / (1 - |1.63529 - 1|) = 0.34118 / 0.36471 = 93.548%,
    //   h = ((r-g)/delta + 4) * 60 = (-15/87 + 4) * 60 = 229.655.
    expect(read('components/ui-v2/badge.tsx')).toContain('hsl(var(--v2-link,229.66_93.55%_81.76%))');
  });
});

