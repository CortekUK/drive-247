/**
 * The portal's side of the `integration-billing` edge function
 * (supabase/functions/integration-billing). Everything that needs the platform
 * Stripe key runs there; this only calls it and turns its answers into values
 * or Errors carrying the function's own sentence.
 */
import { supabase } from '@/integrations/supabase/client';
import { extractFunctionErrorPayload } from '@/lib/edge-error';

export const INTEGRATION_BILLING_FUNCTION = 'integration-billing';

export const SERVICE_MISSING = "Premium integrations aren't switched on yet. Nothing was charged.";

export type InvoiceLineKind = 'platform' | 'integration' | 'integration_credit' | 'usage' | 'discount' | 'tax' | 'other';

export interface InvoiceLine {
  kind: InvoiceLineKind;
  label: string;
  /** Minor units; negative for a credit or a discount. */
  amount: number;
  integrationKey?: string;
}

export interface InvoiceSummary {
  currency: string;
  lines: InvoiceLine[];
  total: number;
  amountDue: number;
  balanced: boolean;
}

export interface UpcomingInvoice extends InvoiceSummary {
  /** When the next bill is raised. */
  date: string | null;
}

export interface SubscribeResult {
  id: string;
  integrationKey: string;
  status: 'active' | 'pending';
  monthlyPriceCents: number;
  currency: string;
  firstMonthFree: boolean;
  firstBillAt: string | null;
  adopted: boolean;
}

/** An answer the function refused, with its machine-readable reason when it gave one. */
export class IntegrationBillingError extends Error {
  code: string | null;
  status: number;
  constructor(message: string, code: string | null, status: number) {
    super(message);
    this.name = 'IntegrationBillingError';
    this.code = code;
    this.status = status;
  }
}

async function call(body: Record<string, unknown>): Promise<Record<string, any>> {
  const { data, error } = await supabase.functions.invoke(INTEGRATION_BILLING_FUNCTION, { body });
  if (!error) return (data && typeof data === 'object' ? data : {}) as Record<string, any>;

  const name = String((error as { name?: string })?.name ?? '');
  if (name === 'FunctionsFetchError' || name === 'FunctionsRelayError') {
    throw new IntegrationBillingError(SERVICE_MISSING, 'not_set_up', 0);
  }
  const status = Number((error as { context?: Response })?.context?.status ?? 0);
  const payload = await extractFunctionErrorPayload(error);
  // The gateway's own 404 for a function that is not deployed.
  if (status === 404 && payload?.ok !== false) throw new IntegrationBillingError(SERVICE_MISSING, 'not_set_up', 404);
  const message =
    typeof payload?.error === 'string' && payload.error.trim()
      ? payload.error
      : status === 401
        ? 'Your session has expired. Sign in again.'
        : 'Something went wrong. Nothing was charged. Try again.';
  throw new IntegrationBillingError(message, typeof payload?.code === 'string' ? payload.code : null, status);
}

export async function subscribeToIntegration(integrationKey: string): Promise<SubscribeResult> {
  const data = await call({ action: 'subscribe', integrationKey });
  return data.subscription as SubscribeResult;
}

/** The next invoice, or null (no plan, a plan that is ending, or nothing to bill). */
export async function fetchUpcomingInvoice(): Promise<UpcomingInvoice | null> {
  const data = await call({ action: 'upcoming' });
  return (data.upcoming as UpcomingInvoice | null) ?? null;
}

export async function fetchInvoiceLines(stripeInvoiceId: string): Promise<InvoiceSummary> {
  const data = await call({ action: 'invoice_lines', stripeInvoiceId });
  return data.invoice as InvoiceSummary;
}
