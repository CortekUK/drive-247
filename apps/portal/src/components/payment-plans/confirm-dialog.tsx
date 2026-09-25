"use client";

/**
 * A confirmation that says exactly what will happen, and waits for it.
 *
 * Not ui-v2's AlertDialog: its Action closes the dialog on click, before an
 * async call has answered — so a refused cancel would look like it worked.
 * Here the dialog stays open until `onConfirm` resolves, and stays open with
 * the server's message on screen (the caller toasts it) if it rejects.
 */

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui-v2/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui-v2/dialog";

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  children,
  confirmLabel,
  cancelLabel = "Keep it as it is",
  destructive,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  children: React.ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  destructive?: boolean;
  onConfirm: () => Promise<unknown>;
}) {
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (busy) return;
        if (!next) setFailed(null);
        onOpenChange(next);
      }}
    >
      <DialogContent className="sm:max-w-md" data-confirm-dialog="">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription asChild>
            <div className="space-y-2 text-sm leading-relaxed text-muted-foreground">{children}</div>
          </DialogDescription>
        </DialogHeader>
        {failed && (
          <p role="alert" className="rounded-2xl bg-destructive/10 px-3.5 py-2.5 text-xs text-destructive">
            {failed}
          </p>
        )}
        <DialogFooter>
          <Button type="button" variant="outline" disabled={busy} onClick={() => onOpenChange(false)}>
            {cancelLabel}
          </Button>
          <Button
            type="button"
            variant={destructive ? "destructive" : "default"}
            disabled={busy}
            data-confirm=""
            onClick={async () => {
              setBusy(true);
              setFailed(null);
              try {
                await onConfirm();
                onOpenChange(false);
              } catch (err) {
                setFailed(err instanceof Error ? err.message : String(err));
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy && <Loader2 className="animate-spin" />}
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
