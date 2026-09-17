"use client";

/**
 * v2 Settings (northwind only): one section's save state, for the
 * Business-rules pages.
 *
 * Each section tracks its OWN pending flag and error. The page-wide
 * `isUpdatingRentalSettings` spun every Save on a page at once and said nothing
 * when a save failed beyond a toast. Here a second click while a save is in
 * flight is ignored, a failure stays inline beside Save (the form keeps its
 * values, so it stays dirty and Retry works), and a success flashes "Saved".
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui-v2/button";
import {
  SettingsSaveState,
  useSettingsSaveStatus,
  type SettingsSaveStatus,
} from "@/components/settings-v2/section-states";
import type { RegisterSectionSave } from "@/components/settings-v2/pricing-money-parts";
import { cn } from "@/lib/utils";

export interface SectionSave {
  isPending: boolean;
  error: unknown;
  status: SettingsSaveStatus;
  /** Runs one save. Resolves true on success; ignored while another is in flight. */
  run: (work: () => Promise<unknown>) => Promise<boolean>;
}

export function useSectionSave(isDirty: boolean): SectionSave {
  const [isPending, setPending] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const inFlight = useRef(false);

  // Reverting every edit (Discard, or typing the saved value back) clears a stale error.
  useEffect(() => {
    if (!isDirty) setError(null);
  }, [isDirty]);

  const status = useSettingsSaveStatus({ isDirty, isPending, error });

  const run = async (work: () => Promise<unknown>) => {
    if (inFlight.current) return false;
    inFlight.current = true;
    setPending(true);
    setError(null);
    try {
      await work();
      return true;
    } catch (e) {
      setError(e ?? new Error("Save failed"));
      return false;
    } finally {
      inFlight.current = false;
      setPending(false);
    }
  };

  return { isPending, error, status, run };
}

/**
 * While the section holds unsaved edits, give the settings page a save for its
 * leave guard. Registering is what makes leaving warn at all: the page's own
 * `rentalFormDirty` misses advance notice, the lockbox delivery method, the
 * auto-send timing and the lockbox messages, so going to another screen from
 * the sidebar dropped those edits without a word. "Save & Leave" calls `save`,
 * which must REJECT when it did not save, so the page stays put.
 */
export function useRegisterLeaveSave(
  registerSave: RegisterSectionSave | undefined,
  key: string,
  isDirty: boolean,
  save: () => Promise<void>,
) {
  const latest = useRef(save);
  latest.current = save;
  const stable = useCallback(() => latest.current(), []);

  useEffect(() => {
    registerSave?.(key, isDirty ? stable : null);
  }, [registerSave, key, isDirty, stable]);

  useEffect(() => () => registerSave?.(key, null), [registerSave, key]);
}

/**
 * The page keeps one shared form across its settings pages, so an edit left
 * behind with "Don't Save" used to still be there when the page was opened
 * again, and kept every later navigation asking about unsaved changes. When a
 * section unmounts while dirty, put its fields back to what is saved.
 */
export function useDiscardOnUnmount(isDirty: boolean, discard: () => void) {
  const latest = useRef({ isDirty, discard });
  latest.current = { isDirty, discard };
  useEffect(
    () => () => {
      if (latest.current.isDirty) latest.current.discard();
    },
    [],
  );
}

/** The inline status on the left, one labelled Save on the right. Wraps on a phone. */
export function SectionSaveBar({
  save,
  isDirty,
  onSave,
  onDiscard,
  invalid = false,
  label = "Save",
  className,
}: {
  save: SectionSave;
  isDirty: boolean;
  onSave: () => unknown;
  onDiscard?: () => void;
  /** A field is invalid: Save stays disabled; the field says why. */
  invalid?: boolean;
  label?: string;
  className?: string;
}) {
  return (
    <div className={cn("flex w-full flex-wrap items-center justify-end gap-x-3 gap-y-2", className)}>
      <SettingsSaveState
        status={save.status}
        error={save.error}
        onRetry={invalid ? undefined : onSave}
        onDiscard={onDiscard}
        className="mr-auto"
      />
      <Button
        type="button"
        size="sm"
        onClick={() => void onSave()}
        disabled={save.isPending || invalid || !isDirty}
        className="min-w-[88px]"
      >
        {save.isPending && <Loader2 className="animate-spin" data-icon="inline-start" />}
        {label}
      </Button>
    </div>
  );
}
