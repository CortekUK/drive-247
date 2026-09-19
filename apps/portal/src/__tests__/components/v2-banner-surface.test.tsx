/**
 * The top-of-app notice bar, in v2's language — and byte-identical in v1.
 *
 * ── WHAT THE LEAD SAW, AND WHAT IT MEASURED AS ──────────────────────────────
 *
 * Sep 18 2026: "the background at the top has become odd", and the red
 * test-mode bar and the yellow announcement bar "look like two different
 * systems … we built one thing, so we will use that one".
 *
 * Sampled down the content column at 1280×800 in headless Chrome, against the
 * real compiled stylesheet, with a warning announcement bar showing and this
 * stack holding the critical test-mode notice:
 *
 *   BEFORE                                  AFTER
 *   y   0– 36  #fffbeb  announcement bar    unchanged (not ours — see below)
 *   y  37–101  #ebe9fc  page wash           unchanged
 *   y 102–154  #fef2f2  THIS bar, flat      #edd4e2 → #f3dae5, tracking the wash
 *   y 155+     #f4f3fd  page wash, paler    unchanged
 *
 * The wash is four gradients anchored to the top of the VIEWPORT, so its
 * strongest band is the top ~100px. Two opaque pastel slabs cut that band into
 * pieces, leaving a stripe of saturated lavender between them and a visibly
 * paler wash below — ten units of red channel apart, across 86px. That is the
 * "odd". It is the same defect reported when the top bar carried a white fill
 * (see the comment in top-bar-v2.tsx): a band across the top makes the page's
 * colour look like it starts lower down.
 *
 * The fix is that the bar stops REPLACING the ground and starts tinting it, so
 * the wash keeps running from the very top. The "after" numbers above are the
 * proof: the bar's own colour now drifts across its height exactly as the wash
 * drifts, instead of sitting flat.
 *
 * Dark was literally the brief's phrase — "the wash shows through": the old
 * `dark:bg-red-950/40` is 40% alpha, sampling #230b11, nothing like red-950,
 * while the announcement bar beside it was fully opaque. Two bars, two
 * compositing models, touching.
 *
 * ── WHAT THIS FILE GUARDS ───────────────────────────────────────────────────
 *
 *   1. v1 is untouched. ~56 live tenants render this same component.
 *   2. v2 carries NO hardcoded palette — tokens only, so a tenant on green does
 *      not get an indigo notice.
 *   3. v2 obeys the rounded system (pills, never rounded-md) and the v2 hover
 *      pair on controls that have no fill of their own.
 *   4. The severity signal survives: four distinct tones, four distinct icons.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { ReactElement } from "react";

import type { AppBanner, BannerSeverity } from "@/components/banners/banner-types";
import { BannerStack } from "@/components/banners/banner-stack";
import { V2Provider } from "@/lib/v2-context";

vi.mock("next/navigation", () => ({ usePathname: () => "/dashboard" }));
vi.mock("@/contexts/TenantContext", () => ({
  useTenant: () => ({ tenant: { id: "tenant-alpha" } }),
}));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: any) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

/* ------------------------------- harness -------------------------------- */

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  window.localStorage.clear();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const mount = (ui: ReactElement) => {
  act(() => root.render(ui));
};

/** The real test-mode notice, as `useConnectStripeBanner` emits it. */
const testMode: AppBanner = {
  id: "connect-stripe-test-mode",
  severity: "critical",
  scope: "app",
  title: "Your account is in test mode.",
  plainTitle:
    "Your account is in test mode. Connect your Stripe account to start taking live payments.",
  description: "Real customer payments aren't being collected.",
  action: { label: "Connect Stripe", onClick: () => {} },
};

const withSeverity = (severity: BannerSeverity): AppBanner => ({
  ...testMode,
  id: `notice-${severity}`,
  severity,
});

/** The notice row's own class list, for whichever experience is mounted. */
function rowClasses(v2: boolean, banner: AppBanner = testMode): string {
  const stack = <BannerStack banners={[banner]} />;
  mount(v2 ? <V2Provider flags={{ theme: true }}>{stack}</V2Provider> : stack);
  const row = container.querySelector(`[data-banner-id="${banner.id}"]`);
  expect(row).not.toBeNull();
  return row!.className;
}

/**
 * The description sentence's own class list — the second span in the text
 * block, which on the test-mode notice is "Real customer payments aren't being
 * collected …".
 */
