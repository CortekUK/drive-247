'use client';

/**
 * Upload a document.
 *
 * ── WHY THE FEEDBACK IS INLINE ──────────────────────────────────────────────
 * v1 reports every outcome here through `sonner`. This app ships the `Toaster`
 * primitive but MOUNTS it nowhere — not in `app/layout.tsx`, not in
 * `providers.tsx`, not in the portal shell — so a `toast.error(...)` here would
 * render precisely nothing and the customer would watch an upload fail in
 * silence. Every message therefore lands in the dialog itself, next to the
 * control that produced it. That is the better place for a form error anyway;
 * mounting the Toaster (see the handoff note) would not change this file.
 *
 * ── VALIDATION MIRRORS THE BUCKET, NOT v1 ───────────────────────────────────
 * `validateUploadFile` checks against the `customer-documents` bucket's real
 * limits (5 MB, four MIME types), which the storage layer enforces with 413 and
 * 415. v1 checks against 10 MB, so it waves a 6 MB certificate through and the
 * customer meets the failure after the upload has already started.
 */

import { useRef, useState } from 'react';
import { CircleAlert, FileText, Loader2, Upload, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  ACCEPTED_FILE_EXTENSIONS,
  ACCEPTED_FORMATS_LABEL,
  DOCUMENT_TYPES,
  INSURANCE_DOCUMENT_TYPE,
  useUploadCustomerDocument,
  validateUploadFile,
  type DocumentType,
} from '@/hooks/use-customer-documents';
import { cn } from '@/lib/utils';

function isDocumentType(value: string): value is DocumentType {
  return DOCUMENT_TYPES.some((entry) => entry.value === value);
}

function formatSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
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

  const [documentType, setDocumentType] = useState<DocumentType>(
    INSURANCE_DOCUMENT_TYPE,
  );
  const [files, setFiles] = useState<File[]>([]);
  const [insuranceProvider, setInsuranceProvider] = useState('');
  const [policyNumber, setPolicyNumber] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');

  const [dragActive, setDragActive] = useState(false);
  const [problems, setProblems] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  const isInsurance = documentType === INSURANCE_DOCUMENT_TYPE;

  const reset = () => {
    setDocumentType(INSURANCE_DOCUMENT_TYPE);
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
      if (problem) {
        rejected.push(problem);
      } else {
        accepted.push(file);
      }
    }

    setFiles((previous) => {
      // Same name twice is nearly always a double-click on the picker, not a
      // deliberate second copy.
      const seen = new Set(previous.map((file) => file.name));
      return [...previous, ...accepted.filter((file) => !seen.has(file.name))];
    });
    setProblems(rejected);
  };

  const removeFile = (name: string) => {
    setFiles((previous) => previous.filter((file) => file.name !== name));
  };

  const handleSubmit = async () => {
    if (files.length === 0) {
      setProblems(['Choose a file to upload.']);
      return;
    }

    // v1 accepts an expiry before the start date and files it. The operator
    // then sees a certificate that expired before it began.
    if (isInsurance && startDate && endDate && endDate < startDate) {
      setProblems(['The expiry date is before the start date.']);
      return;
    }

    setBusy(true);
    setProblems([]);

    const failures: string[] = [];
    // The names, not a count. Failures are not necessarily the tail of the
    // list — file 1 can fail while file 2 lands — so counting successes and
    // slicing would put an already-uploaded file back in the retry queue and
    // duplicate it on the next press.
    const failed: File[] = [];

    for (const file of files) {
      try {
        await upload.mutateAsync({
          file,
          documentType,
          insuranceProvider,
          policyNumber,
          startDate,
          endDate,
        });
      } catch (caught: unknown) {
        failed.push(file);
        failures.push(
          caught instanceof Error
            ? caught.message
            : `We could not upload “${file.name}”.`,
        );
      }
    }

    setBusy(false);

    const uploaded = files.length - failed.length;
    if (uploaded > 0) onUploaded(uploaded);

    if (failures.length === 0) {
      reset();
      onOpenChange(false);
      return;
    }

    // Keep only what still needs a retry.
    setFiles(failed);
    setProblems(failures);
  };

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Add a document</DialogTitle>
          <DialogDescription>
            {ACCEPTED_FORMATS_LABEL}. We will check it and mark it verified once
            it has been reviewed.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="document-type">Document type</Label>
            <Select
              value={documentType}
              onValueChange={(value) => {
                if (isDocumentType(value)) setDocumentType(value);
              }}
            >
              <SelectTrigger id="document-type" className="h-11 w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {DOCUMENT_TYPES.map((entry) => (
                  <SelectItem key={entry.value} value={entry.value}>
                    {entry.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {isInsurance ? (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="insurance-provider">Insurer</Label>
                <Input
                  id="insurance-provider"
                  className="h-11"
                  placeholder="Who you are insured with"
                  value={insuranceProvider}
                  onChange={(event) => setInsuranceProvider(event.target.value)}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="policy-number">Policy number</Label>
                <Input
                  id="policy-number"
                  className="h-11"
                  placeholder="Optional"
                  value={policyNumber}
                  onChange={(event) => setPolicyNumber(event.target.value)}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="start-date">Cover starts</Label>
                <Input
                  id="start-date"
                  type="date"
                  className="h-11"
                  value={startDate}
                  onChange={(event) => setStartDate(event.target.value)}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="end-date">Cover ends</Label>
                <Input
                  id="end-date"
                  type="date"
                  className="h-11"
                  value={endDate}
                  onChange={(event) => setEndDate(event.target.value)}
                />
              </div>
            </div>
          ) : null}

          <div
            onDragEnter={(event) => {
              event.preventDefault();
              setDragActive(true);
            }}
            onDragOver={(event) => {
              event.preventDefault();
              setDragActive(true);
            }}
            onDragLeave={(event) => {
              event.preventDefault();
              setDragActive(false);
            }}
            onDrop={(event) => {
              event.preventDefault();
              setDragActive(false);
              addFiles(event.dataTransfer.files);
            }}
            className={cn(
              'flex flex-col items-center gap-2 rounded-[14px] border border-dashed px-4 py-7 text-center transition-colors',
              dragActive
                ? 'border-brand-forest bg-brand-stone'
                : 'border-brand-border bg-brand-card',
            )}
          >
            <Upload
              aria-hidden
              strokeWidth={1.75}
              className="size-5 text-brand-text-subtle"
            />
            <p className="text-sm text-brand-text-soft">
              Drop your file here, or choose one from your device.
            </p>
            <input
              ref={inputRef}
              id="document-file"
              type="file"
              multiple
              accept={ACCEPTED_FILE_EXTENSIONS}
              className="sr-only"
              onChange={(event) => addFiles(event.target.files)}
            />
            <Button
              type="button"
              variant="brand-outline"
              className="mt-1 h-11"
              onClick={() => inputRef.current?.click()}
            >
              Choose a file
            </Button>
            <p className="text-xs text-brand-text-subtle">{ACCEPTED_FORMATS_LABEL}</p>
          </div>

          {files.length > 0 ? (
            <ul className="flex flex-col gap-2">
              {files.map((file) => (
                <li
                  key={file.name}
                  className="flex items-center gap-3 rounded-[10px] border border-brand-border-soft px-3 py-2"
                >
                  <FileText
                    aria-hidden
                    strokeWidth={1.75}
                    className="size-4 shrink-0 text-brand-text-subtle"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm text-brand-text">
                      {file.name}
                    </span>
                    <span className="block text-xs text-brand-text-subtle">
                      {formatSize(file.size)}
                    </span>
                  </span>
                  <Button
                    type="button"
                    variant="brand-ghost"
                    size="icon"
                    className="size-11 shrink-0"
                    disabled={busy}
                    onClick={() => removeFile(file.name)}
                  >
                    <X aria-hidden className="size-4" />
                    <span className="sr-only">Remove {file.name}</span>
                  </Button>
                </li>
              ))}
            </ul>
          ) : null}

          {problems.length > 0 ? (
            <div
              role="alert"
              className="flex gap-3 rounded-[14px] border border-danger-subtle/40 bg-danger-light px-4 py-3"
            >
              <CircleAlert
                aria-hidden
                strokeWidth={1.75}
                className="mt-0.5 size-4 shrink-0 text-danger"
              />
              <ul className="flex min-w-0 flex-col gap-1">
                {problems.map((problem) => (
                  <li key={problem} className="text-sm leading-relaxed text-brand-text">
                    {problem}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="brand-outline"
            className="h-11"
            disabled={busy}
            onClick={() => close(false)}
          >
            Cancel
          </Button>
          <Button
            type="button"
            variant="brand"
            className="h-11"
            disabled={busy || files.length === 0}
            onClick={() => {
              void handleSubmit();
            }}
          >
            {busy ? <Loader2 aria-hidden className="size-4 animate-spin" /> : null}
            {busy
              ? 'Uploading…'
              : `Upload${files.length > 1 ? ` ${files.length} files` : ''}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
