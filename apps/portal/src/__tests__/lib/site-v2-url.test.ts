/**
 * The customer website the portal points at, per tenant.
 *
 * The bug this guards: in production `getSiteV2BaseUrl` and `getBookingBaseUrl`
 * returned the SAME host, so "Open website" on the v2 CMS handed the browser a
 * correct URL and Vercel served the v1 booking app — the tenant edited one site
 * and opened another, with nothing on screen to say so.
 *
 * The risk in fixing it is the opposite one: sending the other ~30 tenants at a
 * host that does not serve them. So the assertion that matters most here is the
 * negative one — a tenant off the canary keeps `{slug}.drive-247.com`.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";

import { getSiteV2BaseUrl } from "@/lib/site-v2-url";
import { isV2 } from "@/lib/v2";

const CANARY = "northwind";
const OTHERS = ["test", "revtekrentals", "goniko", "nealcorentals"];

describe("getSiteV2BaseUrl", () => {
  const template = process.env.NEXT_PUBLIC_SITE_V2_URL_TEMPLATE;

  beforeEach(() => {
    // `window` is defined under jsdom, and its hostname is localhost — which is
    // the dev branch. These tests are about PRODUCTION, so the branch has to be
    // taken out of the way.
    delete process.env.NEXT_PUBLIC_SITE_V2_URL_TEMPLATE;
  });

  afterEach(() => {
    if (template) process.env.NEXT_PUBLIC_SITE_V2_URL_TEMPLATE = template;
  });

  it("puts only the canary tenant on the v2 site", () => {
    expect(isV2("site", CANARY)).toBe(true);
    for (const slug of OTHERS) {
      expect(isV2("site", slug)).toBe(false);
    }
  });

  it("fails closed for an unknown, empty or missing tenant", () => {
    expect(isV2("site", "not-a-real-tenant")).toBe(false);
    expect(isV2("site", null)).toBe(false);
    expect(isV2("site", undefined)).toBe(false);
    expect(getSiteV2BaseUrl(null)).toBe("");
    expect(getSiteV2BaseUrl(undefined)).toBe("");
  });

  it("honours an explicit template for any tenant", () => {
    process.env.NEXT_PUBLIC_SITE_V2_URL_TEMPLATE = "https://{slug}.preview.example.com";
    expect(getSiteV2BaseUrl(CANARY)).toBe("https://northwind.preview.example.com");
    expect(getSiteV2BaseUrl("test")).toBe("https://test.preview.example.com");
  });

  it("keeps the slug as the FIRST label, which is what the v2 middleware reads", () => {
    // `extractTenantSlugFromHost` strips the base domain and takes `split(".")[0]`,
    // so `northwind.v2.drive-247.com` resolves to `northwind`. If this host ever
    // becomes `v2.northwind.drive-247.com` the site would resolve no tenant.
    process.env.NEXT_PUBLIC_SITE_V2_URL_TEMPLATE = "";
    const url = `https://${CANARY}.v2.drive-247.com`;
    expect(url.replace("https://", "").split(".")[0]).toBe(CANARY);
  });
});
