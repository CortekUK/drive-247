/**
 * Engine mechanics — classify.ts: every provider answer lands in one class,
 * and the text a person reads never reveals a fraud flag.
 *
 * The codes are Stripe's (design §7 table). This file checks the MAPPING;
 * the money consequences of each class are exercised by the scenario suite.
 */
import { describe, expect, it } from "vitest";
import { classifyCharge, classifyDecline, customerSafeReason, isSensitiveDeclineCode } from "../../../supabase/functions/_shared/payment-plans/classify.ts";

describe("classifyDecline — design §7 table", () => {
  const table: [string, string][] = [
    ["authentication_required", "needs_customer"],
    ["authentication_not_handled", "needs_customer"],
    ["payment_intent_authentication_failure", "needs_customer"],
    ["expired_card", "needs_new_card"],
    ["incorrect_number", "needs_new_card"],
    ["invalid_number", "needs_new_card"],
    ["lost_card", "needs_new_card"],
    ["stolen_card", "needs_new_card"],
    ["pickup_card", "needs_new_card"],
    ["restricted_card", "needs_new_card"],
    ["revocation_of_all_authorizations", "needs_new_card"],
    ["revocation_of_authorization", "needs_new_card"],
    ["transaction_not_allowed", "needs_new_card"],
    ["card_not_supported", "needs_new_card"],
    ["currency_not_supported", "needs_new_card"],
    ["pin_try_exceeded", "needs_new_card"],
    ["payment_method_restricted", "needs_new_card"],
    ["insufficient_funds", "retry_later"],
    ["card_velocity_exceeded", "retry_later"],
    ["withdrawal_count_limit_exceeded", "retry_later"],
    ["card_decline_rate_limit_exceeded", "retry_later"],
    ["processing_error", "transient"],
    ["issuer_not_available", "transient"],
    ["reenter_transaction", "transient"],
    ["approve_with_id", "transient"],
    ["lock_timeout", "transient"],
    ["rate_limit", "transient"],
    ["do_not_honor", "opaque"],
    ["generic_decline", "opaque"],
    ["call_issuer", "opaque"],
    ["billing_invalid_mandate", "integration_bug"],
    ["missing", "integration_bug"],
    ["livemode_mismatch", "integration_bug"],
    ["testmode_charges_only", "integration_bug"],
    ["payment_intent_unexpected_state", "integration_bug"],
    ["duplicate_transaction", "integration_bug"],
    ["idempotency_key_in_use", "in_use"],
  ];
  it.each(table)("%s → %s", (code, cls) => {
    expect(classifyDecline(code, null)).toBe(cls);
    // Stripe puts the reason in decline_code or in code; both are read.
    expect(classifyDecline(null, code)).toBe(cls);
  });

  it("the bank's decline_code wins over the generic error code", () => {
    expect(classifyDecline("insufficient_funds", "card_declined")).toBe("retry_later");
    expect(classifyDecline("expired_card", "card_declined")).toBe("needs_new_card");
  });

  it("an unknown or missing code is opaque — fail, never retry", () => {
    expect(classifyDecline("some_new_code_stripe_invented", "card_declined")).toBe("opaque");
    expect(classifyDecline(null, null)).toBe("opaque");
  });

  it("codes the adapters generate are classified deliberately", () => {
    expect(classifyDecline(null, "no_payment_method")).toBe("needs_new_card");
    expect(classifyDecline(null, "resource_missing")).toBe("needs_new_card");
    expect(classifyDecline(null, "provider_not_supported")).toBe("integration_bug");
    expect(classifyDecline(null, "idempotency_error")).toBe("integration_bug");
    expect(classifyDecline(null, "invalid_request_error")).toBe("integration_bug");
  });
});

describe("classifyCharge — outcome kinds", () => {
  it("maps each ChargeOutcome kind", () => {
    expect(classifyCharge({ kind: "succeeded", providerRef: "pi_x" })).toBe("succeeded");
    expect(classifyCharge({ kind: "indeterminate" })).toBe("indeterminate");
    expect(classifyCharge({ kind: "in_use" })).toBe("in_use");
    expect(classifyCharge({ kind: "declined", providerRef: null, declineCode: "insufficient_funds", errorCode: "card_declined" })).toBe("retry_later");
  });
});

describe("customerSafeReason — nobody is told a card is flagged", () => {
  const sensitive = ["lost_card", "stolen_card", "pickup_card", "fraudulent", "merchant_blacklist", "security_violation", "restricted_card"];
  it.each(sensitive)("%s reads as a generic decline", (code) => {
    const text = customerSafeReason(code, "card_declined");
    expect(isSensitiveDeclineCode(code)).toBe(true);
    expect(text).toBe(customerSafeReason("generic_decline", "card_declined"));
    expect(text.toLowerCase()).not.toMatch(/lost|stolen|fraud|pick ?up|blacklist|security|restricted/);
  });

  it("a sensitive code hidden in the error code is caught too", () => {
    expect(customerSafeReason(null, "stolen_card")).toBe(customerSafeReason("generic_decline", null));
  });

  it("non-sensitive codes get a specific, plain sentence", () => {
    expect(customerSafeReason("insufficient_funds")).toMatch(/insufficient funds/i);
    expect(customerSafeReason("expired_card")).toMatch(/expired/i);
    expect(customerSafeReason("authentication_required")).toMatch(/confirm/i);
  });
});
