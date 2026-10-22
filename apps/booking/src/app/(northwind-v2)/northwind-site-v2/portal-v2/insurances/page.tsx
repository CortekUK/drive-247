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
 *     via useCustomerInsurancePolicies). Bonzah's branding lives in ONE place:
 *     its logo in the Provider column, nowhere else (owner, Oct 22 2026).
 *
 * Owner's pass, Oct 22 2026: no decorative icons; one fact per cell, one line
 * per row (Insurance · Provider · Policy number · Coverage dates · Status);
 * the row's actions behind a three-dot menu — View (the document itself, in
 * the browser's PDF viewer, in a new tab), Download (straight from the row),
 * Delete (asks first). No dialog opens from the table, and a row is not a
 * link: as in the operator's insurances table, the menu is where things happen.
 *
 * The table is the shared v2 list (shared/portal-v2/list-table), as the
 * Rentals and Agreements tables are. Search lives in the top bar. Both hooks
 * filter on this customer AND this tenant; nothing here queries on its own.
 */

import { useMemo, useState } from 'react';
import { Plus } from 'lucide-react-nw';

import { LoadError, PageHeader, Panel } from '@nw/portal-v2/primitives';
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
import { V2_BUTTON_GHOST_SM, V2_BUTTON_PRIMARY } from '@portal-v2-shared/button-styles';
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
import { V2_LIST_CLASSES } from '@portal-v2-shared/list-styles';
import { usePageSearch } from '@portal-v2-shared/page-search-slot';

import { Notice } from './_components/kit';
import { RowMenu } from './_components/row-menu';
import { BonzahLogo, coverRange, toRows, type InsuranceRow } from './_components/rows';
import { downloadExternal, externalFileUrl, useViewDocument } from './_components/use-view-document';
import { DeleteDocumentDialog } from './delete-dialog';
import { UploadDocumentDialog } from './upload-dialog';

type PolicyPdf = CustomerInsurancePolicy['pdfIds'][number];

/** An empty state in words only: a title, one line, one quiet action. */
function Empty({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action: { label: string; onClick: () => void };
}) {
  return (
    <div className="flex flex-col items-center gap-4 px-6 py-14 text-center">
      <div className="max-w-sm">
        <p className="text-[15px] font-semibold text-pv-fg">{title}</p>
        <p className="mt-1 text-[13px] leading-relaxed text-pv-muted-fg">{description}</p>
      </div>
      <button type="button" onClick={action.onClick} className={V2_BUTTON_GHOST_SM}>
        {action.label}
      </button>
    </div>
  );
}

/* ──────────────────────────────── page ─────────────────────────────────── */

