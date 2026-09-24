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
import { readFileSync, existsSync } from "node:fs";
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

  it.each(pages)("%s scrolls its table instead of clipping it", (page) => {
    const s = src(page);
    expect(s).toContain('className="bg-dark-card rounded-lg shadow overflow-x-auto border border-dark-border"');
    expect(s).not.toContain('className="bg-dark-card rounded-lg shadow overflow-hidden border border-dark-border"');
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
