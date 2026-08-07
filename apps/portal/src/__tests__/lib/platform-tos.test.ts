import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

// The canonical document lives in apps/web (drive-247.com/terms is its public
// home), but only apps/portal has a test runner — so this suite reaches across
// the workspace rather than leaving the legal copy untested.
import {
  PLATFORM_TOS_SECTIONS,
  PLATFORM_TOS_PENDING_VERSION,
  PLATFORM_TOS_PENDING_PLACEHOLDERS,
  PLATFORM_TOS_IS_DRAFT,
  PLATFORM_TOS_EFFECTIVE_DATE,
} from "../../../../web/src/lib/legal/platform-tos";

/**
 * The edge functions are Deno modules outside the portal's tsconfig, so they
 * cannot be imported here. Read the source and pull the constants out textually
 * — the point of these tests is to catch drift between two files that no
 * compiler checks against each other.
 */
const sharedTosSource = readFileSync(
  resolve(__dirname, "../../../../../supabase/functions/_shared/platform-tos.ts"),
  "utf8",
);

function constFromSource(name: string): string {
  const m = sharedTosSource.match(
    new RegExp(`export const ${name}\\s*=\\s*["']([^"']+)["']`),
  );
  if (!m) throw new Error(`${name} not found in _shared/platform-tos.ts`);
  return m[1];
}

describe("platform ToS — version wiring", () => {
  it("exposes a server-side version constant to the edge functions", () => {
    expect(constFromSource("PLATFORM_TOS_VERSION")).toBeTruthy();
  });

  it("keeps the pending version in sync between the page content and the server constant", () => {
    // These live in two files that nothing links: the portal renders the
    // document, the edge function stamps the version into tenants. If they
    // drift, we record consent to a version the tenant was never shown — which
    // is exactly the failure the column exists to prevent.
    expect(constFromSource("PLATFORM_TOS_PENDING_VERSION")).toBe(
      PLATFORM_TOS_PENDING_VERSION,
    );
  });

  it("only stamps the Appendix A version once that document is actually live", () => {
    // Guards the two-step release: flipping PLATFORM_TOS_IS_DRAFT to false
    // without bumping PLATFORM_TOS_VERSION (or vice versa) would leave the
    // recorded version pointing at a document nobody is being shown.
    const serverVersion = constFromSource("PLATFORM_TOS_VERSION");
    if (PLATFORM_TOS_IS_DRAFT) {
      expect(serverVersion).not.toBe(PLATFORM_TOS_PENDING_VERSION);
    } else {
      expect(serverVersion).toBe(PLATFORM_TOS_PENDING_VERSION);
    }
  });
});

