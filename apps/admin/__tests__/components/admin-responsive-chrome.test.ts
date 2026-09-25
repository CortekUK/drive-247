/**
 * The Super Admin app's chrome on a phone.
 *
 * Sep 25 2026: port the operator portal's responsive rules here. Three of them
 * survived contact with this codebase; the rest had nothing to attach to,
 * which is recorded at the bottom so the next person does not go looking.
 *
 * Source checks rather than renders: every page in this app sits behind
 * `(protected)`, which redirects to the login screen without a session, so
 * there is no way to mount one of these in a test without standing up auth.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(__dirname, "../..");
const src = (p: string) => readFileSync(resolve(ROOT, p), "utf8");

describe("the admin sidebar is sized for a thumb", () => {
  const sidebar = () => src("components/admin/Sidebar.tsx");

  it("gives a nav row a 44px target on a phone and the rail's own density from md", () => {
    const s = sidebar();
    // Below `md` this sidebar IS the sheet behind the header's menu, and its
    // rows were px-3 py-2 at 13px — about 34px tall.
    expect(s).toContain("min-h-11");
    expect(s).toContain("md:min-h-0 md:text-[13px]");
    expect(s).toContain("text-[15px]");
  });

  it("never leaves a 13px label without its mobile size", () => {
    // A bare 13px label is one the pass missed.
    expect(sidebar()).not.toMatch(/(?<!md:)text-\[13px\]/);
  });

  it("scales the row's glyph with the row", () => {
    expect(sidebar()).toContain("size-[18px] md:size-4");
  });
});

describe("no admin table is clipped on a phone", () => {
  /*
   * These three cards wrapped a `min-w-full` table in `overflow-hidden`, which
   * is worse than no scroller at all: the columns past the fold were not
   * merely off screen, they were unreachable. Any non-visible overflow still
   * rounds the card's corners, so `overflow-x-auto` costs the desktop nothing.
   */
  const pages = [
    "app/admin/(protected)/admins/page.tsx",
    "app/admin/(protected)/blacklist/page.tsx",
    "app/admin/(protected)/contacts/page.tsx",
  ];

  /*
   * The RULE, not the class string. This first asserted the exact wrapper it
   * expected, and a restyle that kept the scrolling perfectly intact broke it
   * anyway — a test that fails on a change it does not care about teaches
   * people to edit tests rather than read them. What matters is that a table
   * has a scroller on an ancestor near it, whatever that ancestor looks like.
   */
  it.each(pages)("%s has a scroller above its table, not a clip", (page) => {
    const lines = src(page).split("\n");
    const tables = lines.flatMap((l, i) => (/<table\b/.test(l) ? [i] : []));
    expect(tables.length).toBeGreaterThan(0);

    for (const at of tables) {
      // Class attributes only. Reading the raw slice matched the COMMENT that
      // explains this fix, which happens to contain the word it forbids.
      const classes = [...lines.slice(Math.max(0, at - 6), at + 1).join("\n").matchAll(/className="([^"]*)"/g)]
        .map((m) => m[1])
        .join(" ");
      expect(classes).toMatch(/overflow-(x-)?(auto|scroll)/);
      expect(classes).not.toMatch(/overflow-hidden/);
    }
  });
});

describe("the admin login screen", () => {
  const login = () => src("app/admin/login/page.tsx");

  it("carries the product's own wordmark, from the file the other apps use", () => {
    expect(login()).toContain('src="/drive247-logo-light.png"');
    expect(existsSync(resolve(ROOT, "public/drive247-logo-light.png"))).toBe(true);
    // Byte for byte the landing site's, so the three sign-in surfaces cannot
    // drift into three slightly different marks.
    expect(
      readFileSync(resolve(ROOT, "public/drive247-logo-light.png")).equals(
        readFileSync(resolve(ROOT, "../web/public/logo-light.png")),
      ),
    ).toBe(true);
  });

  it("no longer brands itself as something the rest of the app never says", () => {
    // "CORTEK" appeared here and nowhere else in the app, against a tab title
    // of "Drive247 Admin Portal" and a sidebar wordmark of "Drive247".
    expect(login()).not.toMatch(/>\s*CORTEK\s*</);
    expect(login()).not.toContain("<ShieldCheck");
  });

  it("needs no light-mode pin, because this app has no dark to fall into", () => {
    // The portal needed `usePinnedLightTheme` because next-themes there
    // resolves "system". This app has no theme provider at all — globals.css
    // says so explicitly — so a pin would be a moving part guarding nothing.
    // If that ever changes, this test is the thing that should fail.
    const globals = src("app/globals.css");
    expect(globals).toContain("LIGHT by default");
    const appFiles = ["app/layout.tsx", "app/admin/login/page.tsx", "app/admin/(protected)/layout.tsx"];
    for (const file of appFiles) {
      expect(src(file)).not.toContain("next-themes");
      expect(src(file)).not.toContain("ThemeProvider");
    }
  });
});

