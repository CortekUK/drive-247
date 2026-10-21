'use client';

/**
 * /portal/insurances — every insurance the customer has, in one table.
 *
 * Replaced Documents on Oct 21 2026 (owner): one stop for cover. Two sources,
 * one list, newest first:
 *
 *   - the insurance certificates the customer uploaded (`customer_documents`,
 *     `document_type = 'Insurance Certificate'`, via useCustomerDocuments);
 *   - the Bonzah policies bought with a booking (`bonzah_insurance_policies`,
 *     via useCustomerInsurancePolicies), each tagged with the Bonzah logo so
 *     it is plain which cover came from Bonzah and which is the customer's own.
 *
 * The table is the shared v2 list (shared/portal-v2/list-table), as the
 * Rentals and Agreements tables are. Search lives in the top bar. Both hooks
 * filter on this customer AND this tenant; nothing here queries on its own.
 */

import { useMemo, useState } from 'react';
import Link from 'next/link';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { Download, Loader2, Plus, SearchX, ShieldCheck, Trash2 } from 'lucide-react-nw';

import { formatDate, formatTimestamp } from '@nw/components/portal/format';
import { MOTION_ANCHORED } from '@nw/components/ui/motion';
import { EmptyState, LoadError, PageHeader, Panel } from '@nw/portal-v2/primitives';
import {
  useCustomerDocuments,
  useCustomerInsurancePolicies,
  useDeleteCustomerDocument,
  useDocumentDownload,
  usePolicyPdfDownload,
  type CustomerDocument,
  type CustomerInsurancePolicy,
} from '@nw/hooks/use-customer-documents';
import { cn } from '@nw/lib/utils';
import { V2_BUTTON_GHOST_ICON_SM, V2_BUTTON_GHOST_SM, V2_BUTTON_PRIMARY } from '@portal-v2-shared/button-styles';
import { HEADER_ACTIONS_V2, HEADER_PRIMARY_V2 } from '@portal-v2-shared/header';
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
import { usePageSearch } from '@portal-v2-shared/page-search-slot';

import { Notice } from './_components/kit';
import { DeleteDocumentDialog } from './delete-dialog';
import { UploadDocumentDialog } from './upload-dialog';

/* ──────────────────────────────── rows ─────────────────────────────────── */

interface BaseRow {
  key: string;
  name: string;
  provider: string | null;
  policyNumber: string | null;
  start: string | null;
  end: string | null;
  status: { label: string; tone: V2ListTone };
  /** For ordering: when it was added or issued. */
  addedAt: string | null;
  booking: { id: string; reference: string } | null;
}

type InsuranceRow =
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

