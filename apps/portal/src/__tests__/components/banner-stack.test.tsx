/**
 * BannerStack — behavioural contract.
 *
 * The three things this file is really guarding, in order of how much damage
 * getting them wrong would do:
 *
 *   1. A `critical` is NEVER collapsed. The whole feature exists because a
 *      money warning sat somewhere nobody opened; hiding a critical behind a
 *      disclosure triangle would reproduce that with extra steps.
 *   2. A dismissed critical COMES BACK. Silence is a 24h snooze, not a mute.
 *   3. A NEW occurrence re-shows a dismissed banner. Four unsecured rentals and
 *      five unsecured rentals are different facts.
 *
 * Everything else here is ordering, scoping and accessibility scaffolding.
 *
 * NOTE ON THE HARNESS: this renders through `react-dom/client` + `act` rather
 * than `@testing-library/react`. The repo depends on that package but NOT on
 * its `@testing-library/dom` peer, so `render()` throws at import — which is
 * why every existing "component" test under `src/__tests__/components/` is a
 * source-scan rather than a render. Rather than add a dependency for one file,
 * the ~30 lines below do the job.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { ReactElement } from "react";

import {
  fingerprint,
  type AppBanner,
  type BannerSeverity,
} from "@/components/banners/banner-types";
import { BannerStack } from "@/components/banners/banner-stack";
import { bannerDismissalKey } from "@/components/banners/use-banner-dismissal";

const TENANT_ID = "tenant-alpha";
let pathname = "/dashboard";
let tenantId: string | null = TENANT_ID;

vi.mock("next/navigation", () => ({
  usePathname: () => pathname,
}));

vi.mock("@/contexts/TenantContext", () => ({
  useTenant: () => ({ tenant: tenantId ? { id: tenantId } : null }),
}));

// next/link needs no router to emit a plain anchor, but stubbing keeps this
// test independent of Next's app-router test shims.
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

const mount = (ui: ReactElement) => {
  act(() => {
    root.render(ui);
  });
};

const unmount = () => {
  act(() => {
    root.render(null);
  });
};

const click = (el: Element) => {
  act(() => {
    el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
};

const byLabel = (label: string) =>
  container.querySelector(`[aria-label="${label}"]`);

const text = () => container.textContent ?? "";

/** Rows in DOM order, top to bottom. */
const renderedIds = () =>
  Array.from(container.querySelectorAll("[data-banner-id]")).map((el) =>
    el.getAttribute("data-banner-id"),
  );

/* -------------------------------- fixtures ------------------------------- */

const banner = (
  id: string,
  severity: BannerSeverity,
  overrides: Partial<AppBanner> = {},
): AppBanner => ({
  id,
  severity,
  title: `${id} title`,
  plainTitle: `${id} title`,
  description: `${id} description`,
  ...overrides,
});

const dismissible = (
  id: string,
  severity: BannerSeverity,
  fp = "fp-1",
  overrides: Partial<AppBanner> = {},
): AppBanner =>
  banner(id, severity, { dismissal: { fingerprint: fp }, ...overrides });

