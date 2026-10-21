'use client';

/**
 * Settings → Gig driver: the customer's gig driver proof, and nothing else
 * (owner, Oct 21 2026). Pictures (JPG, PNG) and documents (PDF) both go up —
 * screenshots of the Uber, Lyft or delivery app profile, or a PDF the platform
 * issued — and each shows as a tile: the picture itself, or the PDF's first
 * page drawn with pdf.js.
 *
 * The data layer is `use-customer-gig-driver.ts` (same bucket and table as v1;
 * the bucket was opened to PDFs on Oct 21 2026). Kept from the v1 port: the
 * actions are always visible (no hover on a phone), the last file can be
 * deleted, a batch uploads what it can and names what it skipped, and failures
 * stay on screen rather than in a toast nobody mounted.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { ExternalLink, Loader2, Trash2, Upload } from 'lucide-react-nw';
import type { PDFDocumentProxy } from 'pdfjs-dist';

import { formatTimestamp } from '@nw/components/portal/format';
import { LoadError } from '@nw/portal-v2/primitives';
import { Skeleton } from '@nw/components/ui/skeleton';
import { useTenant } from '@nw/contexts/TenantContext';
import { GIG_ACCEPT_ATTRIBUTE, useCustomerGigDriver, type GigDriverDocument } from '@nw/hooks/use-customer-gig-driver';
import { cn } from '@nw/lib/utils';
import { V2_BUTTON_GHOST_ICON_SM, V2_BUTTON_PRIMARY } from '@portal-v2-shared/button-styles';
import { DocumentsEmptyArt } from '@portal-v2-shared/empty-states/documents';
import { TeachingEmptyState } from '@portal-v2-shared/empty-states/teaching-empty-state';

import { ConfirmDialog, Notice, type Tone } from '../../insurances/_components/kit';
import { SettingsPageHeader } from '../_components/settings-ui';

interface Feedback {
  tone: Extract<Tone, 'success' | 'warning' | 'danger'>;
  title: string;
  lines: string[];
}

const isPdf = (document: GigDriverDocument) => /\.pdf$/i.test(document.path) || /\.pdf$/i.test(document.fileName);

function formatBytes(bytes: number | null): string | null {
  if (bytes === null || !Number.isFinite(bytes) || bytes < 0) return null;
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${Math.round(kb)} KB`;
  return `${(kb / 1024).toFixed(1)} MB`;
}

const plural = (count: number, one: string, many: string) => (count === 1 ? one : many);

/* ─────────────────────────────── previews ──────────────────────────────── */

