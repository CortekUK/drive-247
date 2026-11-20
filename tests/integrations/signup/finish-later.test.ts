import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  buildFinishLaterEmail,
  buildFinishLaterLink,
  checkFinishLaterToken,
  FINISH_LATER_MAX_REDEMPTIONS,
  FINISH_LATER_SUBJECT,
  FINISH_LATER_TTL_MS,
  finishLaterCode,
  finishLaterExpiry,
  finishLaterSignupState,
  hashFinishLaterToken,
  isFinishLaterTokenShape,
  mintFinishLaterToken,
} from "../../../supabase/functions/_shared/signup-finish-later";
import {
  FLEET_SIZE_VALUES,
  readSignupAttribution,
  stripeAttributionMetadata,
} from "../../../supabase/functions/_shared/signup-attribution";
import { FLEET_SIZE_OPTIONS } from "../../../apps/web/src/lib/fleet-size";

const repo = resolve(__dirname, "../../..");
const read = (rel: string) => readFileSync(join(repo, rel), "utf8");

const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date("2026-11-20T12:00:00Z");

describe("finish later: the token", () => {
  it("is 32 random bytes, URL-safe, and never the same twice", () => {
    const a = mintFinishLaterToken();
    const b = mintFinishLaterToken();
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(isFinishLaterTokenShape(a)).toBe(true);
    expect(a).not.toBe(b);
  });

  it("refuses anything the mint could not have produced", () => {
    expect(isFinishLaterTokenShape("short")).toBe(false);
    expect(isFinishLaterTokenShape(`${"a".repeat(42)}=`)).toBe(false);
    expect(isFinishLaterTokenShape(null)).toBe(false);
  });

  it("is stored as its SHA-256, which is stable and not the token", async () => {
    const token = mintFinishLaterToken();
    const hash = await hashFinishLaterToken(token);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).toBe(await hashFinishLaterToken(token));
    expect(hash).not.toContain(token);
    // A known vector, so the hash cannot silently change algorithm.
    expect(await hashFinishLaterToken("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });
});

describe("finish later: how long a link works", () => {
  const row = (extra: Record<string, unknown> = {}) => ({
    auth_user_id: "user-1",
    expires_at: finishLaterExpiry(NOW),
    used_count: 0,
    revoked_at: null,
    ...extra,
  });

  it("lasts 7 days", () => {
    expect(FINISH_LATER_TTL_MS).toBe(7 * DAY);
    expect(Date.parse(finishLaterExpiry(NOW)) - NOW.getTime()).toBe(7 * DAY);
  });

  it("works on day 6 and stops at 7 days", () => {
    expect(checkFinishLaterToken(row(), new Date(NOW.getTime() + 6 * DAY))).toEqual({ ok: true });
    expect(checkFinishLaterToken(row(), new Date(NOW.getTime() + 7 * DAY))).toEqual({ ok: false, reason: "expired" });
  });

  it("refuses an unknown, revoked or used-up link", () => {
    expect(checkFinishLaterToken(null, NOW)).toEqual({ ok: false, reason: "not_found" });
    expect(checkFinishLaterToken(row({ revoked_at: NOW.toISOString() }), NOW)).toEqual({ ok: false, reason: "revoked" });
    expect(checkFinishLaterToken(row({ used_count: FINISH_LATER_MAX_REDEMPTIONS }), NOW)).toEqual({
      ok: false,
      reason: "used_up",
    });
    expect(checkFinishLaterToken(row({ expires_at: "not a date" }), NOW)).toEqual({ ok: false, reason: "expired" });
  });

  it("survives being opened more than once (a mail preview, the phone first)", () => {
    expect(checkFinishLaterToken(row({ used_count: 2 }), NOW)).toEqual({ ok: true });
  });

  it("never signs in an account whose portal is built", () => {
    expect(finishLaterSignupState({ status: "payment_pending" })).toBe("open");
    expect(finishLaterSignupState({ status: "paid" })).toBe("open");
    expect(finishLaterSignupState({ status: "provisioned" })).toBe("provisioned");
    expect(finishLaterSignupState({ status: "provisioning" })).toBe("provisioned");
    expect(finishLaterSignupState({ status: "paid", tenantId: "t-1" })).toBe("provisioned");
    expect(finishLaterSignupState(null)).toBe("missing");
  });
});

describe("finish later: the link and the email", () => {
  it("opens the card step with the exit offer's code", () => {
    const url = new URL(buildFinishLaterLink("tok_123"));
    expect(url.origin).toBe("https://www.drive-247.com");
    expect(url.searchParams.get("signup")).toBe("finish");
    expect(url.searchParams.get("t")).toBe("tok_123");
    expect(url.searchParams.get("code")).toBe("WELCOME20");
  });

  it("carries no other code", () => {
    expect(new URL(buildFinishLaterLink("tok", "FREEMONTH")).searchParams.has("code")).toBe(false);
    expect(new URL(buildFinishLaterLink("tok", null)).searchParams.has("code")).toBe(false);
    expect(finishLaterCode("welcome20")).toBe("WELCOME20");
    expect(finishLaterCode("FREEMONTH")).toBeNull();
    expect(finishLaterCode(undefined)).toBeNull();
  });

  it("has the owner's subject, the link and the offer that is really applied", () => {
    const link = buildFinishLaterLink("tok_abc");
    const email = buildFinishLaterEmail({
      fullName: "Jordan <Miller>",
      link,
      offer: { discountText: "20% off", durationText: "for your first 3 months" },
    });
    expect(email.subject).toBe("Finish setting up your Drive247 account");
    expect(FINISH_LATER_SUBJECT).toBe(email.subject);
    expect(email.html).toContain("Hi Jordan,");
    expect(email.html).toContain(link.replace(/&/g, "&amp;"));
    expect(email.html).toContain("20% off for your first 3 months is already applied.");
    expect(email.html).toContain("7 days");
    expect(email.html).not.toContain("<Miller>");
  });

  it("promises no discount when the code is not live", () => {
    const email = buildFinishLaterEmail({ fullName: "", link: buildFinishLaterLink("tok", null), offer: null });
    expect(email.html).not.toContain("is already applied");
    expect(email.html).toContain("Hi,");
  });
});

describe("fleet size: the server", () => {
  it("accepts the same three answers as the form", () => {
    expect(FLEET_SIZE_OPTIONS.map((o) => o.value)).toEqual([...FLEET_SIZE_VALUES]);
  });

  it("keeps a valid answer and drops anything else, without refusing the signup", () => {
    expect(readSignupAttribution({ heardAbout: "youtube", fleetSize: "6-20" })).toEqual({
      heardAbout: "youtube",
      fleetSize: "6-20",
    });
    expect(readSignupAttribution({ heardAbout: "youtube", fleetSize: "50" })).toEqual({ heardAbout: "youtube" });
  });

  it("puts fleet_size on the Stripe customer, with or without heard_about", () => {
    expect(stripeAttributionMetadata({ heardAbout: "instagram", fleetSize: "21+" })).toEqual({
      heard_about: "instagram",
      fleet_size: "21+",
    });
    expect(stripeAttributionMetadata({ fleetSize: "1-5" })).toEqual({ fleet_size: "1-5" });
  });
});

describe("finish later and fleet size: wiring", () => {
  it("locks the token table to the service role and stores only hashes", () => {
    const sql = read("supabase/migrations/20261120120000_signup_fleet_size_and_finish_later.sql");
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS public.signup_finish_later_tokens");
    expect(sql).toContain("ALTER TABLE public.signup_finish_later_tokens ENABLE ROW LEVEL SECURITY");
    expect(sql).toContain("REVOKE ALL ON public.signup_finish_later_tokens FROM anon, authenticated");
    expect(sql).not.toMatch(/CREATE POLICY/i);
    expect(sql).not.toMatch(/\btoken\s+text/);
    expect(sql).toContain("ADD COLUMN IF NOT EXISTS fleet_size text");
    expect(sql).toContain("ADD COLUMN IF NOT EXISTS exit_offer_seen_at timestamptz");
  });

  it("keeps every column admin_onboarding_calls() already returned, in order", () => {
    const before = read("supabase/migrations/20261119120000_onboarding_call_journey.sql");
    const after = read("supabase/migrations/20261120120000_signup_fleet_size_and_finish_later.sql");
    const columns = (sql: string) =>
      sql
        .slice(sql.indexOf("RETURNS TABLE ("), sql.indexOf(") LANGUAGE plpgsql"))
        .replace("RETURNS TABLE (", "")
        .split(",")
        .map((c) => c.trim().split(/\s+/)[0]);
    const old = columns(before);
    expect(columns(after).slice(0, old.length)).toEqual(old);
    expect(columns(after).slice(old.length)).toEqual(["fleet_size", "exit_offer_seen_at"]);
  });

  it("sends the email from support@ and lets the link be opened without a session", () => {
    const source = read("supabase/functions/signup-finish-later/index.ts");
    expect(source).toContain("...DRIVE247_SENDER");
    expect(source).toContain("hashFinishLaterToken(token)");
    expect(read("supabase/config.toml")).toMatch(/\[functions\.signup-finish-later\]\r?\nverify_jwt = false/);
  });

  it("writes the fleet size to the tenant in a write of its own", () => {
    const source = read("supabase/functions/signup-provision/index.ts");
    expect(source).toContain(".update({ fleet_size: meta.fleetSize })");
  });
});