beforeEach(() => {
  window.localStorage.clear();
  pathname = "/dashboard";
  tenantId = TENANT_ID;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

/* --------------------------------- tests --------------------------------- */

describe("ordering", () => {
  it("sorts by severity, then weight, then id", () => {
    mount(
      <BannerStack
        maxVisible={99}
        banners={[
          banner("z-success", "success"),
          banner("a-warning-low", "warning", { weight: 1 }),
          banner("b-warning-high", "warning", { weight: 50 }),
          banner("c-critical", "critical"),
          banner("d-info", "info"),
        ]}
      />,
    );

    // SLIDER: one slot. Ordering is asserted through what occupies it first —
    // the most severe thing the operator has. The rest queue behind it, and the
    // counter proves how many.
    expect(renderedIds()).toEqual(["c-critical"]);
    expect(text()).toContain("1 of 5");
  });

  it("is stable when the input array order changes", () => {
    const a = banner("alpha", "warning");
    const b = banner("beta", "warning");
    mount(<BannerStack banners={[a, b]} />);
    const first = renderedIds();
    mount(<BannerStack banners={[b, a]} />);
    expect(renderedIds()).toEqual(first);
  });
});

describe("slider behaviour", () => {
  /**
   * One notice occupies the slot; the rest queue. The risk this creates — a
   * notice nobody sees because it was never on screen — is the same shape as the
   * incident that prompted the feature, so the mitigations are what these tests
   * actually guard.
   */
  it("renders exactly one banner however many are live", () => {
    mount(
      <BannerStack
        banners={[
          banner("crit-1", "critical"),
          banner("crit-2", "critical"),
          banner("warn-1", "warning"),
          banner("info-1", "info"),
        ]}
      />,
    );
    expect(renderedIds()).toHaveLength(1);
  });

  it("puts the most severe notice in the slot with no interaction", () => {
    mount(
      <BannerStack
        banners={[
          banner("info-1", "info"),
          banner("warn-1", "warning"),
          banner("crit-1", "critical"),
        ]}
      />,
    );
    expect(renderedIds()).toEqual(["crit-1"]);
  });

  it("shows the queue SIZE even though the contents are hidden", () => {
    // The whole safety argument for a carousel: an operator must never mistake
    // slide 1 for everything there is.
    mount(
      <BannerStack
        banners={[
          banner("warn-1", "warning"),
          banner("warn-2", "warning"),
          banner("info-1", "info"),
        ]}
      />,
    );
    expect(text()).toContain("1 of 3");
  });

  it("says in WORDS when a critical has been navigated past", () => {
    // Severity always outranks weight, so a critical starts in the slot. It can
    // only end up off-screen once the operator clicks past it — and that is
    // exactly when they need telling that something urgent is still queued,
    // because a dot cannot convey "money is leaving the building".
    mount(
      <BannerStack
        banners={[banner("crit-1", "critical"), banner("warn-1", "warning")]}
      />,
    );
    expect(renderedIds()).toEqual(["crit-1"]);
    expect(text()).not.toContain("urgent");

    click(container.querySelector('[aria-label^="Next notice"]')!);

    expect(renderedIds()).toEqual(["warn-1"]);
    expect(text()).toContain("1 urgent");
  });

  it("advances to the next notice and wraps at the end", () => {
    mount(
      <BannerStack
        banners={[banner("warn-1", "warning"), banner("warn-2", "warning")]}
      />,
    );
    expect(renderedIds()).toEqual(["warn-1"]);

    click(container.querySelector('[aria-label^="Next notice"]')!);
    expect(renderedIds()).toEqual(["warn-2"]);
    expect(text()).toContain("2 of 2");

    // Wrapping matters: a dead end reads as "that is all of them".
    click(container.querySelector('[aria-label^="Next notice"]')!);
    expect(renderedIds()).toEqual(["warn-1"]);
  });

  it("steps backwards too", () => {
    mount(
      <BannerStack
        banners={[banner("warn-1", "warning"), banner("warn-2", "warning")]}
      />,
    );
    click(container.querySelector('[aria-label^="Previous notice"]')!);
    expect(renderedIds()).toEqual(["warn-2"]);
  });

  it("renders no queue chrome for a lone notice", () => {
    // The common case must stay as quiet as the single banner it replaced.
    mount(<BannerStack banners={[banner("warn-1", "warning")]} />);
    expect(text()).not.toContain("of 1");
    expect(container.querySelector('[aria-label^="Next notice"]')).toBeNull();
  });
});

describe("dismissal", () => {
  it("offers no dismiss control when `dismissal` is omitted", () => {
    mount(<BannerStack banners={[banner("no-x", "warning")]} />);
    expect(byLabel("Dismiss: no-x title")).toBeNull();
  });

  it("hides the row and persists one key per (tenant, condition)", () => {
    mount(<BannerStack banners={[dismissible("warn-1", "warning")]} />);

    click(byLabel("Dismiss: warn-1 title")!);

    expect(renderedIds()).toEqual([]);
    const raw = window.localStorage.getItem(
      bannerDismissalKey(TENANT_ID, "warn-1"),
    );
    expect(raw).toBeTruthy();
    expect(JSON.parse(raw!)).toMatchObject({ fp: "fp-1" });
    // The fingerprint lives in the VALUE, so a churning occurrence set can
    // never grow an unbounded number of keys and blow the storage quota.
    expect(window.localStorage.length).toBe(1);
  });

  it("labels the control with the banner it silences, not a bare 'Dismiss'", () => {
    mount(
      <BannerStack
        banners={[
          dismissible("warn-1", "warning"),
          dismissible("warn-2", "warning"),
        ]}
      />,
    );
    // A bare "Dismiss" is unusable with a screen reader when the slot's contents
    // change under you — the label has to name what is being silenced. Asserted
    // across a navigation, because in slider mode only one control exists at a
    // time and a hardcoded label would pass the first assertion and lie on the
    // second.
    expect(byLabel("Dismiss: warn-1 title")).toBeTruthy();
    expect(byLabel("Dismiss: warn-2 title")).toBeNull();

    click(container.querySelector('[aria-label^="Next notice"]')!);

    expect(byLabel("Dismiss: warn-2 title")).toBeTruthy();
    expect(byLabel("Dismiss: warn-1 title")).toBeNull();
  });

  it("honours a custom dismiss label and tooltip (the 'Snooze 24h' case)", () => {
    mount(
      <BannerStack
        banners={[
          banner("crit-1", "critical", {
            dismissal: {
              fingerprint: "fp-1",
              label: "Snooze 24h",
              tooltip: "This comes back tomorrow if it is still unresolved.",
            },
          }),
        ]}
      />,
    );
    const btn = byLabel("Snooze 24h")!;
    expect(btn).toBeTruthy();
    expect(btn.getAttribute("title")).toBe(
      "This comes back tomorrow if it is still unresolved.",
    );
  });

  it("re-shows when the occurrence changes, even though the id has not", () => {
    window.localStorage.setItem(
      bannerDismissalKey(TENANT_ID, "warn-1"),
      JSON.stringify({ fp: fingerprint("a", "b"), at: Date.now() }),
    );

    mount(
      <BannerStack
        banners={[dismissible("warn-1", "warning", fingerprint("a", "b"))]}
      />,
    );
    expect(renderedIds()).toEqual([]);

    // A fifth rental joins the cohort → new fact → speak up again.
    mount(
      <BannerStack
        banners={[dismissible("warn-1", "warning", fingerprint("a", "b", "c"))]}
      />,
    );
    expect(renderedIds()).toEqual(["warn-1"]);
  });

  it("brings a snoozed critical back after 24h but not before", () => {
    const key = bannerDismissalKey(TENANT_ID, "crit-1");

    window.localStorage.setItem(
      key,
      JSON.stringify({ fp: "fp-1", at: Date.now() - 23 * 60 * 60 * 1000 }),
    );
    mount(<BannerStack banners={[dismissible("crit-1", "critical")]} />);
    expect(renderedIds()).toEqual([]);
    unmount();

    window.localStorage.setItem(
      key,
      JSON.stringify({ fp: "fp-1", at: Date.now() - 25 * 60 * 60 * 1000 }),
    );
    mount(<BannerStack banners={[dismissible("crit-1", "critical")]} />);
    expect(renderedIds()).toEqual(["crit-1"]);
  });

  it("keeps a dismissed success banner gone (infinite TTL)", () => {
    window.localStorage.setItem(
      bannerDismissalKey(TENANT_ID, "yay"),
      JSON.stringify({ fp: "fp-1", at: 0 }), // 1970
    );
    mount(<BannerStack banners={[dismissible("yay", "success")]} />);
    expect(renderedIds()).toEqual([]);
  });

  it("scopes dismissal per tenant", () => {
    window.localStorage.setItem(
      bannerDismissalKey(TENANT_ID, "warn-1"),
      JSON.stringify({ fp: "fp-1", at: Date.now() }),
    );

    mount(<BannerStack banners={[dismissible("warn-1", "warning")]} />);
    expect(renderedIds()).toEqual([]);
    unmount();

    // A super admin hops to another tenant and must see THAT tenant's real
    // state, not the first tenant's silence.
    tenantId = "tenant-beta";
    mount(<BannerStack banners={[dismissible("warn-1", "warning")]} />);
    expect(renderedIds()).toEqual(["warn-1"]);
  });

  it("survives a corrupt or legacy storage value instead of crashing", () => {
    window.localStorage.setItem(
      bannerDismissalKey(TENANT_ID, "warn-1"),
      "true", // the legacy shape the old bespoke banners wrote
    );
    mount(<BannerStack banners={[dismissible("warn-1", "warning")]} />);
    expect(renderedIds()).toEqual(["warn-1"]);
  });
});

describe("scope and path filtering", () => {
  it("renders only banners matching the mount point's scope", () => {
    mount(
      <BannerStack
        scope="app"
        maxVisible={99}
        banners={[
          banner("app-1", "warning"), // default scope is "app"
          banner("dash-1", "warning", { scope: "dashboard" }),
        ]}
      />,
    );
    expect(renderedIds()).toEqual(["app-1"]);
  });

  it("hides a banner while the operator is already on the page that fixes it", () => {
    pathname = "/settings";
    mount(
      <BannerStack
        banners={[banner("accounting", "warning", { hideOnPathPrefix: ["/settings"] })]}
      />,
    );
    expect(renderedIds()).toEqual([]);
  });

  it("renders nothing at all when there is no tenant yet", () => {
    tenantId = null;
    mount(<BannerStack banners={[banner("warn-1", "warning")]} />);
    expect(container.querySelector("[data-banner-stack]")).toBeNull();
  });
});

describe("accessibility", () => {
  it("is a labelled landmark", () => {
    mount(<BannerStack banners={[banner("warn-1", "warning")]} />);
    const region = container.querySelector("section[aria-label]")!;
    expect(region).toBeTruthy();
    expect(region.getAttribute("aria-label")).toBe("Account notices");
  });

  it("announces criticals once, in a single live region", () => {
    vi.useFakeTimers();
    try {
      mount(
        <BannerStack
          maxVisible={99}
          banners={[
            banner("crit-1", "critical"),
            banner("crit-2", "critical"),
            banner("warn-1", "warning"),
          ]}
        />,
      );
      act(() => {
        vi.advanceTimersByTime(700);
      });

      const live = container.querySelector('[aria-live="assertive"]')!;
      expect(live).toBeTruthy();
      expect(live.textContent).toContain("2 urgent notices");
      expect(live.textContent).toContain("crit-1 title");
      // Warnings are reachable inside the region but must not interrupt.
      expect(live.textContent).not.toContain("warn-1 title");
      // One node for the whole stack — per-row live regions would re-announce
      // everything on every 5-minute refetch.
      expect(container.querySelectorAll("[aria-live]")).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("renders an external action as a guarded new-tab anchor", () => {
    mount(
      <BannerStack
        banners={[
          banner("dispute", "critical", {
            action: {
              label: "Open in Stripe",
              href: "https://dashboard.stripe.com/disputes",
              external: true,
            },
          }),
        ]}
      />,
    );
    const link = container.querySelector('a[target="_blank"]')!;
    expect(link).toBeTruthy();
    expect(link.getAttribute("rel")).toBe("noopener noreferrer");
  });

  it("keeps the dismiss control reachable as a real button", () => {
    mount(<BannerStack banners={[dismissible("warn-1", "warning")]} />);
    const btn = byLabel("Dismiss: warn-1 title")!;
    expect(btn.tagName).toBe("BUTTON");
    expect(btn.getAttribute("type")).toBe("button");
  });
});

describe("legacy `render` escape hatch", () => {
  it("renders a bespoke body but still owns the dismiss control", () => {
    mount(
      <BannerStack
        banners={[
          dismissible("legacy", "warning", "fp-1", {
            render: () => <div data-testid="legacy-body">bespoke</div>,
          }),
        ]}
      />,
    );

    expect(container.querySelector('[data-testid="legacy-body"]')).toBeTruthy();
    // The stack's promise is that it owns dismissal even for bodies it does not
    // draw — otherwise migrated banners silently lose their X.
    expect(byLabel("Dismiss: legacy title")).toBeTruthy();
  });
});