/** A PDF's first page, fitted to the tile. */
function PdfThumb({ url, onError }: { url: string; onError: () => void }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let doc: PDFDocumentProxy | null = null;
    (async () => {
      try {
        const pdfjs = await import('pdfjs-dist');
        pdfjs.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjs.version}/pdf.worker.min.mjs`;
        const response = await fetch(url);
        if (!response.ok) throw new Error('fetch');
        doc = await pdfjs.getDocument({ data: await response.arrayBuffer() }).promise;
        const page = await doc.getPage(1);
        const host = hostRef.current;
        const canvas = canvasRef.current;
        if (cancelled || !host || !canvas) return;
        const base = page.getViewport({ scale: 1 });
        const scale = Math.min(host.clientWidth / base.width, host.clientHeight / base.height) * 0.86;
        const ratio = window.devicePixelRatio || 1;
        const viewport = page.getViewport({ scale: scale * ratio });
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        canvas.style.width = `${viewport.width / ratio}px`;
        canvas.style.height = `${viewport.height / ratio}px`;
        const context = canvas.getContext('2d');
        if (!context) throw new Error('canvas');
        await page.render({ canvasContext: context, viewport, canvas } as Parameters<typeof page.render>[0]).promise;
        if (!cancelled) setReady(true);
      } catch {
        if (!cancelled) onError();
      }
    })();
    return () => {
      cancelled = true;
      if (doc) void doc.destroy();
    };
  }, [url, onError]);

  return (
    <div ref={hostRef} className="flex size-full items-center justify-center">
      {!ready ? <Loader2 aria-hidden className="absolute size-5 animate-spin text-pv-muted-fg motion-reduce:animate-none" /> : null}
      <canvas ref={canvasRef} className={cn('rounded-sm bg-white shadow-sm', !ready && 'opacity-0')} />
    </div>
  );
}

/**
 * How many times a picture is re-requested before it is called broken: storage
 * serves through a CDN and a file asked for a second after upload can 404
 * while the edge catches up.
 */
const IMAGE_RETRIES = 2;
const IMAGE_RETRY_DELAY_MS = 1200;

function DocumentTile({ document, isDeleting, onDelete }: { document: GigDriverDocument; isDeleting: boolean; onDelete: () => void }) {
  const [attempt, setAttempt] = useState(0);
  const [failed, setFailed] = useState(false);
  const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (retryTimer.current !== null) clearTimeout(retryTimer.current);
    },
    [],
  );
  const onImageError = useCallback(() => {
    if (attempt >= IMAGE_RETRIES) return setFailed(true);
    if (retryTimer.current !== null) clearTimeout(retryTimer.current);
    retryTimer.current = setTimeout(() => setAttempt((current) => current + 1), IMAGE_RETRY_DELAY_MS);
  }, [attempt]);
  const onPdfError = useCallback(() => setFailed(true), []);

  const pdf = isPdf(document);
  const src = attempt === 0 ? document.url : `${document.url}?retry=${attempt}`;
  const meta = [pdf ? 'PDF' : null, formatTimestamp(document.uploadedAt), formatBytes(document.fileSize)].filter(Boolean).join(' · ');

  return (
    <li className="flex flex-col overflow-hidden rounded-2xl border border-pv-border bg-pv-card">
      <div className="relative flex aspect-[4/3] w-full items-center justify-center overflow-hidden bg-pv-muted">
        {failed ? (
          <span className="px-4 text-center text-xs leading-relaxed text-pv-muted-fg">This file could not be shown. Open it to view it.</span>
        ) : pdf ? (
          <PdfThumb url={document.url} onError={onPdfError} />
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img key={src} src={src} alt={document.fileName} loading="lazy" decoding="async" onError={onImageError} className="size-full object-cover" />
        )}
      </div>
      <div className="flex items-center gap-1 border-t border-pv-border py-2 pr-2 pl-4">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-pv-fg" title={document.fileName}>
            {document.fileName}
          </p>
          {meta ? <p className="truncate text-xs text-pv-muted-fg">{meta}</p> : null}
        </div>
        <a href={document.url} target="_blank" rel="noopener noreferrer" aria-label={`Open ${document.fileName}`} title="Open" className={V2_BUTTON_GHOST_ICON_SM}>
          <ExternalLink aria-hidden />
        </a>
        <button
          type="button"
          aria-label={`Delete ${document.fileName}`}
          title="Delete"
          disabled={isDeleting}
          onClick={onDelete}
          className={cn(V2_BUTTON_GHOST_ICON_SM, 'hover:bg-pv-danger-light hover:text-pv-danger')}
        >
          {isDeleting ? <Loader2 aria-hidden className="animate-spin" /> : <Trash2 aria-hidden />}
        </button>
      </div>
    </li>
  );
}

/* ──────────────────────────────── the page ─────────────────────────────── */

export function GigDriverSettings() {
  const { tenant } = useTenant();
  const operator = tenant?.company_name ?? 'the rental company';
  const { documents, isLoading, isError, error, refetch, hasMore, unsubmittedCount, upload, isUploading, remove, removingPath } =
    useCustomerGigDriver();

  const inputRef = useRef<HTMLInputElement>(null);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [pendingDelete, setPendingDelete] = useState<GigDriverDocument | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [dragging, setDragging] = useState(false);

  const pick = useCallback(() => inputRef.current?.click(), []);

  const uploadFiles = useCallback(
    async (files: File[]) => {
      if (files.length === 0) return;
      setFeedback(null);
      try {
        const outcome = await upload(files);
        const lines = [
          ...outcome.rejected.map((item) => `${item.fileName} was skipped — ${item.reason}.`),
          ...outcome.failed.map((item) => `${item.fileName} did not upload — ${item.reason}.`),
        ];
        if (outcome.uploaded === 0) {
          setFeedback({ tone: 'danger', title: 'Nothing was uploaded', lines: lines.length ? lines : ['Please try again.'] });
          return;
        }
        setFeedback({
          tone: lines.length ? 'warning' : 'success',
          title: `${outcome.uploaded} ${plural(outcome.uploaded, 'file uploaded', 'files uploaded')}`,
          lines,
        });
      } catch (cause) {
        setFeedback({ tone: 'danger', title: 'Upload failed', lines: [cause instanceof Error ? cause.message : 'Please try again.'] });
      }
    },
    [upload],
  );

  const confirmDelete = useCallback(async () => {
    if (!pendingDelete) return;
    const target = pendingDelete;
    setConfirming(true);
    setFeedback(null);
    try {
      await remove(target);
      setFeedback({ tone: 'success', title: `${target.fileName} was deleted`, lines: [] });
    } catch (cause) {
      setFeedback({ tone: 'danger', title: 'We could not delete that file', lines: [cause instanceof Error ? cause.message : 'Please try again.'] });
    } finally {
      setPendingDelete(null);
      setConfirming(false);
    }
  }, [pendingDelete, remove]);

  const empty = !isLoading && !isError && documents.length === 0;

  return (
    <div
      className={cn('flex flex-col gap-6 rounded-3xl transition-shadow duration-200', dragging && 'ring-2 ring-pv-primary/40 ring-offset-8 ring-offset-pv-bg')}
      onDragOver={(event) => {
        if (!event.dataTransfer.types.includes('Files')) return;
        event.preventDefault();
        setDragging(true);
      }}
      onDragLeave={(event) => {
        if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
        setDragging(false);
      }}
      onDrop={(event) => {
        event.preventDefault();
        setDragging(false);
        void uploadFiles(Array.from(event.dataTransfer.files ?? []));
      }}
    >
      <SettingsPageHeader
        title="Gig driver"
        description={`Pictures or documents that show you drive for Uber, Lyft or a delivery app, for ${operator}'s gig driver rates.`}
        action={
          empty ? undefined : (
            <button type="button" className={V2_BUTTON_PRIMARY} disabled={isUploading} onClick={pick}>
              {isUploading ? <Loader2 aria-hidden className="animate-spin" /> : <Upload aria-hidden />}
              {isUploading ? 'Uploading…' : 'Upload'}
            </button>
          )
        }
      />

      <input
        ref={inputRef}
        type="file"
        accept={GIG_ACCEPT_ATTRIBUTE}
        multiple
        onChange={(event) => {
          const files = Array.from(event.target.files ?? []);
          event.target.value = '';
          void uploadFiles(files);
        }}
        className="sr-only"
        tabIndex={-1}
        aria-hidden
      />

      {feedback ? <Notice tone={feedback.tone} title={feedback.title} lines={feedback.lines} /> : null}

      {!isLoading && unsubmittedCount > 0 ? (
        <Notice
          tone="warning"
          title={`${unsubmittedCount} ${plural(unsubmittedCount, 'file has', 'files have')} not reached ${operator}`}
          lines={[`Saved here, but not attached to your customer file. Please mention it when you contact ${operator}.`]}
        />
      ) : null}

      {isError ? (
        <LoadError title="We could not load your files" error={error} onRetry={() => void refetch()} />
      ) : isLoading ? (
        <div aria-hidden className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {[0, 1, 2].map((index) => (
            <div key={index} className="overflow-hidden rounded-2xl border border-pv-border bg-pv-card">
              <Skeleton className="aspect-[4/3] w-full rounded-none bg-pv-tint" />
              <div className="flex flex-col gap-2 border-t border-pv-border px-4 py-4">
                <Skeleton className="h-4 w-2/3 bg-pv-tint" />
                <Skeleton className="h-3 w-1/2 bg-pv-tint" />
              </div>
            </div>
          ))}
        </div>
      ) : empty ? (
        <TeachingEmptyState
          illustration={<DocumentsEmptyArt />}
          headline="Show you drive for a gig app"
          body={`Upload screenshots of your driver profile, or a PDF from the platform. ${operator} uses them for gig driver rates.`}
          primaryAction={{
            label: isUploading ? 'Uploading…' : 'Upload',
            icon: Upload,
            onClick: pick,
            disabled: isUploading,
            hint: 'JPG, PNG or PDF, up to 10MB each. You can also drop files here.',
          }}
        />
      ) : (
        <>
          <ul className="grid list-none grid-cols-1 gap-3 p-0 sm:grid-cols-2 xl:grid-cols-3">
            {documents.map((document) => (
              <DocumentTile
                key={document.path}
                document={document}
                isDeleting={removingPath === document.path}
                onDelete={() => setPendingDelete(document)}
              />
            ))}
          </ul>
          <p className="text-[13px] text-pv-muted-fg">
            JPG, PNG or PDF, up to 10MB each. You can also drop files here.
            {hasMore ? ' Showing your 100 most recent files.' : ''}
          </p>
        </>
      )}

      <ConfirmDialog
        open={pendingDelete !== null}
        icon={Trash2}
        title="Delete this file?"
        description={pendingDelete ? `${pendingDelete.fileName} will be removed. You can upload it again if you need to.` : ''}
        confirmLabel="Delete"
        busyLabel="Deleting…"
        busy={confirming}
        onCancel={() => setPendingDelete(null)}
        onConfirm={() => void confirmDelete()}
      />
    </div>
  );
}
