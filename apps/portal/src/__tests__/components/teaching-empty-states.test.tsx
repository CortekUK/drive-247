/**
 * Teaching empty states — who gets them, and what a video slot does before
 * there is a video.
 *
 * THE OUTAGE THIS GUARDS. Four of the five surfaces are SHARED pages that all
 * 57 tenants render. `northwind` is one canary; the other 56 are live rental
 * operators taking real money, and a gate that resolves the wrong way replaces
 * a working "no results, clear your filters" screen with a beginner's tutorial
 * for someone who has been running a fleet for two years.
 *
 * The specific way that happens is keying on tenant ID. `northwind` is
 * 6e5c544f-… in production and 8e6bc88f-… on the staging branch, so an id gate
 * is right in one environment and silently wrong in the other — no error, no
 * failed build, no failed check, just a screen that is never the one you meant.
 * Hence the assertions below check both that the SLUG gate is present and that
 * no UUID appears near it.
 *
 * HARNESS: `react-dom/client` + `act`, not `@testing-library/react` — the repo
 * lacks that package's `@testing-library/dom` peer, so `render()` throws at
 * import. Same approach as `connect-stripe-required-dialog.test.tsx`.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

import { isLeanTenant } from "@/lib/lean-areas";
import {
  codeOnly,
  compile,
  compileExpression,
  liftDeclaration,
  readPortalSource,
} from "../helpers/edge-source";

// The chip is tested against its CONTRACT — "given a ready explainer, render;
// given null, render nothing" — so the manifest is mocked here. Whether the
// real manifest ever returns a ready entry is `lib/explainer-manifest.test.ts`.
let mockReady: {
  id: string;
  title: string;
  blurb: string;
  durationSeconds: number;
  url: string;
} | null = null;

vi.mock("@/lib/explainers", () => ({
  getExplainer: () => mockReady,
  listReadyExplainers: () => (mockReady ? [mockReady] : []),
  formatExplainerDuration: (s: number) =>
    `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, "0")}`,
  EXPLAINERS: {},
}));

// Imported AFTER the mock declaration for readability only — vi.mock is hoisted.
import { ExplainerChip } from "@/components/explainers/explainer";
import { TeachingEmptyState } from "@/components/empty-states/teaching-empty-state";
import { Car } from "lucide-react";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  mockReady = null;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const render = (node: React.ReactElement) => {
  act(() => root.render(node));
};

// ---------------------------------------------------------------------------
// 1. The gate itself
// ---------------------------------------------------------------------------

describe("the teaching gate is keyed on slug", () => {
  it("is ON for the northwind canary", () => {
    expect(isLeanTenant("northwind")).toBe(true);
  });

  it("is OFF for real live operators", () => {
    // Not placeholders. These are three tenants currently taking bookings —
    // goniko (New Orleans), revtek (Jacksonville) and jangram (Denver). If this
    // assertion ever flips, those operators' list pages changed.
    for (const slug of ["goniko", "revtek", "jangram"]) {
      expect(isLeanTenant(slug), slug).toBe(false);
    }
  });

  it("fails safe on an unknown, blank or unresolved slug", () => {
    // TenantContext resolves the slug client-side in a useEffect, so it is null
    // for a tick on first paint and stays null on an unrecognised host. Both
    // must keep the screen the tenant already had — never flash new copy and
    // then swap it.
    expect(isLeanTenant("not-a-real-tenant")).toBe(false);
    expect(isLeanTenant("")).toBe(false);
    expect(isLeanTenant(null)).toBe(false);
    expect(isLeanTenant(undefined)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 2. Every call site actually uses it
// ---------------------------------------------------------------------------

/**
 * Each case proves TWO things in order, and the order matters: first that the
 * teaching component is referenced at all, then that it is gated. A gate
 * assertion alone would pass just as happily against a page where the whole
 * feature was never wired up.
 */
