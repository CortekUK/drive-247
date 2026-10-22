'use client';

/**
 * Upload an insurance certificate.
 *
 * ── ONE SCREEN ──────────────────────────────────────────────────────────────
 * The cover details and the file are asked together (owner, Oct 22 2026: "policy
 * number and upload are two steps — merge them"). No step bar, no back button:
 * the operator's dialog header (art, status, title), four optional fields, the
 * drop zone, and one footer row — Cancel and Upload, equal height, right-aligned.
 *
 * ── MANY FILES, ONE COVER ───────────────────────────────────────────────────
 * The picker and the drop zone take several files at once. Each file is filed
 * as its own `customer_documents` row carrying the same insurer, policy number
 * and dates (a certificate plus its schedule, say), uploaded one after another
 * so the button can say how far along it is. A failure keeps only the files
 * that still need a retry, so a second press never duplicates one that landed.
 *
 * ── WHY THE FEEDBACK IS INLINE ──────────────────────────────────────────────
 * This app mounts no `Toaster`, so a toast would render nothing. Every message
 * lands in the dialog, next to the control that produced it.
 *
 * ── VALIDATION MIRRORS THE BUCKET ───────────────────────────────────────────
 * `validateUploadFile` checks the `customer-documents` bucket's real limits
 * (5 MB, four MIME types), which storage enforces with 413 and 415.
 */

import { useRef, useState } from 'react';
import { X } from 'lucide-react-nw';
import * as DialogPrimitive from '@radix-ui/react-dialog';

import { Button } from '@nw/components/ui/button';
import {
  ACCEPTED_FILE_EXTENSIONS,
  ACCEPTED_FORMATS_LABEL,
  INSURANCE_DOCUMENT_TYPE,
  useUploadCustomerDocument,
  validateUploadFile,
} from '@nw/hooks/use-customer-documents';
import { DateField, TextField } from '@nw/site-v2/booking/field-primitives';
import { cn } from '@nw/lib/utils';

import { PvDialogContent, PvDialogHeader, PvStatus } from '@nw/portal-v2/dialog';

import { Notice, UploadZone } from './_components/kit';

function formatSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** Local 'YYYY-MM-DD' → a Date at local midnight, for the calendar's bounds. */
function isoToLocalDate(iso: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  return match ? new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3])) : null;
}

