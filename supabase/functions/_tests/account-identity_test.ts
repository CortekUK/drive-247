// feat-001 spec 07 — the Google connect / disconnect decisions.
//   deno test supabase/functions/_tests/account-identity_test.ts
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { decide, sameEmail, type IdentityState } from "../_shared/account-identity-rules.ts";

const base: IdentityState = { accountEmail: "Ann@Shop.com", hasPassword: true, googles: [], googleEmailOwnedByOther: false };
const g = (email: string | null, id = "g1") => ({ id, email });

Deno.test("status: password and Google shown (07.1)", () => {
  const d = decide("status", { ...base, googles: [g("ann@shop.com")] });
  assertEquals(d.ok && d.body, { password: true, google: "ann@shop.com" });
  const none = decide("status", { ...base, hasPassword: false });
  assertEquals(none.ok && none.body, { password: false, google: null });
});

Deno.test("emails compare lowercase and trimmed (07.3)", () => {
  assertEquals(sameEmail(" ANN@shop.com ", "ann@SHOP.com"), true);
  assertEquals(sameEmail("ann@shop.com", "anne@shop.com"), false);
  assertEquals(sameEmail(null, "ann@shop.com"), false);
  assertEquals(sameEmail("", ""), false);
});

Deno.test("check_google: same email is kept (07.3)", () => {
  const d = decide("check_google", { ...base, googles: [g(" ANN@shop.com")] });
  assertEquals(d.ok, true);
  assertEquals(d.removeIdentityIds, []);
});

Deno.test("check_google: a different email is removed at once (07.4)", () => {
  const d = decide("check_google", { ...base, googles: [g("bob@gmail.com", "x")] });
  assertEquals(d.ok, false);
  assertEquals(!d.ok && d.code, "GOOGLE_EMAIL_MISMATCH");
  assertEquals(!d.ok && d.error, "This Google account uses a different email from your Drive247 account.");
  assertEquals(d.removeIdentityIds, ["x"]);
});

Deno.test("check_google: a Google identity with no email counts as different (07.4)", () => {
  const d = decide("check_google", { ...base, googles: [g(null, "n")] });
  assertEquals(!d.ok && d.code, "GOOGLE_EMAIL_MISMATCH");
  assertEquals(d.removeIdentityIds, ["n"]);
});

Deno.test("check_google: only the wrong one of two is removed", () => {
  const d = decide("check_google", { ...base, googles: [g("ann@shop.com", "ok"), g("bob@gmail.com", "bad")] });
  assertEquals(d.removeIdentityIds, ["bad"]);
});

Deno.test("check_google: owned by another account is refused, nothing removed (07.5)", () => {
  const d = decide("check_google", { ...base, googleEmailOwnedByOther: true, googles: [g("bob@gmail.com")] });
  assertEquals(!d.ok && d.code, "IDENTITY_IN_USE");
  assertEquals(d.removeIdentityIds, []);
});

Deno.test("check_google: nothing linked is fine", () => {
  const d = decide("check_google", base);
  assertEquals(d.ok && d.body, { google: null });
});

Deno.test("unlink: no password is refused and nothing removed (07.6)", () => {
  const d = decide("unlink_google", { ...base, hasPassword: false, googles: [g("ann@shop.com")] });
  assertEquals(!d.ok && d.code, "NO_PASSWORD");
  assertEquals(!d.ok && d.error, "Set a password first.");
  assertEquals(d.removeIdentityIds, []);
});

Deno.test("unlink: with a password, every Google identity goes (07.7)", () => {
  const d = decide("unlink_google", { ...base, googles: [g("ann@shop.com", "a"), g("ann@shop.com", "b")] });
  assertEquals(d.ok, true);
  assertEquals(d.removeIdentityIds, ["a", "b"]);
});

Deno.test("unlink: nothing linked removes nothing (07.8)", () => {
  const d = decide("unlink_google", base);
  assertEquals(!d.ok && d.code, "NOT_LINKED");
  assertEquals(d.removeIdentityIds, []);
});

Deno.test("email changed: Google goes when there is a password (07.9)", () => {
  const d = decide("email_changed", { ...base, googles: [g("ann@shop.com", "a")] });
  assertEquals(d.ok && d.body, { googleRemoved: true });
  assertEquals(d.removeIdentityIds, ["a"]);
});

Deno.test("email changed: refused with Google and no password (07.9)", () => {
  const d = decide("email_changed", { ...base, hasPassword: false, googles: [g("ann@shop.com")] });
  assertEquals(!d.ok && d.code, "NO_PASSWORD");
  assertEquals(d.removeIdentityIds, []);
});

Deno.test("email changed: nothing linked is fine", () => {
  const d = decide("email_changed", { ...base, hasPassword: false });
  assertEquals(d.ok && d.body, { googleRemoved: false });
});

Deno.test("unknown action", () => {
  assertEquals(!decide("drop_tables", base).ok, true);
});