describe("platform ToS — the draft flag is actually wired to the page", () => {
  // Without these, the version-sync tests above are theatre: the constants could
  // agree perfectly while /terms kept serving a completely different document.
  // That was the real state of this code until the page became a switch.
  const termsPage = readFileSync(
    resolve(__dirname, "../../../../web/src/app/(marketing)/terms/page.tsx"),
    "utf8",
  );

  it("has /terms branch on PLATFORM_TOS_IS_DRAFT", () => {
    expect(termsPage).toContain("PLATFORM_TOS_IS_DRAFT");
    expect(termsPage).toMatch(/from ["']@\/lib\/legal\/platform-tos["']/);
  });

  it("has /terms render both the interim document and the Appendix A document", () => {
    expect(termsPage).toContain("InterimPlatformTerms");
    expect(termsPage).toContain("PlatformTosDocument");
  });

  it("has the Appendix A renderer actually consume the section data", () => {
    const doc = readFileSync(
      resolve(__dirname, "../../../../web/src/components/legal/platform-tos-document.tsx"),
      "utf8",
    );
    expect(doc).toContain("PLATFORM_TOS_SECTIONS");
    expect(doc).toContain("PLATFORM_TOS_CLOSING");
  });

  it("has the consent checkbox point at the page this flag controls", () => {
    const consent = readFileSync(
      resolve(__dirname, "../../components/legal/terms-consent.tsx"),
      "utf8",
    );
    // Absolute canonical URLs from the shared module: the portal runs on a
    // different origin, so a root-relative href could never reach the
    // marketing site.
    expect(consent).toContain("PLATFORM_TERMS_URL");
    expect(consent).toContain("PLATFORM_PRIVACY_URL");
  });
});

describe("platform ToS — one canonical document, the portal copy retired", () => {
  const repoRoot = resolve(__dirname, "../../../../..");

  it("has no portal-local copy of the terms or privacy policy", () => {
    // The whole point of the consolidation: two differently-worded documents
    // both claiming to be the platform terms is a real problem once a tenant is
    // charged against one of them. Re-adding a portal page would resurrect that
    // without any other test noticing.
    for (const p of [
      "apps/portal/src/app/(auth)/terms/page.tsx",
      "apps/portal/src/app/(auth)/privacy-policy/page.tsx",
    ]) {
      expect(existsSync(resolve(repoRoot, p)), `${p} must stay retired`).toBe(false);
    }
  });

  it("redirects the retired portal routes instead of 404ing them", () => {
    // Redirect, not delete — the login page's MANDATORY acceptance checkbox
    // links these, and a 404 on the screen where a user attests to having read
    // a document is worse than the duplication we removed.
    const cfg = readFileSync(resolve(repoRoot, "apps/portal/next.config.js"), "utf8");
    expect(cfg).toContain("async redirects()");
    expect(cfg).toContain("'/terms'");
    expect(cfg).toContain("'/privacy-policy'");
    // 307 not 308, asserted on the legal entries specifically rather than by
    // scanning the whole file — an unrelated permanent redirect added later
    // should not fail a test whose message is about legal documents.
    const legalBlock = cfg.slice(cfg.indexOf("async redirects()"));
    for (const route of ["'/terms'", "'/privacy-policy'"]) {
      const at = legalBlock.indexOf(route);
      expect(at, `${route} redirect must exist`).toBeGreaterThan(-1);
      // permanent lives within the same object literal as the source.
      expect(legalBlock.slice(at, at + 220)).toContain("permanent: false");
    }
  });

  it("routes every portal legal link through the shared URL module", () => {
    // A root-relative /terms in the portal resolves against
    // {tenant}.portal.drive-247.com and can never reach the marketing site.
    // Going through lib/legal/urls.ts (rather than each file hardcoding the
    // host) is what stops NEXT_PUBLIC_MARKETING_URL from being honoured on some
    // consent surfaces and ignored on others — which previously left the two
    // MANDATORY acceptance screens pointing at production while the rest
    // followed a local override.
    for (const p of [
      "apps/portal/src/app/(auth)/login/page.tsx",
      "apps/portal/src/components/policy/policy-acceptance-gate.tsx",
      "apps/portal/src/components/legal/terms-consent.tsx",
    ]) {
      const src = readFileSync(resolve(repoRoot, p), "utf8");
      expect(src, `${p} must not link root-relative legal paths`).not.toMatch(
        /href="\/(terms|privacy|privacy-policy)"/,
      );
      expect(src, `${p} must not hardcode the marketing host`).not.toContain(
        "https://drive-247.com",
      );
      expect(src, `${p} must use the shared URL module`).toMatch(
        /PLATFORM_(TERMS|PRIVACY)_URL/,
      );
    }
  });

  it("keeps the portal's link origin, its redirect destination, and Stripe's ToS URL on one host", () => {
    // Three places name the marketing origin and nothing links them: the shared
    // URL module (consent links), next.config.js (the retired-route redirects),
    // and _shared/platform-tos.ts (what Stripe shows when consent_collection is
    // on). If they diverge, a tenant can tick a box against one document while
    // a different one is recorded — the exact failure the version column exists
    // to prevent.
    const urls = readFileSync(
      resolve(repoRoot, "apps/portal/src/lib/legal/urls.ts"),
      "utf8",
    );
    const cfg = readFileSync(resolve(repoRoot, "apps/portal/next.config.js"), "utf8");
    const fallback = urls.match(/NEXT_PUBLIC_MARKETING_URL \|\| "([^"]+)"/)?.[1];
    const cfgFallback = cfg.match(/NEXT_PUBLIC_MARKETING_URL \|\| '([^']+)'/)?.[1];

    expect(fallback).toBe("https://drive-247.com");
    expect(cfgFallback, "next.config.js must default to the same origin").toBe(fallback);
    expect(constFromSource("PLATFORM_TOS_URL")).toBe(`${fallback}/terms`);
  });

  it("keeps the server-side canonical URL pointing at the page that renders the versioned document", () => {
    // If Stripe's account-level ToS URL is set from this constant (which is what
    // enabling STRIPE_TOS_CONSENT_ENABLED requires), it must serve the same
    // document PLATFORM_TOS_VERSION names — otherwise the consent record
    // attests to something the operator never saw.
    expect(constFromSource("PLATFORM_TOS_URL")).toBe("https://drive-247.com/terms");
  });
});

