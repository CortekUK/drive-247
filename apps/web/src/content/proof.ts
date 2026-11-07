/**
 * The numbers and the operator wall on the landing page.
 *
 * EVERY FIGURE HERE IS REAL, measured against production on 2026-11-06 with test
 * tenants (tenant_type = 'test') and the founder's own test signup left out, then
 * rounded DOWN. They only ever grow, so a stale value stays true. Re-measure before
 * raising one; never type a bigger number in without a query behind it, because a
 * prospect can hold us to anything this page states.
 *
 *   payments   $182,945  `payments` Applied / Completed / Partial / Partial Refund at
 *                        live-mode operators: cards through Stripe ($104,599) plus the
 *                        cash, Zelle and similar payments operators recorded. Pending
 *                        rows are left out (the webhook sync-drift bug inflates them).
 *   days       4,437     rental days on rentals that were not cancelled.
 *   agreements 1,008     `rental_agreements` rows (487 of them signed so far).
 *   verified   560       `identity_verifications` that passed (848 started).
 *   operators  65        production tenants ever created (34 paying today).
 *
 * The operator map (components/sections/operator-map.tsx) is not here: it reads the
 * live operators and their bookings itself, on the server, every minute.
 */

export interface ProofNumber {
  /** The number the count-up runs to. */
  value: number;
  prefix?: string;
  suffix?: string;
  label: string;
  detail: string;
}

export const PROOF_AS_OF = "November 2026";

export const NUMBERS: readonly ProofNumber[] = [
  { value: 180, prefix: "$", suffix: "k+", label: "In rental payments", detail: "Paid by renters and tracked on Drive247." },
  { value: 4400, suffix: "+", label: "Rental days booked", detail: "Across every operator's fleet." },
  { value: 1000, suffix: "+", label: "Agreements sent", detail: "For renters to sign from their phone." },
  { value: 560, suffix: "+", label: "Drivers verified", detail: "Licence and selfie, checked online." },
];
