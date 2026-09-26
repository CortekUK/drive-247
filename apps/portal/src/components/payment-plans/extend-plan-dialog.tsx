"use client";

/**
 * Extend — the rental gets more days, and the plan collects them.
 *
 * The four questions, each answered in one line (roadmap A3–A5):
 *
 *   how long        a number of periods, or until a date (the server extends
 *                   by whole periods, so a date becomes "N periods, to X").
 *                   Counted exactly as the engine counts them
 *                   (lib/payment-plans-ui/renewal.ts `extendSteps`): the
 *                   plan's untouched renewal periods first, then new ones
 *                   from the end of its last live period — never from the
 *                   rental's end date alone, which would bill days twice.
 *                   The period is the plan's own renewal period, else ONE of
 *                   the rental's own periods (rental_period_type), and the
 *                   browser always SENDS it (periodUnit + periodCount), so
 *                   the server can never price a different period than the
 *                   one on screen.
 *   when the days   "Give the days now and collect on the plan" — the return
 *                   date moves now, as a manual extension does today — or
 *                   "Give the days when paid" — it moves once each period is
 *                   paid, as a renewal does today. The choice is the operator's
 *                   and it is said out loud, not buried in which button ran.
 *   insurance       only when the tenant sells Bonzah: the rental's own cover,
 *                   or none. Bonzah can't start cover before tomorrow in
 *                   Pacific time, and a premium is never charged without a
 *                   policy (A4) — the dialog says what that means for THESE
 *                   days before anything is saved.
 *   agreement       "Send an extension agreement", on by default for an
 *                   operator's Extend (A5). Sent through the manual
 *                   extension's own `/api/esign` request.
 *
 * On confirm the caller runs `payment-plan-manage` 'extend' and then the
 * agreement (hooks/use-payment-plan `extendOnPlan`). Nothing here writes.
 */

import { useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import { useTenant } from "@/contexts/TenantContext";
import { Button } from "@/components/ui-v2/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui-v2/dialog";
import { Switch } from "@/components/ui-v2/switch";
import { cn } from "@/lib/utils";
import { isBonzahSellable } from "@/lib/bonzah";
import { clampToBonzahStart } from "@/lib/bonzah-dates";
import { addDays, formatDay, plural, type ISODate } from "@/lib/payment-plans-ui/format";
import {
  BONZAH_START_RULE,
  MAX_EXTEND_PERIODS,
  describeCoverage,
  describeEvery,
  extendByPeriods,
  extendUntil,
  formatPeriodSpan,
  hasCoverage,
  insurableSentence,
  insurableWindow,
  plannedEnd,
  unitWord,
  type ExtendPlan,
  type RenewalInsurance,
  type RenewalUnit,
} from "@/lib/payment-plans-ui/renewal";
import type { OccurrenceView, PlanView } from "@/lib/payment-plans-ui/view-types";
import { useRentalPlanFacts, usePaymentPlanActions, type ExtendInput, type RentalPlanFacts } from "@/hooks/use-payment-plan";
import { Chip, InlineDate, InlineNumber, SentenceLine } from "./sentence-kit";

export interface ExtendPlanDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  plan: Pick<PlanView, "renewal" | "status">;
  /** The rental's return date now. */
  currentEnd: ISODate | null;
  /**
   * The plan's payments. Its live renewal periods decide where new periods
   * start and which ones an Extend takes first (`extendSteps`).
   */
  occurrences?: OccurrenceView[];
  /** `undefined` while the rental is still being read (the defaults wait for it); `null` when it could not be. */
  facts: Pick<RentalPlanFacts, "periodUnit" | "customerEmail" | "coverage"> | null | undefined;
  bonzahSellable: boolean;
  onExtend: (input: ExtendInput) => Promise<unknown>;
}

/**
 * The period one Extend counts in: the plan's own renewal period, else ONE of
 * the rental's own periods (rental_period_type) — one period is one rental-
 * period rate, which is what the server charges for it. Null when the plan
 * does not renew and the rental's period type could not be read: guessing a
 * unit would price a month's rate for a week (or a week's for a month).
 */
