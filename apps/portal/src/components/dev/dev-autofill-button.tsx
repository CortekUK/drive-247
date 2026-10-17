"use client";

/**
 * The wand in the top-right corner of the v2 add-customer and add-vehicle
 * dialogs. Renders nothing unless `useDevAutofill()` is true — Northwind only,
 * with the switch on in the super-admin Developer page. See lib/dev-autofill.ts.
 */

import { Wand2 } from "lucide-react";

import { useDevAutofill } from "@/lib/dev-autofill";
import { cn } from "@/lib/utils";

export function DevAutofillButton({ onFill, className }: { onFill: () => void; className?: string }) {
  const enabled = useDevAutofill();
  if (!enabled) return null;
  return (
    <button
      type="button"
      onClick={onFill}
      title="Fill with sample data"
      aria-label="Fill with sample data"
      className={cn(
        "absolute right-4 top-4 z-10 flex size-8 items-center justify-center rounded-full bg-primary/10 text-primary",
        "opacity-70 [transition:opacity_200ms_ease-in] hover:opacity-100 hover:[transition:opacity_200ms_ease-out] motion-reduce:transition-none",
        className,
      )}
    >
      <Wand2 className="size-4" />
    </button>
  );
}
