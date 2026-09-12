// =============================================================================
// integrations/stripe — SECURITY DEPOSIT HOLDS: the number, and who agrees on it.
//
// WHAT THIS FILE COVERS
//
// One question, asked of every screen and every function that answers it:
// "how much deposit is on this rental, and is that the amount actually
// ringfenced on the renter's card?"  Eight places answer it and they do not all
// agree, which is the whole subject here:
//
//   AUTHORISES MONEY        _shared/deposit-amount.ts       (the canonical resolver)
//                           place-deposit-hold              (a second, drifted COPY)
//                           create-hold-checkout            (calls the canonical one)
//   CAPTURES MONEY          capture-deposit-hold            (hold -> revenue)
//                           capture-booking-payment         (booking auth -> revenue)
//   QUOTES / SIGNS IT       create-boldsign-document, apps/booking/.../api/esign,
//                           BookingCheckoutStep, booking/checkout/page,
//                           portal rentals-v2/rental-create-v2
//   UNWINDS IT              stripe-webhook-live / -test, `charge.refunded`
//
// LAYERS, AND WHY EACH ONE
//
//   LAYER 3 (executable). `supabase/functions/_shared/deposit-amount.ts` has no
//     `https://` import, so the `@fn` alias in tests/vitest.config.ts resolves it
//     and vitest runs the REAL shipped resolver against a hand-built fake
//     supabase client. Verified by running it, not assumed. Every other module
//     in this family imports Stripe from esm.sh and cannot load under Node, so
//     everything about them is Layer 1. The arithmetic cases are also Layer 3:
//     the expressions are typed out of source by hand and evaluated here, with
//     the working in a comment (rule 7 — no figure is ever copied out of program
//     output, which would assert only self-consistency).
//
//   LAYER 1 (source text, offline, always runs). The twelve other files are read
//     as text with comments blanked, so prose can never satisfy an assertion.
//     Several cases assert the ORDER of two markers rather than their presence:
//     a guard below the Stripe call is not a guard, it is a log line written
//     after the money moved.
//
//   LAYER 2 — none. Nothing here calls anything. Production
//     (hviqoaokxvlancmftwuo) is never touched, read or named as a target.
//
// WHAT THIS FILE DELIBERATELY DOES NOT COVER
//
//   * The refresh/expiry engine (refresh-deposit-holds, sync-deposit-hold) and
//     the rollover-currency question — `charge-capture.test.ts` owns those.
//   * The step-6 `capture_status` swallow in capture-booking-payment — already
//     pinned at charge-capture.test.ts:731 with its watchdog at :751. This file
//     takes the NEXT step, the rental-status write at index.ts:256-258, which
//     nothing covers.
//   * `unit_amount: Math.round(depositAmount * 100)` as a *rounding* rule —
//     checkout-health.test.ts:868-886 asserts that as correct. What is asserted
//     here is the different claim that the hundred is hardcoded, which is a
//     currency bug on the two sites that AUTHORISE a hold.
//   * Refund arithmetic and FIFO allocation (refund*.test.ts, partial-payment).
//   * Layer 2 liveness of any of it.
//
// NON-OBVIOUS MECHANISMS A LATER READER WILL TRIP ON
//
//   1. PER_VEHICLE_DEPOSIT_TENANT_IDS is CURRENTLY INERT. deposit-amount.ts:26-30
//      records that GMT moved to deposit_mode='global' on 2026-08-25, so the set
//      matches no tenant's mode today and every hold falls through to the tenant
//      global. That does not narrow the divergence below, it widens it: the five
//      quoting screens have no allowlist at all, so any tenant still on
//      'per_vehicle' is quoted the vehicle figure and held the tenant one.
//   2. There are TWO copies of that allowlist. place-deposit-hold/index.ts:387-391
//      says so in a comment and asks the next maintainer to keep them in step.
//      They are already out of step — see the Number.isFinite block below.
//   3. The zero-deposit skip is spelled differently in the two hold paths:
//      place-deposit-hold/index.ts:414 returns the human string
//      `message: "Deposit amount is 0"`; create-hold-checkout/index.ts:266
//      returns the machine code `skipped: 'deposit_amount_is_zero'`. Grepping
//      for one finds only half the behaviour.
//   4. KNOWN DEFECTS ARE NEVER ASSERTED AS CORRECT. Where the code is wrong this
//      file carries a PAIR: a PIN recording the wrong behaviour so its size is
//      on the record, and an `it.fails(...)` immediately after stating what
//      SHOULD be true. `it.fails` is green while the bug lives and RED the day
//      it is fixed, which drags the fixer back here. Both halves go red together
//      on a fix. Never "repair" a red watchdog by deleting it.
// =============================================================================

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  blankComments,
  FUNCTIONS_DIR,
  readEdgeFunctionSource,
  REPO_ROOT,
} from "../../helpers/edge-contract";
import {
  resolveDepositAmount,
  DEPOSIT_AMOUNT_TENANT_COLUMNS,
  DEPOSIT_AMOUNT_RENTAL_COLUMNS,
  PER_VEHICLE_DEPOSIT_TENANT_IDS,
} from "@fn/_shared/deposit-amount.ts";

// ---------------------------------------------------------------------------
// Readers. All three blank comments before returning, so a sentence in a code
// comment can never be mistaken for the code it describes.
// ---------------------------------------------------------------------------

/** An edge function's `index.ts`, comments blanked, offsets intact. */
function code(fn: string): string {
  return blankComments(readEdgeFunctionSource(fn));
}

/** A `supabase/functions/_shared/*.ts` module, comments blanked. */
function shared(file: string): string {
  return blankComments(readFileSync(join(FUNCTIONS_DIR, "_shared", file), "utf8"));
}

/** Any repo file by repo-relative path (the app-side screens live outside `supabase/`). */
function app(relPath: string): string {
  return blankComments(readFileSync(join(REPO_ROOT, relPath), "utf8"));
}

/** Index of a marker in blanked source, asserted present with a human reason. */
function at(src: string, marker: string, why: string): number {
  const i = src.indexOf(marker);
  expect(i, `Marker \`${marker}\` is gone. ${why}`).toBeGreaterThan(-1);
  return i;
}