interface CallSite {
  page: string;
  file: string;
  component: string;
  /** The named const holding the gate, lifted and EXECUTED below. */
  gateName: string;
  /** Inputs the lifted expression needs, in order. */
  params: string[];
  /** `[args…]` for "this tenant has nothing yet". */
  empty: unknown[];
  /** `[args…]` for "this tenant has rows". */
  populated: unknown[];
}

const CALL_SITES: CallSite[] = [
  {
    page: "Vehicles",
    file: "app/(dashboard)/vehicles/page.tsx",
    component: "VehiclesTeachingEmptyState",
    // The RAW query result, never `filteredVehicles` — a filter that matched
    // nothing must keep the existing "no vehicles found" state.
    gateName: "teachEmptyFleet",
    params: ["isLeanTenant", "tenantSlug", "vehicles"],
    empty: [[]],
    populated: [[{ id: "v1" }]],
  },
  {
    page: "Customers",
    file: "app/(dashboard)/customers/page.tsx",
    component: "CustomersTeachingEmptyState",
    gateName: "teachEmptyCustomers",
    params: ["isLeanTenant", "tenantSlug", "customers"],
    empty: [[]],
    populated: [[{ id: "c1" }]],
  },
  {
    page: "Agreements",
    file: "app/(dashboard)/agreements/page.tsx",
    component: "AgreementsTeachingEmptyState",
    gateName: "teachEmptyAgreements",
    params: ["isLeanTenant", "tenantSlug", "allAgreements"],
    empty: [[]],
    populated: [[{ id: "a1" }]],
  },
  {
    page: "Insurances",
    file: "app/(dashboard)/insurances/page.tsx",
    component: "InsurancesTeachingEmptyState",
    gateName: "teachEmptyInsurances",
    params: ["isLeanTenant", "tenantSlug", "allInsurances"],
    empty: [[]],
    populated: [[{ id: "i1" }]],
  },
  {
    page: "Invoices",
    file: "app/(dashboard)/invoices/page.tsx",
    component: "InvoicesTeachingEmptyState",
    gateName: "teachEmptyInvoices",
    params: ["isLeanTenant", "tenantSlug", "invoices"],
    empty: [[]],
    populated: [[{ id: "inv1" }]],
  },
  {
    page: "Payments",
    file: "app/(dashboard)/payments/page.tsx",
    component: "PaymentsTeachingEmptyState",
    // Payments opens with a date range already applied, so the page's own
    // `totalCount` is a filtered number. It gets its own lifetime count.
    gateName: "teachEmptyPayments",
    params: ["teachEligible", "lifetimePayments"],
    empty: [0],
    populated: [3],
  },
];

/**
 * Lift the page's REAL gate expression and run it.
 *
 * Not a regex over the source, and emphatically not a copy of the expression
 * pasted into the test: a paste proves the paste works and stops tracking the
 * original the moment someone edits the page. `liftDeclaration` pulls the exact
 * shipped text out of the file and `compileExpression` turns its inputs into
 * parameters, so what runs below IS the line that ships. Rename or delete it
 * and the lift throws rather than passing quietly.
 */
const liftGate = (site: CallSite) => {
  const src = readPortalSource(site.file);
  const decl = liftDeclaration(src, site.gateName, { tsx: true });
  return compileExpression<(...args: never[]) => boolean>(
    site.params,
    [decl],
    site.gateName
  );
};

/** Payments composes two consts, so its "is this the canary" input is derived. */
const eligibility = (site: CallSite, slug: string | null | undefined) =>
  site.page === "Payments"
    ? [isLeanTenant(slug)]
    : [isLeanTenant, slug];

