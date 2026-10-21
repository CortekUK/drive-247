'use client';

/**
 * Settings → Consent (owner, Oct 21 2026): what the customer has agreed to,
 * and nothing to switch. WhatsApp is gone (it is not collected); more consents
 * (location and the rest) come later.
 *
 *   ACCOUNT. The rental company's privacy policy and terms of service: that
 *   the customer accepted them, which version of each, and when. Recorded by
 *   `record_customer_policy_consent` when they sign in to the portal (the
 *   sign-in screens say so), one row per version — `customer_consents`.
 *
 *   RENTALS. One row per rental: the rental agreement (signing it is consent
 *   to that rental's terms — the e-signature record), the terms and charges
 *   accepted at checkout when the booking was made online (customer_consents
 *   rows with a rental), and consent to texts about that rental (the rental's
 *   own `sms_consent`, stamped when it was given).
 *
 * Everything is read with the customer's own session and scoped by customer id
 * AND tenant, as every portal read is.
 */

import { useMemo } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';

import { formatDate, formatTimestamp } from '@nw/components/portal/format';
import { LoadError } from '@nw/portal-v2/primitives';
import { useTenant } from '@nw/contexts/TenantContext';
import { useCustomer } from '@nw/hooks/use-customer';
import { supabase } from '@nw/integrations/supabase/client';
import { cn } from '@nw/lib/utils';
import { RentalsEmptyArt } from '@portal-v2-shared/empty-states/empty-scenes';
import { TeachingEmptyState } from '@portal-v2-shared/empty-states/teaching-empty-state';
import {
  ListBody,
  ListCell,
  ListHead,
  ListRow,
  ListStatusText,
  ListTable,
  ListTableHeader,
  useProgressiveRows,
} from '@portal-v2-shared/list-table';
import { V2_LIST_CLASSES, type V2ListTone } from '@portal-v2-shared/list-styles';

import { ReadOnlyValue, SettingsPageHeader, SettingsRow, SettingsSkeleton, StatusPill } from '../_components/settings-ui';

/* eslint-disable @typescript-eslint/no-explicit-any -- untyped embeds */
const sb = supabase as any;

interface ConsentRow {
  rental_id: string | null;
  consent_type: string;
  version: string | null;
  accepted_at: string;
}

interface RentalConsent {
  id: string;
  reference: string;
  vehicle: string | null;
  start: string | null;
  end: string | null;
  agreement: { label: string; tone: V2ListTone; when: string | null };
  checkout: { label: string; tone: V2ListTone; when: string | null };
  texts: { label: string; tone: V2ListTone; when: string | null };
}

function agreementState(rows: Array<{ document_status: string | null; envelope_completed_at: string | null; envelope_sent_at: string | null }>) {
  if (rows.length === 0) return { label: 'No agreement', tone: 'muted' as const, when: null };
  const signed = rows.find((row) => (row.document_status ?? '').toLowerCase() === 'completed' || row.envelope_completed_at);
  if (signed) return { label: 'Signed', tone: 'success' as const, when: signed.envelope_completed_at };
  const declined = rows.find((row) => ['declined', 'revoked', 'expired'].includes((row.document_status ?? '').toLowerCase()));
  if (declined) return { label: 'Not signed', tone: 'danger' as const, when: null };
  const sent = rows.find((row) => row.envelope_sent_at || (row.document_status ?? '').toLowerCase() === 'sent');
  if (sent) return { label: 'Waiting for you', tone: 'warning' as const, when: sent.envelope_sent_at };
  return { label: 'Not sent yet', tone: 'muted' as const, when: null };
}

