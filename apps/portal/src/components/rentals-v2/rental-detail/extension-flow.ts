/**
 * The extension flow — what a new period on a rental asks, and where it lives.
 *
 * Opened from Management → Add period → Manual extension. While it is open the
 * left rail swaps the rental's eight stages for these four steps, the same way
 * the rental rail swaps out the app sidebar, and the main pane shows the step.
 *
 * Like the stages, everything is in the URL — `?extend=manual&step=when&end=…`
 * — because the rail and the pane are siblings that share nothing else (see
 * rental-detail-v2.tsx). It is deep-linkable, survives a refresh, and leaving
 * it is just dropping the params.
 *
 * Every extension carries its own configuration for these four: its dates
 * (it starts where the booking ends; only the end is chosen), its agreement,
 * its insurance and its payments.
 */

import type { ComponentType } from "react";
import { CalendarDays, CreditCard, FileSignature, ShieldCheck } from "lucide-react";

export type ExtensionKind = "manual" | "auto";
export type ExtensionStepId = "when" | "agreement" | "insurance" | "payments";

export const EXTENSION_STEPS: readonly {
  id: ExtensionStepId;
  label: string;
  icon: ComponentType<{ className?: string }>;
  prompt: string;
}[] = [
  { id: "when", label: "When", icon: CalendarDays, prompt: "Until when?" },
  { id: "agreement", label: "Agreement", icon: FileSignature, prompt: "Which contract?" },
  { id: "insurance", label: "Insurance", icon: ShieldCheck, prompt: "Keep the cover?" },
  { id: "payments", label: "Payments", icon: CreditCard, prompt: "How is it paid?" },
] as const;

export const EXTENSION_TITLE: Record<ExtensionKind, string> = {
  manual: "Manual extension",
  auto: "Auto extension",
};

const STEP_IDS = new Set<string>(EXTENSION_STEPS.map((s) => s.id));
const DAY = /^\d{4}-\d{2}-\d{2}$/;

export type ExtensionState = { kind: ExtensionKind; step: ExtensionStepId; end: string | null };

/** The open extension, or null when the rental is showing its stages. */
export function readExtension(params: URLSearchParams | { get(k: string): string | null } | null): ExtensionState | null {
  const kind = params?.get("extend");
  if (kind !== "manual" && kind !== "auto") return null;
  const step = params?.get("step");
  const end = params?.get("end");
  return {
    kind,
    step: step && STEP_IDS.has(step) ? (step as ExtensionStepId) : "when",
    end: end && DAY.test(end) ? end : null,
  };
}

export function extensionHref(rentalId: string, s: ExtensionState): string {
  const q = new URLSearchParams({ extend: s.kind, step: s.step });
  if (s.end) q.set("end", s.end);
  return `/rentals/${rentalId}?${q.toString()}`;
}

/** "Mar 8" at local midnight — rental dates are calendar days. */
export const shortDay = (iso: string | null | undefined) =>
  iso
    ? new Date(`${String(iso).slice(0, 10)}T00:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric" })
    : "—";

/** What each step says in the rail; null while it is still asking. */
export function extensionValues(s: ExtensionState, start: string | null): Record<ExtensionStepId, string | null> {
  return {
    when: s.end ? `${shortDay(start)} → ${shortDay(s.end)}` : null,
    agreement: null,
    insurance: null,
    payments: null,
  };
}

/* ── viewing a period that already exists ───────────────────────────────────
   Clicking an extension card in Management opens it in the same layout as the
   flow — the rail's four steps, the pane's step — read from `?period=<id>`. */

export type PeriodView = { period: string; step: ExtensionStepId };

export function readPeriod(params: { get(k: string): string | null } | null): PeriodView | null {
  const period = params?.get("period");
  if (!period) return null;
  const step = params?.get("step");
  return { period, step: step && STEP_IDS.has(step) ? (step as ExtensionStepId) : "when" };
}

export function periodHref(rentalId: string, v: PeriodView): string {
  return `/rentals/${rentalId}?${new URLSearchParams({ period: v.period, step: v.step }).toString()}`;
}

/* ── the whole rental at a glance ────────────────────────────────────────────
   Opened from the Management tab's Overview card. Full width: the layout drops
   the stage rail while it is open, so the rail and the pane read as one area. */

export function readOverview(params: { get(k: string): string | null } | null): boolean {
  return params?.get("overview") === "1";
}

export const overviewHref = (rentalId: string) => `/rentals/${rentalId}?overview=1`;