export function UploadDocumentDialog({
  open,
  onOpenChange,
  onUploaded,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called once at least one file landed, so the page can say so. */
  onUploaded: (count: number) => void;
}) {
  const upload = useUploadCustomerDocument();
  const inputRef = useRef<HTMLInputElement>(null);

  const [files, setFiles] = useState<File[]>([]);
  const [insuranceProvider, setInsuranceProvider] = useState('');
  const [policyNumber, setPolicyNumber] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');

  const [dragActive, setDragActive] = useState(false);
  const [problems, setProblems] = useState<string[]>([]);
  /** Null when idle; otherwise which file (1-based) is going up. */
  const [progress, setProgress] = useState<number | null>(null);
  const busy = progress !== null;

  const reset = () => {
    setFiles([]);
    setInsuranceProvider('');
    setPolicyNumber('');
    setStartDate('');
    setEndDate('');
    setProblems([]);
    if (inputRef.current) inputRef.current.value = '';
  };

  const close = (next: boolean) => {
    if (busy) return; // Never yank the dialog out from under an in-flight upload.
    if (!next) reset();
    onOpenChange(next);
  };

  /** Take the valid files, name the rejected ones. */
  const addFiles = (incoming: FileList | null) => {
    if (!incoming || incoming.length === 0) return;

    const accepted: File[] = [];
    const rejected: string[] = [];
    for (const file of Array.from(incoming)) {
      const problem = validateUploadFile(file);
      if (problem) rejected.push(problem);
      else accepted.push(file);
    }

    setFiles((previous) => {
      // Same name twice is nearly always a double pick, not a deliberate copy.
      const seen = new Set(previous.map((file) => file.name));
      return [...previous, ...accepted.filter((file) => !seen.has(file.name))];
    });
    setProblems(rejected);
    // Let the same file be picked again after it is removed.
    if (inputRef.current) inputRef.current.value = '';
  };

  const removeFile = (name: string) => {
    setFiles((previous) => previous.filter((file) => file.name !== name));
  };

  const handleSubmit = async () => {
    if (files.length === 0) {
      setProblems(['Choose a file to upload.']);
      return;
    }
    // An expiry before the start would file a certificate that ended before it began.
    if (startDate && endDate && endDate < startDate) {
      setProblems(['Cover ends before it starts.']);
      return;
    }

    setProblems([]);
    const failures: string[] = [];
    // The files, not a count: file 1 can fail while file 2 lands, so slicing by
    // a success count would re-queue (and duplicate) one that already went up.
    const failed: File[] = [];

    for (const [index, file] of files.entries()) {
      setProgress(index + 1);
      try {
        await upload.mutateAsync({
          file,
          documentType: INSURANCE_DOCUMENT_TYPE,
          insuranceProvider,
          policyNumber,
          startDate,
          endDate,
        });
      } catch (caught: unknown) {
        failed.push(file);
        failures.push(caught instanceof Error ? caught.message : `We could not upload “${file.name}”.`);
      }
    }

    setProgress(null);

    const uploaded = files.length - failed.length;
    if (uploaded > 0) onUploaded(uploaded);

    if (failures.length === 0) {
      reset();
      onOpenChange(false);
      return;
    }
    setFiles(failed);
    setProblems(failures);
  };

  const start = isoToLocalDate(startDate);
  const end = isoToLocalDate(endDate);
  const submitLabel = busy
    ? files.length > 1
      ? `Uploading ${progress} of ${files.length}…`
      : 'Uploading…'
    : files.length > 1
      ? `Upload ${files.length} files`
      : 'Upload insurance';

  return (
    <DialogPrimitive.Root open={open} onOpenChange={close}>
      <PvDialogContent
        showCloseButton={!busy}
        className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-2xl"
      >
        <PvDialogHeader
          title="Upload insurance"
          description="Add your certificate and, if you have them, the policy details. We will review it shortly."
          // A status only while something is happening; the file list says what is ready.
          status={busy ? <PvStatus tone="info">Uploading</PvStatus> : undefined}
        />

        <div className="grid grid-cols-1 gap-x-3 gap-y-4 sm:grid-cols-2">
          <TextField
            id="insurance-provider"
            label="Insurer"
            placeholder="Company name"
            value={insuranceProvider}
            onChange={setInsuranceProvider}
            optional
          />
          <TextField
            id="policy-number"
            label="Policy number"
            placeholder="As printed on the certificate"
            value={policyNumber}
            onChange={setPolicyNumber}
            optional
          />
          <DateField
            id="cover-starts"
            label="Cover starts"
            placeholder="Pick a date"
            value={startDate}
            onChange={setStartDate}
            isDisabledDate={(date) => (end ? date > end : false)}
            defaultMonthIso={endDate || undefined}
            disabled={busy}
          />
          <DateField
            id="cover-ends"
            label="Cover ends"
            placeholder="Pick a date"
            value={endDate}
            onChange={setEndDate}
            isDisabledDate={(date) => (start ? date < start : false)}
            defaultMonthIso={startDate || undefined}
            disabled={busy}
          />
        </div>

        <div className="flex flex-col gap-3">
          <UploadZone active={dragActive} onDragState={setDragActive} onFiles={addFiles} className="gap-2 py-6">
            <input
              ref={inputRef}
              id="insurance-files"
              type="file"
              multiple
              accept={ACCEPTED_FILE_EXTENSIONS}
              className="sr-only"
              onChange={(event) => addFiles(event.target.files)}
            />
            <p className="text-sm text-pv-fg">
              Drop files here, or{' '}
              <button
                type="button"
                disabled={busy}
                onClick={() => inputRef.current?.click()}
                className="cursor-pointer font-semibold text-pv-primary underline-offset-4 outline-none hover:underline focus-visible:underline disabled:opacity-60"
              >
                choose files
              </button>
            </p>
            <p className="text-xs text-pv-muted-fg">{ACCEPTED_FORMATS_LABEL}. Several files at once is fine.</p>
          </UploadZone>

          {files.length > 0 ? (
            <div className="flex flex-col gap-1.5">
              <p className="px-1 text-xs font-medium text-pv-muted-fg">
                {files.length === 1 ? '1 file ready' : `${files.length} files ready`}
              </p>
              <ul className="max-h-44 divide-y divide-pv-border overflow-y-auto rounded-2xl ring-1 ring-pv-border">
                {files.map((file, index) => (
                  <li key={file.name} className="flex items-center gap-3 py-1 pr-1 pl-4">
                    <span className="min-w-0 flex-1 truncate text-sm text-pv-fg" title={file.name}>
                      {file.name}
                    </span>
                    <span
                      className={cn(
                        'shrink-0 text-xs tabular-nums',
                        busy && progress === index + 1 ? 'font-medium text-pv-primary' : 'text-pv-muted-fg',
                      )}
                    >
                      {busy && progress === index + 1 ? 'Uploading…' : busy && progress! > index + 1 ? 'Done' : formatSize(file.size)}
                    </span>
                    <Button
                      type="button"
                      variant="brand-ghost"
                      size="icon"
                      className="size-9 shrink-0 rounded-full! text-pv-muted-fg hover:bg-pv-danger-light hover:text-pv-danger"
                      disabled={busy}
                      onClick={() => removeFile(file.name)}
                    >
                      <X aria-hidden className="size-4" />
                      <span className="sr-only">Remove {file.name}</span>
                    </Button>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>

        {problems.length > 0 ? <Notice plain tone="danger" lines={problems} /> : null}

        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-end">
          <Button
            type="button"
            variant="brand-ghost"
            className="h-11 w-full px-6 sm:w-auto sm:min-w-[9rem]"
            disabled={busy}
            onClick={() => close(false)}
          >
            Cancel
          </Button>
          <Button
            type="button"
            variant="brand"
            className="h-11 w-full px-6 sm:w-auto sm:min-w-[9rem]"
            disabled={busy || files.length === 0}
            onClick={() => {
              void handleSubmit();
            }}
          >
            {submitLabel}
          </Button>
        </div>
      </PvDialogContent>
    </DialogPrimitive.Root>
  );
}
