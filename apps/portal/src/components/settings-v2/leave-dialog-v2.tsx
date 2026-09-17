"use client";

/**
 * v2 "Save your changes?" dialog, shown when an operator leaves a page with
 * unsaved edits. Drive it with `useLeaveGuardV2` (hooks/use-leave-guard-v2.ts).
 *
 *   const guard = useLeaveGuardV2({ enabled, isDirty, canSave, onSave, onDiscard });
 *   <LeaveDialogV2
 *     open={guard.open}
 *     canSave={guard.canSave}
 *     saving={guard.saving}
 *     onSave={guard.save}
 *     onDiscard={guard.discard}
 *     onCancel={guard.cancel}
 *     error={failure ? <SettingsSaveState status="error" error={failure} /> : null}
 *   />
 *
 * PROPS
 *   open       whether the dialog shows
 *   canSave    false hides Save: some edit has no save the page can run, so
 *              offering it would report success over dropped edits
 *   saving     Save is running: every button waits, Escape does nothing
 *   onSave     "Save": save, then leave
 *   onDiscard  "Don't save": drop the edits and leave
 *   onCancel   stay on the page (Escape, or the close button top-right)
 *   error      why the last save failed, shown above the buttons
 *
 * v2 ONLY. v1 keeps `components/shared/unsaved-changes-dialog.tsx` and its
 * wording ("Unsaved Changes", "Don't Save", "Save & Leave"), which a test pins.
 */

import type { ReactNode } from "react";
import { Loader2, X } from "lucide-react";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui-v2/alert-dialog";
import { Button } from "@/components/ui-v2/button";

export interface LeaveDialogV2Props {
  open: boolean;
  canSave: boolean;
  saving?: boolean;
  onSave: () => void;
  onDiscard: () => void;
  onCancel: () => void;
  error?: ReactNode;
}

export const LEAVE_DIALOG_TITLE = "Save your changes?";

export function LeaveDialogV2({ open, canSave, saving = false, onSave, onDiscard, onCancel, error }: LeaveDialogV2Props) {
  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        // Escape behaves like the close button: stay on the page.
        if (!next && !saving) onCancel();
      }}
    >
      <AlertDialogContent data-leave-dialog="v2" className="sm:max-w-md">
        {/* The dialog's Cancel, so it takes focus when the dialog opens: the
            safe default for a stray Enter is staying on the page. */}
        <AlertDialogCancel
          variant="ghost"
          size="icon-sm"
          disabled={saving}
          aria-label="Stay on this page"
          className="absolute top-4 right-4"
        >
          <X />
        </AlertDialogCancel>
        <AlertDialogHeader className="pr-8">
          <AlertDialogTitle className="font-semibold">{LEAVE_DIALOG_TITLE}</AlertDialogTitle>
          <AlertDialogDescription>
            {canSave
              ? "You have unsaved changes on this page. Save them before you go, or leave without saving."
              : "Some of your changes can only be saved on this page. Close this to go back and save them, or leave without saving."}
          </AlertDialogDescription>
        </AlertDialogHeader>
        {error ? <div className="min-w-0">{error}</div> : null}
        <AlertDialogFooter>
          <Button type="button" variant="outline" onClick={onDiscard} disabled={saving}>
            Don&apos;t save
          </Button>
          {canSave && (
            <Button type="button" onClick={onSave} disabled={saving} aria-busy={saving || undefined}>
              {saving && <Loader2 className="animate-spin" data-icon="inline-start" />}
              {saving ? "Saving…" : "Save"}
            </Button>
          )}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
