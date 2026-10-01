"use client";

/**
 * Agreements v2 — Template Studio's signing dock (Oct 1 2026): a slim pill
 * floating at the bottom of the document, right where things are dropped.
 *
 *   [ Signature ] [ Initials ] [ Date ]  |  [ your signature ] [ ▾ ]
 *
 *  - The three signer fields: click to put one at the cursor, or drag it into
 *    place (the drag carries exactly the token; starting one shows the
 *    editable document so it can land). Each can be placed once: a placed one
 *    carries a tick, one placed twice turns red and says to keep one.
 *  - Your signature: your primary saved signature, one click puts it at the
 *    cursor. ▾ opens Manage signatures (draw, upload, several, one primary).
 *    With none saved yet, the slot opens Manage signatures to add one.
 *
 * It steps out of the way while Trax is writing (the Trax motion: 200ms, fade
 * and 12px, ease-out in, ease-in out, nothing under reduced motion).
 */

import { useMemo, useState, type DragEvent, type ReactNode } from "react";
import { CalendarCheck, CaseUpper, ChevronDown, Info, PenLine, Signature, X, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui-v2/tooltip";
import { SIGNATURE_FIELDS, type SignatureFieldKeyV2 } from "@/lib/agreements-v2/types";
import { countTag } from "@/components/agreements-v2/editor/starter-content";
import { setTokenDragData } from "@/components/agreements-v2/editor/editor-extensions";
import { toast } from "@/hooks/use-toast";
import { useOperatorSignaturesV2 } from "@/hooks/use-operator-signatures-v2";
import { SignatureManagerDialogV2 } from "./signature-manager-dialog-v2";

const FIELD_ICON: Record<SignatureFieldKeyV2, LucideIcon> = {
  signature: Signature,
  initials: CaseUpper,
  date: CalendarCheck,
};
const FIELD_SHORT: Record<SignatureFieldKeyV2, string> = { signature: "Signature", initials: "Initials", date: "Date" };

const TIP_KEY = "agreements-v2:studio-slash-tip-dismissed";

/**
 * A dock button's tooltip: a small white card above it, like the app's menus
 * and hover cards, with the name in bold and one line on what it does. Not the
 * browser's `title` text.
 */
export function DockTip({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <Tooltip>
      {/* `as never`: two copies of @types/react disagree on ReactNode here. */}
      <TooltipTrigger asChild>{children as never}</TooltipTrigger>
      <TooltipContent
        side="top"
        sideOffset={10}
        className="z-[70] max-w-[16rem] flex-col items-start gap-0.5 border border-border bg-popover px-3 py-2 text-popover-foreground shadow-md"
      >
        <span className="text-sm font-semibold">{label}</span>
        {hint && <span className="text-xs leading-snug text-muted-foreground">{hint}</span>}
      </TooltipContent>
    </Tooltip>
  );
}

/** One square slot: every control in the dock is this size. */
const ICON_SLOT =
  "relative inline-flex h-11 w-12 shrink-0 items-center justify-center rounded-xl transition-colors duration-200 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none";

const Divider = () => <span className="mx-1.5 h-7 w-px bg-primary/20" aria-hidden="true" />;

export function SigningDockV2({
  content,
  hidden = false,
  onInsertText,
  onFieldDragStart,
  onInsertSignature,
  className,
  leading,
  trailing,
  tip,
}: {
  /** Last in the dock, after its own divider (the studio's Save). */
  trailing?: ReactNode;
  /** A one-line tip shown above the dock until dismissed (the studio's "/" hint). */
  tip?: ReactNode;
  /** First in the dock, at its normal spacing (the studio's Preview / Edit switch). */
  leading?: ReactNode;
  /** The document as written, to know which fields are placed. */
  content: string;
  /** Out of the way (Trax is writing). */
  hidden?: boolean;
  onInsertText: (token: string) => void;
  onFieldDragStart?: () => void;
  /** Put the operator's signature at the cursor; returns why not, or null. */
  onInsertSignature: (src: string) => string | null;
  className?: string;
}) {
  const [manageOpen, setManageOpen] = useState(false);
  // Remembered per device: a viewer convenience, so browser storage, guarded.
  const [tipDismissed, setTipDismissed] = useState(() => {
    try {
      return typeof window !== "undefined" && window.localStorage.getItem(TIP_KEY) === "1";
    } catch {
      return false;
    }
  });
  const dismissTip = () => {
    setTipDismissed(true);
    try {
      window.localStorage.setItem(TIP_KEY, "1");
    } catch {
      /* private mode: dismissed for this visit only */
    }
  };
  const { primary } = useOperatorSignaturesV2();
  const fields = useMemo(() => SIGNATURE_FIELDS.map((f) => ({ ...f, count: countTag(content, f.tag) })), [content]);

  const useMine = () => {
    if (!primary) {
      setManageOpen(true);
      return;
    }
    const problem = onInsertSignature(primary.imageData);
    if (problem) toast({ title: "Not added", description: problem, variant: "destructive" });
  };

  return (
    <>
      <div
        aria-hidden={hidden || undefined}
        className={cn(
          // The tip sizes to its own one line (it may be wider than the dock).
          "flex flex-col items-center gap-2",
          hidden
            ? "invisible pointer-events-none translate-y-3 opacity-0 [transition:transform_200ms_ease-in,opacity_200ms_ease-in,visibility_0s_linear_200ms]"
            : "visible translate-y-0 opacity-100 [transition:transform_200ms_ease-out,opacity_200ms_ease-out]",
          "motion-reduce:transition-none",
          className,
        )}
      >
      {tip && !tipDismissed && (
        // A one-line tip on top of the dock, like a quiet notice: what to type,
        // dismissed once and remembered on this device.
        // A SOLID white notice (grey border, grey text): quiet, never the accent (the dock is) and
        // never see-through (the agreement behind it showed through before).
        <div role="note" className="flex items-center gap-2.5 rounded-xl border border-zinc-200 bg-[#ffffff] py-1.5 pr-1.5 pl-3 text-sm text-zinc-600 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300 [&_kbd]:border-zinc-300 [&_kbd]:bg-zinc-100 [&_kbd]:text-zinc-800 dark:[&_kbd]:border-zinc-600 dark:[&_kbd]:bg-zinc-700 dark:[&_kbd]:text-zinc-100">
          <Info className="size-4 shrink-0 text-zinc-500 dark:text-zinc-400" aria-hidden="true" />
          <span className="whitespace-nowrap">{tip}</span>
          <button
            type="button"
            onClick={dismissTip}
            aria-label="Dismiss tip"
            className="flex size-7 shrink-0 items-center justify-center rounded-lg text-zinc-500 transition-colors duration-200 ease-out hover:bg-zinc-100 hover:text-zinc-700 motion-reduce:transition-none dark:text-zinc-400 dark:hover:bg-zinc-700 dark:hover:text-zinc-200"
          >
            <X className="size-4" aria-hidden="true" />
          </button>
        </div>
      )}
      <div
        role="toolbar"
        aria-label="Signing"
        // Minimal (Oct 1 2026): a plain solid card with a hairline border; icons
        // only, names in their tooltips; one accent thing (the view switch).
        className="flex items-center gap-1.5 rounded-2xl border border-primary/30 px-2 py-1.5 [background:linear-gradient(hsl(var(--primary)/0.08),hsl(var(--primary)/0.08)),hsl(var(--background))] dark:border-primary/40 dark:[background:linear-gradient(hsl(var(--primary)/0.16),hsl(var(--primary)/0.16)),hsl(var(--background))]"
      >
        {leading && (
          <>
            {leading}
            <Divider />
          </>
        )}
        {fields.map((field) => {
          const Icon = FIELD_ICON[field.key];
          const placed = field.count > 0;
          const twice = field.count > 1;
          return (
            <DockTip
              key={field.key}
              label={field.label}
              hint={
                twice
                  ? `In the agreement ${field.count} times. Keep one.`
                  : placed
                    ? "Already in the agreement."
                    : `${field.hint} Click to add at the cursor, or drag it into place.`
              }
            >
            <button
              type="button"
              draggable={!placed}
              aria-disabled={(placed && !twice) || undefined}
              data-field={field.key}
              aria-label={`${field.label}${twice ? `, placed ${field.count} times` : placed ? ", placed" : ""}`}
              onDragStart={(e: DragEvent<HTMLButtonElement>) => {
                if (placed) {
                  e.preventDefault();
                  return;
                }
                setTokenDragData(e.dataTransfer, field.tag);
                onFieldDragStart?.();
              }}
              onClick={() => !placed && onInsertText(field.tag)}
              className={cn(
                ICON_SLOT,
                twice
                  ? "text-destructive hover:bg-destructive/10"
                  : placed
                    ? "cursor-default text-primary/40 dark:text-[hsl(var(--v2-link,var(--primary))/0.45)]"
                    : "cursor-grab text-primary hover:bg-primary/10 active:cursor-grabbing dark:text-[hsl(var(--v2-link,var(--primary)))]",
              )}
            >
              <Icon className="size-5" aria-hidden="true" />
              {/* Placed: a small dot, green once, red twice. */}
              {placed && (
                <span
                  aria-hidden="true"
                  className={cn("absolute top-1.5 right-1.5 size-1.5 rounded-full", twice ? "bg-destructive" : "bg-green-500")}
                />
              )}
            </button>
            </DockTip>
          );
        })}

        <Divider />

        <DockTip
          label={primary ? "My signature" : "Add your signature"}
          hint={primary ? "Click to add your primary signature at the cursor." : "Draw or upload your signature to use it here."}
        >
        <button
          type="button"
          onClick={useMine}
          aria-label={primary ? "Add my signature" : "Add a signature"}
          className={cn(ICON_SLOT, "w-auto px-1.5 hover:bg-primary/10")}
        >
          {primary ? (
            <span className="flex h-8 w-14 items-center justify-center overflow-hidden rounded-md bg-white ring-1 ring-black/5">
              <img src={primary.imageData} alt="" className="max-h-full max-w-full object-contain" />
            </span>
          ) : (
            <PenLine className="size-5 text-primary dark:text-[hsl(var(--v2-link,var(--primary)))]" aria-hidden="true" />
          )}
        </button>
        </DockTip>
        <DockTip label="Manage signatures" hint="Draw or upload, keep several, choose your primary.">
        <button
          type="button"
          onClick={() => setManageOpen(true)}
          aria-label="Manage signatures"
          className={cn(ICON_SLOT, "w-8 text-primary/70 hover:bg-primary/10 hover:text-primary dark:text-[hsl(var(--v2-link,var(--primary)))]")}
        >
          <ChevronDown className="size-5" aria-hidden="true" />
        </button>
        </DockTip>

        {trailing && (
          <>
            <Divider />
            {trailing}
          </>
        )}
      </div>
      </div>

      <SignatureManagerDialogV2 open={manageOpen} onOpenChange={setManageOpen} onUse={onInsertSignature} />
    </>
  );
}
