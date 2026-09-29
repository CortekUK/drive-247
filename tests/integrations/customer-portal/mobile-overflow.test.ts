// =============================================================================
// The customer portal has to survive a 360px phone.
//
// WHO SEES THIS. 63 of the 64 active tenants put their customers on the LEGACY
// portal (`app/(legacy)/(customer-portal)`); only RBVS is on the Northwind one.
// So this is the portal almost every renter actually uses, and it was the one
// pushing sideways on a phone.
//
// WHY IT WAS INVISIBLE. `layout.tsx` wraps the content in
// `<SidebarInset className="overflow-x-hidden">`. That does not make a row fit
// — it CLIPS it. A four-column instalment schedule at 360px did not scroll into
// view, it simply lost its right-hand columns, so the customer could not see
// the amount or the status of anything they owed.
//
// THE RULE, taken from the Northwind portal, which already does this: a table
// that cannot fit becomes a list of labelled rows below `sm`, and only becomes
// a grid from `sm` up. Its verification page carries the same note — "a list of
// rows rather than a <table>: this has to survive 360px".
//
// These are source assertions rather than renders because the pages are
// 1000-3000 lines of authenticated, query-driven UI; what is being pinned is
// the class contract, which is exactly where the regression happens.
// =============================================================================

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(__dirname, '../../../');
const read = (rel: string) => readFileSync(resolve(ROOT, rel), 'utf8');

const LEGACY = 'apps/booking/src/app/(legacy)/(customer-portal)';

/** Comments quote the very class names under test; assertions must not read them. */
const strip = (s: string) =>
  s.replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/\/\*[\s\S]*?\*\//g, '');

