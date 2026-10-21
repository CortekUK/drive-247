/**
 * shared/portal-v2 carries COPIES of three operator pieces that cannot move
 * there yet, for the customer portal's Bookings page:
 *
 *   button-styles.ts  the ui-v2 Button's looks (the component stays here)
 *   filter-panel.tsx  components/shared/filter-primitives.tsx (draws the Button)
 *   search-field.tsx  the list-page field inside layout/top-bar-v2.tsx (GitHub #32)
 *   popover.tsx, tooltip.tsx  ui-v2's, for the shared rentals timeline
 *   dialog.tsx, tabs.tsx      ui-v2's, for the shared agreement drawer
 *
 * Each copy is the operator source with semantic colours swapped for their
 * shared twins (shared/portal-v2/class-map.ts). These tests recompute that from
 * the operator files, so changing the operator piece without its copy fails.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { buttonVariants } from '@/components/ui-v2/button';
import { cn } from '@/lib/utils';
import { toSharedClasses } from '../../../../../shared/portal-v2/class-map';
import {
  V2_BUTTON_DEFAULT,
  V2_BUTTON_DEFAULT_SM,
  V2_BUTTON_DESTRUCTIVE,
  V2_BUTTON_DESTRUCTIVE_SM,
  V2_BUTTON_GHOST,
  V2_BUTTON_GHOST_ICON_SM,
  V2_BUTTON_GHOST_SM,
  V2_BUTTON_OUTLINE,
  V2_BUTTON_OUTLINE_ICON,
  V2_BUTTON_OUTLINE_ICON_SM,
  V2_BUTTON_OUTLINE_SM,
  V2_BUTTON_PRIMARY,
} from '../../../../../shared/portal-v2/button-styles';

const SRC = join(__dirname, '..', '..');
const SHARED = join(SRC, '..', '..', '..', 'shared', 'portal-v2');
const read = (path: string) => readFileSync(path, 'utf8').replace(/\r\n/g, '\n');
const stripComments = (code: string) =>
  code
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
    // Import specifiers are not class lists.
    .replace(/^import[\s\S]*?from\s+"[^"]*";?$/gm, '');

/** Every double-quoted string in `code` that reads as a class list. */
function classLiterals(code: string): string[] {
  const out: string[] = [];
  for (const m of stripComments(code).matchAll(/"([^"\n]*)"/g)) {
    const value = m[1];
    if (!value.includes('-') || value.includes('${')) continue;
    if (!value.trim().split(/\s+/).every((t) => /^[!\w\-:[\]()/.,&_%=*>#'+@]+$/.test(t))) continue;
    out.push(value);
  }
  return out;
}

describe('shared button styles are the operator Button', () => {
  it('primary: the default Button with bg-gradient-primary, as "+ Add Customer" draws it', () => {
    expect(V2_BUTTON_PRIMARY).toBe(toSharedClasses(cn(buttonVariants({}), 'bg-gradient-primary')));
    // The gradient replaces the solid fill, as on the operator header.
    expect(V2_BUTTON_PRIMARY).toContain('bg-gradient-primary');
    expect(V2_BUTTON_PRIMARY).not.toMatch(/(^|\s)bg-v2-primary(\s|$)/);
  });

  it('ghost sm, outline icon and outline', () => {
    expect(V2_BUTTON_GHOST_SM).toBe(toSharedClasses(cn(buttonVariants({ variant: 'ghost', size: 'sm' }))));
    expect(V2_BUTTON_OUTLINE_ICON).toBe(toSharedClasses(cn(buttonVariants({ variant: 'outline', size: 'icon' }))));
    expect(V2_BUTTON_OUTLINE).toBe(toSharedClasses(cn(buttonVariants({ variant: 'outline' }))));
  });

  it("the rentals timeline's looks: outline sm, outline icon-sm, ghost icon-sm, default sm", () => {
    expect(V2_BUTTON_OUTLINE_SM).toBe(toSharedClasses(cn(buttonVariants({ variant: 'outline', size: 'sm' }))));
    expect(V2_BUTTON_OUTLINE_ICON_SM).toBe(toSharedClasses(cn(buttonVariants({ variant: 'outline', size: 'icon-sm' }))));
    expect(V2_BUTTON_GHOST_ICON_SM).toBe(toSharedClasses(cn(buttonVariants({ variant: 'ghost', size: 'icon-sm' }))));
    expect(V2_BUTTON_DEFAULT_SM).toBe(toSharedClasses(cn(buttonVariants({ size: 'sm' }))));
  });

  it("the agreement drawer's Download: the default Button at the default size", () => {
    expect(V2_BUTTON_DEFAULT).toBe(toSharedClasses(cn(buttonVariants({}))));
    expect(V2_BUTTON_GHOST).toBe(toSharedClasses(cn(buttonVariants({ variant: 'ghost' }))));
    expect(V2_BUTTON_DESTRUCTIVE).toBe(toSharedClasses(cn(buttonVariants({ variant: 'destructive' }))));
    expect(V2_BUTTON_DESTRUCTIVE_SM).toBe(toSharedClasses(cn(buttonVariants({ variant: 'destructive', size: 'sm' }))));
  });
});

describe('shared filter panel is filter-primitives', () => {
  const operator = read(join(SRC, 'components', 'shared', 'filter-primitives.tsx'));
  const copy = read(join(SHARED, 'filter-panel.tsx'));
  const literals = classLiterals(operator);

  it('finds the operator class strings to compare', () => {
    expect(literals.length).toBeGreaterThan(8);
  });

  for (const literal of literals) {
    it(`carries "${literal.slice(0, 60)}…"`, () => {
      expect(copy).toContain(toSharedClasses(literal));
    });
  }

  it('draws Reset and close with the operator ghost / outline-icon Button looks', () => {
    expect(operator).toContain('variant="ghost"');
    expect(operator).toContain('variant="outline"');
    expect(copy).toContain('cn(V2_BUTTON_GHOST_SM,');
    expect(copy).toContain('cn(V2_BUTTON_OUTLINE_ICON,');
  });
});

describe('shared search field is top-bar-v2\'s list-page field', () => {
  const bar = read(join(SRC, 'components', 'shared', 'layout', 'top-bar-v2.tsx'));
  const copy = read(join(SHARED, 'search-field.tsx'));
  const field = bar.slice(bar.indexOf('const FIELD ='), bar.indexOf(';', bar.indexOf('const FIELD =')));
  const slotStart = bar.indexOf('{slot ? (');
  const region = bar.slice(slotStart, bar.indexOf(') : (', slotStart));
  const literals = [...classLiterals(field), ...classLiterals(region)];

  it('finds the field and its class strings', () => {
    expect(field).toContain('rounded-full');
    expect(slotStart).toBeGreaterThan(-1);
    expect(literals.length).toBeGreaterThan(15);
  });

  for (const literal of literals) {
    it(`carries "${literal.slice(0, 60)}…"`, () => {
      expect(copy).toContain(toSharedClasses(literal));
    });
  }

  it('keeps the behaviour: filter as you type after 400ms, ⌘↵ and the row to search everywhere', () => {
    expect(bar).toMatch(/,\s*400\);/);
    expect(copy).toMatch(/,\s*400\);/);
    for (const piece of ['Search everywhere for', '⌘↵', '⌘K', 'Remove ${slot.scopeLabel} filter and search everything', 'onMouseDown']) {
      expect(bar).toContain(piece);
      expect(copy).toContain(piece);
    }
  });
});

