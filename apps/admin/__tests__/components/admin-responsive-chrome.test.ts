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

/*
 * The filter surface is Northwind's, not one of our own.
 *
 * The first build of this invented its own: a round toggle sitting BESIDE the
 * search field, and a card that expanded downward on a partial `rotateX`.
 * Reported as "no no i am saying use that design in super admin" — and the
 * report was right. Northwind puts the toggle inside the field and makes the
 * filters the far face of the overview card, which turns over.
 *
 * These assertions are written against the PORTAL's file as well as this app's,
 * so the two cannot drift: if someone restyles the chip here, the comparison
 * against `apps/portal/.../filter-primitives.tsx` fails.
 */
describe("the filter surface matches Northwind's", () => {
  const primitives = () => src("components/admin/filter-primitives.tsx");
  const portalPrimitives = () =>
    readFileSync(
      resolve(ROOT, "../portal/src/components/shared/filter-primitives.tsx"),
      "utf8",
    );

  it("puts the toggle INSIDE the search field, not beside it", () => {
    const s = primitives();
    // Absolutely positioned against the field's right edge, and square —
    // a round button outside the field is the shape that was rejected.
    expect(s).toContain("absolute right-1.5 top-1/2");
    expect(s).toContain("size-7");
    expect(s).toContain("rounded-lg");
    expect(s).toContain("SlidersHorizontal");
    // Which is only possible if the field is drawn by this component.
    expect(s).toMatch(/pl-9 pr-11/);
  });

  it("hides the count while the panel is open, because the chips say it better", () => {
    expect(primitives()).toContain("{!open && activeCount > 0 && (");
  });

  it("carries the same chip and section shapes as the portal", () => {
    const here = primitives();
    const there = portalPrimitives();
    for (const shape of [
      "rounded-full border px-2.5 py-1 text-xs font-medium transition-colors",
      'text-[10px] font-semibold uppercase tracking-wide text-muted-foreground',
      "flex size-5 shrink-0 items-center justify-center rounded",
      "grid flex-1 content-center gap-x-8 gap-y-4 px-5 pb-4 pt-1 sm:grid-cols-2 lg:grid-cols-4",
    ]) {
      expect(there).toContain(shape);
      expect(here).toContain(shape);
    }
  });

  it("offers Reset only when there is something to reset", () => {
    expect(primitives()).toContain("{activeCount > 0 && (");
  });

  it("owns no filter state of its own", () => {
    // The page keeps every value and passes the controls in as children. That
    // is what makes this safe to drop onto a working list: nothing about what
    // a filter does, or when it applies, passes through here.
    const s = primitives();
    expect(s).toContain("children: ReactNode");
    expect(s).not.toMatch(/fetch\(|useQuery|supabase/);
  });
});

/*
 * The overview card turns over; it does not expand downward.
 */
describe("the overview flips to reveal the filters", () => {
  const flip = () => src("components/admin/overview-flip.tsx");
  const portalFlip = () =>
    readFileSync(
      resolve(ROOT, "../portal/src/components/rentals-v2/rentals-overview-flip.tsx"),
      "utf8",
    );

  it("is a real 180° turn on the horizontal axis", () => {
    const s = flip();
    expect(s).toContain("rotateX: reduceMotion ? 0 : flipped ? 180 : 0");
    expect(s).toContain('transformStyle: "preserve-3d"'.replace(/"/g, "'"));
    expect(s).toContain("backfaceVisibility: 'hidden'");
  });

  it("puts perspective on the WRAPPER, never on the rotating element", () => {
    const s = flip();
    // `perspective` is the viewer's distance from the card. On the card itself
    // it travels with it and the turn goes flat.
    const wrapper = s.slice(s.indexOf("<motion.div"), s.indexOf("<motion.div", s.indexOf("<motion.div") + 1));
    expect(wrapper).toContain("perspective: 1100");
    expect(s).not.toMatch(/preserve-3d[\s\S]{0,200}perspective:/);
  });

  it("animates height on the SAME transition as the rotation", () => {
    // Different curves and the card finishes turning while the box is still
    // resizing under it — the exact broken look the component exists to avoid.
    const s = flip();
    expect(s).toContain("const FLIP = { duration: 0.62");
    expect(s).toMatch(/animate=\{\{ height: target \?\? 'auto' \}\}/);
    expect(s).toContain("transition={hasFlipped ? (reduceMotion ? FADE : FLIP)");
  });

  it("takes the hidden face out of the tab order", () => {
    const s = flip();
    expect(s).toContain("inert");
    expect(s).toContain("invisible");
  });

  it("keeps the same timing as the portal's", () => {
    expect(portalFlip()).toContain("duration: 0.62");
    expect(flip()).toContain("duration: 0.62");
  });
});

/*
 * NOTHING in this app filters its own way.
 *
 * This has now been reported twice. First "no filter flipper", when the panel
 * existed but was wired only into the design preview. Then "promo codes also
 * have the filters and more pages have filters" — because the five obvious
 * list pages had been done and the filtering surfaces that live INSIDE
 * components had not. Promo Codes keeps its filters in
 * `components/admin/promo-codes/*-tab.tsx`, so every check that walked
 * `app/**` and stopped there declared the job finished while two tabs still
 * wore a labelled Search box next to a Status dropdown.
 *
 * So this scans for the STATE rather than the markup: anything that narrows a
 * list has to hold the value that narrows it, and holding one obliges you to
 * use the shared primitives. The allow-list below is every false positive,
 * each with the reason it is not a filter — a new one has to be justified in
 * writing before this test goes green again.
 */
describe("every filtering surface uses the shared primitives", () => {
  /* `setStatus` on something that is NOT a list filter. */
  const NOT_FILTERS = new Set([
    // A status MESSAGE — "Loading signup plans…", "Could not load…".
    "app/admin/(protected)/signup-plans/page.tsx",
    // A todo's own status field, set by a form inside a dialog.
    "components/admin-todos/todo-create-dialog.tsx",
    "components/admin-todos/todo-detail-dialog.tsx",
  ]);

  const tsxFiles = (dir: string): string[] =>
    readdirSync(resolve(ROOT, dir), { withFileTypes: true }).flatMap((e) => {
      const rel = `${dir}/${e.name}`;
      if (e.isDirectory()) return e.name === "node_modules" ? [] : tsxFiles(rel);
      return e.name.endsWith(".tsx") ? [rel] : [];
    });

  const narrowsAList = /set[A-Z][A-Za-z]*Filter\(|setFilter\(|setRange\(|setStatus\(|setSearchQuery\(|setSearch\(/;

  it("finds the surfaces at all", () => {
    const all = tsxFiles("app").concat(tsxFiles("components"));
    expect(all.length).toBeGreaterThan(50);
    const filtering = all.filter((f) => narrowsAList.test(src(f)));
    // If this drops to nothing the regex has stopped matching and every
    // assertion below would pass vacuously.
    expect(filtering.length).toBeGreaterThan(5);
  });

  it("leaves no surface filtering on its own terms", () => {
    const all = tsxFiles("app").concat(tsxFiles("components"));
    const offenders = all.filter((f) => {
      if (NOT_FILTERS.has(f)) return false;
      const s = src(f);
      if (!narrowsAList.test(s)) return false;
      return !s.includes("@/components/admin/filter-primitives");
    });
    expect(offenders).toEqual([]);
  });

  it("has no hand-rolled status pill row left anywhere", () => {
    // The exact shape that was removed from four separate files: a `<button>`
    // per status, coloured by which status it is. Chips carry one active
    // treatment, set in the primitives, so this shape means someone rebuilt
    // the thing rather than importing it.
    const all = tsxFiles("app").concat(tsxFiles("components"));
    const offenders = all.filter((f) =>
      /rounded-md text-xs font-semibold transition-all capitalize border/.test(src(f)),
    );
    expect(offenders).toEqual([]);
  });
});

/*
 * Every list page that has filters, folds them.
 *
 * `welcome-pack` is deliberately absent: its Selects pick a chapter inside a
 * form, and it has no list to narrow. `blacklist` is absent from THIS list but
 * covered below — it searches without filtering, so it has a field and no
 * toggle.
 */
describe("list pages fold their filters", () => {
  const folded = [
    "app/admin/(protected)/feedbacks/page.tsx",
    "app/admin/(protected)/platform-rentals/page.tsx",
    "app/admin/(protected)/audit-logs/page.tsx",
    "app/admin/(protected)/requests/page.tsx",
    "app/admin/(protected)/rentals/page.tsx",
    "app/admin/(protected)/openai-usage/page.tsx",
    "app/admin/(protected)/contacts/page.tsx",
    "components/admin/BonzahSubmissions.tsx",
    "components/admin/promo-codes/codes-tab.tsx",
    "components/admin/promo-codes/referral-links-tab.tsx",
  ];

  it.each(folded)("%s uses the shared Northwind primitives", (page) => {
    const s = src(page);
    expect(s).toContain("from '@/components/admin/filter-primitives'");
    expect(s).toContain("<FilterShell");
    expect(s).toContain("activeCount=");
  });

  /*
   * The search field belongs on the SEARCH ROW, not inside the panel.
   *
   * The first version put every control inside the panel, search included — so
   * finding a record by name meant opening the filters first. Northwind keeps
   * the field visible with the toggle inside it, which is what `FilterSearch`
   * draws.
   *
   * Two surfaces have nothing to search — Contact Requests and OpenAI Usage
   * both narrow without a query — so they render the toggle on its own via
   * `standalone`. What every surface shares is that the toggle is reachable
   * WITHOUT first opening anything, and that no page hand-rolls a second
   * search box beside the one the primitive owns.
   */
  it.each(folded)("%s exposes the toggle without opening anything first", (page) => {
    const s = src(page);
    const hasField = s.includes("<FilterSearch");
    const standalone = /<FilterToggle[\s\S]*?standalone/.test(s);
    expect(hasField || standalone).toBe(true);
    expect(s).toMatch(/open=\{filtersOpen\}/);
    expect(s).toMatch(/onOpenChange=\{setFiltersOpen\}/);
    expect(s).not.toMatch(/<Input[\s\S]{0,200}placeholder="Search/);
  });

  /*
   * Closed on arrival. A list page does not open wearing its filters — that
   * was the whole complaint the panel exists to answer.
   */
  it.each(folded)("%s starts with the filters hidden", (page) => {
    const s = src(page);
    expect(s).toMatch(/const \[filtersOpen, setFiltersOpen\] = useState\(false\)/);
  });

  /*
   * Where the panel appears depends on whether the page has an overview to
   * turn over. Both are Northwind's — the flip is its rentals list, the reveal
   * is its filter bar used uncontrolled — and a page must use exactly one.
   */
  it.each(folded)("%s puts the panel on a flip or a reveal, not both", (page) => {
    const s = src(page);
    const flips = s.includes("<OverviewFlip");
    const reveals = s.includes("<FilterReveal");
    expect(flips || reveals).toBe(true);
    expect(flips && reveals).toBe(false);
    if (flips) {
      // A flip needs a front face, and the way back from it.
      expect(s).toContain("front={");
      expect(s).toContain("back={");
      expect(s).toMatch(/onFlipBack=\{\(\) => setFiltersOpen\(false\)\}/);
    }
  });

  /*
   * The badge reads real state, not a literal.
   *
   * Only for the surfaces that declare an `activeFilterCount`. Contact
   * Requests and OpenAI Usage each narrow on exactly one axis and pass the
   * expression inline (`range !== '7d' ? 1 : 0`), which is the same thing
   * written shorter and has no declaration to inspect.
   */
  const counted = folded.filter((p) => /const activeFilterCount =/.test(src(p)));

  it("most surfaces declare a filter count", () => {
    expect(counted.length).toBeGreaterThanOrEqual(folded.length - 2);
  });

  it.each(counted)("%s counts its filters from its own state", (page) => {
    const s = src(page);
    const decl = s.match(/const activeFilterCount =[\s\S]*?;/)?.[0] ?? "";
    expect(decl).not.toBe("");
    // Every name the badge reads must be a `useState` on this page. The first
    // attempt at this counted `search` and `statusFilter` on a page that has
    // neither — the dev server still returned 200, because Turbopack does not
    // typecheck.
    const names = [...decl.matchAll(/\b([a-z][A-Za-z0-9]*)\s*(?:!==|\.trim\(\)|\?)/g)].map((m) => m[1]);
    expect(names.length).toBeGreaterThan(0);
    for (const n of names) {
      // A plain string, not a built regex: `[` needs escaping in one and not
      // the other, and the escape did not survive being written here.
      expect(s.includes(`const [${n},`)).toBe(true);
    }
  });
});

describe("the sidebar reads like Northwind's rail", () => {
  const sidebar = () => src("components/admin/Sidebar.tsx");

  it("gives a group caption full muted ink, not a fraction of it", () => {
    // The portal measured this label under 4.5:1 at a fraction and moved it to
    // full muted (`v2-cursor-hover-polish`: "the 'More' label is full muted
    // text"). This was at /70 for the same reason it was wrong there.
    expect(sidebar()).toContain("uppercase tracking-widest text-muted-foreground hover:text-foreground");
    expect(sidebar()).not.toContain("text-muted-foreground/70");
  });

  it("marks the active row with the rail's inset rim, not an outset glow", () => {
    const s = sidebar();
    expect(s).toContain("bg-sidebar-accent");
    expect(s).toContain("shadow-[inset_0_0_0_1px_hsl(var(--primary)_/_0.12)");
    expect(s).not.toContain("glow-purple'");
  });
});

/*
 * A page's sections live in the sidebar, not in a strip across the top.
 *
 * Asked for Sep 25 2026: "if the page has multiple options like promo codes,
 * shift that to the sidebar". Promo Codes carried five triggers in a
 * `TabsList` that wrapped onto two lines on a narrow window; Northwind's rail
 * carries a page's sub-pages in the navigation instead.
 */
describe("multi-section pages publish their sections to the sidebar", () => {
  const registering = [
    "app/admin/(protected)/promo-codes/page.tsx",
    "app/admin/(protected)/welcome-pack/page.tsx",
    "app/admin/(protected)/rentals/[id]/page.tsx",
  ];

  it.each(registering)("%s registers its sections and keeps no tab strip", (page) => {
    const s = src(page);
    expect(s).toContain("useRegisterSidebarSections(");
    expect(s).not.toContain("<TabsList");
    expect(s).not.toContain("<TabsTrigger");
    // `Tabs` stays: it is what mounts the panel for `value`, so dropping it
    // would have meant rewriting every panel on the page. Asserted on the
    // PROPS, not the exact tag — the first version demanded the tag end right
    // after `setTab}` and failed on a page that also passes a className.
    expect(s).toMatch(/<Tabs[^>]*value=\{tab\}/);
    expect(s).toMatch(/<Tabs[^>]*onValueChange=\{setTab\}/);
  });

  it("leaves a two-way strip alone", () => {
    // `bonzah-onboarding` has two tabs. Two do not wrap, and pushing them into
    // the sidebar buys a level of navigation depth for nothing — Northwind's
    // own two-way switch (Portal / Website) is a strip too.
    const s = src("app/admin/(protected)/bonzah-onboarding/page.tsx");
    expect(s).toContain("<TabsList>");
    expect((s.match(/<TabsTrigger/g) ?? []).length).toBe(2);
  });

  it("a record page names the rail after the record, not the list", () => {
    // Northwind's customer rail says "Haris Zahid", not "Customers". A rail
    // that reads the same on every tenant cannot tell you which one is open.
    const s = src("app/admin/(protected)/rentals/[id]/page.tsx");
    expect(s).toContain("tenant?.company_name ?? 'Rental company'");
  });

  it("keeps the deep link that other screens send", () => {
    // `?tab=payments` was the uncontrolled `defaultValue`; making the tabs
    // controlled must not drop it, or every link into a tenant's payments
    // lands on Details instead.
    const s = src("app/admin/(protected)/rentals/[id]/page.tsx");
    expect(s).toContain("get('tab') === 'payments'");
    expect(s).toContain("const [tab, setTab] = useState(");
  });

  it("promo codes registers its five and keeps no tab strip", () => {
    const s = src("app/admin/(protected)/promo-codes/page.tsx");
    expect(s).toContain("useRegisterSidebarSections(");
    expect(s).toContain("'/admin/promo-codes'");
    // The strip is gone…
    expect(s).not.toContain("<TabsList");
    expect(s).not.toContain("<TabsTrigger");
    // …and `Tabs` stays, because it is what mounts the panel for `value`.
    // Dropping it would have meant rewriting all five panels.
    expect(s).toContain("<Tabs value={tab} onValueChange={setTab}>");
    for (const id of ['codes', 'referral-links', 'claims', 'leaderboard', 'settings']) {
      expect(s).toContain(`<TabsContent value="${id}">`);
    }
  });

  it("registers exactly the sections it renders panels for", () => {
    // A section in the sidebar with no panel behind it is a dead row.
    const s = src("app/admin/(protected)/promo-codes/page.tsx");
    const registered = [...s.matchAll(/\{ id: '([a-z-]+)', label:/g)].map((m) => m[1]).sort();
    const panels = [...s.matchAll(/<TabsContent value="([a-z-]+)">/g)].map((m) => m[1]).sort();
    expect(registered).toEqual(panels);
  });

  it("changes nothing about navigation", () => {
    // The whole reason this is a context and not a route per section: no URL
    // means anything new, and nothing that was bookmarkable has stopped being
    // so. If this ever becomes routes, that is a decision to take on purpose.
    // Checked on the IMPORTS, not the prose: the file's own comment explains
    // why it does not reach for the router, and the first version of this test
    // matched that explanation and failed.
    const s = src("components/admin/sidebar-sections.tsx");
    expect(s).not.toContain("from 'next/navigation'");
    expect(s).not.toContain('from "next/navigation"');
    expect(s).toContain("createContext");
  });

  /* Unmount clearing, the render loop and the round trip from rail row to
     panel are all proved by MOUNTING the thing, in
     `sidebar-sections.test.tsx`. This file used to grep the source for the
     cleanup line, which asserted one particular spelling of the fix and broke
     the moment the fix changed shape — while saying nothing about whether it
     worked. A behavioural test beside a brittle textual one is just the
     brittle one. */

  it("gives the whole rail over to the page's sections", () => {
    // This used to assert the sections were nested UNDER their nav item. They
    // are not any more: a page with sections takes the rail, the way opening a
    // customer in Northwind replaces the navigation with that customer's own
    // sections. The nav comes back through the rail's own way out.
    const s = src("components/admin/Sidebar.tsx");
    expect(s).toContain("sections && !showNav ? (");
    expect(s).toContain("<SectionRail");
    expect(s).toContain("All sections");
    // …and leaving the page must drop the rail, or it sits over the navigation
    // of wherever you landed.
    expect(s).toContain("setShowNav(false);");
  });
});

/*
 * One surface, no seam.
 *
 * Asked for Sep 25 2026 with both screens side by side: "in northwind the side
 * bar colour and main panel colours are same, but the super admin panel have
 * white colour". This went the wrong way twice — the rail was a pale lavender,
 * then pure white when that was asked for — and both drew a visible line down
 * the middle of the page.
 *
 * The answer is not a matching colour, it is NO colour: the shell paints
 * `bg-app-gradient` with `background-attachment: fixed`, so a transparent rail
 * shows the same pixels of the same wash the content does. A chosen match
 * drifts the moment either side is adjusted; this one cannot.
 */
describe('the rail and the page are one surface', () => {
  it('paints no background on either rail', () => {
    const sidebar = src('components/admin/Sidebar.tsx');
    const support = src('components/support/AdminSupportRail.tsx');
    // `bg-sidebar-accent` is the active pill and stays; a bare `bg-sidebar` is
    // the surface and must not come back.
    expect(sidebar).not.toMatch(/className="[^"]*\bbg-sidebar\b[^-][^"]*"/);
    expect(support).not.toMatch(/className="[^"]*\bbg-sidebar\b[^-][^"]*"/);
  });

  it('rules no line between them', () => {
    const sidebar = src('components/admin/Sidebar.tsx');
    const support = src('components/support/AdminSupportRail.tsx');
    expect(sidebar).not.toContain('border-r border-sidebar-border');
    expect(support).not.toContain('border-r border-sidebar-border');
  });

  it('keeps the wash fixed to the viewport, which is what makes them identical', () => {
    // Without `fixed` the gradient would be positioned per element and the two
    // surfaces would show different parts of it.
    expect(src('app/globals.css')).toContain('background-attachment: fixed');
  });
});
