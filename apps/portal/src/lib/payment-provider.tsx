/**
 * Provider-aware labels and marks for anything an operator reads.
 *
 * WHY A HELPER AND NOT A TERNARY AT EACH SITE
 *
 * The portal named Stripe in hard-coded strings in a dozen places — button
 * labels, toasts, nav items. Every one of them was wrong the moment a tenant
 * chose Square, and each was wrong independently: fixing the button did not fix
 * the toast, and nothing connected them. A Square operator opening "Record
 * Payment" was offered "Charge via Stripe" and "Email Stripe Link" for a
 * processor their tenant is not on and can never be on.
 *
 * One function means the next processor is one entry in one object, and it
 * means a site that forgets to branch is visible as a raw literal rather than
 * as a plausible-looking ternary that happens to be missing a case.
 *
 * `undefined` resolves to Stripe deliberately, matching the database default
 * (payment_provider is NOT NULL DEFAULT 'stripe') and resolvePaymentProvider's
 * fail-safe direction: a tenant whose row has not loaded yet must not be shown
 * Square branding it may not have.
 */
import React from "react";

export type PaymentProviderId = "stripe" | "square";

export function toProviderId(value: unknown): PaymentProviderId {
  return value === "square" ? "square" : "stripe";
}

interface ProviderPresentation {
  /** How the operator refers to it. */
  name: string;
  /** Brand colour, used only for the mark. */
  color: string;
  /** "Charge via X" — opens the hosted page in a new tab for a customer present. */
  chargeLabel: string;
  /** "Email X Link" — sends the customer a link instead. */
  emailLabel: string;
  /** Toast title after the hosted page is opened. */
  openedTitle: string;
}

const PRESENTATION: Record<PaymentProviderId, ProviderPresentation> = {
  stripe: {
    name: "Stripe",
    color: "#635BFF",
    chargeLabel: "Charge via Stripe",
    emailLabel: "Email Stripe Link",
    openedTitle: "Stripe Checkout opened",
  },
  square: {
    name: "Square",
    color: "#3E4348",
    chargeLabel: "Charge via Square",
    emailLabel: "Email Square Link",
    openedTitle: "Square Checkout opened",
  },
};

export function providerPresentation(value: unknown): ProviderPresentation {
  return PRESENTATION[toProviderId(value)];
}

/**
 * The processor's mark.
 *
 * Square's is drawn as a rounded square outline rather than reproduced from
 * their brand assets: it reads correctly at 16px, needs no licence, and cannot
 * silently become a stale copy of a logo they later change.
 */
export function ProviderMark({
  provider,
  className = "w-4 h-4 shrink-0",
}: {
  provider: unknown;
  className?: string;
}) {
  const id = toProviderId(provider);
  const { color } = PRESENTATION[id];

  if (id === "square") {
    return (
      <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <rect x="3" y="3" width="18" height="18" rx="4" stroke={color} strokeWidth="2.5" />
        <rect x="9" y="9" width="6" height="6" rx="1.5" fill={color} />
      </svg>
    );
  }

  return (
    <svg className={className} viewBox="0 0 24 24" fill={color} aria-hidden="true">
      <path d="M13.976 9.15c-2.172-.806-3.356-1.426-3.356-2.409 0-.831.683-1.305 1.901-1.305 2.227 0 4.515.858 6.09 1.631l.89-5.494C18.252.975 15.697 0 12.165 0 9.667 0 7.589.654 6.104 1.872 4.56 3.147 3.757 4.992 3.757 7.218c0 4.039 2.467 5.76 6.476 7.219 2.585.92 3.445 1.574 3.445 2.583 0 .98-.84 1.545-2.354 1.545-1.875 0-4.965-.921-6.99-2.109l-.9 5.555C5.175 22.99 8.385 24 11.714 24c2.641 0 4.843-.624 6.328-1.813 1.664-1.305 2.525-3.236 2.525-5.732 0-4.128-2.524-5.851-6.591-7.305z" />
    </svg>
  );
}