function toRows(documents: readonly CustomerDocument[], policies: readonly CustomerInsurancePolicy[]): InsuranceRow[] {
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

/* ─────────────────────────────── pieces ────────────────────────────────── */

/** Bonzah's own logo in its brand tint, so a Bonzah row is plain at a glance. */
function BonzahTag() {
  return (
    <span
      title="Bonzah insurance"
      className="inline-flex h-5 shrink-0 items-center rounded-full bg-[rgba(204,0,74,0.1)] px-2 dark:bg-[rgba(204,0,74,0.2)]"
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/bonzah-logo.svg" alt="Bonzah" className="h-3 w-auto dark:hidden" />
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/bonzah-logo-dark.svg" alt="Bonzah" className="hidden h-3 w-auto dark:block" />
    </span>
  );
}

function coverRange(start: string | null, end: string | null): string {
  const from = start ? (formatDate(start.slice(0, 10)) ?? start) : null;
  const to = end ? (formatDate(end.slice(0, 10)) ?? end) : null;
  if (from && to) return `${from} – ${to}`;
  if (to) return `Until ${to}`;
  if (from) return `From ${from}`;
  return '—';
}

const MENU_ITEM =
  'flex cursor-pointer select-none items-center gap-2 rounded-lg px-2.5 py-1.5 text-[13px] text-pv-fg outline-none ' +
  'transition-colors duration-200 data-[highlighted]:bg-pv-hover data-[disabled]:opacity-60 motion-reduce:transition-none';

/* ──────────────────────────────── page ─────────────────────────────────── */

export default function PortalInsurancesPage() {
  const { documents, isLoading: docsLoading, isError: docsError, error, refetch } = useCustomerDocuments();
  const { policies, isLoading: policiesLoading, isError: policiesError } = useCustomerInsurancePolicies();
  const download = useDocumentDownload();
  const policyPdf = usePolicyPdfDownload();
  const remove = useDeleteCustomerDocument();

  const [term, setTerm] = useState('');
  const [uploadOpen, setUploadOpen] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<CustomerDocument | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState<string | null>(null);

  const isLoading = docsLoading || policiesLoading;
  const rows = useMemo(() => toRows(documents, policies), [documents, policies]);
  const shown = useMemo(() => {
    const q = term.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((row) =>
      [row.name, row.provider, row.policyNumber, row.booking?.reference]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(q)),
    );
  }, [rows, term]);
  const progressive = useProgressiveRows(shown, term);
  const noInsurance = !isLoading && !docsError && rows.length === 0;

  usePageSearch(
    noInsurance
      ? null
      : {
          placeholder: 'Search insurances…',
          value: term,
          onChange: setTerm,
          scopeLabel: 'Insurances',
          resultCount: isLoading ? undefined : shown.length,
        },
  );

  const handleDelete = async () => {
    if (!pendingDelete) return;
    setDeleteError(null);
    try {
      await remove.mutateAsync(pendingDelete);
      setConfirmation(`“${pendingDelete.name}” has been removed.`);
      setPendingDelete(null);
    } catch (caught: unknown) {
      setDeleteError(caught instanceof Error ? caught.message : 'We could not remove that document.');
    }
  };

  const downloadError = download.error ?? policyPdf.error;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Insurances"
        description="Every insurance you have uploaded, and your Bonzah cover, in one place."
        actionClassName={HEADER_ACTIONS_V2}
        action={
          <button type="button" onClick={() => setUploadOpen(true)} className={cn(V2_BUTTON_PRIMARY, HEADER_PRIMARY_V2, 'flex-1 sm:flex-none')}>
            <Plus aria-hidden />
            Upload insurance
          </button>
        }
      />

      {confirmation ? <Notice tone="success">{confirmation}</Notice> : null}
      {downloadError ? <Notice tone="danger">{downloadError}</Notice> : null}
      {policiesError && !docsError ? (
        <Notice tone="warning">We could not load your Bonzah policies just now. Your uploads are shown below.</Notice>
      ) : null}

      {docsError ? (
        <LoadError title="We could not load your insurances" error={error} onRetry={() => void refetch()} />
      ) : noInsurance ? (
        <Panel>
          <EmptyState
            icon={ShieldCheck}
            title="No insurance on file yet"
            description="Upload your own insurance certificate, or add Bonzah cover when you book. Every policy appears here."
            action={{ label: 'Upload insurance', onClick: () => setUploadOpen(true) }}
          />
        </Panel>
      ) : !isLoading && shown.length === 0 ? (
        <Panel>
          <EmptyState
            icon={SearchX}
            title="No insurances match"
            description="Try a different search."
            action={{ label: 'Clear search', onClick: () => setTerm('') }}
          />
        </Panel>
      ) : (
        <section className="flex flex-col gap-3" aria-label="Your insurances">
          <ListTable rows={progressive} minWidth="min-w-[860px]">
            <ListTableHeader>
              <ListHead className="w-[30%]">Insurance</ListHead>
              <ListHead className="w-[14%]">Provider</ListHead>
              <ListHead className="w-[22%]">Cover</ListHead>
              <ListHead className="w-[14%]">Status</ListHead>
              <ListHead className="w-[10%]">Rental</ListHead>
              <ListHead className="w-[10%] text-right">
                <span className="sr-only">Actions</span>
              </ListHead>
            </ListTableHeader>
            <ListBody>
              {isLoading
                ? [0, 1, 2].map((i) => (
                    <ListRow key={`skeleton-${i}`} aria-hidden>
                      {[40, 20, 30, 16, 12, 8].map((w, j) => (
                        <ListCell key={j}>
                          <span className="block h-3 animate-pulse rounded-full bg-v2-muted" style={{ width: `${w * 2}%` }} />
                        </ListCell>
                      ))}
                    </ListRow>
                  ))
                : progressive.visible.map((row) => (
                    <ListRow key={row.key}>
                      <ListCell>
                        <div className="flex min-w-0 flex-col gap-0.5">
                          <span className="flex min-w-0 items-center gap-2">
                            <span className={cn(V2_LIST_CLASSES.identifier, 'truncate')}>{row.name}</span>
                            {row.kind === 'bonzah' ? <BonzahTag /> : null}
                          </span>
                          <span className="truncate text-[12px] text-v2-muted-fg">
                            {row.policyNumber ? `Policy ${row.policyNumber}` : row.kind === 'upload' ? 'Uploaded by you' : 'Policy number pending'}
                            {row.addedAt ? ` · ${formatTimestamp(row.addedAt) ?? ''}` : ''}
                          </span>
                        </div>
                      </ListCell>
                      <ListCell>
                        <span className={V2_LIST_CLASSES.text}>{row.provider ?? '—'}</span>
                      </ListCell>
                      <ListCell>
                        <span className={cn(V2_LIST_CLASSES.text, 'tabular-nums')}>{coverRange(row.start, row.end)}</span>
                      </ListCell>
                      <ListCell>
                        <ListStatusText tone={row.status.tone}>{row.status.label}</ListStatusText>
                      </ListCell>
                      <ListCell>
                        {row.booking ? (
                          <Link href={`/portal/rentals/${row.booking.id}`} className="text-sm font-medium text-v2-primary hover:underline">
                            {row.booking.reference}
                          </Link>
                        ) : (
                          <span className="text-sm text-v2-muted-fg">—</span>
                        )}
                      </ListCell>
                      <ListCell className="text-right">
                        <div className="flex items-center justify-end gap-0.5">
                          {row.kind === 'upload' ? (
                            <>
                              <button
                                type="button"
                                onClick={() => void download.download(row.document)}
                                disabled={!row.document.storagePath || download.downloadingId === row.document.id}
                                aria-label={`Download ${row.name}`}
                                title="Download"
                                className={V2_BUTTON_GHOST_ICON_SM}
                              >
                                {download.downloadingId === row.document.id ? <Loader2 aria-hidden className="animate-spin" /> : <Download aria-hidden />}
                              </button>
                              {row.document.canDelete ? (
                                <button
                                  type="button"
                                  onClick={() => {
                                    setDeleteError(null);
                                    setPendingDelete(row.document);
                                  }}
                                  aria-label={`Remove ${row.name}`}
                                  title="Remove"
                                  className={cn(V2_BUTTON_GHOST_ICON_SM, 'hover:text-v2-destructive')}
                                >
                                  <Trash2 aria-hidden />
                                </button>
                              ) : null}
                            </>
                          ) : row.policy.pdfIds.length === 0 ? (
                            <span className="text-[12px] text-v2-muted-fg">No PDF yet</span>
                          ) : (
                            <DropdownMenu.Root modal={false}>
                              <DropdownMenu.Trigger asChild>
                                <button type="button" aria-label={`Download ${row.name}`} title="Download" className={V2_BUTTON_GHOST_ICON_SM}>
                                  {policyPdf.downloadingKey?.startsWith(`${row.policy.id}:`) ? (
                                    <Loader2 aria-hidden className="animate-spin" />
                                  ) : (
                                    <Download aria-hidden />
                                  )}
                                </button>
                              </DropdownMenu.Trigger>
                              <DropdownMenu.Portal>
                                <DropdownMenu.Content
                                  align="end"
                                  sideOffset={6}
                                  className={cn('z-50 min-w-48 rounded-xl border border-pv-border bg-pv-card p-1.5 text-pv-fg shadow-lg outline-none', MOTION_ANCHORED)}
                                >
                                  {row.policy.pdfIds.map((entry) => (
                                    <DropdownMenu.Item
                                      key={entry.coverage}
                                      className={MENU_ITEM}
                                      disabled={policyPdf.downloadingKey === `${row.policy.id}:${entry.coverage}`}
                                      onSelect={() => void policyPdf.download(row.policy, entry)}
                                    >
                                      <Download aria-hidden className="size-4 text-pv-muted-fg" />
                                      {entry.label} policy
                                    </DropdownMenu.Item>
                                  ))}
                                </DropdownMenu.Content>
                              </DropdownMenu.Portal>
                            </DropdownMenu.Root>
                          )}
                        </div>
                      </ListCell>
                    </ListRow>
                  ))}
            </ListBody>
          </ListTable>
          {isLoading ? null : (
            <div className={V2_LIST_CLASSES.footer}>
              <span>
                {progressive.hasMore
                  ? `Showing ${progressive.visible.length} of ${progressive.total} insurances`
                  : `All ${progressive.total} ${progressive.total === 1 ? 'insurance' : 'insurances'} shown`}
              </span>
              {progressive.hasMore ? (
                <button type="button" onClick={progressive.showMore} className={cn(V2_BUTTON_GHOST_SM, V2_LIST_CLASSES.showMore)}>
                  Show more
                </button>
              ) : null}
            </div>
          )}
        </section>
      )}

      <UploadDocumentDialog
        open={uploadOpen}
        onOpenChange={setUploadOpen}
        insuranceOnly
        onUploaded={(count) => {
          setConfirmation(
            count === 1
              ? 'Your insurance was uploaded. We will review it shortly.'
              : `${count} insurance documents were uploaded. We will review them shortly.`,
          );
        }}
      />

      <DeleteDocumentDialog
        document={pendingDelete}
        isDeleting={remove.isPending}
        error={deleteError}
        onCancel={() => {
          setPendingDelete(null);
          setDeleteError(null);
        }}
        onConfirm={() => {
          void handleDelete();
        }}
      />
    </div>
  );
}
