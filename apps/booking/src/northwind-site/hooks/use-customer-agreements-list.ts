'use client';

/**
 * The signed-in customer's agreements, as the operator's Agreements list reads
 * them (apps/portal/src/hooks/use-agreements-list-v2.ts): one row per
 * agreement sent, rental or individual, in the shared row shape
 * (shared/portal-v2/agreements/list.ts), newest sent first.
 *
 *   - RENTAL agreements: `rental_agreements` for this customer's rentals. RLS
 *     ("Customers can read own rental agreements") already limits the read to
 *     them; the tenant and the rental's customer are filtered here as well.
 *   - INDIVIDUAL agreements (sent from the operator's Agreements tab, "Linked
 *     to: Customer"): `individual_agreements_v2` rows whose customer is this
 *     one, readable by the customer under its own read policy
 *     (20261021090000_individual_agreements_customer_read.sql).
 *
 * The customer and tenant come from the session, never from a prop.
 *
 * Also the two calls the agreement drawer makes for a customer: the document
 * of an individual agreement and the activity log, both from the
 * `agreements-v2` function, which admits a signed-in customer to its
 * read-only actions for their own agreements only.
 */

import { useQuery } from '@tanstack/react-query';
import { FunctionsHttpError } from '@supabase/supabase-js';

import { useTenant } from '@nw/contexts/TenantContext';
import { useCustomer } from '@nw/hooks/use-customer';
import { supabase } from '@nw/integrations/supabase/client';
import type { AgreementEvent } from '@portal-v2-shared/agreements/activity';
import type { IndividualDocument } from '@portal-v2-shared/agreements/document';
import {
  sortAgreementRows,
  toAgreementStatus,
  type AgreementKind,
  type AgreementListRow,
} from '@portal-v2-shared/agreements/list';

/* eslint-disable @typescript-eslint/no-explicit-any -- untyped embeds, as on the operator's list */
const sb = supabase as any;

const RENTAL_SELECT = `
  id,
  rental_id,
  agreement_type,
  document_id,
  document_status,
  envelope_created_at,
  envelope_sent_at,
  envelope_completed_at,
  created_at,
  rentals!rental_agreements_rental_id_fkey!inner(id, rental_number, customer_id)
`;

const INDIVIDUAL_SELECT =
  'id, customer_id, recipient_name, recipient_email, cc_emails, title, message, document_id, document_status, sent_at, completed_at, created_at';

type One<T> = T | T[] | null | undefined;
const one = <T,>(value: One<T>): T | null => (Array.isArray(value) ? value[0] ?? null : value ?? null);

/** A missing table reads as "none yet", as on the operator's list. */
function isMissingTable(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  if (error.code === '42P01' || error.code === 'PGRST205') return true;
  const m = (error.message ?? '').toLowerCase();
  return m.includes('could not find the table');
}

export function useCustomerAgreementsList() {
  const { tenant } = useTenant();
  const { customerId, displayName, email } = useCustomer();
  const tenantId = tenant?.id ?? null;

  const query = useQuery({
    queryKey: ['customer-agreements-list', tenantId, customerId],
    enabled: !!tenantId && !!customerId,
    queryFn: async (): Promise<AgreementListRow[]> => {
      const [rental, individual] = await Promise.all([
        sb
          .from('rental_agreements')
          .select(RENTAL_SELECT)
          .eq('tenant_id', tenantId)
          .eq('rentals.customer_id', customerId)
          .order('created_at', { ascending: false }),
        sb
          .from('individual_agreements_v2')
          .select(INDIVIDUAL_SELECT)
          .eq('tenant_id', tenantId)
          .eq('customer_id', customerId)
          .order('created_at', { ascending: false }),
      ]);
      if (rental.error) throw new Error(rental.error.message || 'Your agreements could not be loaded');
      if (individual.error && !isMissingTable(individual.error)) {
        throw new Error(individual.error.message || 'Your agreements could not be loaded');
      }

      const rows: AgreementListRow[] = [];
      for (const r of rental.data ?? []) {
        const status = toAgreementStatus(r.document_status);
        if (status === 'hidden') continue;
        const rentalRow = one<{ id: string; rental_number: string | null }>(r.rentals);
        const rentalId = r.rental_id ?? rentalRow?.id ?? null;
        rows.push({
          id: r.id,
          kind: 'rental',
          customerName: displayName ?? '',
          customerEmail: email ?? '',
          sentAt: r.envelope_sent_at ?? r.envelope_created_at ?? r.created_at ?? null,
          status,
          rawStatus: r.document_status ?? '',
          rentalId,
          rentalRef: rentalRow?.rental_number || (rentalId ? rentalId.slice(0, 8) : null),
          customerId,
          documentId: r.document_id ?? null,
          title: r.agreement_type === 'extension' ? 'Extension agreement' : 'Rental agreement',
          message: null,
          cc: [],
          signedAt: r.envelope_completed_at ?? null,
        });
      }
      for (const r of individual.error ? [] : individual.data ?? []) {
        const status = toAgreementStatus(r.document_status);
        if (status === 'hidden') continue;
        rows.push({
          id: r.id,
          kind: 'individual',
          customerName: r.recipient_name ?? displayName ?? '',
          customerEmail: r.recipient_email ?? email ?? '',
          sentAt: r.sent_at ?? r.created_at ?? null,
          status,
          rawStatus: r.document_status ?? '',
          rentalId: null,
          rentalRef: null,
          customerId: r.customer_id ?? null,
          documentId: r.document_id ?? null,
          title: r.title ?? null,
          message: r.message ?? null,
          cc: Array.isArray(r.cc_emails) ? r.cc_emails.filter((e: unknown): e is string => typeof e === 'string' && e !== '') : [],
          signedAt: r.completed_at ?? null,
        });
      }
      return sortAgreementRows(rows);
    },
  });

  return {
    rows: query.data ?? [],
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error as Error | null,
    refetch: query.refetch,
  };
}

/* ───────────────────── the drawer's calls, as the customer ───────────────────── */

async function callAgreements(body: Record<string, unknown>): Promise<Record<string, any>> {
  const { data, error } = await supabase.functions.invoke('agreements-v2', { body });
  if (!error) return (data ?? {}) as Record<string, any>;
  if (error instanceof FunctionsHttpError) {
    const payload = await (error.context as Response).json().catch(() => null);
    throw new Error(payload?.error || 'The agreement could not be loaded. Try again.');
  }
  throw new Error('The agreements service could not be reached. Try again.');
}

/** An individual agreement's document: the provider's PDF, else the html that was sent. */
export async function fetchCustomerAgreementDocument(id: string): Promise<IndividualDocument> {
  const data = await callAgreements({ action: 'document', id });
  if (data.kind === 'pdf' && typeof data.base64 === 'string') return { kind: 'pdf', base64: data.base64, signed: data.signed === true };
  if (data.kind === 'html' && typeof data.html === 'string') return { kind: 'html', html: data.html };
  throw new Error('No document came back.');
}

/** Every step of an agreement, oldest first (the operator's activity log). */
export async function fetchCustomerAgreementHistory(
  id: string,
  kind: AgreementKind,
): Promise<{ events: AgreementEvent[]; partial: boolean }> {
  const data = await callAgreements({ action: 'history', id, kind });
  const events = Array.isArray(data.events)
    ? (data.events as AgreementEvent[]).filter((e) => e && typeof e.at === 'string' && typeof e.label === 'string')
    : [];
  return { events, partial: data.partial === true };
}
