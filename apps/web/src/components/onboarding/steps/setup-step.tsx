"use client";

/**
 * SETUP — company, web address and card, on one screen, with one submit.
 *
 * Replaces the `business` + `payment` pair for the flow described in the brief:
 * after Google (or after OTP), the operator sees exactly one screen and presses
 * one button.
 *
 * ── WHY THIS CAN ONLY BE ONE SCREEN AFTER AUTH ─────────────────────────────
 * Stripe's Payment Element needs a `clientSecret`, which needs a PaymentIntent,
 * which needs the auth user to exist. On the email path the user does not exist
 * until `signup-begin` runs, so credentials genuinely cannot share a screen
 * with the card. Once the user exists — Google has just created them, or OTP
 * has just confirmed them — the intent can be minted on arrival, which is what
 * `onNeedIntent` below is for.
 *
 * ── THE ORDER OF `onSubmit` IS THE WHOLE DESIGN ────────────────────────────
 * 1. slug check   — free to fail. Nothing irreversible has happened.
 * 2. confirmPayment — the ONLY irreversible step.
 * 3. provision    — builds the tenant.
 *
 * Checking the slug AFTER the card would mean a paid customer with no tenant
 * and a name they cannot have, and `signup-provision` deliberately never
 * refunds to tidy up. The few seconds between step 1 and step 3 are covered by
 * `tenants_slug_key` and by `signup-provision` re-running every check — so no
 * reservation table is needed, as long as the order holds.
 *
 * ── WHAT THIS COMPONENT DOES NOT OWN ───────────────────────────────────────
 * It does not load Stripe.js. `payment-step.tsx` has hardened that — a blocked
 * script resolves to `null`, a stalled one never settles, and both render a
 * silently empty box. This renders INSIDE an `<Elements>` boundary the caller
 * provides, so that work is not duplicated or diverged from.
 */

import * as React from "react";
import { PaymentElement, useElements, useStripe } from "@stripe/react-stripe-js";
import { Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  TenantIdentityFields,
  type SlugState,
} from "@/components/onboarding/tenant-identity-fields";
import type {
  BusinessDraft,
  OnboardingError,
  SlugCheckResult,
} from "@/components/onboarding/onboarding-types";
import type { SignupPlan } from "@/lib/plans";

export interface SetupStepProps {
  plan: SignupPlan;
  /** Who is signed in, for the header line. Null while unknown. */
  identity: { email: string; via: "google" | "email" } | null;
  tenant: BusinessDraft;
  onTenantChange(patch: Partial<BusinessDraft>): void;
  onCheckSlug(slug: string): Promise<SlugCheckResult>;
  /** Mint the PaymentIntent. Called on mount when there is no client secret. */
  onNeedIntent(): void;
  hasClientSecret: boolean;
  busy: boolean;
  error: OnboardingError | null;
  onClearError(): void;
  /**
   * Step 1 of the submit order. Resolves false when the address is taken, and
   * is expected to have surfaced the reason itself.
   */
  onVerifySlug(slug: string): Promise<boolean>;
  /** Step 3. Called only after the card has confirmed. */
  onProvision(): Promise<void>;
  onError(err: OnboardingError): void;
}