describe("what the portal's dock did NOT port", () => {
  it("has no record screen with a left AND a right internal rail to dock", () => {
    /*
     * The floating dock exists because a rental, customer or vehicle is three
     * columns on a desktop and neither side column fits on a phone. Nothing in
     * this app is built that way: its pages are a list or a form inside one
     * global sidebar, `AdminSupportWorkspace` is still a placeholder, and the
     * single `<aside>` in the whole app is one column on signup-plans.
     *
     * So a dock here would be a bar with nothing to carry. This test is a
     * tripwire, not a rule: when a second internal rail does appear, it fails,
     * and whoever added it gets told the dock is now worth porting.
     */
    const asides = ["app/admin/(protected)/signup-plans/page.tsx"];
    expect(src("components/support/AdminSupportWorkspace.tsx").split("\n").length).toBeLessThan(120);
    for (const page of asides) expect((src(page).match(/<aside/g) ?? []).length).toBeLessThanOrEqual(1);
  });
});

/*
 * One page title, one table head.
 *
 * Ported from the operator portal Sep 25 2026, against its reference screens.
 * Before this the app had six title treatments across 22 pages — `text-2xl
 * font-bold tracking-tight`, `text-2xl font-semibold`, `text-3xl font-bold
 * text-foreground` and three more — and four table-head treatments. Nothing
 * was broken; it just did not read as one product, which is most of what
 * "matching the theme" means at a glance.
 *
 * The values are Northwind's own, not a new house style:
 *   title  apps/portal/src/app/(dashboard)/vehicles/page.tsx
 *   head   apps/portal/src/components/shared/list-table-v2.tsx (LIST_CLASSES)
 */