/** The text between two markers, both asserted present. */
function between(src: string, from: string, to: string, why: string): string {
  const a = at(src, from, why);
  const b = src.indexOf(to, a);
  expect(b, `Marker \`${to}\` no longer follows \`${from}\`. ${why}`).toBeGreaterThan(a);
  return src.slice(a, b);
}

/** Standard note on a pin, so a fixer knows a red pin is expected and what to do. */
function pinNote(then: string): string {
  return `PIN of today's (wrong) behaviour. If this is red the behaviour changed — ${then}`;
}

// ---------------------------------------------------------------------------
// The fake supabase client the Layer 3 cases hand to the real resolver.
//
// resolveDepositAmount only ever does `.from("vehicles").select(...).eq(...)
// .maybeSingle()` (deposit-amount.ts:116-120), so this is the whole surface.
// It records whether the vehicle was consulted at all, which is the observable
// that separates "fell through to the tenant global" from "read the vehicle".
// ---------------------------------------------------------------------------
function fakeSupabase(vehicle: { security_deposit: number | null } | null) {
  const seen: string[] = [];
  const client = {
    from(table: string) {
      seen.push(table);
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: vehicle, error: null }),
          }),
        }),
      };
    },
  };
  return { client, tablesRead: seen };
}

/** A tenant id that is real-shaped but deliberately NOT in the allowlist. */
const NON_ALLOWLISTED_TENANT = "11111111-2222-3333-4444-555555555555";
/** The single id the allowlist carries (deposit-amount.ts:41). */
const GMT_TENANT = "ada84c6f-eb17-43b6-a14d-d16518165349";

/**
 * The rule the five QUOTING screens apply, transcribed by hand from
 * apps/booking/src/components/BookingCheckoutStep.tsx:271-282.
 *
 * Transcribed, not imported: those files are React/Next modules with JSX and
 * app-local aliases that this node-environment suite cannot load. The pin
 * directly below the watchdog that uses this asserts the source still has this
 * exact shape, so the transcription cannot silently rot.
 */
function quotedByTheScreens(args: {
  securityDepositEnabled?: boolean;
  depositChargeEnabled?: boolean;
  depositMode?: string | null;
  vehicleSecurityDeposit: number;
  globalDepositAmount: number;
}): number {
  if (args.securityDepositEnabled === false) return 0;
  if (args.depositChargeEnabled !== true && args.depositMode === "per_vehicle") {
    return args.vehicleSecurityDeposit;
  }
  return args.globalDepositAmount;
}

/**
 * The five places a deposit figure is shown to, or signed by, a renter — none
 * of which consults PER_VEHICLE_DEPOSIT_TENANT_IDS.
 *
 * `marker` is the per-vehicle branch as it is written in that file. Note the
 * fourth: booking/checkout/page.tsx:295-297 is inverted — it tests for
 * 'global' and lets per-vehicle be the FALLBACK — so its marker is the global
 * test plus the vehicle fallback it drops through to.
 */
const QUOTE_SITES: ReadonlyArray<{ label: string; path: string; markers: string[] }> = [
  {
    label: "create-boldsign-document (the signed agreement, portal side)",
    path: "supabase/functions/create-boldsign-document/index.ts",
    markers: ["(tenant as any)?.deposit_mode === 'per_vehicle'", "(vehicle as any)?.security_deposit ?? 0"],
  },
  {
    label: "apps/booking api/esign (the signed agreement, booking side)",
    path: "apps/booking/src/app/api/esign/route.ts",
    markers: ["(tenant as any)?.deposit_mode === 'per_vehicle'", "(vehicle as any)?.security_deposit ?? 0"],
  },
  {
    label: "BookingCheckoutStep (the deposit the renter is quoted)",
    path: "apps/booking/src/components/BookingCheckoutStep.tsx",
    markers: ["tenant?.deposit_mode === 'per_vehicle'", "selectedVehicle?.security_deposit ?? 0"],
  },
  {
    label: "booking/checkout/page (the totals the renter pays from)",
    path: "apps/booking/src/app/booking/checkout/page.tsx",
    markers: ["tenant?.deposit_mode === 'global'", "vehicleDetails?.security_deposit || 0"],
  },
  {
    label: "portal rentals-v2/rental-create-v2 (the operator's new-rental prefill)",
    path: "apps/portal/src/components/rentals-v2/rental-create-v2.tsx",
    markers: ["rentalSettings?.deposit_mode === 'per_vehicle'", "(vehicle as any)?.security_deposit ?? 0"],
  },
];

// ===========================================================================
// The resolver gates per-vehicle deposits behind a tenant allowlist. The five
// screens that quote the same deposit — two of which write it into a signed
// agreement — do not. So for a `per_vehicle` tenant outside the allowlist the
// renter is quoted one number and a different one is authorised, or none at all.
// ===========================================================================

