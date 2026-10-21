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
 * ── THREE SCREENS, NOT ONE FORM ─────────────────────────────────────────────
 * What it is → (insurance only) the cover details → the file. One idea and one
 * button per screen, so the dialog never scrolls (the operator portal v2's
 * dialog rule). The state, validation and upload loop are exactly the single
 * form's; only the order they are asked in changed.
 *
 * ── VALIDATION MIRRORS THE BUCKET, NOT v1 ───────────────────────────────────
 * `validateUploadFile` checks against the `customer-documents` bucket's real
 * limits (5 MB, four MIME types), which the storage layer enforces with 413 and
 * 415. v1 checks against 10 MB, so it waves a 6 MB certificate through and the
 * customer meets the failure after the upload has already started.
 */

import { useRef, useState } from 'react';
import type { LucideIcon } from 'lucide-react-nw';
import {
  ArrowLeft,
  Car,
  Check,
  FileText,
  House,
  IdCard,
  Landmark,
  Loader2,
  ShieldCheck,
  Upload,
  X,
} from 'lucide-react-nw';
import * as DialogPrimitive from '@radix-ui/react-dialog';

import { Button } from '@nw/components/ui/button';
import { Input } from '@nw/components/ui/input';
import { Label } from '@nw/components/ui/label';
import {
  ACCEPTED_FILE_EXTENSIONS,
  ACCEPTED_FORMATS_LABEL,
  DOCUMENT_TYPES,
  INSURANCE_DOCUMENT_TYPE,
  useUploadCustomerDocument,
  validateUploadFile,
  type DocumentType,
} from '@nw/hooks/use-customer-documents';
import { cn } from '@nw/lib/utils';

import { DialogScreenHeader, Notice, PvDialogContent, UploadZone } from './_components/kit';

const TYPE_ICON: Record<DocumentType, LucideIcon> = {
  'Insurance Certificate': ShieldCheck,
  'Driving Licence': Car,
  'ID Card/Passport': IdCard,
  'Address Proof': House,
  'National Insurance': Landmark,
  Other: FileText,
};

type Step = 'type' | 'details' | 'file';

/** The operator kit's `inputCls`, at the customer portal's 44px. */
const FIELD =
  'h-11 rounded-3xl border-transparent bg-pv-muted px-4 shadow-none placeholder:text-pv-muted-fg focus-visible:border-pv-primary/40 focus-visible:ring-3 focus-visible:ring-pv-primary/20';