describe("the admin pages wear Northwind's type scale", () => {
  const pages = readdirSync(resolve(ROOT, "app/admin/(protected)"), { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => `app/admin/(protected)/${e.name}/page.tsx`)
    .filter((p) => existsSync(resolve(ROOT, p)));

  it("finds the pages at all", () => {
    expect(pages.length).toBeGreaterThan(15);
  });

  it("gives every page title the one scale", () => {
    const offenders = pages.filter((p) => {
      const titles = [...src(p).matchAll(/<h1 className="([^"]*)"/g)].map((m) => m[1]);
      return titles.some((t) => !/text-2xl sm:text-3xl font-bold/.test(t));
    });
    expect(offenders).toEqual([]);
  });

  it("gives every table head the one treatment", () => {
    // 11px semibold with `tracking-wider` — the letterspacing is what makes a
    // column head read as Northwind's rather than as a small grey label.
    const offenders: string[] = [];
    for (const p of pages) {
      for (const m of src(p).matchAll(/<th className="([^"]*)"/g)) {
        const cls = m[1];
        if (!/uppercase/.test(cls)) continue; // a plain cell head, not a label
        if (!/text-\[11px\]/.test(cls) || !/tracking-wider/.test(cls)) offenders.push(`${p}: ${cls}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});

/*
 * The shell pads once, and the top bar paints nothing.
 *
 * Reported as "remove this white space" with a screenshot, Sep 25 2026. Two
 * causes stacked at the top of every page:
 *
 *   1. `(protected)/layout.tsx` wraps children in `p-4 sm:p-6`, and seven
 *      pages ALSO padded themselves — `p-8`, or `p-6` beside a max-width — so
 *      24+32px of nothing sat above their own title.
 *   2. The header was `bg-background/80 backdrop-blur-xl border-b`, an opaque
 *      white band across the top that cut the page wash off at the chrome.
 *
 * The portal's top bar carries no fill, no border and no shadow for exactly
 * this reason (`top-bar-v2.tsx`), and it can because nothing scrolls under it.
 * The same is true here: the header is a non-scrolling row in an `h-screen`
 * flex column and `<main>` is the only scroll container.
 */
describe("the admin shell pads once", () => {
  it("keeps the padding on the layout, where every page gets it", () => {
    expect(src("app/admin/(protected)/layout.tsx")).toContain("'p-4 sm:p-6'");
  });

  it("has no page padding itself on top of that", () => {
    const pages = readdirSync(resolve(ROOT, "app/admin/(protected)"), { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => `app/admin/(protected)/${e.name}/page.tsx`)
      .filter((p) => existsSync(resolve(ROOT, p)));

    // The rule is about the page's OUTERMOST element only: an inner panel or a
    // CardContent pads itself and should. So this finds the default export's
    // `return (` and looks at the first className after it, nothing else.
    const offenders = pages.filter((p) => {
      const s = src(p);
      const from = s.indexOf("export default function");
      if (from < 0) return false;
      const ret = s.indexOf("return (", from);
      if (ret < 0) return false;
      const root = s.slice(ret, ret + 400).match(/className="([^"]*)"/);
      // Split on whitespace rather than matching inside the string: `p-4` as
      // a substring also lives inside `gap-4`, so a loose match would fail a
      // root whose only sin was a gap.
      return !!root && root[1].split(/\s+/).some((c) => /^(sm:|md:|lg:)?p[xytblr]?-[0-9]/.test(c));
    });
    expect(offenders).toEqual([]);
  });

  it("leaves the top bar unpainted so the wash runs to the top edge", () => {
    const header = src("components/admin/Header.tsx");
    const cls = [...header.matchAll(/className="([^"]*)"/g)].map((m) => m[1])[0] ?? "";
    for (const paint of ["bg-background", "border-b", "backdrop-blur"]) {
      expect(cls).not.toContain(paint);
    }
    expect(cls).toContain("h-14");
  });
});

/*
 * No label that only repeats the page's own title.
 *
 * Asked for Sep 25 2026 ("remove these name like dashboards"). On every
 * top-level page the header rendered a single breadcrumb — the page's own
 * name, with no href — directly above an <h1> saying the same thing.
 *
 * The trail survives where it IS a trail: on a detail route the first crumb
 * carries an href back to the list, which is the only way up from a record
 * other than the browser's Back button. Removing that would have been taking
 * navigation away, not tidying.
 */
describe("the header shows a trail or nothing", () => {
  const header = () => src("components/admin/Header.tsx");

  it("renders the breadcrumb only when there is more than one crumb", () => {
    expect(header()).toContain("breadcrumbs.length > 1");
  });

  it("keeps the spacer, so the right-hand cluster stays put either way", () => {
    expect(header()).toContain('<div className="flex-1" />');
  });

  it("still builds a two-crumb trail for a detail route", () => {
    // The builder's own branch: a nested path pushes the parent WITH an href
    // and then "Details". If that goes, the rule above starts hiding a real
    // back link rather than a duplicate.
    const s = header();
    expect(s).toContain("crumbs.push({ label: 'Details' })");
    expect(s).toContain("href: `/${parentPath}`");
  });
});

/*
 * The scroll frame, and filters that fold away.
 *
 * Both asked for Sep 25 2026 against the Northwind screens.
 */
describe("the shell scrolls like a desktop app", () => {
  it("scrolls only the main panel and the sidebar, never the document", () => {
    const layout = src("app/admin/(protected)/layout.tsx");
    // The frame is one viewport tall and cannot scroll…
    expect(layout).toContain("h-screen overflow-hidden");
    // …main is the scroll container and is marked for the scrollbar rule…
    expect(layout).toContain("data-scrollport");
    expect(layout).toContain("overflow-y-auto");
    // …and the sidebar scrolls independently of it, showing no bar, which is
    // what Northwind's rail does. This asserted `<ScrollArea` at first — the
    // implementation rather than the rule — and broke the moment that Radix
    // component was swapped for a plain scroller that could hide its bar.
    const sidebar = src("components/admin/Sidebar.tsx");
    expect(sidebar).toMatch(/no-scrollbar[^"]*overflow-y-auto|overflow-y-auto[^"]*no-scrollbar/);
  });

  it("paints the house scrollbar on both elements that can show one", () => {
    // `html` covers the routes outside the fixed frame (login, preview);
    // `[data-scrollport]` covers every page behind the sign-in, where the
    // document never scrolls and main's bar is the one on screen. Styling
    // only the first would have left the visible one untouched.
    const css = src("app/globals.css");
    expect(css).toMatch(/html,\s*\n\[data-scrollport\]/);
    expect(css).toContain("scrollbar-width: thin");
    expect(css).toContain("background-clip: padding-box");
  });
});

describe("filters fold away until asked for", () => {
  const panel = () => src("components/admin/filter-panel.tsx");

  it("is closed until the button is pressed, and says so", () => {
    const s = panel();
    expect(s).toContain("useState(false)");
    expect(s).toContain("aria-expanded={open}");
    expect(s).toContain("aria-controls={panelId}");
  });

  it("animates to the panel's own height without measuring it", () => {
    // `0fr -> 1fr` on a grid row is the one CSS-only way to transition to
    // `auto`. A `max-h-[Npx]` would clip the day a filter is added.
    const s = panel();
    expect(s).toContain("grid-rows-[1fr]");
    expect(s).toContain("grid-rows-[0fr]");
    expect(s).toContain("min-h-0 overflow-hidden");
    expect(s).not.toMatch(/max-h-\[\d+px\]/);
    // …and it respects a system that has asked for less movement.
    expect(s).toContain("motion-reduce:transition-none");
  });

  it("owns no filter state of its own", () => {
    // The page keeps every value and passes the controls in as children. That
    // is what makes this safe to drop onto a working list: nothing about what
    // a filter does, or when it applies, passes through this component.
    const s = panel();
    expect(s).toContain("children: ReactNode");
    expect(s).not.toMatch(/onChange|useEffect|fetch\(/);
  });

  it("shows how many filters are set, since a folded filter is forgettable", () => {
    expect(panel()).toContain("count > 0");
  });
});