// @usecase A renter signs an agreement naming a deposit that is never ringfenced, because the screens and the money path resolve it by different rules.
describe("stripe/deposit-holds — the quoted deposit and the authorised deposit are resolved by different rules", () => {
  it("today resolves the tenant global for a per_vehicle tenant that is not on the allowlist, whatever the vehicle says", async () => {
    // PIN, Layer 3 — the REAL shipped resolver, executed.
    // deposit-amount.ts:110-114 requires all three of:
    //   deposit_mode === 'per_vehicle'  AND  tenant id in the set  AND  vehicle_id
    // The tenant below satisfies two of the three, so the vehicle's $200 is
    // never even read and the tenant's $100 is what gets authorised.
    const { client, tablesRead } = fakeSupabase({ security_deposit: 200 });
    const resolved = await resolveDepositAmount(client as never, {
      tenantId: NON_ALLOWLISTED_TENANT,
      tenant: { global_deposit_amount: 100, deposit_mode: "per_vehicle" },
      rental: { vehicle_id: "veh-1", deposit_amount_override: null },
    });
    expect(resolved.amount, pinNote("delete this pin and drop `.fails` from the case below.")).toBe(100);
    expect(resolved.source).toBe("tenant_global");
    expect(resolved.baseAmount).toBe(100);
    // Proof it was a fall-through and not a failed lookup: `vehicles` was never queried.
    expect(tablesRead).toEqual([]);
  });

  it("reads the vehicle only for the one allow-listed tenant id, which deposit-amount.ts:26-30 records as inert today", async () => {
    // The other half of the same branch, so the pin above cannot be explained
    // away as "the resolver never reads vehicles". Same inputs, allow-listed id.
    const { client, tablesRead } = fakeSupabase({ security_deposit: 200 });
    const resolved = await resolveDepositAmount(client as never, {
      tenantId: GMT_TENANT,
      tenant: { global_deposit_amount: 100, deposit_mode: "per_vehicle" },
      rental: { vehicle_id: "veh-1", deposit_amount_override: null },
    });
    expect(resolved.amount).toBe(200);
    expect(resolved.source).toBe("vehicle_security_deposit");
    expect(tablesRead).toEqual(["vehicles"]);
    // And the set really does hold exactly one id, which is the whole reason
    // the branch is unreachable in production today.
    expect([...PER_VEHICLE_DEPOSIT_TENANT_IDS]).toEqual([GMT_TENANT]);
  });

  it("today lets all five quoting screens branch on deposit_mode alone, with no tenant allowlist anywhere in them", () => {
    // PIN, Layer 1, across five files. The claim is narrow and checkable: each
    // file still contains its per-vehicle branch, and none of them mentions the
    // allowlist by name or by id. That asymmetry IS the defect.
    for (const site of QUOTE_SITES) {
      const src = app(site.path);
      for (const marker of site.markers) {
        expect(
          src,
          `${site.label}: ${pinNote("re-check whether this screen and the resolver now agree.")}`,
        ).toContain(marker);
      }
      expect(src, `${site.label} now names the allowlist by id`).not.toContain(GMT_TENANT);
      expect(src, `${site.label} now names the allowlist by symbol`).not.toContain(
        "PER_VEHICLE_DEPOSIT_TENANT_IDS",
      );
    }
    // And the resolver, for contrast, gates on exactly that id.
    expect(shared("deposit-amount.ts")).toContain("PER_VEHICLE_DEPOSIT_TENANT_IDS.has(tenantId)");
  });

  it.fails("should quote the renter the same deposit that the hold path will actually authorise", async () => {
    // Remove the .fails marker once supabase/functions/_shared/deposit-amount.ts:110-114
    // and the five screens listed in QUOTE_SITES agree. Either direction of fix
    // makes this green: widen the resolver to honour deposit_mode, or delete the
    // per-vehicle branch from the screens. If the second is chosen, the pin above
    // goes red at the same time and points here.
    //
    // Scenario, hand-built from the figures deposit-amount.ts:8-9 records as the
    // original incident, re-pointed at a tenant OUTSIDE the allowlist:
    //   vehicle security_deposit  $200   <- what five screens show and sign
    //   tenant global_deposit     $100   <- what both hold paths authorise
    //   shortfall                 $100
    const quoted = quotedByTheScreens({
      depositChargeEnabled: false,
      depositMode: "per_vehicle",
      vehicleSecurityDeposit: 200,
      globalDepositAmount: 100,
    });
    expect(quoted).toBe(200); // 200 - 100 = 100 short, by hand.

    const { client } = fakeSupabase({ security_deposit: 200 });
    const held = await resolveDepositAmount(client as never, {
      tenantId: NON_ALLOWLISTED_TENANT,
      tenant: { global_deposit_amount: 100, deposit_mode: "per_vehicle" },
      rental: { vehicle_id: "veh-1", deposit_amount_override: null },
    });
    expect(held.amount, "the signed figure and the authorised figure still disagree").toBe(quoted);
  });

  it.fails("should not sign an agreement naming a deposit when the hold path will ringfence nothing at all", async () => {
    // Remove the .fails marker once supabase/functions/_shared/deposit-amount.ts:110-114
    // and the five screens in QUOTE_SITES agree — in EITHER direction. This case
    // deliberately does not demand that the resolver start honouring
    // deposit_mode: deposit-amount.ts:32-35 calls widening the allowlist "a
    // rollout decision, not a bug fix", because the four tenants still on
    // `per_vehicle` (dbcarrentals, eastpeakrentalsllc, flowrentalsllc,
    // jangramrentals) each run global_deposit_amount = 0. What it demands is
    // that the two numbers stop disagreeing, which dropping the branch from the
    // screens also achieves.
    //
    // For those four tenants the divergence is total, not partial:
    //   quoted / signed   $250 (the vehicle's security_deposit)
    //   authorised          $0 -> both hold paths take their zero-skip and
    //                             NOTHING is ringfenced behind a signed contract.
    const quoted = quotedByTheScreens({
      depositChargeEnabled: false,
      depositMode: "per_vehicle",
      vehicleSecurityDeposit: 250,
      globalDepositAmount: 0,
    });
    expect(quoted).toBe(250);

    const { client } = fakeSupabase({ security_deposit: 250 });
    const held = await resolveDepositAmount(client as never, {
      tenantId: NON_ALLOWLISTED_TENANT,
      tenant: { global_deposit_amount: 0, deposit_mode: "per_vehicle" },
      rental: { vehicle_id: "veh-1", deposit_amount_override: null },
    });
    expect(held.amount, "a zero-global per_vehicle tenant is quoted 250 and holds nothing").toBe(quoted);
  });

  it("pins both zero-skips, which are spelled differently and so cannot be found with one grep", () => {
    // Not a defect — the consequence of the two above, recorded so the shape of
    // "nothing was held" is on the record in both dialects.
    expect(code("place-deposit-hold")).toContain(
      'return jsonResponse({ success: true, skipped: true, message: "Deposit amount is 0" });',
    );
    expect(code("create-hold-checkout")).toContain(
      "return jsonResponse({ skipped: 'deposit_amount_is_zero' })",
    );
    // Both skips are decided BEFORE any Stripe object is built, which is the one
    // genuinely right thing on this path: a $0 authorisation is never attempted.
    const place = code("place-deposit-hold");
    expect(at(place, 'message: "Deposit amount is 0"', "the zero-skip moved")).toBeLessThan(
      at(place, "const amountInCents", "the minor-unit conversion moved"),
    );
  });
});

// ===========================================================================
// The resolver publishes a column list its callers are told to paste verbatim.
// One of the three columns in it is never read by the resolver.
// ===========================================================================

