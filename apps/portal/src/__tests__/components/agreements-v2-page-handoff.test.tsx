/**
 * Agreements v2: the hand-off in app/(dashboard)/agreements/page.tsx, and the
 * two ways in (the v2 rail row and the v2 global search).
 *
 * The page must render `AgreementsPageV2` for `useV2("agreements")` tenants and
 * ONLY for them, and every other tenant, including one on the v2 chrome but not
 * on Agreements v2, must get the v1 page exactly as before (its three queries,
 * its own `useV2("chrome")` branches). The v1 page's pinned literals and the
 * order of its /api/esign fetches (counted by the spine tests) must not move.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import React from "react";
import { codeOnly, readPortalSource } from "../helpers/edge-source";
import { searchPortalDestinations, type DestinationContext } from "@/lib/search/portal-destinations";

const state = vi.hoisted(() => ({
  areas: new Set<string>(),
  queryCalls: 0,
  loading: true,
}));

vi.mock("@/lib/v2-context", () => ({ useV2: (area: string) => state.areas.has(area) }));
vi.mock("@tanstack/react-query", () => ({
  useQuery: () => {
    state.queryCalls += 1;
    return { data: state.loading ? undefined : [], isLoading: state.loading, refetch: vi.fn() };
  },
}));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: vi.fn(), storage: { from: vi.fn() } } }));
vi.mock("@/contexts/TenantContext", () => ({ useTenant: () => ({ tenant: { id: "t1", slug: "acme" }, tenantSlug: "acme" }) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }) }));
vi.mock("next/link", () => ({ default: ({ href, children }: any) => <a href={href}>{children}</a> }));
vi.mock("@/lib/lean-context", () => ({ useIsLean: () => false }));
vi.mock("@/hooks/use-forced-empty-state", () => ({ useForcedEmptyState: () => false }));
vi.mock("jszip", () => ({ default: vi.fn() }));
vi.mock("jspdf", () => ({ jsPDF: vi.fn() }));
vi.mock("@/components/agreements/generate-agreement-dialog", () => ({ GenerateAgreementDialog: () => null }));
vi.mock("@/components/empty-states/lean-empty-states", () => ({ AgreementsTeachingEmptyState: () => <div>teaching</div> }));
vi.mock("@/components/agreements-v2/agreements-page-v2", () => ({
  AgreementsPageV2: () => <div data-testid="agreements-v2">v2</div>,
}));

import AgreementsPage from "@/app/(dashboard)/agreements/page";

const PAGE = "app/(dashboard)/agreements/page.tsx";

beforeEach(() => {
  state.areas = new Set();
  state.queryCalls = 0;
  state.loading = true;
});

describe("the hand-off", () => {
  it("a useV2('agreements') tenant gets the v2 page, and the v1 queries never run", () => {
    state.areas = new Set(["agreements", "chrome"]);
    render(<AgreementsPage />);
    expect(screen.getByTestId("agreements-v2")).toBeInTheDocument();
    expect(state.queryCalls).toBe(0);
  });

  it("a v1 tenant gets the v1 page: its three queries and its own skeleton", () => {
    const { container } = render(<AgreementsPage />);
    expect(screen.queryByTestId("agreements-v2")).toBeNull();
    expect(state.queryCalls).toBe(3);
    expect(container.firstElementChild?.className).toBe("space-y-6");
  });

  it("a tenant on the v2 chrome but not on Agreements v2 still gets v1, with its chrome branch working", () => {
    state.areas = new Set(["chrome"]);
    const { container } = render(<AgreementsPage />);
    expect(screen.queryByTestId("agreements-v2")).toBeNull();
    expect(state.queryCalls).toBe(3);
    expect(container.firstElementChild?.className).toBe("space-y-6 md:pt-6");
  });

  it("the loaded v1 page still renders in full for everyone else", () => {
    state.loading = false;
    render(<AgreementsPage />);
    expect(screen.getByText("No agreements found")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Generate Agreement/ })).toBeInTheDocument();
    expect(screen.queryByTestId("agreements-v2")).toBeNull();
  });
});

describe("page.tsx source: the hand-off is the only v2 change", () => {
  const src = readPortalSource(PAGE);
  const code = codeOnly(src);

  it("branches on the agreements area, in a wrapper, before any v1 hook", () => {
    expect(code).toMatch(
      /export default function AgreementsPage\(\) \{\s*const v2 = useV2\("agreements"\);\s*return v2 \? <AgreementsPageV2 \/> : <AgreementsList \/>;\s*\}/,
    );
    expect(code).toContain("function AgreementsList() {");
    expect(code.match(/useV2\("agreements"\)/g)).toHaveLength(1);
  });

  it("keeps every pinned v1 literal", () => {
    for (const literal of [
      "const paginatedDocuments = filteredAgreements.slice(startIndex, endIndex);",
      "rows={agreementsNewestFirst}",
      "{paginatedDocuments.length === 0 || teachEmptyAgreements ? (",
      'const devForceEmpty = useForcedEmptyState("agreements")',
      "const teachEmptyAgreements = useIsLean() &&",
      "const createdAtMs =",
      "const agreementsNewestFirst = v2Chrome",
      'const v2Chrome = useV2("chrome");',
    ]) {
      expect(code, literal).toContain(literal);
    }
    expect(code).toMatch(/No agreements/);
  });

  it("makes no network call of its own: the /api/esign fetches are v1's six, in v1's order", () => {
    const urls = [...code.matchAll(/fetch\(\s*["'`]([^"'`]+)["'`]/g)].map((m) => m[1]);
    expect(urls).toEqual([
      "/api/esign/view",
      "/api/esign/view",
      "/api/esign/sign",
      "/api/esign/status",
      "/api/esign",
      "/api/esign/void",
    ]);
  });
});

describe("the ways in", () => {
  it("the v2 rail lists Agreements by default; Insights and Insurances stay opt-in", () => {
    const sidebar = codeOnly(readPortalSource("components/shared/layout/app-sidebar-v2.tsx"));
    expect(sidebar).toContain('{ name: "Agreements", href: "/agreements", icon: FileSignature },');
    expect(sidebar).not.toMatch(/name: "Agreements"[^}]*optional/);
    expect(sidebar).toContain('{ name: "Insights", href: "/insights", icon: TrendingUp, optional: true },');
    expect(sidebar).toContain('{ name: "Insurances", href: "/insurances", icon: Shield, optional: true },');
  });

  const base: Omit<DestinationContext, "v2Chrome"> = {
    integrationsBoard: false,
    lean: false,
    isHeadAdmin: true,
    flags: {},
    canAccessRoute: () => true,
    canViewSettings: () => true,
  };
  const pages = (query: string, ctx: DestinationContext) =>
    searchPortalDestinations(query, ctx).pages.filter((d) => d.href === "/agreements");

  it("v2 search finds /agreements, once, described as the v2 tab", () => {
    const found = pages("agreements", { ...base, v2Chrome: true });
    expect(found).toHaveLength(1);
    expect(found[0].description).toMatch(/agreement templates/);
    expect(pages("templates", { ...base, v2Chrome: true })).toHaveLength(1);
  });

  it("v1 search keeps its own entry, word for word", () => {
    const found = pages("agreements", { ...base, v2Chrome: false });
    expect(found).toHaveLength(1);
    expect(found[0].description).toBe("Rental agreements sent and signed.");
    // v1's Agreements page has no templates, so the word does not lead there.
    expect(pages("templates", { ...base, v2Chrome: false })).toHaveLength(0);
  });

  it("a manager without the agreements tab is not offered it on v2", () => {
    const found = pages("agreements", { ...base, v2Chrome: true, canAccessRoute: (p) => p !== "/agreements" });
    expect(found).toHaveLength(0);
  });
});