describe('no phone-hostile grid in the customer portal', () => {
  const PAGES = [
    `${LEGACY}/portal/payments/page.tsx`,
    `${LEGACY}/portal/bookings/[id]/page.tsx`,
    `${LEGACY}/portal/bookings/page.tsx`,
    `${LEGACY}/portal/documents/page.tsx`,
    `${LEGACY}/portal/agreements/page.tsx`,
  ];

  /*
   * WHAT ACTUALLY OVERFLOWS, precisely, because the obvious rule is wrong.
   *
   * Tailwind's `grid-cols-N` is `repeat(N, minmax(0, 1fr))`, so the columns
   * themselves CAN shrink below their content — a bare column count does not
   * push the page sideways. What does is unbreakable content sitting in a
   * column too narrow for it: `$1,234.56` has no space to wrap at, so it
   * overflows its cell and takes the grid with it. Prose wraps and is fine.
   *
   * So this rule does not ban three columns. It bans FOUR OR MORE on a phone,
   * where even wrapping content is unreadable, and exempts a row that is
   * `hidden` below `sm` because it is not rendered there at all.
   */
  it('never lays out four or more columns on a phone', () => {
    const offenders: string[] = [];
    const wide = /(^|\s)grid-cols-([4-9]|1[0-2])\b/;
    const hiddenOnPhone = /(^|\s)hidden(\s|$)/;

    for (const rel of PAGES) {
      const src = strip(read(rel));
      for (const m of src.matchAll(/className=["'`]([^"'`]*)["'`]/g)) {
        const cls = m[1];
        if (!wide.test(cls)) continue;
        if (hiddenOnPhone.test(cls)) continue;
        offenders.push(`${rel}: ${cls}`);
      }
    }
    expect(offenders, offenders.join('\n')).toEqual([]);
  });
});

describe('the instalment schedule is readable on a phone', () => {
  const src = strip(read(`${LEGACY}/portal/bookings/[id]/page.tsx`));

  it('stacks into labelled rows below sm', () => {
    expect(src).toMatch(/flex flex-col[^"]*sm:grid sm:grid-cols-4/);
  });

  it('hides the table header on a phone, where it labels nothing', () => {
    expect(src).toMatch(/hidden grid-cols-4[^"]*sm:grid/);
  });

  it('carries a visible label for each value on a phone', () => {
    for (const label of ['Instalment', 'Due', 'Amount', 'Status']) {
      // Each stacked row needs its own `sm:hidden` caption, or the phone view
      // is four bare values in a column with nothing saying what they are.
      const re = new RegExp(`sm:hidden[^<]*>\\s*${label}`);
      expect(src, `missing phone label: ${label}`).toMatch(re);
    }
  });
});

describe('controls and figures fit the narrow column', () => {
  it('the bookings sort control is full width before it is fixed width', () => {
    const src = strip(read(`${LEGACY}/portal/bookings/page.tsx`));
    expect(src).toMatch(/w-full sm:h-9 sm:w-\[150px\]/);
    expect(src).not.toMatch(/SelectTrigger className="w-\[150px\]"/);
  });

  it('the payment summary steps its type down rather than overflowing', () => {
    const src = strip(read(`${LEGACY}/portal/payments/page.tsx`));
    expect(src).toMatch(/text-base font-bold tabular-nums[^"]*sm:text-xl/);
  });
});

describe('an error message cannot widen the page', () => {
  /*
   * `LoadError` prints `error.message`, which for a database failure is prose
   * with an identifier embedded in it — "column rentals.documents_status does
   * not exist". `rentals.documents_status` is 24 characters with nowhere to
   * wrap, so at 390px inside a padded card it pushed the panel wider than the
   * phone and the whole page scrolled sideways. The failed query was one bug;
   * the horizontal scroll was the error REPORT being unwrappable.
   */
  const src = strip(read('apps/booking/src/northwind-site/components/portal/primitives.tsx'));

  it('wraps the message it did not write', () => {
    expect(src).toMatch(/break-words[^"]*text-sm leading-relaxed text-brand-text-soft/);
  });
});

describe('the shell leaves exactly one scroll container', () => {
  /*
   * Northwind's shell has one: the document. Its sidebar is `fixed`, so it is
   * out of flow, and the content column is a plain block with `lg:pl-[272px]`.
   *
   * The legacy shell is a shadcn flex row, and `SidebarInset` is `flex-1` with
   * no `min-w-0` — a flex item's default `min-width: auto` refuses to shrink
   * below its content, so one wide row widened the column and the page grew a
   * horizontal scrollbar. `overflow-x-hidden` was added to bury that, and per
   * spec a hidden x-axis against a visible y-axis computes y to `auto`: the
   * element becomes its OWN scroll container, which is the second scrollbar
   * the portal had and Northwind's did not.
   */
  const shell = strip(read(`${LEGACY}/layout.tsx`));

  it('lets the content column shrink instead of forcing the page wide', () => {
    expect(shell).toMatch(/SidebarInset className="[^"]*min-w-0/);
  });

  it('clips without creating a nested scroll container', () => {
    expect(shell).toMatch(/SidebarInset className="[^"]*overflow-x-clip/);
    // `overflow-x-hidden` here is the regression: it silently turns the y axis
    // into `auto` and gives the portal a second scrollbar.
    expect(shell).not.toMatch(/SidebarInset className="[^"]*overflow-x-hidden/);
  });
});

describe('the Northwind portal stays the reference', () => {
  // It is the shape being copied, so if it regresses the target moves.
  const NW = 'apps/booking/src/northwind-site/components/portal/portal-shell.tsx';

  it('keeps the sidebar off-canvas below lg', () => {
    const src = strip(read(NW));
    expect(src).toMatch(/hidden w-\[272px\][^"]*lg:flex/);
    expect(src).toMatch(/lg:pl-\[272px\]/);
  });

  it('keeps 44px tap targets on its nav', () => {
    expect(strip(read(NW))).toMatch(/min-h-11/);
  });

  /*
   * The rail is `fixed inset-y-0`, so its height is the viewport's. Eight 44px
   * rows plus the brand header, the Book a car button and the account block
   * need ~556px, so a short window made the nav overflow and draw its own
   * scrollbar down the middle of the shell — the one thing in the portal that
   * had one. The rows still have to be reachable on a short viewport, so the
   * overflow stays and only the chrome goes.
   */
  it('scrolls its nav without drawing a scrollbar', () => {
    const src = strip(read(NW));
    const rail = src.slice(src.indexOf('flex-1 overflow-y-auto'));
    expect(rail).toMatch(/\[scrollbar-width:none\]/);
    expect(rail).toMatch(/\[&::-webkit-scrollbar\]:hidden/);
  });

  it('keeps the nav scrollable, rather than clipping rows out of reach', () => {
    // If this ever becomes `overflow-y-hidden`, a short window silently loses
    // the bottom nav items with no way to get to them.
    expect(strip(read(NW))).toMatch(/flex-1 overflow-y-auto/);
  });
});
