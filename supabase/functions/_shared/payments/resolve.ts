/**
 * Square integration — the single provider resolver.
 *
 * `resolvePaymentProvider` is the ONE binding name. Six other candidates were
 * proposed across the analysis (getProvider, getTenantProvider, providerFor,
 * resolveProvider, getPaymentProvider, whichProvider); all are banned by CI grep
 * so that a reader who greps for the resolver finds exactly one thing.
 *
 * This deliberately does NOT live in _shared/stripe-client.ts, and does NOT
 * extend TENANT_STRIPE_COLUMNS. Measured on this branch: getConnectAccountId is
 * invoked at 55 sites across 44 files, but TENANT_STRIPE_COLUMNS is imported by
 * only 6 — and 5 of those are deposit-hold / saved-card paths that a Square
 * tenant can never reach. Widening that constant would therefore have edited 5
 * working Stripe files to cover 1 reachable call site, while putting
 * `payment_provider` into 6 interpolated PostgREST selects that would return
 * error 42703 on any deploy that landed before the migration.
 */

import { ProviderId, ProviderResolution, SquareMode, PaymentsSupabaseClient } from "./types.ts";

/**
 * The ONLY tenant columns this seam reads. Deliberately tiny and deliberately
 * separate from TENANT_STRIPE_COLUMNS — the two must never be merged.
 */
export const TENANT_PROVIDER_COLUMNS = "id, payment_provider, square_mode, country";

function coerceProvider(value: unknown): ProviderId {
  // Fail SAFE toward Stripe. An unrecognised value must never be treated as
  // Square: that would route a Stripe tenant's money down an unbuilt rail.
  // The DB CHECK constraint makes this branch unreachable; it exists so that a
  // stale deploy reading a future value still behaves.
  return value === "square" ? "square" : "stripe";
}

/**
 * Resolve which processor owns a tenant's customer-facing money.
 *
 * Throws only when the tenant row genuinely cannot be read. It never invents a
 * provider from a failed query — a caller that swallowed that would silently
 * charge on the wrong rail.
 */
export async function resolvePaymentProvider(
  supabase: PaymentsSupabaseClient,
  tenantId: string,
): Promise<ProviderResolution> {
  const { data, error } = await supabase
    .from("tenants")
    .select(TENANT_PROVIDER_COLUMNS)
    .eq("id", tenantId)
    .single();

  // FAIL OPEN TO STRIPE. This is the single most important line in the seam.
  //
  // An earlier version threw here. That contradicted guard.ts's documented fail
  // direction and was a live Stripe-regression vector the moment the preamble
  // landed: staging is behind on the migration and returns 42703 for these
  // columns, so EVERY checkout on a schema-lagging environment would have thrown
  // instead of falling through to its untouched Stripe body.
  //
  // A read failure carries NO evidence that the tenant is on Square. Stripe is
  // the native rail and the safe default, so we log loudly and degrade to it.
  // The asymmetry is deliberate: degrading to Stripe for a Square tenant fails
  // visibly at the Stripe call; throwing for a Stripe tenant breaks live money.
  if (error || !data) {
    console.error(
      `[resolvePaymentProvider] could not read tenant ${tenantId} ` +
        `(${error?.code ?? "no-row"}): falling back to the Stripe rail. ` +
        `If this tenant is on Square, its checkout will fail visibly at the Stripe call.`,
    );
    return { tenantId, provider: "stripe", squareMode: null, country: null };
  }

  const row = data as Record<string, unknown>;
  const provider = coerceProvider(row.payment_provider);

  return {
    tenantId,
    provider,
    squareMode: provider === "square" ? ((row.square_mode as SquareMode) ?? "test") : null,
    country: (row.country as string | null) ?? null,
  };
}

/**
 * Same resolution from a tenant row the caller already has in hand.
 *
 * Use this wherever the tenant was already selected — it avoids a second
 * round-trip. The caller MUST have included the provider columns in its select;
 * a CI set-difference check enforces that pairing at build time, because a
 * missing column here silently degrades to 'stripe'.
 */
export function resolveFromTenantRow(row: Record<string, unknown>): ProviderResolution {
  const provider = coerceProvider(row.payment_provider);
  return {
    tenantId: String(row.id ?? ""),
    provider,
    squareMode: provider === "square" ? ((row.square_mode as SquareMode) ?? "test") : null,
    country: (row.country as string | null) ?? null,
  };
}
