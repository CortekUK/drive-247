import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  CITY_STATE_MAX,
  HEARD_ABOUT_VALUES,
  normalizeCityState,
  normalizeSignupPhone,
  phoneForMeta,
  readSignupAttribution,
  saveSignupAttribution,
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
  // "How did you hear about us?" is optional (2026-11-23). The phone number is
  // required (2026-11-24): a 21+ car lead left it blank and could not be called.
  it("leaves the question optional and requires only the phone", () => {
    expect(validateAttribution(EMPTY_ATTRIBUTION)).toEqual({ phone: "Please enter your phone number." });
    expect(validateAttribution({ ...EMPTY_ATTRIBUTION, phone: "(615) 555-0100" })).toEqual({});
    expect(attributionFromDraft(EMPTY_ATTRIBUTION)).toBeNull();
  });

  it("takes 'Other' without saying what it was", () => {
    const draft = { ...EMPTY_ATTRIBUTION, heardAbout: "other" as const, heardAboutOther: "  ", phone: "(615) 555-0100" };
    expect(validateAttribution(draft)).toEqual({});
    expect(attributionFromDraft(draft)).toEqual({ heardAbout: "other", phone: "(615) 555-0100" });
  });

  it("sends a phone on its own when the question is skipped", () => {
    expect(attributionFromDraft({ ...EMPTY_ATTRIBUTION, phone: "(615) 555-0100" })).toEqual({
      phone: "(615) 555-0100",
    });
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

describe("city and state: the server", () => {
  it("keeps it tidy: one line, single spaces, capped", () => {
    expect(readSignupAttribution({ cityState: "  Houston,\n  TX " })).toEqual({ cityState: "Houston, TX" });
    expect(normalizeCityState("x".repeat(500))).toHaveLength(CITY_STATE_MAX);
    expect(CITY_STATE_MAX).toBe(80);
  });

  it("drops what is not a place, without refusing the signup", () => {
    expect(readSignupAttribution({ cityState: " x " })).toEqual({});
    expect(readSignupAttribution({ cityState: 42 })).toEqual({});
  });

  it("travels with the answers and goes on the Stripe customer as city_state", () => {
    expect(readSignupAttribution({ heardAbout: "instagram", fleetSize: "6-20", cityState: "Miami, FL" })).toEqual({
      heardAbout: "instagram",
      fleetSize: "6-20",
      cityState: "Miami, FL",
    });
    expect(stripeAttributionMetadata({ heardAbout: "instagram", cityState: "Miami, FL" })).toEqual({
      heard_about: "instagram",
      city_state: "Miami, FL",
    });
  });

  /** A signup_attribution table that refuses the columns a pending migration adds. */
  const table = (missing: string[]) => {
    const writes: Record<string, unknown>[] = [];
    const supabase = {
      from: () => ({
        upsert: async (row: Record<string, unknown>) => {
          writes.push(row);
          const absent = missing.find((c) => c in row);
          return absent
            ? { error: { code: "PGRST204", message: `Could not find the '${absent}' column of 'signup_attribution'` } }
            : { error: null };
        },
      }),
    };
    return { supabase, writes };
  };

  it("is saved to signup_attribution.city_state", async () => {
    const { supabase, writes } = table([]);
    await saveSignupAttribution(supabase, {
      authUserId: "u1",
      email: "a@b.test",
      attribution: { heardAbout: "youtube", fleetSize: "1-5", cityState: "Austin, TX" },
    });
    expect(writes).toHaveLength(1);
    expect(writes[0]).toMatchObject({ heard_about: "youtube", fleet_size: "1-5", city_state: "Austin, TX" });
  });

  it("is saved on its own (the Google path) without touching the heard-about answer", async () => {
    const { supabase, writes } = table([]);
    await saveSignupAttribution(supabase, { authUserId: "u1", email: "a@b.test", attribution: { cityState: "Austin, TX" } });
    expect(writes[0]).toMatchObject({ auth_user_id: "u1", city_state: "Austin, TX" });
    expect(writes[0]).not.toHaveProperty("heard_about");
  });

  it("before the migration, the other answers are still saved", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const { supabase, writes } = table(["city_state"]);
    await saveSignupAttribution(supabase, {
      authUserId: "u1",
      email: "a@b.test",
      attribution: { heardAbout: "youtube", fleetSize: "1-5", cityState: "Austin, TX" },
    });
    expect(writes).toHaveLength(2);
    expect(writes[1]).toMatchObject({ heard_about: "youtube", fleet_size: "1-5" });
    expect(writes[1]).not.toHaveProperty("city_state");

    const older = table(["city_state", "fleet_size"]);
    await saveSignupAttribution(older.supabase, {
      authUserId: "u1",
      email: "a@b.test",
      attribution: { heardAbout: "youtube", fleetSize: "1-5", cityState: "Austin, TX" },
    });
    expect(older.writes).toHaveLength(3);
    expect(older.writes[2]).toMatchObject({ heard_about: "youtube" });
    expect(older.writes[2]).not.toHaveProperty("fleet_size");
  });
});

describe("city and state: wiring", () => {
  it("signup-attribution takes it on its own and never blanks the earlier answer", () => {
    const source = read("supabase/functions/signup-attribution/index.ts");
    expect(source).toContain("if (!attribution.heardAbout && !attribution.cityState)");
    expect(source).toMatch(/\.\.\.\(attribution\.heardAbout\s*\?\s*\{ heardAbout: attribution\.heardAbout/);
    expect(source).toContain("...(attribution.cityState ? { cityState: attribution.cityState } : {})");
  });

  it("is never written as the tenant's address", () => {
    const provision = read("supabase/functions/signup-provision/index.ts");
    expect(provision).not.toMatch(/cityState|city_state/);
    expect(provision).toContain("address: location,");
  });

  it("is in the Onboarding calls list, appended at the end, behind the super-admin guard", () => {
    const sql = read("supabase/migrations/20261121090000_signup_company_city.sql");
    expect(sql).toContain("ADD COLUMN IF NOT EXISTS city_state text");
    expect(sql).toMatch(/fleet_size text, exit_offer_seen_at timestamptz,\s*city_state text\s*\)/);
    expect(sql).toContain("IF NOT public.is_super_admin() THEN");
    expect(sql).toContain("REVOKE ALL ON FUNCTION public.admin_onboarding_calls() FROM PUBLIC, anon;");
    expect(sql).toContain("GRANT EXECUTE ON FUNCTION public.admin_onboarding_calls() TO authenticated;");
    expect(sql).not.toMatch(/ALTER TABLE public\.tenants/);
  });

  it("is shown in the admin Onboarding calls tab and Bryan's booking notice", () => {
    const tab = read("apps/admin/components/admin/customer-management/onboarding-calls-tab.tsx");
    expect(tab).toContain("city_state?: string | null;");
    expect(tab).toContain("{r.city_state && `${r.city_state} · `}");
    const booked = read("supabase/functions/onboarding-call-booked/index.ts");
    expect(booked).toContain("cityState: signup?.city_state,");
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
