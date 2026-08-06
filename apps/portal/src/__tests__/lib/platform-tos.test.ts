import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  PLATFORM_TOS_SECTIONS,
  PLATFORM_TOS_PENDING_VERSION,
  PLATFORM_TOS_PENDING_PLACEHOLDERS,
  PLATFORM_TOS_IS_DRAFT,
  PLATFORM_TOS_EFFECTIVE_DATE,
} from "@/lib/legal/platform-tos";

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
    resolve(__dirname, "../../app/(auth)/terms/page.tsx"),
    "utf8",
  );

  it("has /terms branch on PLATFORM_TOS_IS_DRAFT", () => {
    expect(termsPage).toContain("PLATFORM_TOS_IS_DRAFT");
    expect(termsPage).toMatch(/from ["']@\/lib\/legal\/platform-tos["']/);
  });

  it("has /terms render both the legacy document and the Appendix A document", () => {
    expect(termsPage).toContain("LegacyPlatformTerms");
    expect(termsPage).toContain("PlatformTosDocument");
  });

  it("has the Appendix A renderer actually consume the section data", () => {
    const doc = readFileSync(
      resolve(__dirname, "../../components/legal/platform-tos-document.tsx"),
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
    expect(consent).toContain('href="/terms"');
    expect(consent).toContain('href="/privacy-policy"');
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
