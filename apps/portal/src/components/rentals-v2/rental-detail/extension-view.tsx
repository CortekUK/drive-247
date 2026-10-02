"use client";

/**
 * The extension flow's main pane — the step the URL names (see extension-flow.ts).
 *
 * When is built: the period starts where the booking ends (fixed, shown) and
 * only its end is picked, on the app's own calendar. Agreement, Insurance and
 * Payments are the next steps to configure; until they are, each says so
 * honestly rather than offering controls that do nothing. Nothing is saved
 * from here yet — the period is created when the flow is finished.
 */

import { useRouter } from "next/navigation";
import { addDays, differenceInCalendarDays, format } from "date-fns";
import { ArrowLeft, ArrowRight, X } from "lucide-react";
import { Button } from "@/components/ui-v2/button";
import { Calendar } from "@/components/ui-v2/calendar";
import { EmptyHint, Panel } from "./_kit";
import type { RentalDetailV2 } from "./use-rental-detail-v2";
import {
  EXTENSION_STEPS, EXTENSION_TITLE, extensionHref, shortDay,
  type ExtensionState, type ExtensionStepId,
} from "./extension-flow";
import { stageHref } from "./stages";

const local = (iso: string) => new Date(`${iso.slice(0, 10)}T00:00:00`);
const iso = (d: Date) => format(d, "yyyy-MM-dd");

function WhenStep({ start, state, go }: { start: string | null; state: ExtensionState; go: (s: Partial<ExtensionState>) => void }) {
  if (!start) {
    return <EmptyHint>This rental has no end date, so there is nothing to extend from. Set its return date first.</EmptyHint>;
  }
  const from = local(start);
  const end = state.end ? local(state.end) : undefined;
  const days = end ? differenceInCalendarDays(end, from) : null;

  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      {/* Start is the booking's end — shown, not chosen. */}
      <div className="grid shrink-0 grid-cols-2 gap-3">
        <div className="rounded-2xl bg-muted/50 px-4 py-3">
          <p className="text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground/70">Starts</p>
          <p className="mt-1 text-[15px] font-semibold">{shortDay(start)}</p>
          <p className="text-[11.5px] text-muted-foreground">Where the booking ends</p>
        </div>
        <div className="rounded-2xl border border-primary/20 bg-primary/[0.06] px-4 py-3">
          <p className="text-[10.5px] font-semibold uppercase tracking-wider text-primary dark:text-[hsl(var(--v2-link,var(--primary)))]">Ends</p>
          <p className="mt-1 text-[15px] font-semibold">{state.end ? shortDay(state.end) : "Pick a date"}</p>
          <p className="text-[11.5px] text-muted-foreground">
            {days != null ? `${days} ${days === 1 ? "day" : "days"} added` : "On the calendar below"}
          </p>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 justify-center rounded-3xl bg-card p-2 ring-1 ring-foreground/5">
        <Calendar
          mode="single"
          defaultMonth={end ?? from}
          selected={end}
          disabled={{ before: addDays(from, 1) }}
          modifiers={{ booked: from }}
          modifiersClassNames={{ booked: "[&>button]:ring-1 [&>button]:ring-primary/40" }}
          onSelect={(d) => go({ end: d ? iso(d) : null })}
        />
      </div>
    </div>
  );
}

export function ExtensionView({ detail, state }: { detail: RentalDetailV2; state: ExtensionState }) {
  const router = useRouter();
  const id = detail.rental.id;
  const start = detail.rental.end_date ?? null;
  const index = EXTENSION_STEPS.findIndex((s) => s.id === state.step);
  const step = EXTENSION_STEPS[index];
  const prev = EXTENSION_STEPS[index - 1];
  const next = EXTENSION_STEPS[index + 1];

  const go = (patch: Partial<ExtensionState>) =>
    router.replace(extensionHref(id, { ...state, ...patch }), { scroll: false });
  const toStep = (s: ExtensionStepId) => go({ step: s });
  const leave = () => router.replace(stageHref(id, "when"), { scroll: false });

  const canNext = state.step !== "when" || !!state.end;

  return (
    <Panel
      title={`${EXTENSION_TITLE[state.kind]} · ${step.label}`}
      description={
        state.step === "when"
          ? "It starts where the booking ends. Pick the day it should end."
          : step.prompt
      }
      footer={
        <div className="flex items-center justify-between gap-2">
          <Button variant="ghost" className="gap-1.5 rounded-full text-muted-foreground" onClick={leave}>
            <X className="size-4" />
            Cancel extension
          </Button>
          <div className="flex items-center gap-2">
            {prev && (
              <Button variant="outline" className="gap-1.5 rounded-full" onClick={() => toStep(prev.id)}>
                <ArrowLeft className="size-4" />
                {prev.label}
              </Button>
            )}
            {next && (
              <Button className="gap-1.5 rounded-full" disabled={!canNext} onClick={() => toStep(next.id)}>
                {next.label}
                <ArrowRight className="size-4" />
              </Button>
            )}
          </div>
        </div>
      }
    >
      {state.step === "when" ? (
        <WhenStep start={start} state={state} go={go} />
      ) : (
        <EmptyHint>
          The {step.label.toLowerCase()} settings for this extension come next. The dates you picked are kept while you
          move between steps.
        </EmptyHint>
      )}
    </Panel>
  );
}

export default ExtensionView;
