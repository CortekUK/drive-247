"use client";

/**
 * v2 Settings (northwind): read and save plumbing shared by the Pricing rules,
 * Tax and fees and Security deposit pages, and the few parts they share. v2
 * only: mounted from `settings/page.tsx`'s `useV2('chrome')` branch.
 *
 * WHY A READ STATE BESIDE THE HOOKS. `useRentalSettings` and `useWeekendPricing`
 * return DEFAULTS while their query is loading (placeholderData) and after it
 * has failed (`settings || DEFAULTS`). Those hooks serve every tenant, so
 * instead of changing what they return, a v2 page asks the query cache whether
 * the row has really arrived. Until it has, the page shows a skeleton or an
 * error, never a form of defaults an operator could save over real values.
 */

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Loader2 } from "lucide-react";
import { useIsFetching, useQueryClient, type QueryKey } from "@tanstack/react-query";
import { Button } from "@/components/ui-v2/button";
import {
  SettingsLoadError,
  SettingsSaveState,
  SettingsSectionSkeleton,
  useSettingsSaveStatus,
  type SettingsSaveStatus,
} from "@/components/settings-v2/section-states";
import { ISSUE_TEXT_CLASS, type FieldIssue } from "@/components/settings-v2/pricing-money-logic";
import { SETTINGS_SECTION_TITLE, useSettingsPageSave } from "@/components/settings-v2/settings-kit";
import { cn } from "@/lib/utils";

/* -------------------------------------------------------------------------- */
/* Read state                                                                  */
/* -------------------------------------------------------------------------- */

export interface SettingsReadState {
  /** The real row is in the cache (placeholder data does not count). */
  hasData: boolean;
  /** Nothing real yet and no failure: show the skeleton. */
  isLoading: boolean;
  isError: boolean;
  error: unknown;
  isFetching: boolean;
  refetch: () => Promise<unknown>;
}

const OFF_KEY: QueryKey = ["settings-read-state-off"];

/**
 * The truth about one query, read from the cache. `useIsFetching` re-renders the
 * caller whenever a fetch for the key starts or ends, which is every moment the
 * answer can change. `enabled: false` makes it inert (nothing is read).
 */
export function useSettingsReadState(queryKey: QueryKey, enabled = true): SettingsReadState {
  const queryClient = useQueryClient();
  const fetching = useIsFetching({ queryKey: enabled ? queryKey : OFF_KEY, exact: true });
  const state = enabled ? queryClient.getQueryState(queryKey) : undefined;
  const hasData = state?.data !== undefined;
  const isError = state?.status === "error";
  return {
    hasData,
    isLoading: enabled && !hasData && !isError,
    isError,
    error: state?.error ?? null,
    isFetching: fetching > 0,
    refetch: () => queryClient.refetchQueries({ queryKey, exact: true }),
  };
}

/* -------------------------------------------------------------------------- */
/* Save state                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * The page's registry. While a section holds unsaved edits it registers its
 * `save` (which must REJECT when it did not save) and, optionally, a `discard`
 * that puts its fields back to what is saved. The page's save bar and leave
 * dialog run every registered save; Reset and "Don't save" run every discard.
 * `null` unregisters both.
 */
export type RegisterSectionSave = (
  key: string,
  save: (() => Promise<unknown>) | null,
  discard?: () => void,
) => void;

export interface SectionSave {
  status: SettingsSaveStatus;
  saving: boolean;
  error: unknown;
  /** Rejects on failure (for "Save & Leave"). */
  save: () => Promise<void>;
  /** For a button: never rejects, the error shows inline. */
  trigger: () => void;
  retry: () => void;
}

/**
 * One section's Save: a pending flag of its own (so only its button spins), the
 * error kept inline until the operator changes something, and registration with
 * the page while the section is dirty. The form is never reset on failure.
 */