function useConsents() {
  const { tenant } = useTenant();
  const { customerId } = useCustomer();
  const tenantId = tenant?.id ?? null;

  return useQuery({
    queryKey: ['customer-consents', tenantId, customerId],
    enabled: !!tenantId && !!customerId,
    queryFn: async () => {
      const [consents, rentals] = await Promise.all([
        sb
          .from('customer_consents')
          .select('rental_id, consent_type, version, accepted_at')
          .eq('customer_id', customerId)
          .eq('tenant_id', tenantId)
          .order('accepted_at', { ascending: false }),
        sb
          .from('rentals')
          .select('id, rental_number, start_date, end_date, sms_consent, sms_consent_at, created_at, vehicles(make, model)')
          .eq('customer_id', customerId)
          .eq('tenant_id', tenantId)
          .order('start_date', { ascending: false }),
      ]);
      if (consents.error) throw new Error(consents.error.message || 'Your consents could not be loaded');
      if (rentals.error) throw new Error(rentals.error.message || 'Your rentals could not be loaded');

      const rentalRows = (rentals.data ?? []) as Array<Record<string, any>>;
      const ids = rentalRows.map((rental) => rental.id as string);
      const agreements = ids.length
        ? await sb
            .from('rental_agreements')
            .select('rental_id, document_status, envelope_sent_at, envelope_completed_at')
            .eq('tenant_id', tenantId)
            .in('rental_id', ids)
        : { data: [], error: null };
      if (agreements.error) throw new Error(agreements.error.message || 'Your agreements could not be loaded');

      return {
        consents: (consents.data ?? []) as ConsentRow[],
        rentals: rentalRows,
        agreements: (agreements.data ?? []) as Array<{ rental_id: string; document_status: string | null; envelope_sent_at: string | null; envelope_completed_at: string | null }>,
      };
    },
  });
}