describe("shared pages gate the teaching state", () => {
  for (const site of CALL_SITES) {
    it(`${site.page}: renders the teaching state and names a gate`, () => {
      const src = readPortalSource(site.file);
      // Existence first. Every "does not teach" assertion below would pass just
      // as happily against a page where the feature was never wired up at all.
      expect(src, `${site.page} must render ${site.component}`).toContain(
        site.component
      );
      expect(src).toContain(site.gateName);

      // And the lift itself has to have found real code. A declaration that
      // lifted to something trivial — `const x = false;` — would make CASES 2
      // and 3 below pass while proving nothing at all, which is precisely the
      // shape of a test that guards an outage and does not notice it happening.
      const decl = liftDeclaration(src, site.gateName, { tsx: true });
      expect(decl, `${site.page} gate`).toContain(
        site.page === "Payments" ? "teachEligible" : "isLeanTenant(tenantSlug)"
      );
    });

    it(`${site.page}: CASE 1 — teaches the northwind canary when empty`, () => {
      const gate = liftGate(site);
      const args = [...eligibility(site, "northwind"), ...site.empty];
      expect(gate(...(args as never[]))).toBe(true);
    });

    it(`${site.page}: CASE 2 — never teaches a real live operator (the outage case)`, () => {
      const gate = liftGate(site);
      // goniko, revtek and jangram are taking bookings right now. Even with an
      // empty list — a brand-new filter, a wiped page — they keep their screen.
      for (const slug of ["goniko", "revtek", "jangram"]) {
        const args = [...eligibility(site, slug), ...site.empty];
        expect(gate(...(args as never[])), `${site.page} / ${slug}`).toBe(false);
      }
    });

    it(`${site.page}: CASE 3 — fails safe on an unresolved or bogus slug`, () => {
      const gate = liftGate(site);
      for (const slug of [null, undefined, "", "not-a-real-tenant"]) {
        const args = [...eligibility(site, slug), ...site.empty];
        expect(gate(...(args as never[])), `${site.page} / ${String(slug)}`).toBe(
          false
        );
      }
    });

    it(`${site.page}: does not teach the canary once it has rows`, () => {
      const gate = liftGate(site);
      const args = [...eligibility(site, "northwind"), ...site.populated];
      expect(gate(...(args as never[]))).toBe(false);
    });

    it(`${site.page}: does not key the gate on a tenant UUID`, () => {
      const src = readPortalSource(site.file);
      // northwind's id differs between production and staging; an id-keyed gate
      // is wrong in exactly one environment and reports no error in either.
      expect(src).not.toContain("6e5c544f");
      expect(src).not.toContain("8e6bc88f");
    });

    it(`${site.page}: keeps the original empty state for everyone else`, () => {
      const src = readPortalSource(site.file);
      // The v1 branch must still be in the file. Replacing it outright — rather
      // than adding a branch beside it — is the shape of the change that takes
      // 56 live operators with it.
      expect(src).toMatch(/No (vehicles|customers|agreements|insurance|invoices|payments)/);
    });
  }

  it("Payments: never issues its extra count query for a non-canary tenant", () => {
    // The one page that adds a query rather than reusing data already on the
    // screen. If `enabled` ever drops the slug check, all 57 tenants start
    // paying for a count none of them can see.
    const src = readPortalSource("app/(dashboard)/payments/page.tsx");
    expect(src).toContain('queryKey: ["payments-lifetime-count", tenant?.id]');
    expect(src).toMatch(/enabled: teachEligible && !!tenant\?\.id,/);
    expect(src).toMatch(/const teachEligible = isLeanTenant\(tenantSlug\);/);
    // Tenant-scoped: RLS is off on `payments`, so the filter is the isolation.
    expect(src).toMatch(/\.eq\("tenant_id", tenant!\.id\)/);
  });
});