describe("shared popover and tooltip are ui-v2's", () => {
  for (const name of ['popover', 'tooltip']) {
    const operator = read(join(SRC, 'components', 'ui-v2', `${name}.tsx`));
    const copy = read(join(SHARED, `${name}.tsx`));
    const literals = classLiterals(operator).filter((l) => l.startsWith('z-50'));

    it(`${name}: finds the content's class string`, () => {
      expect(literals).toHaveLength(1);
    });

    for (const literal of literals) {
      it(`${name}: carries "${literal.slice(0, 50)}…"`, () => {
        expect(copy).toContain(toSharedClasses(literal));
      });
    }

    it(`${name}: same floating motion`, () => {
      expect(operator).toContain('MOTION_FLOATING');
      expect(copy).toContain('MOTION_FLOATING');
    });
  }
});

describe("shared dialog and tabs are ui-v2's", () => {
  const pairs: Array<[string, (literal: string) => boolean]> = [
    ['dialog', (l) => l.startsWith('fixed ') || l.startsWith('font-heading') || l.startsWith('text-sm text-muted-foreground') || l === 'flex flex-col gap-1.5'],
    ['tabs', (l) => l.startsWith('group/tabs flex') || l.startsWith('relative inline-flex h-[calc(100%-1px)]') || l.startsWith('data-[state=active]:bg-background') || l === 'flex-1 text-sm outline-none'],
  ];
  for (const [name, wanted] of pairs) {
    const operator = read(join(SRC, 'components', 'ui-v2', `${name}.tsx`));
    const copy = read(join(SHARED, `${name}.tsx`));
    const literals = classLiterals(operator).filter(wanted);

    it(`${name}: finds the operator class strings`, () => {
      expect(literals.length).toBeGreaterThanOrEqual(name === 'dialog' ? 5 : 3);
    });

    for (const literal of literals) {
      it(`${name}: carries "${literal.slice(0, 50)}…"`, () => {
        expect(copy.replace(/\s+/g, ' ')).toContain(toSharedClasses(literal));
      });
    }
  }

  it('tabs: the default list, mapped', () => {
    const copy = read(join(SHARED, 'tabs.tsx'));
    for (const c of ['inline-flex w-fit items-center justify-center rounded-full p-1 text-v2-muted-fg', 'bg-v2-muted']) {
      expect(copy).toContain(c);
    }
  });
});

describe("shared empty-state pictures are the operator's illustrations", () => {
  // Verbatim copies for the customer portal's empty states; only the import
  // lines differ (`@/lib/utils` → `../cn`, `../scene-kit` → `./scene-kit`).
  const ILLUSTRATIONS = join(SRC, 'components', 'illustrations-v2');
  const withoutImports = (code: string) => code.replace(/^import .*$/gm, '');
  const pairs: Array<[string, string]> = [
    ['scene-kit.tsx', 'scene-kit.tsx'],
    ['car-art.ts', 'car-art.ts'],
    ['empty-scenes.tsx', 'empty-scenes.tsx'],
    [join('scenes', 'documents.tsx'), 'documents.tsx'],
    [join('scenes', 'add-customer.tsx'), 'add-customer.tsx'],
  ];
  it("timezone-flags.ts matches availability-v2's (the customer time zone picker's flags)", () => {
    expect(read(join(SHARED, 'timezone-flags.ts'))).toBe(read(join(SRC, 'components', 'availability-v2', 'timezone-flags.ts')));
  });
  for (const [operator, copy] of pairs) {
    it(`${copy} matches illustrations-v2/${operator}`, () => {
      expect(withoutImports(read(join(SHARED, 'empty-states', copy)))).toBe(withoutImports(read(join(ILLUSTRATIONS, operator))));
    });
  }
});