// @usecase A third caller trusts the resolver's own column list to mean "the master switch is handled here", and starts authorising holds on the cards of tenants who turned deposits off.
describe("stripe/deposit-holds — the resolver asks for a column it never reads", () => {
  it("asks every caller to select security_deposit_enabled", () => {
    // deposit-amount.ts:17-18, verbatim. The docstring above it reads
    // "Tenant columns this resolver needs. Add to your `.select()` verbatim."
    expect(DEPOSIT_AMOUNT_TENANT_COLUMNS).toBe(
      "global_deposit_amount, security_deposit_enabled, deposit_mode",
    );
    expect(DEPOSIT_AMOUNT_RENTAL_COLUMNS).toBe("vehicle_id, deposit_amount_override");
  });

  it("today returns a full deposit for a tenant with security_deposit_enabled false, because the body never reads it", async () => {
    // PIN, Layer 3 — executed against the real resolver. The interface at
    // deposit-amount.ts:61-64 declares only global_deposit_amount and
    // deposit_mode, and the body at :100-137 reads only those two, so the third
    // advertised column is inert. $150 comes back with deposits switched OFF.
    const { client } = fakeSupabase(null);
    const resolved = await resolveDepositAmount(client as never, {
      tenantId: NON_ALLOWLISTED_TENANT,
      // Cast: the field is not on DepositAmountTenant at all — which is the point.
      tenant: { global_deposit_amount: 150, security_deposit_enabled: false } as never,
      rental: { vehicle_id: "veh-1", deposit_amount_override: null },
    });
    expect(resolved.amount, pinNote("delete this pin and drop `.fails` from the case below.")).toBe(150);
    expect(resolved.source).toBe("tenant_global");
    // Read as CODE: the identifier appears once, in the exported column string,
    // and nowhere in the function body.
    const src = shared("deposit-amount.ts");
    const occurrences = src.split("security_deposit_enabled").length - 1;
    expect(occurrences, "security_deposit_enabled is now referenced more than once").toBe(1);
  });

  it("is latent rather than live only because both current callers guard separately, ABOVE the call", () => {
    // The reason this is a trap and not an incident today. Both guards sit
    // outside the resolver, so moving or refactoring either one is enough to
    // arm it — and neither guard is visible from inside deposit-amount.ts.
    for (const fn of ["place-deposit-hold", "create-hold-checkout"]) {
      expect(code(fn), `${fn} no longer checks the master switch`).toContain(
        "if (!tenant.security_deposit_enabled) {",
      );
    }
    // In create-hold-checkout the guard must stay ABOVE resolveDepositAmount,
    // or the resolver (which ignores the switch) becomes the only opinion.
    const hold = code("create-hold-checkout");
    expect(
      at(hold, "if (!tenant.security_deposit_enabled) {", "the master-switch guard moved"),
    ).toBeLessThan(at(hold, "await resolveDepositAmount(", "the resolver call moved"));
    // The agreement engine takes the opposite approach and folds the switch INTO
    // its own resolution (create-boldsign-document/index.ts:194-197), which is
    // the shape the watchdog below asks for.
    expect(code("create-boldsign-document")).toContain(
      "const depositsSwitchedOn = (tenant as any)?.security_deposit_enabled !== false;",
    );
  });

  it.fails("should resolve the master switch inside the resolver it is advertised on", () => {
    // Remove the .fails marker once supabase/functions/_shared/deposit-amount.ts:100-137
    // reads security_deposit_enabled, or once :17-18 stops asking callers for a
    // column it ignores. Either fix is fine; both make this green. The danger is
    // a third caller reading the column list as "the switch is handled for me".
    const src = shared("deposit-amount.ts");
    const body = between(
      src,
      "export async function resolveDepositAmount(",
      "return { amount, source, baseAmount, overrideAmount: normalisedOverride };",
      "resolveDepositAmount was renamed or restructured.",
    );
    expect(body, "the resolver body still never mentions the master switch").toContain(
      "security_deposit_enabled",
    );
  });
});

// ===========================================================================
// The two copies of the same resolution have drifted on exactly one input:
// the finite-number guard on the per-rental override.
// ===========================================================================