describe("the rentals list", () => {
  const src = readPortalSource("components/rentals-v2/rentals-list-v2.tsx");

  it("teaches from the v2 list, which only the canary reaches", () => {
    // `/rentals` hands northwind RentalsListV2 via V2_AREAS.rentals, so the v1
    // page's empty state is unreachable for it and must be left alone. This is
    // the one of the five that needs no slug check — the file IS the gate.
    expect(src).toContain("RentalsTeachingEmptyState");

    const v1 = readPortalSource("app/(dashboard)/rentals/page.tsx");
    expect(v1).toContain("RentalsListV2");
    expect(v1).not.toContain("RentalsTeachingEmptyState");
  });

  it("teaches only when no filter is set, not when a filter matched nothing", () => {
    expect(src).toMatch(/\) : !hasAnyRentalFilter\(filters\) \? \(/);

    // The real function, lifted and run — the list has no unfiltered count to
    // compare against, so this predicate is the entire difference between
    // "you have no rentals" and "your search found none".
    const hasAnyRentalFilter = compile<(f: Record<string, unknown>) => boolean>(
      [
        liftDeclaration(src, "NON_FILTER_KEYS", { tsx: true }),
        liftDeclaration(src, "hasAnyRentalFilter", { tsx: true }),
      ],
      "hasAnyRentalFilter"
    );

    // The list's own first-paint state: sentinels, not filters.
    const pristine = {
      search: "",
      status: "all",
      paymentMode: "all",
      duration: "all",
      initialPayment: "all",
      sortBy: "created_at",
      sortOrder: "desc",
      page: 1,
      durationMin: undefined,
      startDateFrom: undefined,
      bonzahStatus: undefined,
      depositHold: undefined,
    };
    expect(hasAnyRentalFilter(pristine)).toBe(false);

    // Sorting and paging are not filters — page 4 of an empty book is still an
    // empty book, and treating them as filters would suppress the teaching
    // state forever.
    expect(hasAnyRentalFilter({ ...pristine, page: 4, sortBy: "end_date" })).toBe(
      false
    );

    // Everything that genuinely narrows the list does count.
    expect(hasAnyRentalFilter({ ...pristine, search: "smith" })).toBe(true);
    expect(hasAnyRentalFilter({ ...pristine, status: "active" })).toBe(true);
    expect(hasAnyRentalFilter({ ...pristine, bonzahStatus: "quoted" })).toBe(true);
    expect(hasAnyRentalFilter({ ...pristine, depositHold: "unsecured" })).toBe(true);
    expect(hasAnyRentalFilter({ ...pristine, extensionRequested: true })).toBe(true);
    expect(hasAnyRentalFilter({ ...pristine, durationMin: 7 })).toBe(true);

    // And the reason it is a sweep rather than a list of known keys: the next
    // filter someone adds must count as a filter on the day it lands, without
    // anyone remembering to come back here. An operator with a full book being
    // shown a beginner's tutorial is the failure this prevents.
    expect(hasAnyRentalFilter({ ...pristine, someFutureFilter: "x" })).toBe(true);
  });

  it("still offers Clear Filters when a filter IS set", () => {
    expect(src).toContain("Clear Filters");
  });
});

// ---------------------------------------------------------------------------
// 3. The video slot before there is a video
// ---------------------------------------------------------------------------

describe("ExplainerChip", () => {
  it("renders nothing at all when the video does not exist yet", () => {
    mockReady = null;
    render(<ExplainerChip id={"fleet.vehicle-add" as never} />);

    // Not "hidden", not "disabled" — absent. A control that does nothing is
    // worse than no control, and jsdom loads no stylesheet, so a CSS-hidden
    // button would sail past a class-based assertion.
    expect(container.querySelector("button")).toBeNull();
    expect(container.textContent).toBe("");
  });

  it("renders a play control with the duration once the video exists", () => {
    // The positive case, so the assertion above is a real result and not just
    // a component that never renders anything.
    mockReady = {
      id: "fleet.vehicle-add",
      title: "Add your first vehicle",
      blurb: "…",
      durationSeconds: 72,
      url: "/explainers/vehicle-add.mp4",
    };
    render(<ExplainerChip id={"fleet.vehicle-add" as never} label="Watch how" />);

    const button = container.querySelector("button");
    expect(button).not.toBeNull();
    expect(button!.textContent).toContain("Watch how");
    expect(button!.textContent).toContain("1:12");
  });

  it("never autoplays", () => {
    // Enforced in the source rather than by driving the dialog open: the rule
    // is "the tag is not written", which is stronger than "muted is set" and
    // survives someone later deleting the muted attribute.
    //
    // Comments are stripped first. The file EXPLAINS the rule in prose, and a
    // bare substring search would match the explanation and fail on a correct
    // file — a test that can only be satisfied by not documenting the rule.
    const src = readPortalSource("components/explainers/explainer.tsx");
    const code = codeOnly(src);

    expect(code).toContain("<video");
    expect(code).not.toContain("autoPlay");
    // The prose is still there — otherwise stripping comments would let a real
    // `autoPlay` hide inside one and this assertion would prove nothing.
    expect(src).toContain("NEVER AUTOPLAY WITH SOUND");
  });
});