export default function PortalInsurancesPage() {
  const { documents, isLoading: docsLoading, isError: docsError, error, refetch } = useCustomerDocuments();
  const { policies, isLoading: policiesLoading, isError: policiesError } = useCustomerInsurancePolicies();
  const download = useDocumentDownload();
  const policyPdf = usePolicyPdfDownload();
  const viewer = useViewDocument();
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

  const isDownloading = (row: InsuranceRow) =>
    row.kind === 'upload'
      ? download.downloadingId === row.document.id
      : Boolean(policyPdf.downloadingKey?.startsWith(`${row.policy.id}:`));
  const isViewing = (row: InsuranceRow) =>
    row.kind === 'upload'
      ? viewer.viewingKey === row.document.id
      : Boolean(viewer.viewingKey?.startsWith(`${row.policy.id}:`));
  const viewDocument = (row: InsuranceRow) => {
    if (row.kind === 'upload') void viewer.viewDocument(row.document);
  };
  const viewPolicy = (row: InsuranceRow, entry: PolicyPdf | undefined) => {
    if (row.kind === 'bonzah' && entry) void viewer.viewPolicy(row.policy, entry);
  };
  const downloadDocument = (row: InsuranceRow) => {
    if (row.kind !== 'upload') return;
    const external = externalFileUrl(row.document);
    void (external ? downloadExternal(row.document, external) : download.download(row.document));
  };
  const downloadPolicy = (row: InsuranceRow, entry: PolicyPdf | undefined) => {
    if (row.kind === 'bonzah' && entry) void policyPdf.download(row.policy, entry);
  };
  const askDelete = (row: InsuranceRow) => {
    if (row.kind !== 'upload' || !row.document.canDelete) return;
    setDeleteError(null);
    setPendingDelete(row.document);
  };

  const handleDelete = async () => {
    if (!pendingDelete) return;
    setDeleteError(null);
    try {
      await remove.mutateAsync(pendingDelete);
      setConfirmation(`“${pendingDelete.name}” has been removed.`);
      setPendingDelete(null);
    } catch (caught: unknown) {
      setDeleteError(caught instanceof Error ? caught.message : 'We could not remove that insurance.');
    }
  };

  const downloadError = viewer.error ?? download.error ?? policyPdf.error;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Insurances"
        description="Every insurance you have uploaded, and the cover bought with your rentals, in one place."
        actionClassName={HEADER_ACTIONS_V2}
        action={
          <button
            type="button"
            onClick={() => setUploadOpen(true)}
            className={cn(V2_BUTTON_PRIMARY, HEADER_PRIMARY_V2, 'flex-1 sm:flex-none')}
          >
            <Plus aria-hidden />
            Upload insurance
          </button>
        }
      />

      {confirmation ? (
        <Notice plain tone="success">
          {confirmation}
        </Notice>
      ) : null}
      {downloadError ? (
        <Notice plain tone="danger">
          {downloadError}
        </Notice>
      ) : null}
      {policiesError && !docsError ? (
        <Notice plain tone="warning">
          We could not load your Bonzah policies just now. Your uploads are shown below.
        </Notice>
      ) : null}

      {docsError ? (
        <LoadError title="We could not load your insurances" error={error} onRetry={() => void refetch()} />
      ) : noInsurance ? (
        <Panel>
          <Empty
            title="No insurance on file yet"
            description="Upload your own insurance certificate, or add Bonzah cover when you book. Every policy appears here."
            action={{ label: 'Upload insurance', onClick: () => setUploadOpen(true) }}
          />
        </Panel>
      ) : !isLoading && shown.length === 0 ? (
        <Panel>
          <Empty
            title="No insurances match"
            description="Try a different search."
            action={{ label: 'Clear search', onClick: () => setTerm('') }}
          />
        </Panel>
      ) : (
        <section className="flex flex-col gap-3" aria-label="Your insurances">
          {/*
            One fact per cell, one line per row. A long policy number truncates
            and is shown whole on hover.
          */}
          <ListTable rows={progressive} minWidth="min-w-[860px]">
            <ListTableHeader>
              <ListHead className="w-[26%]">Insurance</ListHead>
              <ListHead className="w-[13%]">Provider</ListHead>
              <ListHead className="w-[22%]">Policy number</ListHead>
              <ListHead className="w-[22%]">Coverage dates</ListHead>
              <ListHead className="w-[17%]">Status</ListHead>
              <ListHead className="w-14">
                <span className="sr-only">Actions</span>
              </ListHead>
            </ListTableHeader>
            <ListBody>
              {isLoading
                ? [0, 1, 2].map((i) => (
                    <ListRow key={`skeleton-${i}`} aria-hidden>
                      {[40, 20, 28, 30, 16, 0].map((w, j) => (
                        <ListCell key={j}>
                          {w ? (
                            <span className="block h-3 animate-pulse rounded-full bg-v2-muted" style={{ width: `${w * 2}%` }} />
                          ) : null}
                        </ListCell>
                      ))}
                    </ListRow>
                  ))
                : progressive.visible.map((row) => (
                    <ListRow key={row.key}>
                      <ListCell>
                        <span className={cn(V2_LIST_CLASSES.identifier, 'block truncate')} title={row.name}>
                          {row.name}
                        </span>
                      </ListCell>
                      <ListCell>
                        {/* Bonzah's one mark on the page: the logo, not the word. */}
                        {row.kind === 'bonzah' ? (
                          <BonzahLogo />
                        ) : (
                          <span className={cn(V2_LIST_CLASSES.text, 'block truncate')} title={row.provider ?? undefined}>
                            {row.provider ?? '—'}
                          </span>
                        )}
                      </ListCell>
                      <ListCell>
                        {row.policyNumber ? (
                          <span className={cn(V2_LIST_CLASSES.text, 'block truncate tabular-nums')} title={row.policyNumber}>
                            {row.policyNumber}
                          </span>
                        ) : (
                          <span className="text-sm text-v2-muted-fg">{row.kind === 'bonzah' ? 'Pending' : '—'}</span>
                        )}
                      </ListCell>
                      <ListCell>
                        <span className={cn(V2_LIST_CLASSES.text, 'whitespace-nowrap tabular-nums')}>
                          {coverRange(row.start, row.end)}
                        </span>
                      </ListCell>
                      <ListCell>
                        <ListStatusText tone={row.status.tone}>{row.status.label}</ListStatusText>
                      </ListCell>
                      <ListCell className="pl-0 text-right">
                        <RowMenu
                          row={row}
                          downloading={isDownloading(row)}
                          viewing={isViewing(row)}
                          onViewDocument={() => viewDocument(row)}
                          onViewPolicy={(entry) => viewPolicy(row, entry)}
                          onDownloadDocument={() => downloadDocument(row)}
                          onDownloadPolicy={(entry) => downloadPolicy(row, entry)}
                          onDelete={() => askDelete(row)}
                        />
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