// @usecase A non-numeric deposit override walks past the zero-skip in place-deposit-hold and reaches Stripe's PaymentIntent create as a NaN amount.
describe("stripe/deposit-holds — the second copy of the resolver dropped its finite-number guard", () => {
  it("normalises a non-finite override away in the canonical resolver, falling back to the tenant default", async () => {
    // Layer 3 — real resolver. Postgres `numeric` admits NaN, and PostgREST
    // delivers that as the JSON string "NaN": Number("NaN") is NaN, which
    // deposit-amount.ts:104-105 filters with Number.isFinite, so the override is
    // treated as unset and the $150 tenant default stands.
    const { client } = fakeSupabase(null);
    const resolved = await resolveDepositAmount(client as never, {
      tenantId: NON_ALLOWLISTED_TENANT,
      tenant: { global_deposit_amount: 150, deposit_mode: "global" },
      rental: { vehicle_id: "veh-1", deposit_amount_override: "NaN" },
    });
    expect(resolved.amount).toBe(150);
    expect(resolved.source).toBe("tenant_global");
    expect(resolved.overrideAmount).toBeNull();
    // The neighbouring inputs, so the guard cannot be mistaken for "numbers only":
    // an explicit 0 is an opt-out and MUST survive (deposit-amount.ts:78-81), and
    // a numeric string is a real override.
    const zero = await resolveDepositAmount(fakeSupabase(null).client as never, {
      tenantId: NON_ALLOWLISTED_TENANT,
      tenant: { global_deposit_amount: 150, deposit_mode: "global" },
      rental: { vehicle_id: "veh-1", deposit_amount_override: 0 },
    });
    expect(zero.amount).toBe(0);
    expect(zero.source).toBe("rental_override");
    const str = await resolveDepositAmount(fakeSupabase(null).client as never, {
      tenantId: NON_ALLOWLISTED_TENANT,
      tenant: { global_deposit_amount: 150, deposit_mode: "global" },
      rental: { vehicle_id: "veh-1", deposit_amount_override: "275.50" },
    });
    expect(str.amount).toBe(275.5);
    expect(str.source).toBe("rental_override");
  });

  it("today omits that guard in place-deposit-hold's own copy, which announces itself as a copy", () => {
    // PIN, Layer 1. The copy is three lines where the canonical is five: the
    // Number.isFinite line is simply absent (index.ts:360-362), and the file
    // says at :387-388 that it is a duplicate to be kept in step.
    const src = code("place-deposit-hold");
    expect(
      src,
      pinNote("delete this pin and drop `.fails` from the case below."),
    ).toContain(
      "const overrideAmount = rental.deposit_amount_override !== null && rental.deposit_amount_override !== undefined",
    );
    expect(src, "place-deposit-hold's copy now guards finiteness").not.toContain("Number.isFinite");
    expect(shared("deposit-amount.ts"), "the canonical guard is gone").toContain("Number.isFinite(overrideAmount)");
    // The copy really is a copy: the same allowlist is declared a second time.
    expect(src).toContain("const PER_VEHICLE_DEPOSIT_TENANT_IDS = new Set([");
    expect(src).toContain(GMT_TENANT);
  });

  it("today lets a NaN override walk through the zero-skip and reach the PaymentIntent, by hand", () => {
    // PIN of the consequence, Layer 3 — the three expressions transcribed from
    // place-deposit-hold/index.ts:361, :413 and :498, evaluated here:
    //
    //   Number("NaN")          -> NaN            (index.ts:361, no finiteness filter)
    //   NaN <= 0               -> false          (index.ts:413, the zero-skip is a no-op)
    //   Math.round(NaN * 100)  -> NaN            (index.ts:498 -> :577 `amount: amountInCents`)
    //
    // For contrast, the same three on a real $150 override: 150, false, 15000.
    const nanOverride = Number("NaN");
    expect(Number.isNaN(nanOverride)).toBe(true);
    expect(nanOverride <= 0).toBe(false); // the skip at :413 does not fire
    expect(Number.isNaN(Math.round(nanOverride * 100))).toBe(true); // 150 * 100 = 15000 for a real one
    expect(Math.round(150 * 100)).toBe(15000);
    // And the source really does chain those three, in that order.
    const src = code("place-deposit-hold");
    const numberCall = at(src, "? Number(rental.deposit_amount_override)", "the override coercion moved");
    const zeroSkip = at(src, "if (depositAmount <= 0) {", "the zero-skip moved");
    const cents = at(src, "const amountInCents = Math.round(depositAmount * 100);", "the conversion moved");
    const intentAmount = at(src, "amount: amountInCents,", "the PaymentIntent amount field moved");
    expect(numberCall).toBeLessThan(zeroSkip);
    expect(zeroSkip).toBeLessThan(cents);
    expect(cents).toBeLessThan(intentAmount);
  });

  it.fails("should apply the same finite-number guard in both copies of the deposit resolution", () => {
    // Remove the .fails marker once supabase/functions/place-deposit-hold/index.ts:360-362
    // is fixed — either by adding the Number.isFinite line the canonical resolver
    // has at deposit-amount.ts:104-105, or better, by deleting the copy and
    // calling resolveDepositAmount the way create-hold-checkout already does.
    const src = code("place-deposit-hold");
    expect(
      src,
      "place-deposit-hold still coerces the override with a bare Number() and no finiteness check",
    ).toMatch(/Number\.isFinite|resolveDepositAmount\(/);
  });
});

// ===========================================================================
// capture-deposit-hold: the money is taken at Stripe, then three record-keeping
// writes are attempted, and all three failures are console.error only.
// ===========================================================================

// @usecase The renter's card is debited, the operator is told "captured", and payments / ledger_entries / payment_applications hold nothing — so the deposit still reads as outstanding and the obvious next move is to capture again.
describe("stripe/deposit-holds — a deposit capture that could not be recorded still answers success", () => {
  it("today handles all three record-keeping failures with a console.error and no return", () => {
    // PIN, Layer 1. Read as CODE, not as an admission in a comment: the whole
    // stretch from the payments insert (index.ts:284) to the single success exit
    // (:514) contains the three error logs and NOT ONE early exit.
    const src = code("capture-deposit-hold");
    const recordKeeping = between(
      src,
      '.from("payments")',
      "return jsonResponse({",
      "capture-deposit-hold's record-keeping block or its success exit has moved.",
    );
    for (const log of [
      '[DEPOSIT-CAPTURE] Failed to create payment:',
      '[DEPOSIT-CAPTURE] Failed to create ledger charge:',
      '[DEPOSIT-CAPTURE] Failed to create payment_application:',
    ]) {
      expect(recordKeeping, `${log} is gone`).toContain(log);
    }
    expect(
      recordKeeping,
      pinNote("delete this pin and drop `.fails` from the case below."),
    ).not.toMatch(/return\s+errorResponse|success:\s*false/);
    // And the exit really is unqualified success, with no "recorded" caveat.
    const exit = src.slice(at(src, "return jsonResponse({", "the success exit moved"));
    expect(exit).toContain("success: true,");
    expect(exit).toContain("capturedAmount: amount,");
  });

  it("keeps the money-moved half honest, which is why the answer cannot simply become a 500", () => {
    // Context that stops the watchdog being "fixed" the wrong way. The Stripe
    // capture happens long before the writes, so an unqualified 500 would be a
    // lie in the other direction — the card HAS been debited. The shape the
    // sibling uses is success-with-a-code, not failure.
    const src = code("capture-deposit-hold");
    expect(at(src, "stripe.paymentIntents.capture(", "the Stripe capture call moved")).toBeLessThan(
      at(src, '.from("payments")', "the payments insert moved"),
    );
    // charge-saved-card, same codebase, same situation, different answer.
    expect(code("charge-saved-card")).toContain("'charged_but_not_recorded'");
  });

  it.fails("should tell the operator when a captured deposit could not be recorded, instead of reporting plain success", () => {
    // Remove the .fails marker once supabase/functions/capture-deposit-hold/index.ts:314-316
    // (and :368-370, :382-384) stop swallowing. The in-repo pattern to copy is
    // charge-saved-card/index.ts:640-656: a distinct `charged_but_not_recorded`
    // outcome naming the PaymentIntent and telling the operator NOT to retry.
    // Retrying is exactly what the multicapture branch at :420-424 leaves open.
    const src = code("capture-deposit-hold");
    const recordKeeping = between(
      src,
      '.from("payments")',
      "return jsonResponse({",
      "capture-deposit-hold's record-keeping block or its success exit has moved.",
    );
    expect(
      recordKeeping,
      "all three record-keeping failures are still logged and dropped",
    ).toMatch(/return\s+errorResponse|not_recorded|unrecorded|warning/i);
  });
});

// ===========================================================================
// Two partial captures on one hold write two payments rows carrying the same
// PaymentIntent id. The refund webhook resolves that id with `.single()`.
// ===========================================================================

// @usecase A deposit captured in two chunks is refunded, `charge.refunded` resolves nothing, and Stripe has returned the money with no refund_status, no Refunded state and no operator notification written anywhere.
describe("stripe/deposit-holds — a multicaptured deposit is invisible to the refund webhook", () => {
  it("today stamps every capture's payments row with the hold's PaymentIntent id", () => {
    // PIN, Layer 1. index.ts:296-299 — the id is the RENTAL's hold PI, so it is
    // identical across captures of the same hold.
    expect(
      code("capture-deposit-hold"),
      pinNote("re-check whether two captures can still collide on one PI."),
    ).toContain("stripe_payment_intent_id: rental.deposit_hold_payment_intent_id,");
  });

  it("today re-arms the capture guard on a multicapture, leaving the same PI capturable again", () => {
    // PIN, Layer 1, the other half. The read-time guard is
    // index.ts:75 `if (rental.deposit_hold_status !== "held")`. The multicapture
    // branch at :420-424 puts the status straight back to "held" and does NOT
    // change deposit_hold_payment_intent_id, so a second capture passes the
    // guard on the SAME PaymentIntent and inserts a SECOND payments row
    // carrying the SAME stripe_payment_intent_id.
    const src = code("capture-deposit-hold");
    expect(src).toContain('if (rental.deposit_hold_status !== "held") {');
    const multicapture = between(
      src,
      "if (usedMulticapture) {",
      "} else if (newHoldPiId) {",
      "the multicapture branch of the rental update has moved.",
    );
    expect(multicapture).toContain('rentalUpdate.deposit_hold_status = "held";');
    expect(
      multicapture,
      pinNote("delete this pin and drop `.fails` from the case below."),
    ).not.toContain("deposit_hold_payment_intent_id");
    // The rollover branch, for contrast, DOES swap the id in — which is why
    // that path does not produce the collision.
    const rollover = between(
      src,
      "} else if (newHoldPiId) {",
      "rentalUpdate.deposit_hold_amount = remainder;",
      "the rollover branch of the rental update has moved.",
    );
    expect(rollover).toContain("rentalUpdate.deposit_hold_payment_intent_id = newHoldPiId;");
  });

  it("today resolves the refunded PaymentIntent with .single() in both webhooks, and drops the error", () => {
    // PIN, Layer 1, cross-file. stripe-webhook-live/index.ts:1942-1948 and the
    // -test twin at :1883-1889. Two matching rows is PGRST116 from PostgREST:
    // supabase-js answers { data: null, error } and NEVER throws (the standing
    // bug class), the error is not even destructured here, so `payment` is null
    // and the whole `if (payment)` body — refund_status, Refunded / Partial
    // Refund, refund_amount, the operator notification — is skipped in silence.
    for (const fn of ["stripe-webhook-live", "stripe-webhook-test"]) {
      const refundBlock = between(
        code(fn),
        '"No payment_intent on charge, skipping"',
        '"Found payment for refund:"',
        `${fn}'s charge.refunded handler has moved.`,
      );
      expect(refundBlock, `${fn}: the lookup no longer destructures data alone`).toContain(
        "const { data: payment } = await supabase",
      );
      expect(refundBlock).toContain('.eq("stripe_payment_intent_id", charge.payment_intent as string)');
      expect(
        refundBlock,
        `${fn}: ${pinNote("delete this pin and drop `.fails` from the case below.")}`,
      ).toContain(".single();");
      expect(refundBlock, `${fn}: the lookup error is still discarded`).not.toContain("error:");
    }
  });

  it.fails("should resolve a refunded PaymentIntent with a read that tolerates more than one payments row", () => {
    // Remove the .fails marker once supabase/functions/stripe-webhook-live/index.ts:1943-1947
    // (and stripe-webhook-test/index.ts:1884-1888) stop using .single() on a
    // column that is not unique — or once capture-deposit-hold/index.ts:420-424
    // stops producing two rows on one PaymentIntent, in which case fix the
    // capture side and delete this. Either way the refund of a two-chunk deposit
    // capture must be recorded.
    for (const fn of ["stripe-webhook-live", "stripe-webhook-test"]) {
      const refundBlock = between(
        code(fn),
        '"No payment_intent on charge, skipping"',
        '"Found payment for refund:"',
        `${fn}'s charge.refunded handler has moved.`,
      );
      expect(
        refundBlock,
        `${fn}: a duplicated PaymentIntent still resolves to nothing at all`,
      ).toMatch(/maybeSingle\(|\.limit\(|\.order\(/);
    }
  });
});

// ===========================================================================
// capture-booking-payment: the overlap pre-check cannot see an open-ended
// rental, the trigger can, and the rejection that follows the capture is logged
// and discarded under an unconditional success message.
// ===========================================================================

// @usecase The customer's money is captured, the database trigger rejects the rental going Active, the vehicle is still stamped Rented, and the caller is told the booking was approved.
describe("stripe/deposit-holds — an open-ended rental passes the overlap pre-check and fails the trigger after capture", () => {
  it("today skips the overlap pre-check entirely when the rental has no end date", () => {
    // PIN, Layer 1. index.ts:134 requires all three of vehicle_id, start_date
    // AND end_date to be truthy before the pre-check runs at all, and the filter
    // itself compares against `payment.rental.end_date`. rentals.end_date is
    // nullable — remote_schema.sql:5003 `"end_date" "date",` against :5002
    // `"start_date" "date" NOT NULL,` — and an auto-extend / pay-as-you-go
    // booking is written with it null.
    const src = code("capture-booking-payment");
    expect(
      src,
      pinNote("delete this pin and drop `.fails` from the case below."),
    ).toContain(
      "if (payment.rental?.vehicle_id && payment.rental?.start_date && payment.rental?.end_date) {",
    );
    expect(src).toContain('.lte("start_date", payment.rental.end_date)');
    expect(src).toContain('.gte("end_date", payment.rental.start_date)');
    // The second blind spot in the same filter: `.gte("end_date", ...)` cannot
    // match a row whose end_date is NULL, so an existing open-ended Active
    // rental on this vehicle is invisible to the pre-check too.
    const schema = readFileSync(
      join(REPO_ROOT, "supabase/migrations/20251219083413_remote_schema.sql"),
      "utf8",
    );
    expect(schema).toContain('"end_date" "date",');
  });

  it("is checked in the database by a trigger that COALESCEs a null end date to the end of time", () => {
    // The asymmetry, from the SQL. The trigger and the JS pre-check are supposed
    // to be asking the same question; only one of them handles NULL.
    const trigger = readFileSync(
      join(
        REPO_ROOT,
        "supabase/migrations/20260418120000_fix_rental_overlap_trigger_for_extensions.sql",
      ),
      "utf8",
    );
    expect(trigger).toContain("AND start_date <= COALESCE(NEW.end_date, '9999-12-31'::date)");
    expect(trigger).toContain("AND COALESCE(end_date, '9999-12-31'::date) >= check_start");
    expect(trigger).toContain("RAISE EXCEPTION 'Vehicle rental overlap");
    expect(trigger).toContain("USING ERRCODE = '23P01'");
    // Neither COALESCE has any counterpart in the edge function.
    expect(code("capture-booking-payment")).not.toMatch(/9999-12-31|COALESCE/i);
  });

  it("today logs the rejected rental update, stamps the vehicle Rented anyway, and reports success", () => {
    // PIN, Layer 1, the sequence that turns a trigger rejection into a 200.
    // Step 7 (:248-258) writes status Active; a 23P01 lands in rentalUpdateError
    // and index.ts:256-258 logs it. Step 8 (:262-269) is NOT in an `else`, so
    // the vehicle is marked Rented regardless, and the only exit (:295-303)
    // carries an unconditional success message.
    //
    // NOTE this is the step-7 swallow. The step-6 `capture_status` swallow is a
    // different write and is already pinned at charge-capture.test.ts:731 with
    // its watchdog at :751 — do not duplicate it here.
    const src = code("capture-booking-payment");
    const stepSeven = between(
      src,
      "if (rentalUpdateError) {",
      "if (payment.rental?.vehicle_id) {",
      "capture-booking-payment's rental-status update or vehicle update has moved.",
    );
    expect(stepSeven).toContain('console.error("Failed to update rental:", rentalUpdateError);');
    expect(
      stepSeven,
      pinNote("delete this pin and drop `.fails` from the case below."),
    ).not.toMatch(/\breturn\b|\bthrow\b/);
    // The rest of the sequence, in order: rental write, vehicle write, success.
    const rentalWrite = at(src, 'status: "Active",', "the rental-status write moved");
    const vehicleWrite = at(src, 'status: "Rented",', "the vehicle-status write moved");
    const successMsg = at(
      src,
      'message: "Booking approved and payment captured successfully",',
      "the success message moved",
    );
    expect(rentalWrite).toBeLessThan(vehicleWrite);
    expect(vehicleWrite).toBeLessThan(successMsg);
    // And the capture really does happen before all three.
    expect(at(src, "stripe.paymentIntents.capture(", "the Stripe capture moved")).toBeLessThan(rentalWrite);
  });

  it.fails("should ask the overlap pre-check the same question the trigger asks, including open-ended rentals", () => {
    // Remove the .fails marker once supabase/functions/capture-booking-payment/index.ts:134-141
    // handles a null end_date on both sides, the way the trigger does at
    // 20260418120000_fix_rental_overlap_trigger_for_extensions.sql:41-42. Until
    // then the pre-check returns "no conflict" for exactly the rentals the
    // trigger will reject — after the money has been captured.
    const src = code("capture-booking-payment");
    expect(
      src,
      "the pre-check still requires a non-null end_date and still cannot see one",
    ).not.toContain(
      "if (payment.rental?.vehicle_id && payment.rental?.start_date && payment.rental?.end_date) {",
    );
  });

  it.fails("should not report a booking as approved when the rental could not be made Active", () => {
    // Remove the .fails marker once supabase/functions/capture-booking-payment/index.ts:256-258
    // stops swallowing. The money HAS moved, so the right answer is success with
    // an explicit reconciliation code (the charge-saved-card/index.ts:640-656
    // shape), not a bare 500 — and the vehicle write at :262-269 must move
    // inside the success path, not run regardless.
    const src = code("capture-booking-payment");
    const stepSeven = between(
      src,
      "if (rentalUpdateError) {",
      "if (payment.rental?.vehicle_id) {",
      "capture-booking-payment's rental-status update or vehicle update has moved.",
    );
    expect(
      stepSeven,
      "a rejected rental-status write is still logged and dropped",
    ).toMatch(/\breturn\b|\bthrow\b|warning|unrecorded|requiresReconciliation/i);
  });
});

// ===========================================================================
// The hundred. Both sites that AUTHORISE a hold multiply by 100 by hand.
// ===========================================================================

// @usecase A JPY tenant's 15,000 deposit is authorised as 1,500,000 JPY on the renter's card, because both hold-placement sites assume every currency has two decimal places.
describe("stripe/deposit-holds — minor units are hardcoded at the two places a hold is authorised", () => {
  it("today converts with a hardcoded hundred on the PaymentIntent path and the Checkout path", () => {
    // PIN, Layer 1, both placement sites.
    //   place-deposit-hold/index.ts:498 -> :577 `amount: amountInCents`
    //   create-hold-checkout/index.ts:298 `unit_amount: Math.round(depositAmount * 100)`
    const place = code("place-deposit-hold");
    expect(
      place,
      pinNote("delete this pin and drop `.fails` from the case below."),
    ).toContain("const amountInCents = Math.round(depositAmount * 100);");
    expect(place).toContain("amount: amountInCents,");
    expect(code("create-hold-checkout")).toContain("unit_amount: Math.round(depositAmount * 100),");
    // Both know the currency is not always USD — they read it one expression
    // earlier and then ignore it for the conversion.
    expect(place).toContain('const currencyCode = (tenant.currency_code || "usd").toLowerCase();');
    expect(code("create-hold-checkout")).toContain(
      "const currency = (tenant.currency_code || 'usd').toLowerCase()",
    );
    // Neither placement site knows what a zero-decimal currency is.
    for (const fn of ["place-deposit-hold", "create-hold-checkout"]) {
      expect(code(fn), `${fn} now handles zero-decimal currencies`).not.toMatch(
        /ZERO_DECIMAL|zeroDecimal|minorUnitsFor/,
      );
    }
  });

  it("costs a JPY tenant a hundred times the deposit, by hand", () => {
    // Layer 3 — the expression from place-deposit-hold/index.ts:498, evaluated,
    // with the arithmetic written out:
    //
    //   USD 250.00 deposit -> 250 * 100    = 25000 minor units = $250.00   correct
    //   JPY 15000  deposit -> 15000 * 100  = 1500000 minor units          WRONG
    //     JPY has no minor unit: 15,000 JPY IS 15000. The renter's card is
    //     asked to authorise 1,500,000 JPY, a hundred times the deposit.
    expect(Math.round(250 * 100)).toBe(25000);
    expect(Math.round(15000 * 100)).toBe(1500000);
    // The size of the error, stated as a ratio so a future reader cannot read
    // 1500000 as a rounding wobble.
    expect(1500000 / 15000).toBe(100);
  });

  it.fails("should convert a deposit to minor units in a currency-aware way where the hold is AUTHORISED, not only where it is captured", () => {
    // Remove the .fails marker once BOTH place-deposit-hold/index.ts:498 and
    // create-hold-checkout/index.ts:298 use the zero-decimal / three-decimal
    // handling that charge-saved-card/index.ts:84-102 already has.
    //
    // TWO OTHER TESTS MUST BE UPDATED IN THE SAME CHANGE, or a correct fix will
    // read as a regression:
    //   * charge-capture.test.ts:1075-1081 — the same watchdog scoped to
    //     capture-deposit-hold ONLY. Fixing capture alone turns it red and it
    //     will be "resolved" by dropping its `.fails`, leaving these two
    //     placement sites multiplying by 100 unnoticed. That is the whole reason
    //     this case exists.
    //   * checkout-health.test.ts:868-886 — asserts create-hold-checkout
    //     CONTAINS `unit_amount: Math.round(depositAmount * 100)` as correct
    //     rounding behaviour. A currency-aware fix breaks that assertion.
    for (const fn of ["place-deposit-hold", "create-hold-checkout"]) {
      expect(code(fn), `${fn} still multiplies by a hardcoded 100`).toMatch(
        /ZERO_DECIMAL|zeroDecimal|minorUnitsFor/,
      );
    }
  });
});

// ===========================================================================
// The read-time refusal that stops a double capture is enforced 170 lines and
// one network call away, by a write filtered on the primary key alone.
// ===========================================================================

// @usecase Two approve clicks (or an approve racing a cancel) both pass the read-time capture_status gate, because nothing re-checks it at the moment of the write.
describe("stripe/deposit-holds — the booking capture's state gate is a read, and the write does not re-check it", () => {
  it("today refuses on a read at the top and writes captured filtered on the row id alone", () => {
    // PIN, Layer 1. index.ts:58 reads capture_status and refuses; index.ts:231-239
    // writes capture_status 'captured' with a single `.eq("id", paymentId)` —
    // no `.eq("capture_status", ...)`, and the result is inspected only for a
    // database error (:241-246).
    const src = code("capture-booking-payment");
    expect(src).toContain('if (payment.capture_status !== "requires_capture") {');
    const stepSix = between(
      src,
      'capture_status: "captured",',
      "if (updatePaymentError) {",
      "capture-booking-payment's step-6 payments update has moved.",
    );
    expect(stepSix).toContain('.eq("id", paymentId);');
    expect(
      stepSix,
      pinNote("delete this pin and drop `.fails` from the case below."),
    ).not.toContain('.eq("capture_status"');
    expect(stepSix, "the write now checks how many rows it changed").not.toContain(".select(");
  });

  it("puts the whole Stripe round trip between the refusal and the write that enforces it", () => {
    // The distance is the point: a read-time gate with a network call between it
    // and its write is not a gate, it is a hint.
    const src = code("capture-booking-payment");
    const gate = at(src, 'if (payment.capture_status !== "requires_capture") {', "the state gate moved");
    const stripeCall = at(src, "stripe.paymentIntents.capture(", "the Stripe capture moved");
    const write = at(src, 'capture_status: "captured",', "the step-6 write moved");
    expect(gate).toBeLessThan(stripeCall);
    expect(stripeCall).toBeLessThan(write);
  });

  it("is not how the sibling capture path does it: capture-deposit-hold compare-and-sets", () => {
    // The in-repo pattern, already written and already commented with its
    // reasoning (capture-deposit-hold/index.ts:447-456). The filter carries the
    // value the decision was made on, so a row that moved underneath the request
    // matches nothing and is not stamped.
    const src = code("capture-deposit-hold");
    const cas = between(
      src,
      '.from("rentals")',
      '.select("id");',
      "capture-deposit-hold's compare-and-set update has moved.",
    );
    expect(cas).toContain('.eq("id", rentalId)');
    expect(cas).toContain('.eq("deposit_hold_payment_intent_id", rental.deposit_hold_payment_intent_id)');
  });

  it.fails("should enforce the capture_status refusal at the write, not only at the read", () => {
    // Remove the .fails marker once supabase/functions/capture-booking-payment/index.ts:225-241
    // filters on the capture_status it decided upon — the shape
    // capture-deposit-hold/index.ts:449-456 already uses, with `.select()` so
    // the caller can tell "I changed the row" from "somebody else got there
    // first". A concurrent cancel-booking-preauth writes capture_status
    // 'cancelled' (cancel-booking-preauth/index.ts:210), and today this write
    // would stamp 'captured' straight over it.
    const src = code("capture-booking-payment");
    const stepSix = between(
      src,
      'capture_status: "captured",',
      "if (updatePaymentError) {",
      "capture-booking-payment's step-6 payments update has moved.",
    );
    expect(stepSix, "the step-6 write is still filtered on the primary key alone").toContain(
      '.eq("capture_status"',
    );
  });
});
