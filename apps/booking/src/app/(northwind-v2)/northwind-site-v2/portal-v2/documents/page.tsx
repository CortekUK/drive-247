'use client';

/**
 * Everything the operator holds on file for this customer, plus a way to add
 * to it.
 *
 * ── WHY SECTIONS AND NOT TABS ───────────────────────────────────────────────
 * The bookings page uses a segmented filter because a customer accumulates
 * dozens of rentals. Paperwork does not work that way: three or four documents
 * is a full set, and a filter bar over four rows is chrome that hides them.
 * Each panel here renders only when it holds something, so a customer with one
 * insurance certificate sees exactly one panel.
 *
 * ── WHAT IS NOT ON THIS PAGE ────────────────────────────────────────────────
 * Signed rental agreements. The sidebar hint promises them, and they are not
 * here, because they CANNOT be: `customer_documents.document_type` has a CHECK
 * constraint that rejects 'Agreement' (verified live against staging), so a
 * signed agreement never lands in this table. They live in `rental_agreements`
 * and are fetched through an esign view route this app does not have yet. See
 * the header of `use-customer-documents.ts`.
 */

import { useState } from 'react';
import { FileText, Plus } from 'lucide-react-nw';

import {
  EmptyState,
  LoadError,
  PageHeader,
  Panel,
  PanelHeader,
} from '@nw/portal-v2/primitives';
import { Button } from '@nw/components/ui/button';
import { Skeleton } from '@nw/components/ui/skeleton';
import {
  useCustomerDocuments,
  useCustomerInsurancePolicies,
  useDeleteCustomerDocument,
  useDocumentDownload,
  usePolicyPdfDownload,
  type CustomerDocument,
  type DocumentCategory,
} from '@nw/hooks/use-customer-documents';

import { Notice } from './_components/kit';
import { DeleteDocumentDialog } from './delete-dialog';
import { DocumentCard } from './document-card';
import { PolicyCard } from './policy-card';
import { UploadDocumentDialog } from './upload-dialog';

const SECTIONS: ReadonlyArray<{ key: DocumentCategory; title: string }> = [
  { key: 'insurance', title: 'Insurance' },
  { key: 'identity', title: 'Licence & ID' },
  { key: 'other', title: 'Other documents' },
];

/** Sized like one `DocumentCard`, so the panel does not jump when rows land. */
function DocumentRowSkeleton() {
  return (
    <div className="flex gap-4 px-5 py-5 sm:px-6" aria-hidden>
      <Skeleton className="size-11 shrink-0 rounded-2xl bg-pv-tint" />
      <div className="flex min-w-0 flex-1 flex-col gap-2.5 py-0.5">
        <Skeleton className="h-4 w-48 bg-pv-tint" />
        <Skeleton className="h-3 w-64 max-w-full bg-pv-tint" />
        <Skeleton className="h-3 w-40 bg-pv-tint" />
      </div>
      <Skeleton className="hidden h-11 w-28 shrink-0 rounded-[10px] bg-pv-tint sm:block" />
    </div>
  );
}

/** Rows inside a panel, a hairline between each. */
function Rows({ children }: { children: React.ReactNode }) {
  return <div className="divide-y divide-pv-border">{children}</div>;
}

