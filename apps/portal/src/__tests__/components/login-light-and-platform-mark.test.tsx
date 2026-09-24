/**
 * The sign-in screen: always light, always the platform's mark.
 *
 * Two changes asked for on Sep 24 2026, after a phone in system dark opened
 * the page dark with a broken-image glyph where the brand should have been:
 *
 *   1. the page is pinned light and the theme toggle is gone, so the screen a
 *      new operator meets does not inherit a preference they have not
 *      expressed and cannot be switched before they have an account;
 *   2. the mark is Drive247's own, shipped with the app, rather than the
 *      tenant's `logo_url` fetched over mobile data above the fold.
 *
 * The pin gets real tests because it reaches out and writes to
 * `document.documentElement`, which is the kind of thing that works when it is
 * written and stops working when something else starts writing there too. The
 * rest are source checks, in the house style: the page needs providers this
 * suite has no business standing up.
 */
import { describe, it, expect, afterEach } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { render, cleanup } from "@testing-library/react";
import { usePinnedLightTheme } from "@/hooks/use-pinned-light-theme";
import { cn } from "@/lib/utils";

const src = (p: string) => readFileSync(resolve(__dirname, "../../", p), "utf8");
const publicFile = (p: string) => resolve(__dirname, "../../../public", p);
const webPublicFile = (p: string) =>
  resolve(__dirname, "../../../../web/public", p);

const login = () => src("components/auth-v2/login-v2.tsx");

function Pinned() {
  usePinnedLightTheme();
  return <p>signed out</p>;
}

describe("the login page is pinned light", () => {
  afterEach(() => {
    cleanup();
    document.documentElement.className = "";
    document.documentElement.style.colorScheme = "";
  });

  it("takes a dark document light while it is on screen", () => {
    document.documentElement.classList.add("dark");

    render(<Pinned />);

    expect(document.documentElement.classList.contains("dark")).toBe(false);
    expect(document.documentElement.classList.contains("light")).toBe(true);
    expect(document.documentElement.style.colorScheme).toBe("light");
  });

  /*
   * The reason the hook carries an observer rather than a one-shot effect.
   * next-themes re-applies the stored theme from its OWN effects, which land
   * after this one when /login is the first page loaded, and again whenever
   * the OS theme flips while the stored theme is "system". Both arrive as an
   * attribute write on <html> from outside React, which is what this stands in
   * for.
   */
  it("re-pins when something else puts the dark class back", async () => {
    render(<Pinned />);

    document.documentElement.classList.add("dark");
    // MutationObserver callbacks are delivered as a microtask.
    await Promise.resolve();

    expect(document.documentElement.classList.contains("dark")).toBe(false);
    expect(document.documentElement.classList.contains("light")).toBe(true);
  });

  it("gives the document back exactly as it found it", async () => {
    document.documentElement.classList.add("dark");
    document.documentElement.style.colorScheme = "dark";

    const { unmount } = render(<Pinned />);
    expect(document.documentElement.classList.contains("dark")).toBe(false);

    unmount();

    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(document.documentElement.classList.contains("light")).toBe(false);
    expect(document.documentElement.style.colorScheme).toBe("dark");

    // And it has stopped listening — signing in must not leave a pin behind
    // that drags the dashboard light again.
    document.documentElement.classList.add("dark");
    await Promise.resolve();
    expect(document.documentElement.classList.contains("dark")).toBe(true);
  });

  it("leaves an already-light document alone on the way out", () => {
    const { unmount } = render(<Pinned />);
    unmount();

    expect(document.documentElement.classList.contains("dark")).toBe(false);
  });
});

describe("the login page's theme controls", () => {
  it("uses the pin and does not read the resolved theme", () => {
    const s = login();
    expect(s).toContain("usePinnedLightTheme()");
    expect(s).toContain("const isDarkMode = false;");
    expect(s).not.toContain('from "next-themes"');
  });

  it("carries no theme toggle", () => {
    const s = login();
    // The comment that records why it went may name it; a live import or
    // element may not.
    expect(s).not.toContain("import { ThemeToggle }");
    expect(s).not.toContain("<ThemeToggle");
  });
});

describe("the login page's mark", () => {
  it("is the platform's file, not the tenant's column", () => {
    const s = login();
    expect(s).toContain('const PLATFORM_LOGO_LIGHT_GROUND = "/drive247-logo-light.png"');
    expect(s).toContain('const PLATFORM_LOGO_DARK_GROUND = "/drive247-logo-dark.png"');
    expect(s).not.toContain("<BrandLogo");
    // The three tenant columns the mark used to be resolved from.
    expect(s).not.toContain("branding?.auth_logo_url");
    expect(s).not.toContain("branding?.dark_logo_url");
    expect(s).not.toContain("branding?.logo_url");
  });

  it("picks its file by the ground it sits on, in both layouts", () => {
    const s = login();
    // Desktop hero: the tenant's photograph makes the ground dark.
    expect(s).toContain(
      "const heroLogo = heroOnDark ? PLATFORM_LOGO_DARK_GROUND : PLATFORM_LOGO_LIGHT_GROUND;",
    );
    // Phone: the flat tint, whose own lightness is the question.
    expect(s).toContain(
      "src={mobileOnDark ? PLATFORM_LOGO_DARK_GROUND : PLATFORM_LOGO_LIGHT_GROUND}",
    );
  });

  it("ships both files, byte for byte the landing site's own", () => {
    for (const [portal, web] of [
      ["drive247-logo-light.png", "logo-light.png"],
      ["drive247-logo-dark.png", "logo-dark.png"],
    ]) {
      expect(existsSync(publicFile(portal))).toBe(true);
      expect(readFileSync(publicFile(portal)).equals(readFileSync(webPublicFile(web)))).toBe(true);
    }
  });
});

