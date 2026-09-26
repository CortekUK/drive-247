"use client";

/**
 * The history of every manual balance change — WHO, WHEN, WHY, and the effect —
 * with Undo. Undo never edits or deletes: it records a new, opposite entry,
 * and both stay on the list.
 *
 * Also shows the one gap the three-step off-platform path can leave: a payment
 * recorded outside the platform whose note did not save (the payment is real
 * and applied; only its "why" is missing), with a button to add it.
 */

import { useState } from "react";
import { Loader2, Undo2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui-v2/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui-v2/dialog";
import { useToast } from "@/hooks/use-toast";
import { useBalanceActions, type AdjustmentEntry, type UnrecordedPayment } from "@/hooks/use-balance-adjustments";
import {
  KIND_LABELS,
  REASON_CODES,
  REASON_LABELS,
  UNDO_REASON_CODES,
  effectWords,
  formatCents,
  formatSignedCents,
} from "./balance-words";
import { BalanceField, BalanceSelect, Callout, noteCls } from "./balance-kit";

const when = (iso: string) => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("en-US", { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" });
};

export function AdjustmentHistory({
  customerId,
  entries,
  unrecorded,
  currency,
  canEdit,
  rentalLabel,
}: {
  customerId: string;
  entries: AdjustmentEntry[];
  unrecorded: UnrecordedPayment[];
  currency: string;
  canEdit: boolean;
  /** Customer scope: names the rental an entry sits on. */
  rentalLabel?: (rentalId: string) => string | null;
}) {
  const [undoing, setUndoing] = useState<AdjustmentEntry | null>(null);
  const [noting, setNoting] = useState<UnrecordedPayment | null>(null);
  const byId = new Map(entries.map((e) => [e.id, e]));

  if (entries.length === 0 && unrecorded.length === 0) {
    return <p className="text-xs text-muted-foreground">No manual changes to this balance yet.</p>;
  }

  return (
    <>
      <ul className="divide-y divide-foreground/5 overflow-hidden rounded-3xl bg-muted/40 ring-1 ring-foreground/5" aria-label="Balance changes">
        {unrecorded.map((p) => (
          <li key={`gap-${p.paymentId}`} className="flex items-start gap-3 px-5 py-3.5" data-testid="unrecorded-payment">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium">Paid outside the platform · no note saved</p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {[p.method, p.paymentDate].filter(Boolean).join(" · ")}. The payment is recorded and applied; only the reason is missing.
              </p>
            </div>
            <p className="shrink-0 text-sm font-semibold tabular-nums">{formatSignedCents(-p.amountCents, currency)}</p>
            {canEdit && (
              <Button size="xs" variant="outline" onClick={() => setNoting(p)}>
                Add the note
              </Button>
            )}
          </li>
        ))}

        {entries.map((e) => {
          const original = e.reversesId ? byId.get(e.reversesId) ?? null : null;
          const isUndo = !!e.reversesId;
          const title = isUndo ? `Undo · ${KIND_LABELS[e.kind]}` : KIND_LABELS[e.kind];
          const where = e.rentalId ? rentalLabel?.(e.rentalId) ?? null : rentalLabel ? "On the account" : null;
          // A refunded off-platform payment cannot be undone — the server
          // refuses it (balance_adjustment_reverse), so no button offers it.
          const refunded = e.kind === "off_platform_payment" && !!e.paymentRefunded;
          const canUndo = canEdit && !isUndo && !e.undoneBy && !refunded;
          return (
            <li key={e.id} className="flex items-start gap-3 px-5 py-3.5" data-testid="adjustment-entry" data-entry-id={e.id}>
              <div className="min-w-0 flex-1">
                <p className={cn("text-sm font-medium", e.undoneBy && "text-muted-foreground line-through decoration-muted-foreground/40")}>
                  {title}
                  {e.kind === "off_platform_payment" && e.paymentMethod ? ` · ${e.paymentMethod}` : ""}
                </p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {[e.createdByName || "A team member", when(e.createdAt), REASON_LABELS[e.reasonCode] ?? e.reasonCode, where]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
                <p className="mt-1 text-xs leading-relaxed text-foreground/80">&ldquo;{e.note}&rdquo;</p>
                {original && (
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    Undoes the {formatSignedCents(original.amountCents, currency)} entry of {when(original.createdAt)}
                  </p>
                )}
                {e.undoneBy && (
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    Undone {when(e.undoneBy.at)} by {e.undoneBy.byName || "a team member"}
                  </p>
                )}
                {e.reversedWithoutUndo && !refunded && (
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    The payment was reversed elsewhere; the undo is not on this record yet.
                  </p>
                )}
                {refunded && !isUndo && !e.undoneBy && (
                  <p className="mt-1 text-[11px] text-muted-foreground" data-testid="refunded-no-undo">
                    Some of this payment was refunded, so it cannot be undone. Record a correction for what is still wrong.
                  </p>
                )}
              </div>
              <div className="shrink-0 text-right">
                <p className={cn("text-sm font-semibold tabular-nums", e.undoneBy && "text-muted-foreground")}>
                  {formatSignedCents(e.amountCents, currency)}
                </p>
                <p className="text-[11px] text-muted-foreground">{effectWords(e.kind, e.amountCents, isUndo)}</p>
              </div>
              {canUndo && (
                <Button size="xs" variant="outline" onClick={() => setUndoing(e)} aria-label={`Undo ${title}`}>
                  <Undo2 className="size-3" />
                  {e.reversedWithoutUndo ? "Record the undo" : "Undo"}
                </Button>
              )}
            </li>
          );
        })}
      </ul>

      <UndoDialog customerId={customerId} entry={undoing} currency={currency} onClose={() => setUndoing(null)} />
      <AddNoteDialog customerId={customerId} payment={noting} currency={currency} onClose={() => setNoting(null)} />
    </>
  );
}

/* ── Undo: a reason, a note, and the effect in words ─────────────────────── */

export function UndoDialog({
  customerId,
  entry,
  currency,
  onClose,
}: {
  customerId: string;
  entry: AdjustmentEntry | null;
  currency: string;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const actions = useBalanceActions();
  const [reasonCode, setReasonCode] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const close = () => {
    if (busy) return;
    setReasonCode("");
    setNote("");
    setError(null);
    onClose();
  };

  const reversesPayment = entry?.kind === "off_platform_payment" && entry.paymentStatus !== "Reversed";
  const effect = entry
    ? entry.amountCents < 0
      ? `They will owe ${formatCents(-entry.amountCents, currency)} more again.`
      : `They will owe ${formatCents(entry.amountCents, currency)} less again.`
    : "";

  const run = async () => {
    if (!entry || !reasonCode || !note.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await actions.undo(customerId, entry, reasonCode, note.trim());
      toast({ title: "Undone", description: effect });
      setReasonCode("");
      setNote("");
      onClose();
    } catch (err: any) {
      setError(err?.message || "It could not be undone.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={!!entry} onOpenChange={(o) => !o && close()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="font-heading">Undo this change?</DialogTitle>
          <DialogDescription>
            Nothing is deleted. A new entry records the opposite, and both stay in the history.
          </DialogDescription>
        </DialogHeader>
        {entry && (
          <div className="space-y-4">
            <Callout>
              <p className="font-medium">
                {KIND_LABELS[entry.kind]} · {formatSignedCents(entry.amountCents, currency)}
              </p>
              <p className="mt-1 text-xs">{effect}</p>
              {reversesPayment && (
                <p className="mt-1 text-xs">
                  The payment itself is reversed first: its money comes off the charges it paid, and it stops counting as
                  received.
                </p>
              )}
            </Callout>
            <BalanceField label="Why undo it?" htmlFor="undo-reason">
              <BalanceSelect
                id="undo-reason"
                value={reasonCode}
                onChange={setReasonCode}
                placeholder="Pick a reason"
                options={UNDO_REASON_CODES.map((r) => ({ value: r, label: REASON_LABELS[r] ?? r }))}
              />
            </BalanceField>
            <BalanceField label="Note" htmlFor="undo-note">
              <textarea id="undo-note" rows={2} value={note} onChange={(e) => setNote(e.target.value)} className={noteCls} />
            </BalanceField>
            {error && <Callout tone="destructive">{error}</Callout>}
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={close} disabled={busy}>
            Keep it
          </Button>
          <Button data-confirm disabled={!reasonCode || !note.trim() || busy} onClick={() => void run()}>
            {busy && <Loader2 className="size-4 animate-spin" />}
            Undo {entry ? formatSignedCents(entry.amountCents, currency) : ""}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ── The missing note on an off-platform payment ─────────────────────────── */

function AddNoteDialog({
  customerId,
  payment,
  currency,
  onClose,
}: {
  customerId: string;
  payment: UnrecordedPayment | null;
  currency: string;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const actions = useBalanceActions();
  const [reasonCode, setReasonCode] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const close = () => {
    if (busy) return;
    setReasonCode("");
    setNote("");
    setError(null);
    onClose();
  };

  const run = async () => {
    if (!payment || !reasonCode || !note.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await actions.recordOffPlatformNote(customerId, payment.paymentId, reasonCode, note.trim());
      toast({ title: "Note saved", description: "The payment is now on the record with its reason." });
      setReasonCode("");
      setNote("");
      onClose();
    } catch (err: any) {
      setError(err?.message || "The note could not be saved.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={!!payment} onOpenChange={(o) => !o && close()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="font-heading">Why was this paid outside the platform?</DialogTitle>
          <DialogDescription>
            {payment ? `${formatCents(payment.amountCents, currency)}${payment.method ? ` by ${payment.method}` : ""}.` : ""}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <BalanceField label="Reason" htmlFor="note-reason">
            <BalanceSelect
              id="note-reason"
              value={reasonCode}
              onChange={setReasonCode}
              placeholder="Pick a reason"
              options={REASON_CODES.off_platform_payment.map((r) => ({ value: r, label: REASON_LABELS[r] ?? r }))}
            />
          </BalanceField>
          <BalanceField label="Note" htmlFor="note-note">
            <textarea id="note-note" rows={2} value={note} onChange={(e) => setNote(e.target.value)} className={noteCls} />
          </BalanceField>
          {error && <Callout tone="destructive">{error}</Callout>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={close} disabled={busy}>
            Cancel
          </Button>
          <Button data-confirm disabled={!reasonCode || !note.trim() || busy} onClick={() => void run()}>
            {busy && <Loader2 className="size-4 animate-spin" />}
            Save the note
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
