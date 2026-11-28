// Proves 02.7, 02.8 (the portal per site) and 01.14 (the finish-later link per site):
// review 1, answers 2.2 and 2.7. One fixed list: supabase/functions/_shared/drive247-sites.ts.
import { describe, expect, it } from "vitest";
import { finishLaterSiteFor, portalUrlForReturn, portalUrlForSignup, signInUrlFor } from "../../../../supabase/functions/_shared/drive247-sites";
import { buildFinishLaterLink } from "../../../../supabase/functions/_shared/signup-finish-later";

const today = (slug: string) => `https://${slug}.portal.from-the-setting.example`;

describe("our sites, from a fixed list", () => {
  it.each([
    ["https://drive-247.com", "https://acme.portal.drive-247.com"],
    ["https://www.drive-247.com", "https://acme.portal.drive-247.com"],
    ["https://staging.drive-247.com", "https://acme.portal.staging.drive-247.com"],
    ["https://ray1.drive-247.com", "https://acme.portal.ray1.drive-247.com"],
    ["https://ray2.drive-247.com", "https://acme.portal.ray2.drive-247.com"],
    ["https://ray3.drive-247.com", "https://acme.portal.ray3.drive-247.com"],
    ["http://localhost:4003", "http://acme.portal.localhost:4002"],
    ["HTTPS://RAY2.DRIVE-247.COM", "https://acme.portal.ray2.drive-247.com"],
  ])("02.7 a signup from %s gets its own portal %s", (origin, portal) => {
    expect(portalUrlForSignup(origin, "acme", today)).toBe(portal);
  });

  it.each([
    ["https://evil.example"],
    ["https://ray2.drive-247.com.evil.example"],
    ["http://ray2.drive-247.com"],
    ["https://ray4.drive-247.com"],
    ["https://localhost:4003"],
    ["not a url"],
    [""],
  ])("02.8 an address not on the list (%s) gets today's setting", (origin) => {
    expect(portalUrlForSignup(origin, "acme", today)).toBe(today("acme"));
  });

  it("02.8 no origin at all gets today's setting", () => {
    expect(portalUrlForSignup(null, "acme", today)).toBe(today("acme"));
  });

  it.each([
    ["https://www.drive-247.com", "https://www.drive-247.com/"],
    ["https://staging.drive-247.com", "https://staging.drive-247.com/"],
    ["https://ray2.drive-247.com", "https://ray2.drive-247.com/"],
    ["http://localhost:4003", "http://localhost:4003/"],
    ["https://evil.example", "https://www.drive-247.com/"],
    ["", "https://www.drive-247.com/"],
  ])("01.14 a finish-later link asked for from %s goes back to %s", (origin, site) => {
    const link = buildFinishLaterLink("t".repeat(43), "WELCOME20", finishLaterSiteFor(origin));
    expect(link.startsWith(`${site}?signup=finish&t=`)).toBe(true);
  });
});

describe("02.9 a returning signup opens the portal of the site it came back on", () => {
  const fallback = (s: string) => `https://${s}.portal.drive-247.com`;
  const savedRay3 = "https://acme.portal.ray3.drive-247.com";
  it.each([
    ["https://ray2.drive-247.com", "https://acme.portal.ray2.drive-247.com"],
    ["https://ray3.drive-247.com", "https://acme.portal.ray3.drive-247.com"],
    ["http://localhost:4003", "http://acme.portal.localhost:4002"],
  ])("from %s → %s, whatever was saved", (origin, want) => {
    expect(portalUrlForReturn(origin, "acme", savedRay3, fallback)).toBe(want);
  });
  it("from a site that is not ours, the saved address stands", () => {
    expect(portalUrlForReturn("https://evil.example", "acme", savedRay3, fallback)).toBe(savedRay3);
    expect(portalUrlForReturn(null, "acme", undefined, fallback)).toBe("https://acme.portal.drive-247.com");
  });
  it("a saved sign-in link is kept only when the portal address did not change", () => {
    expect(signInUrlFor("LINK", savedRay3, savedRay3)).toBe("LINK");
    expect(signInUrlFor("LINK", savedRay3, "https://acme.portal.ray2.drive-247.com")).toBeNull();
    expect(signInUrlFor(null, savedRay3, savedRay3)).toBeNull();
  });
});
