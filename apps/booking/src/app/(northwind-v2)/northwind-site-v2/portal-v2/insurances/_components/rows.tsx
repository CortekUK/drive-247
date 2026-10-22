'use client';

/**
 * One row per insurance, whichever table it came from: the certificates the
 * customer uploaded (`customer_documents`) and the Bonzah policies bought with a
 * booking (`bonzah_insurance_policies`). The table, the row menu and the detail
 * dialog all read this shape.
 */

import { formatDate } from '@nw/components/portal/format';
import type { CustomerDocument, CustomerInsurancePolicy } from '@nw/hooks/use-customer-documents';
import { cn } from '@nw/lib/utils';
import type { V2ListTone } from '@portal-v2-shared/list-styles';

interface BaseRow {
  key: string;
  name: string;
  provider: string | null;
  policyNumber: string | null;
  start: string | null;
  end: string | null;
  status: { label: string; tone: V2ListTone };
  /** When it was uploaded or issued. Ordering and the detail dialog only. */
  addedAt: string | null;
  booking: { id: string; reference: string } | null;
}

export type InsuranceRow =
  | (BaseRow & { kind: 'upload'; document: CustomerDocument })
  | (BaseRow & { kind: 'bonzah'; policy: CustomerInsurancePolicy });

const titleCase = (value: string) =>
  value
    .replace(/_/g, ' ')
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase());

function uploadStatus(doc: CustomerDocument): BaseRow['status'] {
  if (doc.expiry === 'expired') return { label: 'Expired', tone: 'danger' };
  if (doc.expiry === 'expiring') return { label: 'Expires soon', tone: 'warning' };
  return doc.isVerified ? { label: 'Verified', tone: 'success' } : { label: 'Awaiting review', tone: 'muted' };
}

function policyStatus(policy: CustomerInsurancePolicy, today: string): BaseRow['status'] {
  if (policy.status === 'active') {
    return policy.endDate && policy.endDate.slice(0, 10) < today ? { label: 'Ended', tone: 'muted' } : { label: 'Active', tone: 'success' };
  }
  if (policy.status === 'pending') return { label: 'Pending', tone: 'warning' };
  if (policy.status === 'cancelled') return { label: 'Cancelled', tone: 'danger' };
  return { label: titleCase(policy.rawStatus || 'Unknown'), tone: 'muted' };
}

function todayString(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

export function toRows(documents: readonly CustomerDocument[], policies: readonly CustomerInsurancePolicy[]): InsuranceRow[] {
  const today = todayString();
  const uploads: InsuranceRow[] = documents
    .filter((doc) => doc.category === 'insurance')
    .map((doc) => ({
      kind: 'upload',
      key: `upload-${doc.id}`,
      name: doc.name,
      provider: doc.insuranceProvider,
      policyNumber: doc.policyNumber,
      start: doc.startDate,
      end: doc.endDate,
      status: uploadStatus(doc),
      addedAt: doc.uploadedAt,
      booking: doc.booking,
      document: doc,
    }));
  const bonzah: InsuranceRow[] = policies.map((policy) => ({
    kind: 'bonzah',
    key: `bonzah-${policy.id}`,
    name: policy.title,
    provider: 'Bonzah',
    policyNumber: policy.policyNumber,
    start: policy.startDate || null,
    end: policy.endDate || null,
    status: policyStatus(policy, today),
    addedAt: policy.issuedAt,
    booking: policy.booking,
    policy,
  }));
  return [...uploads, ...bonzah].sort((a, b) => (b.addedAt ?? '').localeCompare(a.addedAt ?? ''));
}

export function shortDate(iso: string | null): string | null {
  return iso ? (formatDate(iso.slice(0, 10)) ?? iso) : null;
}

export function coverRange(start: string | null, end: string | null): string {
  const from = shortDate(start);
  const to = shortDate(end);
  if (from && to) return `${from} – ${to}`;
  if (to) return `Until ${to}`;
  if (from) return `From ${from}`;
  return '—';
}

/** Bonzah's wordmark, bare — no pill, no glyph beside it. */
export function BonzahLogo({ className }: { className?: string }) {
  return (
    <span title="Bonzah insurance" className={cn('inline-flex shrink-0 items-center', className)}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/bonzah-logo.svg" alt="Bonzah" className="h-3.5 w-auto dark:hidden" />
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/bonzah-logo-dark.svg" alt="Bonzah" className="hidden h-3.5 w-auto dark:block" />
    </span>
  );
}