function bodyClasses(v2: boolean, banner: AppBanner = testMode): string {
  const stack = <BannerStack banners={[banner]} />;
  mount(v2 ? <V2Provider flags={{ theme: true }}>{stack}</V2Provider> : stack);
  const body = Array.from(container.querySelectorAll("span")).find((s) =>
    s.textContent?.startsWith("Real customer payments"),
  );
  expect(body).toBeDefined();
  return body!.className;
}

/** The action button's class list. */
function actionClasses(v2: boolean): string {
  const stack = <BannerStack banners={[testMode]} />;
  mount(v2 ? <V2Provider flags={{ theme: true }}>{stack}</V2Provider> : stack);
  const button = Array.from(container.querySelectorAll("button")).find(
    (b) => b.textContent === "Connect Stripe",
  );
  expect(button).toBeDefined();
  return button!.className;
}

/* --------------------------------- tests --------------------------------- */

describe("v1 is byte-identical", () => {
  /**
   * WHOLE strings, not `toContain`. The v2 work threads a `ControlSkin` through
   * the two button helpers, and the obvious way to do that — lifting the radius
   * out of the base string onto its own `cn()` argument — moves `rounded-md` to
   * a different position in the rendered class attribute. Nothing renders
   * differently, and a `toContain` test sails straight through it, but the rule
   * for this canary is that v1's class strings do not change, so it is asserted
   * exactly.
   *
   * These three were captured by rendering the component at 36e67f72 (the
   * commit before this change) and diffing every element's class attribute
   * against the current build, for all four severities and a three-banner
   * queue. That comparison was identical; these are the critical row's share
   * of it, kept here so the guarantee survives the scaffolding.
   */
  it("renders the pastel slab the other ~56 tenants see, exactly", () => {
    expect(rowClasses(false)).toBe(
      "border-b border-red-200 bg-red-50 dark:border-red-900/60 dark:bg-red-950/40",
    );
  });

  it("renders the action button exactly, radius in its original position", () => {
    expect(actionClasses(false)).toBe(
      "inline-flex h-9 items-center justify-center gap-1.5 whitespace-nowrap rounded-md px-3 text-xs font-medium sm:h-8 " +
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-current focus-visible:ring-offset-1 " +
        "bg-red-700 text-white hover:bg-red-800 disabled:opacity-60",
    );
  });

  it("renders the dismiss button exactly", () => {
    mount(
      <BannerStack
        banners={[{ ...testMode, dismissal: { fingerprint: "fp-1" } }]}
      />,
    );
    const dismiss = container.querySelector('[aria-label^="Dismiss: "]');
    expect(dismiss).not.toBeNull();
    expect(dismiss!.className).toBe(
      "inline-flex h-11 shrink-0 items-center justify-center gap-1.5 rounded-md sm:h-8 w-11 sm:w-8 " +
        "text-xs font-medium text-red-700 dark:text-red-400 hover:bg-black/5 dark:hover:bg-white/10 " +
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-current focus-visible:ring-offset-1",
    );
  });

  it("is what a component rendered outside any V2Provider gets", () => {
    // `useV2` answers false with no provider, which is what every existing
    // test that mounts this stack bare relies on.
    expect(rowClasses(false)).toContain("bg-red-50");
  });
});

