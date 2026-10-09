"use client";

import { useEffect, useMemo, useState } from "react";
import type React from "react";
import { AlertTriangle, Loader2, PauseCircle } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui-v2/dialog";
import { Button } from "@/components/ui-v2/button";
import { Calendar } from "@/components/ui-v2/calendar";
import { formatBillDate } from "@/lib/integration-billing/catalog";
import {
  addMonths,
  billsAroundPause,
  checkPause,
  localYmd,
  parseYmd,
  PAUSE_BLOCKED_LAST_DAYS,
  toYmd,
  ymdToLocal,
} from "@/lib/subscription-pause";
import {
  useSubscriptionPauseActions,
  type SubscriptionPause,
} from "@/hooks/use-subscription-pause";

/**
 * Pause, v2 — pause the subscription for 1 or 2 whole months.
 *
 * The tenant picks the first day of the pause and the day they are back on the
 * calendar ("1 month" / "2 months" fill in the end for them). The rules are
 * explained as they pick, using the same checks the `subscription-pause` edge
 * function runs again before anything happens:
 *
 *   - exactly 1 or 2 calendar months (30 Oct → 30 Nov or 30 Dec), never more;
 *     the account switches back on by itself when the pause is over
 *   - not in the last 10 days before a bill
 *   - the billing date never moves: bills that fall inside the pause are
 *     skipped, the next one is on the usual day
 *
 * With a pause already booked, the dialog shows it, with "Cancel pause" (not
 * started yet) or "Resume now" (running).
 *
 * The canary's sample account walks the screens and sends nothing.
 */