export default function PortalDocumentsPage() {
  const {
    documents,
    byCategory,
    summary,
    isLoading,
    isError,
    error,
    refetch,
  } = useCustomerDocuments();

  const {
    policies,
    isLoading: policiesLoading,
    isError: policiesError,
  } = useCustomerInsurancePolicies();

  const download = useDocumentDownload();
  const policyPdf = usePolicyPdfDownload();
  const remove = useDeleteCustomerDocument();

  const [uploadOpen, setUploadOpen] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<CustomerDocument | null>(null);
  const [confirmation, setConfirmation] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const uploadButton = (
    <Button
      type="button"
      variant="brand"
      className="h-11 w-full px-5 sm:w-auto"
      onClick={() => setUploadOpen(true)}
    >
      <Plus aria-hidden className="size-4" />
      Add a document
    </Button>
  );

  const handleDelete = async () => {
    if (!pendingDelete) return;
    setDeleteError(null);
    try {
      await remove.mutateAsync(pendingDelete);
      setConfirmation(`“${pendingDelete.name}” has been removed.`);
      setPendingDelete(null);
    } catch (caught: unknown) {
      setDeleteError(
        caught instanceof Error ? caught.message : 'We could not remove that document.',
      );
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Documents"
        description="Your insurance, licence and ID on file with us. Add a fresh copy whenever one runs out."
        action={uploadButton}
      />

      {/*
        The one thing on this page a customer may need to act on. Insurance that
        has lapsed, or is about to, is the reason a booking gets held up at the
        desk — so it goes above everything, not inside a row halfway down.
      */}
      {summary.needsAttention.length > 0 ? (
        <Notice
          tone={summary.needsAttention.some((doc) => doc.expiry === 'expired') ? 'danger' : 'warning'}
          title={
            summary.needsAttention.length === 1
              ? `${summary.needsAttention[0].typeLabel} needs renewing`
              : `${summary.needsAttention.length} documents need renewing`
          }
        >
          {summary.needsAttention
            .map((doc) =>
              doc.expiry === 'expired'
                ? `${doc.name} has expired`
                : `${doc.name} expires in ${doc.daysUntilExpiry} day${doc.daysUntilExpiry === 1 ? '' : 's'}`,
            )
            .join(' · ')}
          . Upload a current copy so your next booking is not held up.
        </Notice>
      ) : null}

      {confirmation ? <Notice tone="success" title={confirmation} /> : null}

      {download.error ? <Notice tone="danger" title={download.error} /> : null}

      {/* ── Bonzah policies ─────────────────────────────────────────────── */}
      {policiesLoading || policies.length > 0 || policiesError ? (
        <Panel>
          <PanelHeader title="Insurance policies" />
          {policiesLoading ? (
            <Rows>
              <DocumentRowSkeleton />
              <DocumentRowSkeleton />
            </Rows>
          ) : policiesError ? (
            <p className="px-5 py-5 text-sm leading-relaxed text-pv-muted-fg sm:px-6">
              We could not load the policies you bought with your bookings. Your
              cover is unaffected — please reload the page.
            </p>
          ) : (
            <Rows>
            {policies.map((policy) => (
              <PolicyCard
                key={policy.id}
                policy={policy}
                downloadingKey={policyPdf.downloadingKey}
                onDownloadPdf={(entry) => {
                  void policyPdf.download(policy, entry);
                }}
              />
            ))}
            </Rows>
          )}
        </Panel>
      ) : null}

      {policyPdf.error ? <Notice tone="danger" title={policyPdf.error} /> : null}

      {/* ── Uploaded documents ──────────────────────────────────────────── */}
      {isError ? (
        <LoadError
          title="We could not load your documents"
          error={error}
          onRetry={() => {
            void refetch();
          }}
        />
      ) : isLoading ? (
        <Panel>
          <PanelHeader title="Your documents" />
          <Rows>
            <DocumentRowSkeleton />
            <DocumentRowSkeleton />
            <DocumentRowSkeleton />
          </Rows>
        </Panel>
      ) : documents.length === 0 ? (
        <Panel>
          <EmptyState
            icon={FileText}
            title="Nothing on file yet"
            description="Add your insurance certificate, driving licence or ID and we will have everything ready before you collect a car."
          />
          {/*
            `EmptyState`'s own action is a Link; this one opens a dialog, so it
            sits just below. The negative margin closes the gap `py-12` leaves so
            the two read as one block.
          */}
          <div className="-mt-6 flex justify-center px-6 pb-12">
            <Button
              type="button"
              variant="brand"
              className="h-11 px-5"
              onClick={() => setUploadOpen(true)}
            >
              <Plus aria-hidden className="size-4" />
              Add a document
            </Button>
          </div>
        </Panel>
      ) : (
        SECTIONS.map(({ key, title }) => {
          const rows = byCategory[key];
          if (rows.length === 0) return null;
          return (
            <Panel key={key}>
              <PanelHeader
                title={title}
                action={
                  <span className="text-xs text-pv-muted-fg">
                    {rows.length} {rows.length === 1 ? 'document' : 'documents'}
                  </span>
                }
              />
              <Rows>
              {rows.map((doc) => (
                <DocumentCard
                  key={doc.id}
                  document={doc}
                  isDownloading={download.downloadingId === doc.id}
                  isDeleting={remove.isPending && pendingDelete?.id === doc.id}
                  onDownload={() => {
                    download.clearError();
                    setConfirmation(null);
                    void download.download(doc);
                  }}
                  onDelete={() => {
                    setConfirmation(null);
                    setDeleteError(null);
                    setPendingDelete(doc);
                  }}
                />
              ))}
              </Rows>
            </Panel>
          );
        })
      )}

      {!isLoading && !isError && summary.awaitingReview > 0 ? (
        <p className="text-[13px] leading-relaxed text-pv-muted-fg">
          {summary.awaitingReview}{' '}
          {summary.awaitingReview === 1 ? 'document is' : 'documents are'} waiting to
          be reviewed. You do not need to do anything — we will be in touch if
          something is unclear.
        </p>
      ) : null}

      <UploadDocumentDialog
        open={uploadOpen}
        onOpenChange={setUploadOpen}
        onUploaded={(count) => {
          setConfirmation(
            count === 1
              ? 'Your document was uploaded. We will review it shortly.'
              : `${count} documents were uploaded. We will review them shortly.`,
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
