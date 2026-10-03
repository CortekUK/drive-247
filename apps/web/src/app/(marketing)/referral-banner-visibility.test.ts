import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/*
 * The invite banner belongs to an ARRIVAL, not to a browser.
 *
 * The home page used to resolve the referral code as
 *
 *   searchParams.ref ?? cookies().get(REFERRAL_COOKIE)
 *
 * which reads as the same thing and is not. The cookie lasts 90 days and
 * nothing on this page clears it, so one click on a referral link greeted that
 * browser with an invite banner on every direct visit for three months, with no
 * dismiss. Worse, the same value fed `showPricing`, so a stale cookie kept the
 * pricing grid and self-serve signup ON for that visitor after an admin had
 * switched them off — the switch worked for everyone except the people most
 * likely to be testing it.
 *
 * The fix is a separation, not a removal, and both halves need holding:
 *
 *   - this page keys off `?ref=` only, so the banner and the pricing exception
 *     belong to the request that actually carried a code;
 *   - the cookie is untouched, so the discount still reaches checkout a week
 *     later.
 *
 * A reader who sees the banner "fail" to appear on a return visit will reach
 * for the cookie fallback, which is why the first test exists.
 */

const ROOT = resolve(__dirname, "../../..");
const read = (p: string) => readFileSync(resolve(ROOT, p), "utf8");
/** Comments explain the removed behaviour; they must not be read as the code. */
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const page = strip(read("src/app/(marketing)/page.tsx"));

describe("the banner follows the arrival, not the browser", () => {
  it("does not read the referral cookie on the home page", () => {
    expect(page).not.toMatch(/REFERRAL_COOKIE/);
    expect(page).not.toMatch(/\bcookies\s*\(/);
  });

  it("takes the code from this request's query string", () => {
    expect(page).toMatch(/normalizeReferralCode\(\s*\(await searchParams\)\?\.ref\s*\)/);
  });

  it("renders the banner only when that produced an offer", () => {
    expect(page).toMatch(/\{offer && <ReferralBanner/);
  });
});

describe("the admin switch is not overridden by a stale cookie", () => {
  it("still makes the invite exception, but from a fresh arrival", () => {
    // An invited operator was sent here to pick a plan, so the grid shows even
    // while self-serve signup is off. `offer` is now fresh-only, which is what
    // keeps that exception from outliving the visit.
    expect(page).toMatch(/const showPricing = \(await fetchLandingPricingEnabled\(\)\) \|\| !!offer;/);
  });
});

describe("the 90-day memory still works for checkout", () => {
  it("/r/{code} still sets the cookie and still lands on ?ref=", () => {
    const route = strip(read("src/app/r/[code]/route.ts"));
    expect(route).toMatch(/res\.cookies\.set\(REFERRAL_COOKIE/);
    expect(route).toMatch(/REFERRAL_COOKIE_DAYS \* 24 \* 60 \* 60/);
    // Both ways in therefore carry ?ref=, which is what lets the page key off
    // the parameter alone without losing /r/{code} arrivals.
    expect(route).toMatch(/home\.searchParams\.set\("ref", code\)/);
  });

  it("a ?ref= arrival that skipped /r/{code} still gets the cookie written", () => {
    // RememberReferralCode lives INSIDE the banner, so it runs exactly when a
    // request carried a usable code — the one case where the cookie is not
    // already set. Moving it out of the banner would break persistence.
    const banner = strip(read("src/components/sections/referral-banner.tsx"));
    expect(banner).toMatch(/<RememberReferralCode code=\{offer\.displayCode\}/);
  });

  it("the signup flow still reads the cookie, which is the point of keeping it", () => {
    const provider = strip(read("src/components/onboarding/onboarding-provider.tsx"));
    expect(provider).toMatch(/readReferralCodeFromDocument/);
  });
});
