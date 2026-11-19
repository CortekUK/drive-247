// =============================================================================
// The owner's real-signup feedback, 2026-11-19.
//
//   1. the account pop-up scrolled inside itself        (spacing, checked by
//                                                         screenshots, not here)
//   2. phone signups were lost on the code screen        → one-time-code field,
//      Open Gmail / Open Outlook, and the code screen survives a reload
//   3. the payment step                                  → one primary action
//      (no Link Confirm), "Have a code?", Change plan, the reminder line, and
//      the navbar no longer signs everybody up to Growth
//
// Source-level, like the rest of this folder: no DOM, no network.
// =============================================================================

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { entryPlanId, SIGNUP_PLANS, type SignupPlan } from "@web/lib/plans";

const ROOT = resolve(__dirname, "../../../");
const read = (rel: string) => readFileSync(resolve(ROOT, rel), "utf8");
const strip = (s: string) =>
  s.replace(/\{\/\*[\s\S]*?\*\/\}/g, "").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const provider = strip(read("apps/web/src/components/onboarding/onboarding-provider.tsx"));
const screen = strip(read("apps/web/src/components/onboarding/onboarding-screen.tsx"));
const payment = strip(read("apps/web/src/components/onboarding/steps/payment-step.tsx"));
const verify = strip(read("apps/web/src/components/onboarding/steps/verify-step.tsx"));
const intentV1 = strip(read("supabase/functions/signup-payment-intent/index.ts"));
const intentV2 = strip(read("supabase/functions/signup-payment-intent-v2/index.ts"));

const between = (src: string, from: string, to: string) => src.slice(src.indexOf(from), src.indexOf(to, src.indexOf(from)));

describe("2a. the phone can fill the code", () => {
  it("is a numeric one-time-code field", () => {
    expect(verify).toMatch(/autoComplete="one-time-code"/);
    expect(verify).toMatch(/inputMode="numeric"/);
    expect(verify).toMatch(/pattern="\[0-9\]\*"/);
  });

  it("reads a pasted code itself, so the whole code lands at once", () => {
    expect(verify).toMatch(/onPaste=\{onPaste\}/);
    expect(verify).toMatch(/clipboardData\.getData\("text"\)\.replace\(\/\\D\/g, ""\)/);
  });
});

describe("2b. Open Gmail / Open Outlook", () => {
  it("are offered on touch screens only", () => {
    expect(verify).toMatch(/\(hover: none\) and \(pointer: coarse\)/);
    expect(verify).toMatch(/touchOnly \? \(/);
    expect(verify).toMatch(/"Open Gmail"/);
    expect(verify).toMatch(/"Open Outlook"/);
  });
});

describe("2c. the code screen survives a reload or a closed tab", () => {
  it("is remembered every time a code is sent", () => {
    const submit = between(provider, "const submitAccount", "const verifyEmailCode");
    expect(submit.match(/rememberCodeSent\(/g)?.length).toBe(2);
    const resend = between(provider, "const resendEmailCode", "const submitTenantDetails");
    expect(resend).toMatch(/rememberCodeSent\(/);
  });

  it("is restored before the tab's open plan is reopened", () => {
    const restore = between(provider, "const restoreCheckedRef", "const restorePlan = planId;");
    expect(restore).toMatch(/readPendingVerify\(\)/);
    expect(restore).toMatch(/step: "verify"/);
  });

  it("is forgotten once the code is spent, or on 'Use a different email'", () => {
    const verifyFn = between(provider, "const verifyEmailCode", "const clearVerifyError");
    expect(verifyFn).toMatch(/clearPendingVerify\(\)/);
    const different = between(provider, "const useDifferentEmail", "const signInInstead");
    expect(different).toMatch(/clearPendingVerify\(\)/);
    expect(different).toMatch(/step: "account"/);
  });

  it("asks for the password once when the code was restored without it", () => {
    const verifyFn = between(provider, "const verifyEmailCode", "const clearVerifyError");
    expect(verifyFn).toMatch(/reason: "EMAIL_IN_SIGNUP"/);
  });
});

describe("3a. the purple button is the only way through", () => {
  it("turns Link (and its own Confirm button) off in the Payment Element", () => {
    expect(payment).toMatch(/wallets: \{ link: "never"/);
  });

  it("needs no server change: both intents stay card-only", () => {
    expect(intentV1).toMatch(/payment_method_types: \["card"\]/);
    expect(intentV2).toMatch(/payment_method_types: \["card"\]/);
    expect(intentV1).not.toMatch(/"link"/);
    expect(intentV2).not.toMatch(/"link"/);
  });
});

describe("3b. 'Have a code?'", () => {
  it("starts closed unless a code is already in play", () => {
    expect(payment).toMatch(/useState\(Boolean\(applied\)\)/);
    expect(payment).toMatch(/Have a code\?/);
  });
});

describe("3c. the plan", () => {
  const catalogue = (over: Partial<SignupPlan>[]): SignupPlan[] =>
    over.map((o, i) => ({ ...SIGNUP_PLANS[i % SIGNUP_PLANS.length], ...o }) as SignupPlan);

  it("a button with no plan on it opens on the cheapest plan, not the highlighted one", () => {
    const plans = catalogue([
      { id: "starter", amountCents: 12900, highlighted: false },
      { id: "growth", amountCents: 22900, highlighted: true },
      { id: "scale", amountCents: 32900, highlighted: false },
    ]);
    expect(entryPlanId(plans)).toBe("starter");
  });

  it("follows the live catalogue, whatever its order", () => {
    const plans = catalogue([
      { id: "growth", amountCents: 22900, highlighted: true },
      { id: "lite", amountCents: 4900, highlighted: false },
    ]);
    expect(entryPlanId(plans)).toBe("lite");
    expect(entryPlanId([])).toBe("starter");
  });

  it("the provider no longer defaults to the highlighted plan anywhere", () => {
    expect(provider).not.toMatch(/p\.highlighted\)\?\.id/);
    expect(provider).toMatch(/entryPlanId\(plans\)/);
  });

  it("the payment step always offers Change plan, from the live catalogue", () => {
    expect(screen).toMatch(/plans=\{plans\}/);
    expect(screen).toMatch(/onChangePlan=\{changePlan\}/);
    expect(payment).toMatch(/Change plan/);
    expect(payment).toMatch(/formatPlanPriceUsd\(p\)/);
  });

  it("changing plan re-mints the intent, and never after paying", () => {
    const fn = between(provider, "const changePlan", "const applyPromoCode");
    expect(fn).toMatch(/s\.payment\.paid/);
    expect(fn).toMatch(/startPaymentInternal\(planId\)/);
  });
});

describe("3d. the reminder line", () => {
  it("sits with the 'No charge today' line on a trial", () => {
    expect(payment).toMatch(/We&apos;ll email you 3 days before your trial ends\./);
  });
});

describe("3e. the purple button on a phone", () => {
  it("is pinned to the bottom of the card on the payment step", () => {
    expect(screen).toMatch(/paymentColumns &&\s*"max-sm:sticky max-sm:bottom-0/);
  });
});