/** How many chosen files are listed before the rest collapse to "and N more". */
const LISTED_FILES = 3;

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
  insuranceOnly = false,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called once at least one file landed, so the page can say so. */
  onUploaded: (count: number) => void;
  /** Insurances page: no type step, an insurance certificate is the only kind. */
  insuranceOnly?: boolean;
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

  const [step, setStep] = useState<Step>(insuranceOnly ? 'details' : 'type');
  const [dragActive, setDragActive] = useState(false);
  const [problems, setProblems] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  const isInsurance = documentType === INSURANCE_DOCUMENT_TYPE;

  const reset = () => {
    setStep(insuranceOnly ? 'details' : 'type');
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

  const steps: Step[] = insuranceOnly ? ['details', 'file'] : isInsurance ? ['type', 'details', 'file'] : ['type', 'file'];
  const stepIndex = steps.indexOf(step);
  const goBack = () => {
    setProblems([]);
    setStep(steps[Math.max(0, stepIndex - 1)]);
  };
  const goNext = () => {
    setProblems([]);
    // The date check runs where the dates are, not two screens later.
    if (step === 'details' && startDate && endDate && endDate < startDate) {
      setProblems(['The expiry date is before the start date.']);
      return;
    }
    setStep(steps[Math.min(steps.length - 1, stepIndex + 1)]);
  };
  const typeLabel = DOCUMENT_TYPES.find((entry) => entry.value === documentType)?.label ?? 'document';

  return (
    <DialogPrimitive.Root open={open} onOpenChange={close}>
      <PvDialogContent showCloseButton={!busy} className="sm:max-w-lg">
        {stepIndex > 0 ? (
          <Button
            type="button"
            variant="brand-ghost"
            size="icon-sm"
            className="absolute top-4 left-4 rounded-full! bg-pv-muted text-pv-muted-fg hover:bg-pv-tint hover:text-pv-fg"
            disabled={busy}
            onClick={goBack}
          >
            <ArrowLeft aria-hidden className="size-4" />
            <span className="sr-only">Back</span>
          </Button>
        ) : null}

        {/* Where you are: one bar per screen, the done ones filled. */}
        <div aria-hidden className="flex justify-center gap-1.5 pt-1">
          {steps.map((entry, index) => (
            <span
              key={entry}
              className={cn(
                'h-1 w-6 rounded-full transition-colors duration-200 ease-out motion-reduce:transition-none',
                index <= stepIndex ? 'bg-pv-primary' : 'bg-pv-border',
              )}
            />
          ))}
        </div>

        {step === 'type' ? (
          <div key="type" className="pv2-enter flex flex-col gap-6">
            <DialogScreenHeader
              icon={FileText}
              title="What are you adding?"
              description="Pick the kind of document. You can add more than one file next."
            />
            <div role="radiogroup" aria-label="Document type" className="grid grid-cols-2 gap-2.5">
              {DOCUMENT_TYPES.map((entry) => {
                const selected = entry.value === documentType;
                const Icon = TYPE_ICON[entry.value];
                return (
                  <button
                    key={entry.value}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    onClick={() => {
                      if (isDocumentType(entry.value)) setDocumentType(entry.value);
                    }}
                    className={cn(
                      'relative flex min-h-[72px] cursor-pointer flex-col items-start justify-between gap-2 rounded-3xl px-4 py-3.5 text-left outline-none',
                      '[transition:background-color_200ms_ease-out,box-shadow_200ms_ease-out] motion-reduce:transition-none',
                      'focus-visible:ring-3 focus-visible:ring-pv-primary/25',
                      selected
                        ? 'bg-pv-tint ring-2 ring-pv-primary/40'
                        : 'bg-pv-card ring-1 ring-pv-border hover:bg-pv-row-hover hover:ring-pv-primary/30',
                    )}
                  >
                    <Icon
                      aria-hidden
                      strokeWidth={1.75}
                      className={cn('size-5', selected ? 'text-pv-primary' : 'text-pv-muted-fg')}
                    />
                    <span className="text-sm font-medium leading-tight text-pv-fg">{entry.label}</span>
                    {selected ? (
                      <span className="absolute top-3 right-3 grid size-5 place-items-center rounded-full bg-pv-primary">
                        <Check aria-hidden strokeWidth={3} className="size-3 text-pv-primary-fg" />
                      </span>
                    ) : null}
                  </button>
                );
              })}
            </div>
            <Button type="button" variant="brand" className="h-11 w-full" onClick={goNext}>
              Continue
            </Button>
          </div>
        ) : null}

        {step === 'details' ? (
          <div key="details" className="pv2-enter flex flex-col gap-6">
            <DialogScreenHeader
              icon={ShieldCheck}
              tone="success"
              title="About your cover"
              description="All optional, but it lets us spot when your cover runs out."
            />
            <div className="grid grid-cols-2 gap-x-3 gap-y-4">
              <div className="flex flex-col gap-2">
                <Label htmlFor="insurance-provider" className="text-[13px] font-medium text-pv-fg">
                  Insurer
                </Label>
                <Input
                  id="insurance-provider"
                  className={FIELD}
                  placeholder="Company name"
                  value={insuranceProvider}
                  onChange={(event) => setInsuranceProvider(event.target.value)}
                />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="policy-number" className="text-[13px] font-medium text-pv-fg">
                  Policy number
                </Label>
                <Input
                  id="policy-number"
                  className={FIELD}
                  placeholder="Optional"
                  value={policyNumber}
                  onChange={(event) => setPolicyNumber(event.target.value)}
                />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="start-date" className="text-[13px] font-medium text-pv-fg">
                  Cover starts
                </Label>
                <Input
                  id="start-date"
                  type="date"
                  className={FIELD}
                  value={startDate}
                  onChange={(event) => setStartDate(event.target.value)}
                />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="end-date" className="text-[13px] font-medium text-pv-fg">
                  Cover ends
                </Label>
                <Input
                  id="end-date"
                  type="date"
                  className={FIELD}
                  value={endDate}
                  onChange={(event) => setEndDate(event.target.value)}
                />
              </div>
            </div>
            {problems.length > 0 ? <Notice tone="danger" lines={problems} /> : null}
            <Button type="button" variant="brand" className="h-11 w-full" onClick={goNext}>
              Continue
            </Button>
          </div>
        ) : null}

        {step === 'file' ? (
          <div key="file" className="pv2-enter flex flex-col gap-6">
            <DialogScreenHeader
              icon={Upload}
              title={`Add your ${typeLabel.toLowerCase()}`}
              description="We will check it and mark it verified once it has been reviewed."
            />

            <UploadZone
              active={dragActive}
              onDragState={setDragActive}
              onFiles={addFiles}
              className="py-7"
            >
              <p className="text-sm text-pv-muted-fg">Drop files here, or</p>
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
                className="h-11 px-5"
                disabled={busy}
                onClick={() => inputRef.current?.click()}
              >
                Choose a file
              </Button>
              <p className="text-xs text-pv-muted-fg">{ACCEPTED_FORMATS_LABEL}</p>
            </UploadZone>

            {files.length > 0 ? (
              <ul className="divide-y divide-pv-border overflow-hidden rounded-3xl bg-pv-row ring-1 ring-pv-border">
                {files.slice(0, LISTED_FILES).map((file) => (
                  <li key={file.name} className="flex items-center gap-3 py-1.5 pr-1.5 pl-4">
                    <FileText aria-hidden strokeWidth={1.75} className="size-4 shrink-0 text-pv-primary" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-pv-fg">{file.name}</span>
                      <span className="block text-xs text-pv-muted-fg">{formatSize(file.size)}</span>
                    </span>
                    <Button
                      type="button"
                      variant="brand-ghost"
                      size="icon"
                      className="size-11 shrink-0 rounded-full! text-pv-muted-fg hover:bg-pv-danger-light hover:text-pv-danger"
                      disabled={busy}
                      onClick={() => removeFile(file.name)}
                    >
                      <X aria-hidden className="size-4" />
                      <span className="sr-only">Remove {file.name}</span>
                    </Button>
                  </li>
                ))}
                {files.length > LISTED_FILES ? (
                  <li className="px-4 py-2.5 text-xs text-pv-muted-fg">
                    and {files.length - LISTED_FILES} more
                  </li>
                ) : null}
              </ul>
            ) : null}

            {problems.length > 0 ? <Notice tone="danger" lines={problems} /> : null}

            <Button
              type="button"
              variant="brand"
              className="h-11 w-full"
              disabled={busy || files.length === 0}
              onClick={() => {
                void handleSubmit();
              }}
            >
              {busy ? <Loader2 aria-hidden className="size-4 animate-spin" /> : null}
              {busy ? 'Uploading…' : `Upload${files.length > 1 ? ` ${files.length} files` : ''}`}
            </Button>
          </div>
        ) : null}
      </PvDialogContent>
    </DialogPrimitive.Root>
  );
}