describe("v2 tints the page ground instead of covering it", () => {
  it("uses the destructive token, in both modes, for a critical", () => {
    const classes = rowClasses(true);
    expect(classes).toContain("bg-destructive/10");
    // The dark half is a DELIBERATE token tint, not a leftover 40% alpha of a
    // palette colour. 10% of anything on a near-black ground is invisible,
    // which is why it doubles rather than repeating the light value.
    expect(classes).toContain("dark:bg-destructive/20");
    expect(classes).toContain("border-destructive/20");
  });

  it("carries no hardcoded palette or hex on any severity", () => {
    for (const severity of [
      "critical",
      "warning",
      "info",
      "success",
    ] as BannerSeverity[]) {
      const classes = rowClasses(true, withSeverity(severity));
      expect(classes).not.toMatch(/\b(dark:)?(bg|text|border)-(red|amber|blue|emerald|indigo|slate|gray|zinc)-\d/);
      expect(classes).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    }
  });

  it("gives every severity its own tone, so colour still carries meaning", () => {
    const tones = (["critical", "warning", "info", "success"] as BannerSeverity[])
      .map((s) => rowClasses(true, withSeverity(s)));
    expect(new Set(tones).size).toBe(4);
    expect(tones[0]).toContain("destructive");
    expect(tones[1]).toContain("warning");
    // Info is the BRAND in v2, not blue: --primary follows --brand-h/s/l.
    expect(tones[2]).toContain("primary");
    expect(tones[3]).toContain("success");
  });

  it("keeps the description legible on the tint, on every severity", () => {
    /**
     * `text-muted-foreground` is the obvious ink for a secondary line and it is
     * the one that fails here. The tint is TRANSPARENT, so the row composites
     * over the page wash rather than over white: measured against the real
     * compiled stylesheet at 1280px, muted-foreground lands at 2.87–4.03:1
     * across the four severities in light mode — under AA, and worst on the
     * critical row, whose description is "Real customer payments aren't being
     * collected." v1 renders that same sentence at 7.60:1.
     *
     * `text-foreground/70` measures 5.94–7.07:1 light and 6.7–9.0:1 dark, and
     * is still a visible step quieter than the `text-foreground` title.
     */
    for (const severity of [
      "critical",
      "warning",
      "info",
      "success",
    ] as BannerSeverity[]) {
      const classes = bodyClasses(true, withSeverity(severity));
      expect(classes).toBe("text-foreground/70");
      expect(classes).not.toContain("text-muted-foreground");
    }
    // v1's red-800 is untouched — the ~56 tenants keep the ink they have.
    expect(bodyClasses(false)).toBe("text-red-800 dark:text-red-200");
  });

  it("still emits a distinct icon per severity", () => {
    // Colour is never the only channel — a red-green operator reads the icon.
    const icons = (["critical", "warning", "info", "success"] as BannerSeverity[])
      .map((s) => {
        mount(
          <V2Provider flags={{ theme: true }}>
            <BannerStack banners={[withSeverity(s)]} />
          </V2Provider>,
        );
        return container.querySelector("svg")?.getAttribute("class") ?? "";
      });
    expect(new Set(icons.map((c) => c.split(" ").find((x) => x.startsWith("lucide-"))))
      .size).toBe(4);
  });
});

describe("v2 controls follow the rounded system and the hover pair", () => {
  it("makes the action a pill, never rounded-md", () => {
    const classes = actionClasses(true);
    expect(classes).toContain("rounded-full");
    expect(classes).not.toContain("rounded-md");
    expect(classes).not.toContain("rounded-sm");
  });

  it("fills the action from the tone token rather than a solid palette red", () => {
    const classes = actionClasses(true);
    expect(classes).toContain("bg-destructive/15");
    expect(classes).toContain("hover:bg-destructive/25");
    expect(classes).not.toContain("bg-red-700");
  });

  it("uses the v2 hover pair on a control with no fill of its own", () => {
    // The dismiss control. `hover:bg-black/5 dark:hover:bg-white/10` is the v1
    // grey wash; v2 wants the brand tint in light and --v2-hover in dark.
    mount(
      <V2Provider flags={{ theme: true }}>
        <BannerStack
          banners={[{ ...testMode, dismissal: { fingerprint: "fp-1" } }]}
        />
      </V2Provider>,
    );
    const dismiss = container.querySelector(
      `[aria-label^="Dismiss: "]`,
    ) as HTMLElement | null;
    expect(dismiss).not.toBeNull();
    expect(dismiss!.className).toContain("hover:bg-primary/10");
    expect(dismiss!.className).toContain(
      "dark:hover:bg-[hsl(var(--v2-hover,var(--muted)))]",
    );
    expect(dismiss!.className).toContain("rounded-full");
    expect(dismiss!.className).not.toContain("hover:bg-black/5");
  });
});

describe("what the bar says and when it shows is unchanged", () => {
  it("renders the same words in both experiences", () => {
    mount(<BannerStack banners={[testMode]} />);
    const v1Text = container.textContent;
    act(() => root.render(null));
    mount(
      <V2Provider flags={{ theme: true }}>
        <BannerStack banners={[testMode]} />
      </V2Provider>,
    );
    expect(container.textContent).toBe(v1Text);
    expect(container.textContent).toContain("Your account is in test mode.");
    expect(container.textContent).toContain(
      "Real customer payments aren't being collected.",
    );
  });

  it("has no dismiss control, in either experience — it warns about real money", () => {
    for (const v2 of [false, true]) {
      const stack = <BannerStack banners={[testMode]} />;
      mount(v2 ? <V2Provider flags={{ theme: true }}>{stack}</V2Provider> : stack);
      expect(container.querySelector('[aria-label^="Dismiss: "]')).toBeNull();
      act(() => root.render(null));
    }
  });
});