describe("interim canonical documents — the sign-off window is still contractually covered", () => {
  const repoRoot = resolve(__dirname, "../../../../..");
  // Collapse whitespace: JSX wraps prose across lines, so a clause like "shall
  // not\n  exceed the fees paid" is one sentence in the rendered document but
  // never a substring of the source.
  const terms = readFileSync(
    resolve(repoRoot, "apps/web/src/components/legal/interim-platform-terms.tsx"),
    "utf8",
  ).replace(/\s+/g, " ");
  const privacy = readFileSync(
    resolve(repoRoot, "apps/web/src/app/(marketing)/privacy/page.tsx"),
    "utf8",
  );

  it("serves an interim contract that still has payment, liability, warranty and governing-law clauses", () => {
    // Consolidating onto the marketing URL briefly carried the marketing *text*
    // with it — an 8-section summary with none of these. A tenant is charged
    // against whatever is live during the Appendix A sign-off window, so the
    // interim document has to be a real contract, not a summary.
    expect(terms).toContain("does not collect, hold, or process client funds");
    expect(terms).toContain("shall not exceed the fees paid by the Client");
    expect(terms).toContain("without warranties of any kind");
    expect(terms).toContain("governed by the laws of England and Wales");
  });

  it("keeps all 13 clauses of the interim contract", () => {
    for (const [n, title] of [
      [1, "Scope of the System"], [2, "Authorised Users"],
      [3, "Client Operational Responsibility"], [4, "Third-Party Services"],
      [5, "Payments"], [6, "Data Responsibility"], [7, "System Availability"],
      [8, "Acceptable Use"], [9, "Limitation of Liability"], [10, "No Warranty"],
      [11, "Changes to Terms"], [12, "Governing Law"], [13, "Acceptance"],
    ] as [number, string][]) {
      expect(terms, `clause ${n}. ${title}`).toContain(`${n}. ${title}`);
    }
  });

  it("does not claim Drive247 is only a processor now that operators accept this policy too", () => {
    // The page used to open with an unqualified "We act as a data processor on
    // behalf of the independent rental operators (controllers)". True of RENTER
    // data; false for the operator's own staff accounts, where Cortek decides
    // the purposes and means. The portal's /privacy-policy now redirects here,
    // so both audiences read this page and the blanket claim was backwards.
    expect(privacy).not.toMatch(
      /We act as a\{?"?\s*"?\}?\s*<strong>data processor<\/strong> on behalf of the independent rental\s*operators/,
    );
    // The controller relationship for portal accounts must be stated.
    expect(privacy).toContain("Rental operators and their staff");
    expect(privacy).toMatch(/portal account[\s\S]{0,400}<strong>controller<\/strong>/);
    // ...and the processor relationship for renter data must survive.
    expect(privacy).toMatch(/Renters[\s\S]{0,600}<strong>\s*processor\s*<\/strong>/);
  });
});

describe("platform ToS — Appendix A integrity", () => {
  it("has all 50 sections, numbered 1..50 with no gaps or duplicates", () => {
    expect(PLATFORM_TOS_SECTIONS).toHaveLength(50);
    expect(PLATFORM_TOS_SECTIONS.map((s) => s.n)).toEqual(
      Array.from({ length: 50 }, (_, i) => i + 1),
    );
  });

  it("has a title and at least one block of body copy in every section", () => {
    for (const s of PLATFORM_TOS_SECTIONS) {
      expect(s.title, `section ${s.n} title`).toBeTruthy();
      expect(s.body.length, `section ${s.n} body`).toBeGreaterThan(0);
    }
  });

  it("leaves every solicitor placeholder unfilled", () => {
    // The handoff is explicit: "Leave every bracketed placeholder in Appendix A
    // exactly as written — don't fill in Governing Law, Venue, or the Privacy
    // Policy URL yourself." A well-meaning autofill here would put an
    // unreviewed jurisdiction into a contract tenants are charged against.
    const allText = JSON.stringify(PLATFORM_TOS_SECTIONS);
    for (const placeholder of PLATFORM_TOS_PENDING_PLACEHOLDERS) {
      expect(allText, `${placeholder} must still be present`).toContain(placeholder);
    }
    expect(PLATFORM_TOS_EFFECTIVE_DATE).toContain("[");
  });

  it("keeps Governing Law and Venue in section 34 and the Privacy URL in section 17", () => {
    const s34 = PLATFORM_TOS_SECTIONS.find((s) => s.n === 34)!;
    const s17 = PLATFORM_TOS_SECTIONS.find((s) => s.n === 17)!;
    expect(JSON.stringify(s34)).toContain("[Governing Law Jurisdiction]");
    expect(JSON.stringify(s34)).toContain("[Venue]");
    expect(JSON.stringify(s17)).toContain("[Privacy Policy URL]");
  });

  it("preserves the drafted all-caps disclaimer and liability sections", () => {
    // Sections 29 and 30 are drafted in capitals deliberately — several US
    // states condition enforceability of warranty disclaimers and liability
    // caps on their being conspicuous. Down-casing them is a legal change, not
    // a styling one.
    for (const n of [29, 30]) {
      const section = PLATFORM_TOS_SECTIONS.find((s) => s.n === n)!;
      const caps = section.body.filter((b) => b.t === "caps");
      expect(caps.length, `section ${n} must keep a caps block`).toBeGreaterThan(0);
      for (const block of caps) {
        const text = (block as { text: string }).text;
        expect(text, `section ${n} caps block`).toBe(text.toUpperCase());
      }
    }
  });

  it("keeps the cross-references that renumbering would silently break", () => {
    const text = JSON.stringify(PLATFORM_TOS_SECTIONS);
    // 27 cites 7, 18 cites 19, 14 cites 20, 23 cites 21, 24 cites 30.
    for (const ref of [
      "Section 7",
      "Section 19 (Licence to Use the Platform)",
      "Section 20 (AI-Assisted Features)",
      "Section 21 (Acceptable Use)",
      "Section 30 (Limitation of Liability)",
    ]) {
      expect(text, `cross-reference "${ref}"`).toContain(ref);
    }
  });
});
