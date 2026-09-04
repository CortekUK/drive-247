"use client";

/**
 * The password-field bits that BOTH the create-account form and the
 * password-reset panel render.
 *
 * They live in their own module because they were previously duplicated, and a
 * duplicated control is a control that drifts: the strength meter had a
 * module-local colour map in account-step.tsx and a second, differently-worded
 * one inlined in the reset panel — where the "strong" colour was a
 * `bg-green-600` with no dark variant, i.e. the one bar colour in the flow that
 * did not follow the theme. One map, imported twice, makes that impossible.
 */

import * as React from "react";
import { Eye, EyeOff } from "lucide-react";

import { Button } from "@/components/ui/button";

interface PasswordToggleProps {
  shown: boolean;
  onToggle(): void;
  /**
   * What this toggle acts on, folded into the accessible name. A form with two
   * password fields otherwise offers two buttons both called "Show password",
   * which are indistinguishable in a screen reader's element list.
   */
  fieldLabel?: string;
}

/**
 * Show/hide control for a masked input. Rendered INSIDE a `relative` wrapper
 * that also holds the input, and the input must reserve room for it (`pr-10`).
 *
 * `aria-pressed` as well as the label swap: a toggle whose only state signal is
 * its accessible name reads as a different button each time it is pressed,
 * rather than as one button that is now on.
 */
export function PasswordToggle({
  shown,
  onToggle,
  fieldLabel = "password",
}: PasswordToggleProps) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      onClick={onToggle}
      aria-pressed={shown}
      aria-label={shown ? `Hide ${fieldLabel}` : `Show ${fieldLabel}`}
      className="absolute right-1 top-1 text-muted-foreground hover:text-foreground"
    >
      {shown ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
    </Button>
  );
}

/**
 * Meter fill per `passwordStrength().score`.
 *
 * Indigo — not green — at the top of the scale: green at the contrast this bar
 * needs fails AA against the light surface, and indigo is already the accent
 * the rest of the dialog uses for "good". Every entry carries the dark-theme
 * variant it needs; the bar sits on `bg-muted`, which flips with the theme.
 */
export const STRENGTH_BAR_CLASS: Record<number, string> = {
  0: "bg-red-500",
  1: "bg-red-500",
  2: "bg-amber-500",
  3: "bg-indigo-500",
  4: "bg-indigo-600 dark:bg-indigo-400",
};
