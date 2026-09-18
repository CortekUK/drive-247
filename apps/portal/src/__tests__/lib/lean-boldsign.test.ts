import { describe, expect, it } from "vitest";

import { isLeanTenant, resolveBoldSignMode } from "@/lib/lean-areas";
import {
  codeOnly,
  compile,
  liftDeclaration,
  readEdgeSource,
  readRepoSource,
} from "../helpers/edge-source";

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


/**
 * BOTH SOURCES, EVERYWHERE. This is the invariant the suite above could not see.
 *
 * A tenant is lean two ways now: the canary slug list, and
 * `tenants.portal_experience = 'v2'` — which is how every self-serve signup and
 * every hand-flipped sale arrives, because the slug list only ever named
 * `northwind`. The tests above assert each resolution point *imports* the gate,
 * which stayed green while 6 of the 12 sites were upgraded and 6 were not.
 *
 * That half-gated state is the specific failure the mirror headers call "worse
 * than no gate": the portal reports "Live" and signs live and binding, while an
 * automation step, the booking app's own create path and the nightly
 * credit-retry cron mint the SAME tenant's agreements in the BoldSign sandbox —
 * watermarked "not binding", auto-deleted after 14 days, with nothing in any UI
 * saying so. The documented hand-flip (ops/portal_experience.sql) sets only
 * `portal_experience`, leaving `tenants.boldsign_mode` at its DEFAULT 'test', so
 * every admin-onboarded v2 tenant lands in exactly this split.
 *
 * So: assert the three mirrors AGREE ON BEHAVIOUR by executing them, and assert
 * every one of the 12 resolution points actually threads the column through.
 */