describe("the sidebar sheet is sized for a thumb", () => {
  const sidebar = () => src("components/shared/layout/app-sidebar-v2.tsx");

  it("gives nav rows a 44px target on a phone and the rail's 32px from md", () => {
    const s = sidebar();
    expect(s).toContain('"h-11 md:h-8 [&>svg]:size-[18px] md:[&>svg]:size-4 font-medium');
    // No row may keep the desktop height unconditionally.
    expect(s).not.toMatch(/className="h-8 (min-w-0 flex-1 )?transition-colors"/);
  });

  it("scales every nav label, and never drops the desktop size", () => {
    const s = sidebar();
    expect(s).toContain("text-[15px] md:text-[13px]");
    // A 13px label that is not behind `md:` is one the mobile pass missed.
    expect(s).not.toMatch(/(?<!md:)text-\[13px\]/);
    // …and every mobile size must be paired, or the rail got bigger too.
    const mobile = s.match(/text-\[15px\]/g) ?? [];
    const paired = s.match(/text-\[15px\] md:text-\[13px\]/g) ?? [];
    expect(paired.length).toBe(mobile.length);
  });

  it("hides the keyboard hints the phone cannot use", () => {
    expect(sidebar()).toContain("hidden rounded-full px-1.5 py-0.5 font-mono text-[10px] font-semibold transition-colors md:inline-block");
  });
});

/*
 * The sheet's sizes survive the merge.
 *
 * `SidebarMenuButton` composes its base classes with the caller's through
 * `cn` (tailwind-merge), and its base already sets `h-8` and `[&>svg]:size-4`.
 * A merge that treats `[&>svg]:size-[18px]` as a different utility from
 * `[&>svg]:size-4`, or that drops `md:h-8` along with the bare `h-8` it
 * replaces, would leave the sheet looking exactly as it did before with
 * nothing in the source to show why. These assert the resolved class list, not
 * the intent.
 */
describe("the sheet's row classes survive tailwind-merge", () => {
  const BASE_BUTTON =
    "peer/menu-button flex w-full items-center gap-2 rounded-md p-2 text-left text-sm [&>svg]:size-4 [&>svg]:shrink-0";
  const BASE_SIZE = "h-8 text-sm";
  const NAV_ROW =
    "h-11 md:h-8 [&>svg]:size-[18px] md:[&>svg]:size-4 font-medium transition-colors";

  const resolved = () => cn(BASE_BUTTON, BASE_SIZE, NAV_ROW).split(/\s+/);

  it("keeps the mobile height and the md override, and drops the base height", () => {
    const classes = resolved();
    expect(classes).toContain("h-11");
    expect(classes).toContain("md:h-8");
    expect(classes).not.toContain("h-8");
  });

  it("keeps both icon sizes, and drops the base icon size", () => {
    const classes = resolved();
    expect(classes).toContain("[&>svg]:size-[18px]");
    expect(classes).toContain("md:[&>svg]:size-4");
    expect(classes).not.toContain("[&>svg]:size-4");
    // The base's other svg rule is not a size and must survive untouched.
    expect(classes).toContain("[&>svg]:shrink-0");
  });
});

/*
 * The one coupling the sheet's sizes rest on.
 *
 * The sheet renders when `useIsMobile()` is true — under 768px — and every
 * size above is paired as `<mobile> md:<desktop>`, where Tailwind's `md:` is
 * 768px and up. The two agreeing is what makes the larger set reachable ONLY
 * inside the sheet and the rail's own density untouched. Move
 * `MOBILE_BREAKPOINT` to 640 and nothing breaks loudly: the rail simply starts
 * wearing 44px rows between 640 and 768.
 *
 * It is also the breakpoint the three record rails stand down at
 * (`app-sidebar-v2.tsx`, `&& !isMobile`) and the one the record dock takes
 * over at (`useWiderThan(768)`), so all three read from this number.
 */
describe("the sheet's breakpoint is Tailwind's md", () => {
  it("is 768, the same number every mobile pair above is written against", () => {
    expect(src("hooks/use-mobile.tsx")).toContain("const MOBILE_BREAKPOINT = 768;");
  });

  it("is the width the record rails and the dock hand over at", () => {
    const sidebar = src("components/shared/layout/app-sidebar-v2.tsx");
    expect(sidebar.match(/&& !isMobile\)/g)?.length).toBe(3);
    for (const page of [
      "components/rentals-v2/rental-detail/rental-detail-v2.tsx",
      "components/customers-v2/customer-detail/customer-detail-v2.tsx",
      "components/vehicles-v2/vehicle-detail-v2.tsx",
    ]) {
      expect(src(page)).toContain("useWiderThan(768)");
    }
  });
});