describe("TeachingEmptyState", () => {
  it("renders the teaching copy and the primary action", () => {
    mockReady = null;
    const onClick = vi.fn();
    render(
      <TeachingEmptyState
        icon={Car}
        headline="Your fleet lives here"
        body="Every car you rent out is a vehicle record."
        points={["Photos and rates decide what customers see"]}
        primaryAction={{ label: "Add your first vehicle", onClick }}
        explainerId={"fleet.vehicle-add" as never}
      />
    );

    expect(container.textContent).toContain("Your fleet lives here");
    expect(container.textContent).toContain("Photos and rates decide what customers see");

    const buttons = Array.from(container.querySelectorAll("button"));
    // Exactly one: the primary action. The video slot is absent today, which is
    // the whole point of asserting the count rather than just "a button exists".
    expect(buttons).toHaveLength(1);
    expect(buttons[0].textContent).toContain("Add your first vehicle");

    act(() => {
      buttons[0].dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(onClick).toHaveBeenCalledOnce();
  });
});

// ---------------------------------------------------------------------------
// 4. The setup checklist
// ---------------------------------------------------------------------------

describe("setup guide", () => {
  const hook = readPortalSource("hooks/use-setup-guide.ts");

  it("carries the discovery the tour drops", () => {
    // The tour deliberately stops at the first rental. E-signing and insurance
    // are the two features new operators most often never find, so the
    // checklist is where they get named — an unfinished row is an invitation.
    expect(hook).toContain('label: "Send your first agreement"');
    expect(hook).toContain('label: "Turn on Bonzah insurance"');
    expect(hook).toContain('label: "Connect your Stripe account"');
  });

  it("derives 'sent an agreement' from a real envelope, not from intent", () => {
    expect(hook).toMatch(/head\("rentals"\)\.not\("docusign_envelope_id", "is", null\)/);
    expect(hook).toContain("agreementsSent");
  });

  it("keeps the tenant filter on the new count", () => {
    // RLS is off on `rentals` (V2_PLAN §5); `head()` pins .eq('tenant_id', tid)
    // before anything else is chained on. A raw supabase.from() here would read
    // every tenant's rentals.
    expect(hook).not.toMatch(/from\("rentals"\)\s*\n?\s*\.select\("id", \{ count/);
  });

  it("gives every checklist row a video slot", () => {
    const rows = hook.match(/label: "/g) ?? [];
    const slots = hook.match(/explainerId: "/g) ?? [];
    expect(rows.length).toBeGreaterThan(10);
    expect(slots.length).toBe(rows.length);
  });

  it("puts the slot beside the row, not inside its button", () => {
    const panel = readPortalSource("components/dashboard-v2/setup-guide.tsx");
    // A <button> nested in a <button> is invalid HTML and hydrates wrong.
    expect(panel).toMatch(/<li key=\{item\.id\} className="flex items-start gap-1">/);
    expect(panel).toContain("<ExplainerChip");
  });
});