export function SetupStep({
  plan,
  identity,
  tenant,
  onTenantChange,
  onCheckSlug,
  onNeedIntent,
  hasClientSecret,
  busy,
  error,
  onClearError,
  onVerifySlug,
  onProvision,
  onError,
}: SetupStepProps) {
  const stripe = useStripe();
  const elements = useElements();
  const [slugState, setSlugState] = React.useState<SlugState>({ kind: "idle" });
  const [submitting, setSubmitting] = React.useState(false);

  /*
   * The intent is minted on ARRIVAL, not on submit. The Payment Element cannot
   * mount without a client secret, so deferring it would show an empty box
   * until the operator pressed a button that needs the box filled in. An
   * unconfirmed intent costs nothing and expires on its own.
   */
  React.useEffect(() => {
    if (!hasClientSecret) onNeedIntent();
  }, [hasClientSecret, onNeedIntent]);

  /*
   * `TenantIdentityFields` keys its errors by FIELD, not by error code. The
   * only ones it can show are the two it owns, so anything else stays in the
   * banner below rather than being forced into a field that did not cause it.
   */
  const fieldErrors = React.useMemo(() => {
    if (!error) return {};
    const field = (error.detail as { field?: string } | undefined)?.field;
    if (field === "slug") return { slug: error.message };
    if (field === "companyName") return { companyName: error.message };
    return {};
  }, [error]);

  const price = React.useMemo(() => {
    const amount = (plan as { amountCents?: number | null }).amountCents;
    if (amount == null) return null;
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "usd",
      maximumFractionDigits: amount % 100 === 0 ? 0 : 2,
    }).format(amount / 100);
  }, [plan]);

  const canSubmit =
    !!stripe &&
    !!elements &&
    hasClientSecret &&
    !busy &&
    !submitting &&
    tenant.companyName.trim().length > 0 &&
    tenant.slug.trim().length > 0 &&
    tenant.acceptedTerms === true &&
    slugState.kind !== "checking" &&
    slugState.kind !== "unavailable";

  const handleSubmit = React.useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!stripe || !elements || submitting) return;

      onClearError();
      setSubmitting(true);
      try {
        // ── 1. SLUG, BEFORE THE CARD ───────────────────────────────────────
        // Free to fail: the operator edits a field and tries again.
        const slugOk = await onVerifySlug(tenant.slug.trim());
        if (!slugOk) return;

        // ── 2. THE CARD — the only irreversible step ───────────────────────
        const { error: stripeError } = await stripe.confirmPayment({
          elements,
          redirect: "if_required",
        });
        if (stripeError) {
          onError({
            code: "CARD_DECLINED",
            message: stripeError.message ?? "That payment could not be completed.",
          });
          return;
        }

        // ── 3. BUILD THE TENANT ────────────────────────────────────────────
        // If this throws SLUG_TAKEN — someone won the race in those seconds —
        // the money is recorded and `signup-resume` lands them back here to
        // pick another name. It retries into the SAME subscription; nothing is
        // charged twice.
        await onProvision();
      } catch (err) {
        onError({
          code: "INTERNAL",
          message: err instanceof Error ? err.message : "Something went wrong.",
        });
      } finally {
        setSubmitting(false);
      }
    },
    [stripe, elements, submitting, onClearError, onVerifySlug, tenant.slug, onError, onProvision],
  );

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {identity ? (
        <div className="flex items-center gap-2 rounded-xl bg-muted/60 px-3 py-2.5 text-sm">
          <span aria-hidden className="text-emerald-600">✓</span>
          <span className="min-w-0 truncate">
            Signed in as <span className="font-medium">{identity.email}</span>
            {identity.via === "google" ? " (Google)" : null}
          </span>
        </div>
      ) : null}

      <TenantIdentityFields
        value={tenant}
        busy={busy || submitting}
        errors={fieldErrors}
        onChange={onTenantChange}
        onClearError={onClearError}
        onCheckSlug={onCheckSlug}
        onSlugStateChange={setSlugState}
        autoFocusCompanyName
      />

      <div className="space-y-3 border-t pt-5">
        <h3 className="text-sm font-medium">Payment</h3>
        {hasClientSecret ? (
          <PaymentElement options={{ layout: "tabs" }} />
        ) : (
          <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Preparing secure payment…
          </div>
        )}
      </div>

      {error ? (
        <p className="text-sm text-destructive" role="alert">
          {error.message}
        </p>
      ) : null}

      <Button type="submit" className="w-full" disabled={!canSubmit}>
        {submitting ? (
          <>
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            Creating your portal…
          </>
        ) : (
          <>Create my portal{price ? ` · ${price}/mo` : ""}</>
        )}
      </Button>
    </form>
  );
}