export function ConsentSettings() {
  const { tenant } = useTenant();
  const company = tenant?.company_name ?? tenant?.app_name ?? 'The rental company';
  const query = useConsents();

  const account = useMemo(() => {
    const list = query.data?.consents.filter((row) => row.rental_id === null) ?? [];
    // Newest first: the version on file is the latest one accepted.
    return {
      privacy: list.find((row) => row.consent_type === 'privacy_policy') ?? null,
      terms: list.find((row) => row.consent_type === 'terms') ?? null,
    };
  }, [query.data]);

  const rows = useMemo<RentalConsent[]>(() => {
    if (!query.data) return [];
    return query.data.rentals.map((rental) => {
      const vehicle = Array.isArray(rental.vehicles) ? rental.vehicles[0] : rental.vehicles;
      const ownConsents = query.data.consents.filter((row) => row.rental_id === rental.id);
      const terms = ownConsents.find((row) => row.consent_type === 'rental_terms') ?? null;
      const charges = ownConsents.find((row) => row.consent_type === 'rental_charges') ?? null;
      const sms = ownConsents.find((row) => row.consent_type === 'sms') ?? null;
      const textsAt = rental.sms_consent_at ?? sms?.accepted_at ?? null;
      return {
        id: rental.id,
        reference: rental.rental_number ?? `R-${String(rental.id).slice(0, 6)}`,
        vehicle: vehicle ? [vehicle.make, vehicle.model].filter(Boolean).join(' ') || null : null,
        start: rental.start_date ?? null,
        end: rental.end_date ?? null,
        agreement: agreementState(query.data.agreements.filter((row) => row.rental_id === rental.id)),
        checkout: terms
          ? { label: charges ? 'Terms and charges' : 'Terms', tone: 'success', when: terms.accepted_at }
          : { label: 'Booked by the company', tone: 'muted', when: null },
        texts:
          rental.sms_consent === true || sms
            ? { label: 'Agreed', tone: 'success', when: textsAt }
            : { label: 'Not given', tone: 'muted', when: null },
      };
    });
  }, [query.data]);

  const progressive = useProgressiveRows(rows, 'consents');

  return (
    <div className="flex flex-col gap-8">
      <SettingsPageHeader
        title="Consent"
        description={`What you have agreed to with ${company}: its privacy policy and terms, and each of your rentals.`}
      />

      {query.isError ? (
        <LoadError title="We could not load your consents" error={query.error as Error} onRetry={() => void query.refetch()} />
      ) : query.isPending ? (
        <SettingsSkeleton />
      ) : (
        <>
          <div>
            <PolicyRow
              label="Privacy policy"
              href="/privacy"
              row={account.privacy}
              current={tenant?.privacy_policy_version ?? null}
            />
            <PolicyRow label="Terms of service" href="/terms" row={account.terms} current={tenant?.terms_version ?? null} />
          </div>

          <section aria-labelledby="consent-rentals-title" className="flex flex-col gap-3">
            <div>
              <h2 id="consent-rentals-title" className="text-[17px] font-semibold tracking-tight text-pv-fg">
                Your rentals
              </h2>
              <p className="mt-0.5 text-[14px] text-pv-muted-fg">What you agreed to for each rental.</p>
            </div>

            {rows.length === 0 ? (
              <TeachingEmptyState
                illustration={<RentalsEmptyArt />}
                headline="No rentals yet"
                body="When you rent with us, each rental's agreement and what you agreed to at checkout appear here."
              />
            ) : (
              <ListTable rows={progressive} minWidth="min-w-[780px]" surface="settings">
                <ListTableHeader>
                  <ListHead className="w-[26%]">Rental</ListHead>
                  <ListHead className="w-[22%]">Dates</ListHead>
                  <ListHead className="w-[18%]">Rental agreement</ListHead>
                  <ListHead className="w-[18%]">At checkout</ListHead>
                  <ListHead className="w-[16%]">Text messages</ListHead>
                </ListTableHeader>
                <ListBody>
                  {progressive.visible.map((row) => (
                    <ListRow key={row.id}>
                      <ListCell>
                        <div className="flex min-w-0 flex-col gap-0.5">
                          <Link href={`/portal/rentals/${row.id}`} className={cn(V2_LIST_CLASSES.identifier, 'truncate hover:underline')}>
                            {row.reference}
                          </Link>
                          {row.vehicle ? <span className="truncate text-[12px] text-v2-muted-fg">{row.vehicle}</span> : null}
                        </div>
                      </ListCell>
                      <ListCell>
                        <span className={cn(V2_LIST_CLASSES.text, 'tabular-nums')}>
                          {[formatDate(row.start), formatDate(row.end)].filter(Boolean).join(' – ') || '—'}
                        </span>
                      </ListCell>
                      <StateCell state={row.agreement} />
                      <StateCell state={row.checkout} />
                      <StateCell state={row.texts} />
                    </ListRow>
                  ))}
                </ListBody>
              </ListTable>
            )}
          </section>
        </>
      )}
    </div>
  );
}

function StateCell({ state }: { state: { label: string; tone: V2ListTone; when: string | null } }) {
  return (
    <ListCell>
      <div className="flex min-w-0 flex-col gap-0.5">
        <ListStatusText tone={state.tone}>{state.label}</ListStatusText>
        {state.when ? <span className="truncate text-[12px] tabular-nums text-v2-muted-fg">{formatTimestamp(state.when)}</span> : null}
      </div>
    </ListCell>
  );
}

function PolicyRow({ label, href, row, current }: { label: string; href: string; row: ConsentRow | null; current: string | null }) {
  const outdated = row !== null && current !== null && row.version !== null && row.version !== current;
  return (
    <SettingsRow
      label={label}
      description={
        <>
          <Link href={href} target="_blank" className="font-medium text-pv-link underline-offset-2 hover:underline">
            Read the {label.toLowerCase()}
          </Link>
          {row ? ` · accepted when you signed in on ${formatTimestamp(row.accepted_at) ?? row.accepted_at}.` : null}
        </>
      }
    >
      <ReadOnlyValue
        value={row ? `Version ${row.version ?? '—'}` : <span className="text-pv-muted-fg">Not recorded yet</span>}
        badge={
          row ? (
            <StatusPill tone={outdated ? 'notice' : 'positive'}>{outdated ? `Version ${current} is newer` : 'Accepted'}</StatusPill>
          ) : undefined
        }
      />
    </SettingsRow>
  );
}