describe("all three mirrors agree on behaviour, not just on the list", () => {
  type Resolver = (
    mode: string | null | undefined,
    slug: string | null | undefined,
    onV2?: boolean,
  ) => string;
  type Predicate = (slug: string | null | undefined, onV2?: boolean) => boolean;

  /**
   * Lift and compile the REAL declarations out of each mirror. Booking resolves
   * through a different `@` alias and the edge module is Deno, so neither is
   * importable from portal's vitest — but their source text is, and lifting it
   * means the shipped function is the one under test.
   */
  const mirrors: Array<[string, string]> = [
    ["portal", readRepoSource("apps/portal/src/lib/lean-areas.ts")],
    ["booking", readRepoSource("apps/booking/src/lib/lean-tenants.ts")],
    ["edge", readEdgeSource("_shared/lean-tenants.ts")],
  ];

  const lift = (src: string) => {
    const snippets = [
      liftDeclaration(src, "LEAN_TENANTS"),
      liftDeclaration(src, "isLeanTenant"),
      liftDeclaration(src, "resolveBoldSignMode"),
    ];
    // The portal's canonical copy delegates to a `…ForLean` helper; the mirrors
    // inline the same two lines. Lift the helper too when it is there.
    if (/function resolveBoldSignModeForLean/.test(src)) {
      snippets.push(liftDeclaration(src, "resolveBoldSignModeForLean"));
    }
    return {
      resolveBoldSignMode: compile<Resolver>(snippets, "resolveBoldSignMode"),
      isLeanTenant: compile<Predicate>(snippets, "isLeanTenant"),
    };
  };

  it.each(mirrors)("%s forces live for a column-flagged tenant", (_name, src) => {
    const { resolveBoldSignMode: resolve, isLeanTenant: lean } = lift(src);
    // The flagged tenant: boldsign_mode is still its DEFAULT 'test', and the
    // only thing saying v2 is the row. Every runtime must answer `live`.
    expect(resolve("test", "wings", true)).toBe("live");
    expect(resolve(null, "wings", true)).toBe("live");
    expect(lean("wings", true)).toBe(true);
  });

  it.each(mirrors)("%s keeps the canary working through the slug list", (_name, src) => {
    const { resolveBoldSignMode: resolve, isLeanTenant: lean } = lift(src);
    expect(resolve("test", "northwind")).toBe("live");
    expect(lean("northwind")).toBe(true);
  });

  it.each(mirrors)("%s leaves a v1 tenant exactly as it was", (_name, src) => {
    const { resolveBoldSignMode: resolve, isLeanTenant: lean } = lift(src);
    // 12 production tenants sit on boldsign_mode='test' and 8 are live
    // operators. onV2 defaults to false, so an un-upgraded caller is unchanged.
    expect(resolve("test", "goniko")).toBe("test");
    expect(resolve("live", "goniko")).toBe("live");
    expect(resolve("test", "goniko", false)).toBe("test");
    expect(lean("goniko")).toBe(false);
    expect(lean("goniko", false)).toBe(false);
  });

  it.each(mirrors)("%s still fails open on an unresolved slug, even with onV2", (_name, src) => {
    const { resolveBoldSignMode: resolve, isLeanTenant: lean } = lift(src);
    expect(resolve("test", null, true)).toBe("test");
    expect(resolve("test", undefined, true)).toBe("test");
    expect(resolve("test", "", true)).toBe("test");
    expect(lean(null, true)).toBe(false);
  });

  /**
   * The flag reaches a route through `readTenantOnV2ById`, which lives beside
   * the gate in each runtime — `lib/portal-tenant.ts` in the portal, and inside
   * the mirror itself in booking and the edge functions, which have nowhere else
   * to put it. All three must fail CLOSED, because the column may be unreadable
   * (42703 before the migration, 42501 before the GRANT) for as long as the
   * deploy is ahead of the SQL the lead applies by hand.
   */
  const readers: Array<[string, string]> = [
    ["portal", readRepoSource("apps/portal/src/lib/portal-tenant.ts")],
    ["booking", readRepoSource("apps/booking/src/lib/lean-tenants.ts")],
    ["edge", readEdgeSource("_shared/lean-tenants.ts")],
  ];

  it.each(readers)("%s resolves the column fail-closed", (_name, src) => {
    const reader = liftDeclaration(src, "readTenantOnV2ById");
    // No id, no row, an error, or a throw — all v1.
    expect(reader).toMatch(/if \(!tenantId\) return false;/);
    expect(reader).toMatch(/if \(error\) return false;/);
    expect(reader).toMatch(/catch \{\s*return false;/);
    // And the value itself is compared against the literal 'v2', so NULL, '',
    // 'V2' and any future value stay on v1.
    expect(reader).toMatch(/portal_experience/);
    expect(src).toMatch(/'v2'/);
  });

  it.each(readers)("%s asks for portal_experience on its OWN round trip", (_name, src) => {
    // Never folded into a select that also names `boldsign_mode`: Postgres
    // refuses the WHOLE row for an unreadable column, so widening those selects
    // would drop `boldsign_mode` for every tenant at once and send live
    // operators' documents to the sandbox.
    const reader = liftDeclaration(src, "readTenantOnV2ById");
    expect(reader).toMatch(/\.select\(\s*(['"]portal_experience['"]|EXPERIENCE_COLUMN)\s*\)/);
    expect(reader).not.toMatch(/boldsign_mode/);
  });
});

describe("every BoldSign resolution point consults BOTH sources", () => {
  /**
   * The 12 places a tenant's BoldSign mode is decided. Every one of them must
   * consult the column as well as the slug list, or the tenant is half-gated.
   */
  const sites: Array<[string, string]> = [
    ["apps/portal/src/app/api/esign/route.ts", "repo"],
    ["apps/portal/src/app/api/esign/sign/route.ts", "repo"],
    ["apps/portal/src/app/api/esign/view/route.ts", "repo"],
    ["apps/portal/src/app/api/esign/status/route.ts", "repo"],
    ["apps/portal/src/app/api/esign/void/route.ts", "repo"],
    ["apps/portal/src/app/api/esign/signing-redirect/route.ts", "repo"],
    ["apps/booking/src/app/api/esign/route.ts", "repo"],
    ["apps/booking/src/app/api/esign/sign/route.ts", "repo"],
    ["apps/booking/src/app/api/esign/view/route.ts", "repo"],
    ["supabase/functions/_shared/boldsign-client.ts", "repo"],
    ["supabase/functions/create-boldsign-document/index.ts", "repo"],
    ["supabase/functions/retry-credit-failed-agreements/index.ts", "repo"],
  ];

  /** Every `fn(...)` call's argument text, with balanced parens respected. */
  const callArgs = (src: string, fn: string): string[] => {
    const out: string[] = [];
    const needle = `${fn}(`;
    let at = src.indexOf(needle);
    while (at !== -1) {
      // Skip an import/declaration mention rather than a call.
      let depth = 0;
      let i = at + needle.length - 1;
      const start = i + 1;
      for (; i < src.length; i += 1) {
        if (src[i] === "(") depth += 1;
        else if (src[i] === ")") {
          depth -= 1;
          if (depth === 0) break;
        }
      }
      out.push(src.slice(start, i));
      at = src.indexOf(needle, i);
    }
    return out;
  };

  it.each(sites)("%s reads tenants.portal_experience", (path) => {
    const src = codeOnly(readRepoSource(path));
    expect(
      /readTenantOnV2ById\(/.test(src),
      `${path} never reads portal_experience, so a column-flagged tenant ` +
        "resolves through the slug list alone and signs in the wrong mode",
    ).toBe(true);
  });

  it.each(sites)("%s threads the flag into every gate call", (path) => {
    const src = codeOnly(readRepoSource(path));
    const calls = [
      ...callArgs(src, "resolveBoldSignMode"),
      ...callArgs(src, "isLeanTenant"),
    ].filter((args) => !/^\s*$/.test(args));
    // Declarations in the gate module itself are not in this list of files, so
    // every match here is a call at a resolution point.
    expect(calls.length, `${path} has no lean-gate call`).toBeGreaterThan(0);
    for (const args of calls) {
      expect(
        /onV2/.test(args),
        `${path} calls the gate without the portal_experience flag: (${args.trim()})`,
      ).toBe(true);
    }
  });
});
