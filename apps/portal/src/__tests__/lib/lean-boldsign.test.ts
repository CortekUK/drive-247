import { describe, expect, it } from "vitest";

import { isLeanTenant, resolveBoldSignMode } from "@/lib/lean-areas";
import { readEdgeSource, readRepoSource } from "../helpers/edge-source";

/**
 * The lean product has NO test modes: BoldSign is always live for a lean tenant.
 *
 * Two things are being protected here.
 *
 *  1. The predicate itself — including the fail-open contract. An unresolved
 *     slug must NOT be treated as lean, because that would flip a v1 tenant's
 *     signing to the live BoldSign key on first paint, before TenantContext has
 *     resolved. 12 production tenants sit on `boldsign_mode = test` and 8 of
 *     them are live, so a gate that fires on an empty slug is an outage.
 *
 *  2. That the three runtime MIRRORS agree. Portal, booking and the Deno edge
 *     functions cannot share a module, so the tenant list is duplicated. A list
 *     that drifts produces a HALF-GATED mode, which is strictly worse than no
 *     gate at all: signing starts against the live key in one runtime while
 *     `boldsign-webhook` downloads the signed PDF with the test key, and the
 *     document 404s — a signed agreement nobody can retrieve.
 */
describe("isLeanTenant", () => {
  it("recognises the northwind canary", () => {
    expect(isLeanTenant("northwind")).toBe(true);
  });

  it("does not claim real non-canary tenants", () => {
    for (const slug of ["goniko", "revtekrentals", "globalmotiontransport", "eastpeakrentalsllc"]) {
      expect(isLeanTenant(slug)).toBe(false);
    }
  });

  it("fails open while the tenant slug is still unresolved", () => {
    expect(isLeanTenant(null)).toBe(false);
    expect(isLeanTenant(undefined)).toBe(false);
    expect(isLeanTenant("")).toBe(false);
  });

  it("keys on the slug, never on a tenant id", () => {
    // Same tenant, different primary key per environment — prod vs the seeded
    // staging branch. Neither id may ever satisfy the gate.
    expect(isLeanTenant("6e5c544f-b374-451f-a662-360a634bff15")).toBe(false);
    expect(isLeanTenant("8e6bc88f-86d6-4468-8610-73f7c8a88f6e")).toBe(false);
  });

  it("is case- and whitespace-exact", () => {
    expect(isLeanTenant("Northwind")).toBe(false);
    expect(isLeanTenant(" northwind")).toBe(false);
    expect(isLeanTenant("northwind-2")).toBe(false);
  });
});

describe("resolveBoldSignMode", () => {
  it("forces live for a lean tenant whatever the column says", () => {
    // northwind's tenants.boldsign_mode is literally 'test' in production. The
    // gate is in code precisely so that column does not have to be touched.
    expect(resolveBoldSignMode("test", "northwind")).toBe("live");
    expect(resolveBoldSignMode("live", "northwind")).toBe("live");
    expect(resolveBoldSignMode(null, "northwind")).toBe("live");
    expect(resolveBoldSignMode(undefined, "northwind")).toBe("live");
  });

  it("leaves every other tenant on its column value", () => {
    // 12 tenants are on boldsign_mode='test' and 8 of those are LIVE operators.
    // Flipping them to the live BoldSign key would break their signing.
    expect(resolveBoldSignMode("test", "goniko")).toBe("test");
    expect(resolveBoldSignMode("live", "goniko")).toBe("live");
  });

  it("keeps the historical default of test when the column is empty", () => {
    expect(resolveBoldSignMode(null, "goniko")).toBe("test");
    expect(resolveBoldSignMode(undefined, "goniko")).toBe("test");
    expect(resolveBoldSignMode("", "goniko")).toBe("test");
  });

  it("does not force live when the slug is unresolved", () => {
    // First paint, and any unrecognised host. Must behave exactly as v1.
    expect(resolveBoldSignMode("test", null)).toBe("test");
    expect(resolveBoldSignMode("test", undefined)).toBe("test");
    expect(resolveBoldSignMode("live", null)).toBe("live");
  });

  it("treats an unexpected column value as test, not live", () => {
    // Fail safe: an unknown mode must never mint documents against the live key.
    expect(resolveBoldSignMode("sandbox", "goniko")).toBe("test");
    expect(resolveBoldSignMode("LIVE", "goniko")).toBe("test");
  });
});

/**
 * Mirror consistency. Asserted against the source text rather than by importing,
 * because the booking module resolves through a different `@` alias and the edge
 * module is Deno (`.ts` URL imports) — neither is loadable from portal's vitest.
 */