export function extendPeriodOf(
  plan: Pick<PlanView, "renewal">,
  facts: Pick<RentalPlanFacts, "periodUnit"> | null | undefined,
): { unit: RenewalUnit; count: number } | null {
  if (plan.renewal) return { unit: plan.renewal.periodUnit, count: plan.renewal.periodCount };
  if (!facts?.periodUnit) return null;
  return { unit: facts.periodUnit, count: 1 };
}

export function ExtendPlanDialog(props: ExtendPlanDialogProps) {
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="w-[calc(100vw-2rem)] sm:!max-w-2xl max-h-[90svh] overflow-y-auto no-scrollbar" data-extend-plan-dialog="">
        {props.open &&
          (props.facts === undefined ? (
            <>
              <DialogHeader>
                <DialogTitle>Extend the rental</DialogTitle>
                <DialogDescription>Reading the rental&rsquo;s dates and cover…</DialogDescription>
              </DialogHeader>
              <Loader2 className="mx-auto my-6 size-5 animate-spin text-muted-foreground" />
            </>
          ) : (
            <ExtendBody {...props} />
          ))}
      </DialogContent>
    </Dialog>
  );
}

type How = "periods" | "date";

const NO_OCCURRENCES: OccurrenceView[] = [];

function ExtendBody({ onOpenChange, plan, currentEnd, occurrences = NO_OCCURRENCES, facts, bonzahSellable, onExtend }: ExtendPlanDialogProps) {
  const known = extendPeriodOf(plan, facts);
  // Only for the words while there is nothing to extend by; never sent.
  const period = known ?? { unit: "week" as RenewalUnit, count: 1 };
  const every = describeEvery(period.unit, period.count);
  const one = period.count === 1 ? `1 ${period.unit}` : unitWord(period.unit, period.count);

  const [how, setHow] = useState<How>("periods");
  const [periods, setPeriods] = useState(1);
  const [until, setUntil] = useState<ISODate | null>(null);
  const [giveDaysNow, setGiveDaysNow] = useState(true);
  const coverage = facts?.coverage ?? null;
  const [insure, setInsure] = useState<"rental" | "none">(bonzahSellable && hasCoverage(coverage) ? "rental" : "none");
  const hasEmail = !!facts?.customerEmail;
  const [sendAgreement, setSendAgreement] = useState(true);
  const [busy, setBusy] = useState(false);

  const plan_: ExtendPlan = useMemo(() => {
    if (!known) {
      return { ok: false, message: "The rental's period (daily, weekly or monthly) could not be read, so a period can't be priced. Close this and try again." };
    }
    return how === "periods"
      ? extendByPeriods(currentEnd, occurrences, known.unit, known.count, periods)
      : extendUntil(currentEnd, occurrences, until, known.unit, known.count);
  }, [known?.unit, known?.count, currentEnd, occurrences, how, periods, until]); // eslint-disable-line react-hooks/exhaustive-deps

  // Where new periods start when the plan already has periods being collected.
  const planned = currentEnd ? plannedEnd(currentEnd, occurrences) : null;
  const reused = plan_.ok ? plan_.steps.filter((s) => s.reused) : [];
  const firstStart = plan_.ok ? plan_.steps[0].periodStart : currentEnd;

  const insurance: RenewalInsurance | null = bonzahSellable && insure === "rental" && hasCoverage(coverage) ? { ...coverage } : null;
  const window_ = plan_.ok && firstStart ? insurableWindow(firstStart, plan_.newEnd, clampToBonzahStart(firstStart)) : null;
  const willSend = sendAgreement && hasEmail;

  const confirm = async () => {
    if (!plan_.ok || !known) return;
    setBusy(true);
    try {
      await onExtend({
        periods: plan_.periods,
        giveDaysNow,
        sendAgreement: willSend,
        insurance,
        // Always the period on screen — the server never picks its own.
        periodUnit: known.unit,
        periodCount: known.count,
      });
      onOpenChange(false);
    } catch {
      /* the caller toasted it; stay open so nothing chosen is lost */
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>Extend the rental</DialogTitle>
        <DialogDescription>
          {currentEnd
            ? `It ends ${formatDay(currentEnd)} now. It is extended in whole periods of ${one}, and each new period is collected on the payment plan.`
            : "This rental has no return date to extend from."}
        </DialogDescription>
      </DialogHeader>

      <div className="space-y-4">
        {/* ── how long ─────────────────────────────────────────────────── */}
        <SentenceLine word="by" id="extend-by" error={plan_.ok ? null : plan_.message}>
          <Chip active={how === "periods"} onClick={() => setHow("periods")}>
            a number of periods
          </Chip>
          <Chip active={how === "date"} onClick={() => setHow("date")}>
            until a date
          </Chip>
          {how === "periods" ? (
            <span className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">
              <InlineNumber label="Number of periods" value={periods} min={1} max={MAX_EXTEND_PERIODS} onChange={setPeriods} />
              {periods === 1 ? `period of ${one}` : `periods of ${one}`}
            </span>
          ) : (
            <InlineDate label="Extend until" value={until} min={currentEnd ? addDays(currentEnd, 1) : undefined} onChange={setUntil} />
          )}
        </SentenceLine>
        {plan_.ok && currentEnd && (
          <p className="text-xs leading-relaxed text-muted-foreground sm:pl-[92px]" data-extend-summary="">
            {plural(plan_.periods, reused.length === plan_.periods ? "period" : "new period")} ({every}): the rental runs {formatDay(currentEnd)} → {formatDay(plan_.newEnd)}
            {how === "date" && until && plan_.newEnd !== until ? ` — the whole period that covers ${formatDay(until)}` : ""}.
            {reused.length > 0 &&
              ` ${reused.length === 1 ? "Payment" : "Payments"} ${reused.map((r) => `#${r.seq} (${formatPeriodSpan(r.periodStart, r.periodEnd)})`).join(", ")} already on the plan ${reused.length === 1 ? "is" : "are"} brought forward to today${plan_.periods > reused.length ? ` and ${plural(plan_.periods - reused.length, "new period")} added after ${reused.length === 1 ? "it" : "them"}` : ""}.`}
            {reused.length === 0 && planned && planned > currentEnd && ` The plan already runs the rental to ${formatDay(planned)} once its open periods are paid, so the new days start there.`}
          </p>
        )}

        {/* ── when the days are given ──────────────────────────────────── */}
        <div className="space-y-2" role="radiogroup" aria-label="When the days are given">
          <ChoiceCard
            active={giveDaysNow}
            onClick={() => setGiveDaysNow(true)}
            title="Give the days now and collect on the plan"
            line={
              plan_.ok
                ? `The return date moves to ${formatDay(plan_.newEnd)} now; each new period is collected on the day it starts.`
                : "The return date moves now; each new period is collected on the day it starts."
            }
            testId="now"
          />
          <ChoiceCard
            active={!giveDaysNow}
            onClick={() => setGiveDaysNow(false)}
            title="Give the days when paid"
            line="Each new period is added to the plan, and the return date moves only once that period is paid."
            testId="when_paid"
          />
        </div>

        {/* ── insurance for the new days (only when Bonzah is sold) ────── */}
        {bonzahSellable && (
          <SentenceLine
            word="cover"
            id="extend-cover"
            hint={
              <>
                {!hasCoverage(coverage) && "This rental has no Bonzah cover, so the new days have none either. "}
                {insure === "rental" && window_ ? `${insurableSentence(window_, plan_.ok ? plan_.newEnd : currentEnd ?? "")} ` : ""}
                {BONZAH_START_RULE}
                {insure === "rental" && !giveDaysNow ? " Bonzah never reinstates cover that has lapsed, so a period paid late can start without cover." : ""}
              </>
            }
          >
            <span className="text-sm text-muted-foreground">the new days with</span>
            <Chip
              active={insure === "rental"}
              disabled={!hasCoverage(coverage)}
              title={!hasCoverage(coverage) ? "This rental has no Bonzah cover." : undefined}
              onClick={() => setInsure("rental")}
            >
              the rental&rsquo;s coverage{hasCoverage(coverage) ? ` · ${describeCoverage(coverage)}` : ""}
            </Chip>
            <Chip active={insure === "none"} onClick={() => setInsure("none")}>
              no insurance
            </Chip>
          </SentenceLine>
        )}

        {/* ── agreement ───────────────────────────────────────────────── */}
        <label className="flex items-start gap-3 rounded-3xl bg-muted/40 px-4 py-3 ring-1 ring-foreground/5" data-extend-agreement="">
          <Switch
            checked={willSend}
            disabled={!hasEmail}
            onCheckedChange={(v) => setSendAgreement(!!v)}
            aria-label="Send an extension agreement"
            className="mt-0.5"
          />
          <span className="min-w-0">
            <span className="block text-[13px] font-medium">Send an extension agreement</span>
            <span className="block text-xs leading-relaxed text-muted-foreground">
              {!hasEmail
                ? "This customer has no email address, so no agreement can be sent."
                : plan_.ok && plan_.periods > 1
                  ? `One for each new period (${plan_.periods}), emailed to sign, using your extension agreement template.`
                  : "Emailed to the customer to sign, using your extension agreement template."}
            </span>
          </span>
        </label>
      </div>

      <DialogFooter>
        <Button type="button" variant="outline" disabled={busy} onClick={() => onOpenChange(false)}>
          Not now
        </Button>
        <Button type="button" data-confirm="" disabled={!plan_.ok || busy || plan.status !== "active"} onClick={() => void confirm()}>
          {busy && <Loader2 className="animate-spin" />}
          {plan_.ok ? `Extend to ${formatDay(plan_.newEnd)}` : "Extend"}
        </Button>
      </DialogFooter>
    </>
  );
}

function ChoiceCard({ active, onClick, title, line, testId }: { active: boolean; onClick: () => void; title: string; line: string; testId: string }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      onClick={onClick}
      data-give-days={testId}
      className={cn(
        "flex w-full cursor-pointer flex-col items-start gap-0.5 rounded-3xl px-4 py-3 text-left ring-1 transition-colors",
        active
          ? "bg-primary/10 ring-primary/40 dark:bg-[hsl(var(--v2-hover,var(--muted)))]"
          : "bg-muted/40 ring-foreground/5 hover:bg-primary/10 dark:hover:bg-[hsl(var(--v2-hover,var(--muted)))]",
      )}
    >
      <span className={cn("text-[13px] font-medium", active && "text-primary dark:text-[hsl(var(--v2-link,var(--primary)))]")}>{title}</span>
      <span className="text-xs leading-relaxed text-muted-foreground">{line}</span>
    </button>
  );
}

/**
 * The dialog wired to the rental: its facts, the tenant's Bonzah setting and
 * the Extend action. Used by the plan card's section and by the Extensions
 * rail, so a rental on a plan has exactly one way to be extended.
 */
export function RentalExtendPlanDialog({
  open,
  onOpenChange,
  rentalId,
  plan,
  occurrences,
  currentEnd,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  rentalId: string;
  plan: Pick<PlanView, "renewal" | "status">;
  occurrences: OccurrenceView[];
  currentEnd: ISODate | null;
}) {
  const { tenant } = useTenant();
  const facts = useRentalPlanFacts(rentalId, open);
  const act = usePaymentPlanActions(rentalId);
  return (
    <ExtendPlanDialog
      open={open}
      onOpenChange={onOpenChange}
      plan={plan}
      occurrences={occurrences}
      currentEnd={facts.data?.endDate ?? currentEnd}
      facts={facts.isLoading ? undefined : facts.data ?? null}
      bonzahSellable={isBonzahSellable(tenant)}
      onExtend={(input) =>
        act.extend(input, {
          customerName: facts.data?.customerName,
          customerEmail: facts.data?.customerEmail,
          occurrences: () => occurrences,
        })
      }
    />
  );
}