/** A calendar day ("YYYY-MM-DD", stored as UTC midnight) without a timezone shift. */
function fmtDay(date: Date | string): string {
  const d = typeof date === "string" ? parseYmd(date) ?? new Date(date) : date;
  return d.toLocaleDateString("en-US", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}

export function PauseDialogV2({
  open,
  onOpenChange,
  pause,
  nextBillAt,
  interval,
  readOnly,
  sample,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The booked pause, if any. */
  pause: SubscriptionPause | null;
  /** The next bill (current period end): every bill date is counted from it. */
  nextBillAt: string | null;
  interval: string;
  readOnly: boolean;
  /** The canary's sample account: walk the flow, send nothing. */
  sample: boolean;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[90vh] flex-col gap-0 overflow-y-auto p-0 sm:max-w-2xl">
        {pause ? (
          <BookedPause
            pause={pause}
            nextBillAt={nextBillAt}
            interval={interval}
            readOnly={readOnly}
            sample={sample}
            onClose={() => onOpenChange(false)}
          />
        ) : (
          <PickPause
            open={open}
            nextBillAt={nextBillAt}
            interval={interval}
            readOnly={readOnly}
            sample={sample}
            onClose={() => onOpenChange(false)}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

/* -------------------------------------------------------------------------- */
/* Picking the dates                                                           */
/* -------------------------------------------------------------------------- */

function PickPause({
  open,
  nextBillAt,
  interval,
  readOnly,
  sample,
  onClose,
}: {
  open: boolean;
  nextBillAt: string | null;
  interval: string;
  readOnly: boolean;
  sample: boolean;
  onClose: () => void;
}) {
  const { request } = useSubscriptionPauseActions();
  const [start, setStart] = useState<string | null>(null);
  const [end, setEnd] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setStart(null);
      setEnd(null);
    }
  }, [open]);

  const knownBill = nextBillAt ? new Date(nextBillAt) : null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const check = useMemo(() => {
    if (!start || !end || !knownBill) return null;
    return checkPause({ startDate: start, endDate: end, now: new Date(), knownBill, interval });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [start, end, nextBillAt, interval]);

  const bills = check?.ok && knownBill ? billsAroundPause(knownBill, interval, check.startsAt, check.endsAt) : null;

  const pickDay = (day: Date | undefined) => {
    if (!day) return;
    const ymd = localYmd(day);
    if (!start || end || ymd <= start) {
      setStart(ymd);
      setEnd(null);
    } else {
      setEnd(ymd);
    }
  };

  const setLength = (months: 1 | 2) => {
    if (!start) return;
    setEnd(toYmd(addMonths(parseYmd(start)!, months)));
  };

  const confirm = async () => {
    if (!check?.ok) return;
    if (sample) {
      toast.success("Sample account: nothing was paused.");
      onClose();
      return;
    }
    try {
      await request.mutateAsync({ startDate: check.startDate, endDate: check.endDate });
      toast.success(
        check.startsAt.getTime() <= Date.now()
          ? `Your account is paused until ${fmtDay(check.endDate)}.`
          : `Pause booked: ${fmtDay(check.startDate)} to ${fmtDay(check.endDate)}.`,
      );
      onClose();
    } catch (e) {
      toast.error((e as Error).message || "Could not pause the subscription");
    }
  };

  const busy = request.isPending;

  return (
    <>
      <Header
        eyebrow="Pause subscription"
        title="Take a break for 1 or 2 months"
        body="Pick the day the pause starts and the day you're back. You're not charged while paused, and everything in your account is kept."
      />

      <div className="grid gap-6 px-8 pb-6 pt-5 md:grid-cols-[auto_minmax(0,1fr)]">
        <div className="flex flex-col items-center gap-3">
          <div className="rounded-2xl border">
            <Calendar
              mode="range"
              selected={{ from: start ? ymdToLocal(start) : undefined, to: end ? ymdToLocal(end) : undefined }}
              onSelect={(_range, day) => pickDay(day)}
              disabled={{ before: today }}
              defaultMonth={today}
              numberOfMonths={1}
            />
          </div>
          <div className="flex w-full gap-2">
            {([1, 2] as const).map((m) => (
              <button
                key={m}
                type="button"
                disabled={!start}
                onClick={() => setLength(m)}
                className="h-8 flex-1 rounded-lg border text-sm transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-40"
              >
                {m} month{m === 1 ? "" : "s"}
              </button>
            ))}
          </div>
        </div>

        <div className="flex min-w-0 flex-col gap-4 text-sm">
          <dl className="grid grid-cols-2 gap-3">
            <Field label="Pause starts" value={start ? fmtDay(start) : "Pick a day"} muted={!start} />
            <Field label="Back on" value={end ? fmtDay(end) : start ? "Pick a day" : "—"} muted={!end} />
          </dl>

          {!knownBill && (
            <Notice tone="warn">Your billing date isn't known yet, so a pause can't be booked right now.</Notice>
          )}
          {check && !check.ok && <Notice tone="warn">{check.message}</Notice>}
          {check?.ok && bills && (
            <Notice tone="ok">
              Paused for {check.months} month{check.months === 1 ? "" : "s"}.{" "}
              {bills.skipped.length > 0
                ? `No charge on ${bills.skipped.map((b) => formatBillDate(b.toISOString())).join(" or ")}. `
                : ""}
              Your next bill is on {formatBillDate(bills.nextBill.toISOString())}, your usual billing day.
            </Notice>
          )}

          <ul className="space-y-1.5 rounded-2xl bg-muted/40 px-5 py-4 text-[13px] text-muted-foreground">
            <li>Minimum 1 month, maximum 2 months, in whole months.</li>
            <li>After 2 months at most, your account switches back on automatically.</li>
            <li>A pause can't start in the last {PAUSE_BLOCKED_LAST_DAYS} days before a bill.</li>
            <li>Your billing date stays the same.</li>
            <li>While paused: your booking site shows "Booking on hold", and new rentals, vehicles and customers can't be added. Nothing is deleted.</li>
          </ul>
        </div>
      </div>

      <Footer note={sample ? "Sample account: nothing is sent." : "You can cancel a booked pause any time."}>
        <Button variant="ghost" onClick={onClose} className="h-9 rounded-xl px-4">
          Not now
        </Button>
        <Button onClick={confirm} disabled={!check?.ok || busy || readOnly} className="h-9 rounded-xl px-5">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Pause subscription"}
        </Button>
      </Footer>
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* A pause already booked                                                      */
/* -------------------------------------------------------------------------- */

function BookedPause({
  pause,
  nextBillAt,
  interval,
  readOnly,
  sample,
  onClose,
}: {
  pause: SubscriptionPause;
  nextBillAt: string | null;
  interval: string;
  readOnly: boolean;
  sample: boolean;
  onClose: () => void;
}) {
  const { end } = useSubscriptionPauseActions();
  const [confirming, setConfirming] = useState(false);
  const running = new Date(pause.starts_at).getTime() <= Date.now();
  const bills = nextBillAt
    ? billsAroundPause(new Date(nextBillAt), interval, new Date(pause.starts_at), new Date(pause.ends_at))
    : null;
  const daysLeft = Math.max(1, Math.ceil((new Date(pause.ends_at).getTime() - Date.now()) / 86_400_000));

  const stop = async () => {
    if (sample) {
      toast.success("Sample account: nothing was changed.");
      onClose();
      return;
    }
    try {
      await end.mutateAsync();
      toast.success(running ? "Welcome back! Your account is active again." : "Your pause was cancelled.");
      onClose();
    } catch (e) {
      toast.error((e as Error).message || "Could not change the pause");
    }
  };

  return (
    <>
      <Header
        eyebrow="Pause subscription"
        title={running ? "Your account is paused" : "Pause booked"}
        body={
          running
            ? `You're back on ${fmtDay(pause.end_date)}: ${daysLeft} day${daysLeft === 1 ? "" : "s"} to go. Billing is off and your data is safe.`
            : `Your ${pause.months}-month pause starts on ${fmtDay(pause.start_date)}.`
        }
      />
      <div className="space-y-4 px-8 pb-6 pt-5 text-sm">
        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <Field label="Pause starts" value={fmtDay(pause.start_date)} />
          <Field label="Back on" value={fmtDay(pause.end_date)} />
          {bills && <Field label="Next bill" value={formatBillDate(bills.nextBill.toISOString()) ?? "—"} />}
        </dl>
        {bills && bills.skipped.length > 0 && (
          <Notice tone="ok">
            No charge on {bills.skipped.map((b) => formatBillDate(b.toISOString())).join(" or ")}. Your billing day
            stays the same.
          </Notice>
        )}
        <ul className="space-y-1.5 rounded-2xl bg-muted/40 px-5 py-4 text-[13px] text-muted-foreground">
          <li>Your booking site shows "Booking on hold" while paused.</li>
          <li>New rentals, vehicles and customers can't be added while paused. Everything you have is kept.</li>
          <li>Your account switches back on by itself on {fmtDay(pause.end_date)}.</li>
        </ul>
        {confirming && (
          <Notice tone="warn">
            {running
              ? "Resume now? Billing switches back on and your next bill is on your usual billing day."
              : "Cancel this pause? Nothing changes: your subscription carries on as normal."}
          </Notice>
        )}
      </div>
      <Footer>
        <Button variant="ghost" onClick={onClose} className="h-9 rounded-xl px-4">
          Close
        </Button>
        {confirming ? (
          <Button onClick={stop} disabled={end.isPending || readOnly} className="h-9 rounded-xl px-5">
            {end.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : running ? "Yes, resume now" : "Yes, cancel pause"}
          </Button>
        ) : (
          <Button variant="outline" onClick={() => setConfirming(true)} disabled={readOnly} className="h-9 rounded-xl px-5">
            {running ? "Resume now" : "Cancel pause"}
          </Button>
        )}
      </Footer>
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* Parts                                                                       */
/* -------------------------------------------------------------------------- */

function Header({ eyebrow, title, body }: { eyebrow: string; title: string; body: string }) {
  return (
    <DialogHeader className="shrink-0 px-8 pb-2 pt-8 text-left">
      <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
        <PauseCircle className="h-3.5 w-3.5" aria-hidden />
        {eyebrow}
      </p>
      <DialogTitle className="text-2xl font-semibold tracking-tight">{title}</DialogTitle>
      <DialogDescription>{body}</DialogDescription>
    </DialogHeader>
  );
}

function Footer({ children, note }: { children?: React.ReactNode; note?: string }) {
  return (
    <div className="flex shrink-0 items-center justify-between gap-4 border-t px-8 py-4">
      <span className="hidden min-w-0 truncate text-xs text-muted-foreground sm:inline">{note}</span>
      <div className="ml-auto flex shrink-0 items-center gap-2">{children}</div>
    </div>
  );
}

function Field({ label, value, muted }: { label: string; value: string; muted?: boolean }) {
  return (
    <div className="rounded-xl border px-3 py-2">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className={muted ? "text-muted-foreground" : "font-medium"}>{value}</dd>
    </div>
  );
}

function Notice({ tone, children }: { tone: "warn" | "ok"; children: React.ReactNode }) {
  return tone === "warn" ? (
    <div
      role="alert"
      className="flex gap-2 rounded-xl border border-amber-200 bg-amber-50/70 px-3.5 py-2.5 text-amber-800 dark:border-amber-400/25 dark:bg-amber-500/10 dark:text-amber-200"
    >
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
      <p>{children}</p>
    </div>
  ) : (
    <p className="rounded-xl border border-green-200 bg-green-50/70 px-3.5 py-2.5 text-green-800 dark:border-green-400/25 dark:bg-green-500/10 dark:text-green-200">
      {children}
    </p>
  );
}
