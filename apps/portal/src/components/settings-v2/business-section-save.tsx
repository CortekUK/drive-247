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

import { useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui-v2/button";
import {
  SettingsSaveState,
  useSettingsSaveStatus,
  type SettingsSaveStatus,
} from "@/components/settings-v2/section-states";
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