describe("lean tenant list mirrors", () => {
  const LIST_RE = /const LEAN_TENANTS: readonly string\[\] = \[([^\]]*)\]/;

  const extractList = (src: string): string[] => {
    const m = src.match(LIST_RE);
    if (!m) throw new Error("LEAN_TENANTS declaration not found");
    return m[1]
      .split(",")
      .map((s) => s.trim().replace(/^['"]|['"]$/g, ""))
      .filter(Boolean);
  };

  const portal = readRepoSource("apps/portal/src/lib/lean-areas.ts");
  const booking = readRepoSource("apps/booking/src/lib/lean-tenants.ts");
  const edge = readEdgeSource("_shared/lean-tenants.ts");

  it("all three runtimes list exactly the same tenants", () => {
    const expected = extractList(portal);
    expect(expected).toEqual(["northwind"]);
    expect(extractList(booking)).toEqual(expected);
    expect(extractList(edge)).toEqual(expected);
  });

  it("no mirror uses `as const`, which would break .includes()", () => {
    // `as const` narrows the element type to the literal union, which narrows
    // Array.prototype.includes to accept only that literal — turning the
    // membership test into a compile error. Both apps build with
    // ignoreBuildErrors: true, so that error is discarded and the gate ships
    // broken. This has already happened twice on this repo.
    for (const src of [portal, booking, edge]) {
      expect(src).not.toMatch(/LEAN_TENANTS\s*=\s*\[[^\]]*\]\s*as const/);
      expect(src).toMatch(/const LEAN_TENANTS: readonly string\[\]/);
    }
  });

  it("every mirror fails open on an empty slug", () => {
    for (const src of [portal, booking, edge]) {
      expect(src).toMatch(/if \(!tenantSlug\) return false;/);
    }
  });
});

/**
 * Every BoldSign mode-resolution point must be gated. A route that still reads
 * `boldsign_mode` straight off the tenant row without consulting the lean gate
 * is exactly the half-gated failure described above.
 */
describe("BoldSign tenant-mode resolution points are all gated", () => {
  const appRoutes = [
    "apps/portal/src/app/api/esign/route.ts",
    "apps/portal/src/app/api/esign/sign/route.ts",
    "apps/portal/src/app/api/esign/view/route.ts",
    "apps/portal/src/app/api/esign/status/route.ts",
    "apps/portal/src/app/api/esign/void/route.ts",
    "apps/portal/src/app/api/esign/signing-redirect/route.ts",
    "apps/booking/src/app/api/esign/route.ts",
    "apps/booking/src/app/api/esign/sign/route.ts",
    "apps/booking/src/app/api/esign/view/route.ts",
  ];

  const edgeFns = [
    "_shared/boldsign-client.ts",
    "create-boldsign-document/index.ts",
    "retry-credit-failed-agreements/index.ts",
  ];

  it.each(appRoutes)("%s imports the lean gate", (path) => {
    const src = readRepoSource(path);
    expect(src).toMatch(/from ['"]@\/lib\/lean-(areas|tenants)['"]/);
  });

  it.each(edgeFns)("%s imports the lean gate", (path) => {
    const src = readEdgeSource(path);
    expect(src).toMatch(/lean-tenants\.ts/);
  });

  it("selects the tenant slug wherever it reads boldsign_mode off tenants", () => {
    // The gate is slug-keyed, so a resolution point that selects only
    // `boldsign_mode` would silently resolve every tenant to the ungated path.
    for (const path of appRoutes) {
      const src = readRepoSource(path);
      const selects = src.match(/\.select\(['"][^'"]*boldsign_mode[^'"]*['"]\)/g) ?? [];
      for (const sel of selects) {
        // Record-level selects (rentals / rental_agreements) legitimately carry
        // no slug; only the tenants selects must.
        if (/slug/.test(sel) || !/company_name|currency_code/.test(sel)) continue;
        expect(sel).toMatch(/slug/);
      }
    }
  });

  it("no app route still assigns the raw tenant column ungated", () => {
    // The old shape was:  if (tenantData?.boldsign_mode) mode = ... as 'test'|'live'
    // with no lean check in front of it. Every such site must now be preceded by
    // an isLeanTenant branch, or go through resolveBoldSignMode.
    for (const path of appRoutes) {
      const src = readRepoSource(path);
      const usesGate = /isLeanTenant\(|resolveBoldSignMode\(/.test(src);
      expect(usesGate, `${path} has no lean gate`).toBe(true);
    }
  });
});
