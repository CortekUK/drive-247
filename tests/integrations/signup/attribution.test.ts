import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  HEARD_ABOUT_VALUES,
  normalizeSignupPhone,
  phoneForMeta,
  readSignupAttribution,
  stampStripeCustomer,
  stripeAttributionMetadata,
} from "../../../supabase/functions/_shared/signup-attribution";
import {
  attributionFromDraft,
  EMPTY_ATTRIBUTION,
  HEARD_ABOUT_OPTIONS,
  isValidPhone,
  validateAttribution,
} from "../../../apps/web/src/lib/signup-attribution";

const repo = resolve(__dirname, "../../..");
const read = (rel: string) => readFileSync(join(repo, rel), "utf8");

describe("signup attribution: the answer list", () => {
  it("offers the same choices in the form and on the server", () => {
    expect(HEARD_ABOUT_OPTIONS.map((o) => o.value)).toEqual([...HEARD_ABOUT_VALUES]);
  });

  it("shows the seven agreed labels, in order", () => {
    expect(HEARD_ABOUT_OPTIONS.map((o) => o.label)).toEqual([
      "Instagram",
      "Facebook",
      "Google search",
      "YouTube",
      "A friend or another host",
      "Turo host group or forum",
      "Other",
    ]);
  });
});

describe("signup attribution: the form", () => {
  it("requires an answer", () => {
    expect(validateAttribution(EMPTY_ATTRIBUTION).heardAbout).toBeTruthy();
    expect(attributionFromDraft(EMPTY_ATTRIBUTION)).toBeNull();
  });

  it("asks what 'Other' means", () => {
    const draft = { ...EMPTY_ATTRIBUTION, heardAbout: "other" as const, heardAboutOther: "  " };
    expect(validateAttribution(draft).heardAboutOther).toBeTruthy();
    expect(attributionFromDraft(draft)).toBeNull();
  });

  it("leaves the phone optional but checks one that is typed", () => {
    expect(isValidPhone("")).toBe(true);
    expect(isValidPhone("(615) 555-0100")).toBe(true);
    expect(isValidPhone("call me")).toBe(false);
    expect(isValidPhone("123")).toBe(false);
  });

  it("drops text left over from switching away from 'Other'", () => {
    expect(
      attributionFromDraft({ heardAbout: "youtube", heardAboutOther: "a podcast", phone: "" }),
    ).toEqual({ heardAbout: "youtube" });
  });
});

describe("signup attribution: the server", () => {
  it("keeps a valid answer", () => {
    expect(
      readSignupAttribution({ heardAbout: "other", heardAboutOther: " a podcast ", phone: "615-555-0100" }),
    ).toEqual({ heardAbout: "other", heardAboutOther: "a podcast", phone: "+16155550100" });
  });

  it("ignores values that are not on the list, without refusing the signup", () => {
    expect(readSignupAttribution({ heardAbout: "tiktok", phone: "nope" })).toEqual({});
    expect(readSignupAttribution(null)).toEqual({});
  });

  it("only keeps the free text for 'Other', and caps its length", () => {
    expect(readSignupAttribution({ heardAbout: "facebook", heardAboutOther: "x" })).toEqual({
      heardAbout: "facebook",
    });
    const long = readSignupAttribution({ heardAbout: "other", heardAboutOther: "x".repeat(500) });
    expect(long.heardAboutOther).toHaveLength(100);
  });

  it.each([
    ["(615) 555-0100", "+16155550100"],
    ["1 615 555 0100", "+16155550100"],
    ["+44 7700 900123", "+447700900123"],
    ["0044 7700 900123", "+447700900123"],
  ])("reads %s as %s", (typed, expected) => {
    expect(normalizeSignupPhone(typed)).toBe(expected);
  });

  it("does not guess a country for a number it cannot place", () => {
    const local = normalizeSignupPhone("07700 900123");
    expect(local).toBe("07700900123");
    expect(phoneForMeta(local)).toBeNull();
  });

  it("sends Meta only numbers that carry a country code", () => {
    expect(phoneForMeta("+16155550100")).toBe("+16155550100");
    expect(phoneForMeta(undefined)).toBeNull();
  });

  it("builds the Stripe metadata under heard_about", () => {
    expect(stripeAttributionMetadata({ heardAbout: "instagram" })).toEqual({ heard_about: "instagram" });
    expect(stripeAttributionMetadata({ heardAbout: "other", heardAboutOther: "a podcast" })).toEqual({
      heard_about: "other",
      heard_about_other: "a podcast",
    });
    expect(stripeAttributionMetadata({ phone: "+16155550100" })).toEqual({});
  });

  it("never lets a Stripe failure reach the signup", async () => {
    const update = vi.fn().mockRejectedValue(new Error("stripe down"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(
      stampStripeCustomer({ customers: { update } }, "cus_1", { heardAbout: "youtube" }),
    ).resolves.toBeUndefined();
    expect(update).toHaveBeenCalledWith("cus_1", { metadata: { heard_about: "youtube" } });
  });

  it("does not call Stripe when there is no answer", async () => {
    const update = vi.fn();
    await stampStripeCustomer({ customers: { update } }, "cus_1", {});
    expect(update).not.toHaveBeenCalled();
  });
});

describe("signup attribution: wiring", () => {
  it.each(["signup-payment-intent", "signup-payment-intent-v2"])(
    "%s stamps the customer without changing the idempotent create call",
    (slug) => {
      const source = read(`supabase/functions/${slug}/index.ts`);
      const create = source.slice(source.indexOf("stripe.customers.create("), source.indexOf("signup-cus-"));
      expect(create).not.toContain("heard_about");
      expect(source).toContain("await stampStripeCustomer(stripe, stripeCustomerId");
    },
  );

  it("keeps the phone off the public tenant row", () => {
    const source = read("supabase/functions/signup-provision/index.ts");
    expect(source).not.toMatch(/contact_phone:\s*meta\.phone/);
    expect(source).toContain("phone: body.businessPhone ?? phoneForMeta(meta.phone)");
  });

  it("locks the table to the service role", () => {
    const sql = read("supabase/migrations/20261118120000_add_signup_attribution.sql");
    expect(sql).toContain("ENABLE ROW LEVEL SECURITY");
    expect(sql).toContain("REVOKE ALL ON public.signup_attribution FROM anon, authenticated");
    expect(sql).not.toMatch(/CREATE POLICY/i);
  });
});
