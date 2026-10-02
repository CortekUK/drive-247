"use client";

/**
 * Add period — the dialog behind the Management tab's "Add period" box.
 *
 * Screen one asks one thing: how this rental continues. Two choices side by
 * side — peers, so they sit level (Ghulam's call, Oct 2 2026, over the usual
 * stacked rule) — each with its picture, a name and one Trax line. One
 * primary button, no scroll. The screens behind each choice — dates and billing for a
 * manual extension, the cadence for an auto extension — are the next step;
 * `onContinue` hands the choice to the caller until they exist.
 */

import { useState } from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui-v2/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui-v2/dialog";
import { AutoExtensionArt, ManualExtensionArt } from "@/components/illustrations-v2/scenes/add-period";

export type PeriodKind = "manual" | "auto";

const CHOICES: { id: PeriodKind; title: string; line: string; Art: React.ComponentType<{ className?: string }> }[] = [
  {
    id: "manual",
    title: "Manual extension",
    line: "You pick the new return date. I charge for exactly those days.",
    Art: ManualExtensionArt,
  },
  {
    id: "auto",
    title: "Auto extension",
    line: "I renew it every week or month and charge each time, until you stop it.",
    Art: AutoExtensionArt,
  },
];

export function AddPeriodDialog({
  open,
  onOpenChange,
  onContinue,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onContinue: (kind: PeriodKind) => void;
}) {
  const [kind, setKind] = useState<PeriodKind | null>(null);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) setKind(null);
        onOpenChange(next);
      }}
    >
      <DialogContent className="gap-5 sm:max-w-[560px]">
        <DialogHeader className="text-center sm:text-center">
          <DialogTitle className="text-[18px]">How should this rental continue?</DialogTitle>
          <DialogDescription className="text-[13px]">
            Pick one. You can add another period after it, of either kind.
          </DialogDescription>
        </DialogHeader>

        <div role="radiogroup" aria-label="Kind of period" className="grid grid-cols-2 gap-3">
          {CHOICES.map(({ id, title, line, Art }) => {
            const on = kind === id;
            return (
              <button
                key={id}
                type="button"
                role="radio"
                aria-checked={on}
                onClick={() => setKind(id)}
                className={cn(
                  "flex h-full w-full cursor-pointer flex-col items-center rounded-2xl border px-3.5 pb-4 pt-3 text-center transition-colors duration-200 motion-reduce:transition-none",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  on
                    ? "border-primary bg-primary/[0.05] dark:border-[hsl(var(--v2-link,var(--primary)))]"
                    : "border-border hover:border-primary/40 hover:bg-primary/[0.025]"
                )}
              >
                <Art className="!mx-auto w-[130px]" />
                <span className="mt-1 text-[14px] font-semibold tracking-tight">{title}</span>
                <span className="mt-0.5 text-[12.5px] leading-relaxed text-muted-foreground">{line}</span>
              </button>
            );
          })}
        </div>

        <DialogFooter>
          <Button
            className="w-full rounded-full sm:w-full"
            disabled={!kind}
            onClick={() => kind && onContinue(kind)}
          >
            Continue
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default AddPeriodDialog;
