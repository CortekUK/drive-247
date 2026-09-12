/**
 * Turo Sync — ONLY northwind may see it.
 *
 * This file exists because the obvious gate was not enough, and the reason is
 * worth stating once rather than rediscovering.
 *
 * `tenants.turo_bridge_enabled` was ALREADY true for five tenants when Turo
 * Bridge was grafted onto main — jangramrentals and nealcorentals among them,
 * and both are LIVE, PAYING OPERATORS who were part of the PoC. A screen gated
 * only on that column would have appeared in their sidebar the moment the
 * graft deployed. Nobody would have turned anything on; the flag was already
 * there, waiting, from weeks earlier.
 *
 * So the rule this file enforces is: the CANARY GATE decides who may reach the
 * feature at all, and the column stays what it always was — the operator's own
 * switch, meaningful only once they are on the rollout. Both must agree.
 *
 * The three-case shape below is from V2_PLAN §10 ("Verifying a gate"). Two
 * cases cannot tell "the gate correctly refused" apart from "the tenant lookup
 * returned nothing, so everything renders empty". The non-existent slug is what
 * separates them.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { isV2, V2_AREA_LIST, NORTHWIND } from "@/lib/v2";

const SRC = join(__dirname, "..", "..");
const read = (p: string) => readFileSync(join(SRC, p), "utf8");

/** Every tenant that carries turo_bridge_enabled = true in production today. */
const FLAGGED_IN_PRODUCTION = ["jangramrentals", "nealcorentals", "test", "test-rent", "test-rentals"];

/** A sample of real operators, none of which may ever resolve true here. */
const LIVE_OPERATORS = [
  "revtekrentals", "goniko", "eastpeakrentalsllc", "openbayrental",
  "flowrentalsllc", "drive-hustle", "globalmotiontransport", "rbvs",
];

describe("Turo Sync — the canary gate, executed", () => {
  it("is carried in the derived area list the root layout iterates", () => {
    // V2_AREA_LIST is Object.keys(V2_AREAS), not a hand-kept second copy. If
    // that ever becomes a literal again, an area added to one and not the other
    // is a gate that answers v1 for everyone, silently — which is the failure
    // V2_PLAN calls the worst this model produces.
    expect(V2_AREA_LIST).toContain("turo");
  });

  it("resolves TRUE for the canary and nothing else", () => {
    expect(isV2("turo", NORTHWIND)).toBe(true);
  });

  it.each(FLAGGED_IN_PRODUCTION)(
    "refuses %s — which HAS turo_bridge_enabled = true, and still may not see it",
    (slug) => {
      expect(
        isV2("turo", slug),
        `${slug} carries the tenant flag in production. If this gate lets it ` +
          "through, the column alone is deciding again and two live operators " +
          "get an unfinished screen.",
      ).toBe(false);
    },
  );

  it.each(LIVE_OPERATORS)("refuses live operator %s", (slug) => {
    expect(isV2("turo", slug)).toBe(false);
  });

  it("refuses a slug that does not exist at all", () => {
    // The third case. Without it, a gate that refuses everyone for the wrong
    // reason (lookup returning nothing) passes the first two.
    expect(isV2("turo", "no-such-tenant-anywhere")).toBe(false);
  });

  it.each([null, undefined, ""])("fails to v1 on an unresolved tenant (%s)", (slug) => {
    expect(isV2("turo", slug as string | null | undefined)).toBe(false);
  });
});

describe("Turo Sync — every surface consults the gate", () => {
  // Three places can reveal this feature. A gate on two of them is not a gate:
  // the sidebar entry is what an operator sees, the route is what a typed URL
  // or a stale bookmark reaches, and the settings switch is what would let
  // someone turn on a page they cannot open.
  it.each([
    ["the sidebar entry", "components/shared/layout/app-sidebar.tsx", /isV2\(\s*["']turo["']/],
    ["the settings toggle", "app/(dashboard)/settings/page.tsx", /isV2\(\s*["']turo["']/],
    ["the route guard", "app/(dashboard)/turo-bridge/page.tsx", /useV2\(\s*["']turo["']/],
  ])("%s is gated", (_label, path, pattern) => {
    expect(
      read(path),
      `${path} no longer consults the turo canary gate. Removing it here does ` +
        "not just widen the rollout — it hands the feature to every tenant " +
        "whose turo_bridge_enabled is already true, which includes two live " +
        "operators from the PoC.",
    ).toMatch(pattern);
  });

  it("the sidebar demands the gate AND the tenant flag, not either", () => {
    const src = read("components/shared/layout/app-sidebar.tsx");
    expect(
      /isV2\(\s*["']turo["'][^)]*\)\s*&&/.test(src),
      "The sidebar's two turo conditions are no longer combined with &&. An || " +
        "here would show the entry to any tenant carrying the column.",
    ).toBe(true);
  });
});