export function useSectionSave({
  sectionKey,
  isDirty,
  run,
  registerSave,
  signature,
  discard,
}: {
  sectionKey: string;
  isDirty: boolean;
  run: () => Promise<unknown>;
  registerSave?: RegisterSectionSave;
  /** Changes whenever the form does; clears a stale save error. */
  signature: string;
  /** Puts the section's fields back to what is saved (the page's Reset). */
  discard?: () => void;
}): SectionSave {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const savingRef = useRef(false);
  const runRef = useRef(run);
  runRef.current = run;
  const discardRef = useRef(discard);
  discardRef.current = discard;
  const stableDiscard = useCallback(() => discardRef.current?.(), []);

  const save = useCallback(async () => {
    if (savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    setError(null);
    try {
      await runRef.current();
    } catch (err) {
      setError(err ?? new Error("Save failed"));
      throw err;
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }, []);

  const trigger = useCallback(() => {
    save().catch(() => undefined);
  }, [save]);

  useEffect(() => {
    setError(null);
  }, [signature]);

  useEffect(() => {
    if (isDirty) registerSave?.(sectionKey, save, stableDiscard);
    else registerSave?.(sectionKey, null);
  }, [registerSave, sectionKey, isDirty, save, stableDiscard]);

  useEffect(() => () => registerSave?.(sectionKey, null), [registerSave, sectionKey]);

  const status = useSettingsSaveStatus({ isDirty, isPending: saving, error });
  return { status, saving, error, save, trigger, retry: trigger };
}

/* -------------------------------------------------------------------------- */
/* Parts                                                                       */
/* -------------------------------------------------------------------------- */

/** Loading -> read error -> content (with a one-line error over stale data). */
export function ReadGate({
  read,
  thing,
  rows,
  variant = "form",
  columns,
  children,
}: {
  read: SettingsReadState;
  thing: string;
  rows: number;
  variant?: "form" | "table";
  columns?: number;
  children: ReactNode;
}) {
  if (read.isLoading) {
    return <SettingsSectionSkeleton variant={variant} rows={rows} columns={columns} label={`Loading ${thing}`} />;
  }
  if (read.isError && !read.hasData) {
    return (
      <SettingsLoadError
        thing={thing}
        error={read.error}
        onRetry={read.refetch}
        retrying={read.isFetching}
        className="pointer-events-auto"
      />
    );
  }
  return (
    <div className="pointer-events-auto space-y-3">
      {read.isError && (
        <SettingsLoadError
          variant="inline"
          thing={thing}
          error={read.error}
          onRetry={read.refetch}
          retrying={read.isFetching}
        />
      )}
      {children}
    </div>
  );
}

export function SectionHeader({
  id,
  title,
  description,
  action,
}: {
  id: string;
  title: string;
  description?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        <h2 id={id} className={SETTINGS_SECTION_TITLE}>
          {title}
        </h2>
        {description && <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

export function IssueLine({ issue, id, className }: { issue: FieldIssue; id?: string; className?: string }) {
  return (
    <p id={id} role={issue.blocksSave ? "alert" : undefined} className={cn(ISSUE_TEXT_CLASS[issue.tone], className)}>
      {issue.message}
    </p>
  );
}

/**
 * Inline save state beside one labelled Save. Inside a page save bar
 * (`useSettingsPageSave`) the page owns Save, so this shows only a failed save.
 */
export function SaveFooter({
  save,
  disabled,
  onDiscard,
  label = "Save",
}: {
  save: SectionSave;
  disabled?: boolean;
  onDiscard?: () => void;
  label?: string;
}) {
  const pageSave = useSettingsPageSave();
  if (pageSave) {
    return save.status === "error" ? <SettingsSaveState status="error" error={save.error} /> : null;
  }
  return (
    <div className="flex w-full min-w-0 flex-wrap items-center justify-end gap-x-3 gap-y-2">
      <SettingsSaveState status={save.status} error={save.error} onRetry={save.retry} onDiscard={onDiscard} />
      <Button
        type="button"
        size="sm"
        onClick={save.trigger}
        disabled={disabled || save.saving}
        aria-busy={save.saving || undefined}
        className="min-w-[88px]"
      >
        {save.saving && <Loader2 className="animate-spin" data-icon="inline-start" />}
        {label}
      </Button>
    </div>
  );
}
