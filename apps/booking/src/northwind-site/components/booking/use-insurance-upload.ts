'use client';

/**
 * The insurance step's LOGIC, shared by the v1 panel (`insurance-upload.tsx`)
 * and the v2 one (`site-v2/booking/insurance-upload.tsx`). Only the markup is
 * forked: the tray, the dedupe, the per-file states, readiness and the send
 * live here, once. Read `insurance-upload.tsx`'s header for why each rule is
 * the way it is.
 */

import { useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';

import {
  MAX_INSURANCE_FILES,
  insuranceObjectName,
  useSubmitBookingInsurance,
  validateInsuranceFile,
  type BookingDocumentsSession,
  type InsuranceFileState,
} from '@nw/hooks/use-booking-documents';

/** One file in the tray, with where it has got to. */
export interface InsurancePick {
  file: File;
  /** The object name it will be stored under. Also this list's identity key. */
  key: string;
  state: InsuranceFileState;
  error: string | null;
}

/** The handle the shell's single primary button calls. Never throws. */
export interface InsuranceUploadHandle {
  submit: () => Promise<boolean>;
}

export function useInsuranceUpload({
  token,
  session,
  alreadySubmitted,
  onSubmitted,
  onReadyChange,
  ref,
}: {
  token: string;
  session: BookingDocumentsSession;
  alreadySubmitted: boolean;
  onSubmitted: (count: number) => void;
  onReadyChange: (ready: boolean) => void;
  ref?: React.Ref<InsuranceUploadHandle>;
}) {
  const submit = useSubmitBookingInsurance();

  const [picks, setPicks] = useState<InsurancePick[]>([]);
  const [problem, setProblem] = useState<string | null>(null);

  /*
    `picks` has to be readable from inside the mutation's per-file callback,
    which is created once per submit and would otherwise close over a stale
    array. The ref mirrors it; the state is what renders.
  */
  const picksRef = useRef<InsurancePick[]>(picks);
  picksRef.current = picks;

  const busy = submit.isPending;

  const add = useCallback(
    (list: FileList | null) => {
      if (!list || list.length === 0) return;

      const incoming = Array.from(list);
      const rejections: string[] = [];

      /*
        Computed out here, not inside a setPicks updater: the loop fills
        `rejections`, which is read on the last line to tell the customer what
        was refused, and an updater runs during a later render rather than at
        the call site.
      */
      const previous = picksRef.current;
      const seen = new Set(previous.map((pick) => pick.key));
      const next = [...previous];
      let duplicates = 0;

      for (const file of incoming) {
        const rejection = validateInsuranceFile(file);
        if (rejection) {
          rejections.push(rejection);
          continue;
        }
        // Deduped on the OBJECT name rather than the display name: two names
        // that sanitise to the same object ARE the same object.
        const key = insuranceObjectName(file.name);
        if (seen.has(key)) {
          duplicates += 1;
          continue;
        }
        if (next.length >= MAX_INSURANCE_FILES) {
          rejections.push(
            `We can take ${MAX_INSURANCE_FILES} files at a time. “${file.name}” was not added.`,
          );
          continue;
        }
        seen.add(key);
        next.push({ file, key, state: 'queued', error: null });
      }

      if (duplicates > 0) {
        rejections.push(
          duplicates === 1
            ? 'One file was already in the list, so it was not added twice.'
            : `${duplicates} files were already in the list, so they were not added twice.`,
        );
      }

      // Kept in step immediately so two drops in the same tick build on each
      // other rather than the second discarding the first.
      picksRef.current = next;
      setPicks(next);

      // Every rejected file is named, with the limit it hit.
      setProblem(rejections.length > 0 ? rejections.join(' ') : null);
    },
    [],
  );

  const remove = useCallback((key: string) => {
    setProblem(null);
    const next = picksRef.current.filter((pick) => pick.key !== key);
    picksRef.current = next;
    setPicks(next);
  }, []);

  /* ── readiness, pushed up to the shell ──────────────────────────────── */

  /*
    A document ALREADY filed by the server counts as present, or the single
    confirm button would sit disabled for a customer coming back to finish
    step one.
  */
  const ready = picks.length > 0 || alreadySubmitted;

  useEffect(() => {
    onReadyChange(ready);
  }, [onReadyChange, ready]);

  const handleSubmit = useCallback(async (): Promise<boolean> => {
    const files = picksRef.current.map((pick) => pick.file);
    if (files.length === 0) {
      // Nothing new to send. When the server already has a document that is a
      // no-op success, not a failure.
      if (alreadySubmitted) return true;
      setProblem('Please choose at least one file to send.');
      return false;
    }
    setProblem(null);
    setPicks((previous) =>
      previous.map((pick) => ({ ...pick, state: 'queued' as const, error: null })),
    );

    try {
      const result = await submit.mutateAsync({
        token,
        uploadPrefix: session.uploadPrefix,
        files,
        onFileState: (index, state, error) => {
          setPicks((previous) =>
            previous.map((pick, position) =>
              position === index ? { ...pick, state, error: error ?? null } : pick,
            ),
          );
        },
      });
      picksRef.current = [];
      setPicks([]);
      onSubmitted(result.submitted);
      return true;
    } catch (caught: unknown) {
      // The hook has already turned storage and transport failures into
      // sentences that name the file and what to do next.
      setProblem(
        caught instanceof Error
          ? caught.message
          : 'Something went wrong sending your files. Please try again.',
      );
      return false;
    }
  }, [alreadySubmitted, onSubmitted, session.uploadPrefix, submit, token]);

  useImperativeHandle(ref, () => ({ submit: handleSubmit }), [handleSubmit]);

  const storedCount = picks.filter((pick) => pick.state === 'stored').length;

  return { picks, problem, busy, ready, storedCount, add, remove };
}
