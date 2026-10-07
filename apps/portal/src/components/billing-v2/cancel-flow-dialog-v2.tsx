"use client";

import { useEffect, useState } from "react";
import type React from "react";
import { ArrowLeft, Check, Loader2 } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui-v2/dialog";
import { Button } from "@/components/ui-v2/button";
import { Textarea } from "@/components/ui-v2/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui-v2/select";
import { useCancellationRequest } from "@/hooks/use-cancellation-request";
import { SAMPLE_RETENTION_KEY } from "@/hooks/use-retention-offer";
import { useQueryClient } from "@tanstack/react-query";
import { formatBillDate, formatMoney } from "@/lib/integration-billing/catalog";
import {
  RetentionCallBookedArt,
  RetentionDiscountArt,
  RetentionHelpArt,
  RetentionLeavingArt,
  RetentionPriceArt,
} from "@/components/illustrations-v2/scenes/retention";

/**
 * Cancel, v2 — a short, honest retention flow before a cancellation request.
 *
 *   1. "Before you go"  — what's wrong? Two ways we can help, and a way out:
 *        · Something isn't working → raise a ticket (issue type + details) and
 *          book a call: the team calendar opens in a new tab to pick a slot for an
 *          online meeting.
 *        · The price is too high (green) → 10% off the next 3 bills.
 *        · "I still want to cancel" → 3.
 *   2. The offer       — accept, or "No thanks, continue to cancel" → 3.
 *   3. Cancel          — reason (dropdown) + tell us more, what they'll lose,
 *                        and when; then the request.
 *
 * Every outcome is a REQUEST in the platform queue (`useCancellationRequest`:
 * go_live_requests, shown at /admin/requests, emailed to the team), with a note
 * that leads with what they chose — so a call, a discount and a cancellation
 * all reach a person. Nothing touches Stripe from here.
 *
 * The canary's sample account sends nothing (no demo email to the team); it
 * walks the same screens and confirms.
 */

const ISSUE_TYPES = [
  "Something isn't working as expected",
  "I need a feature that's missing",
  "I need help setting things up",
  "A billing or payments question",
  "An integration (Stripe, e-signing, insurance…)",
  "Something else",
];

const CANCEL_REASONS = [
  "It's too expensive",
  "It's missing features I need",
  "I'm switching to another tool",
  "I'm not using it enough",
  "I'm closing or pausing the business",
  "Technical problems",
  "Something else",
];

/** The team's calendar — "Book a call" opens it so the tenant picks a slot then and there. */
const BOOK_A_CALL_URL = "https://api.leadconnectorhq.com/widget/booking/WhGxejLXDJt4pN10JYUg";

const RETENTION_PERCENT = 10;
const RETENTION_BILLS = 3;

type Step = "start" | "ticket" | "offer" | "cancel" | "done";
type Outcome = "call" | "discount" | "cancel";

const LINK =
  "text-sm text-primary transition-opacity duration-200 ease-out hover:opacity-70 disabled:cursor-not-allowed disabled:opacity-40 motion-reduce:transition-none";

export function CancelFlowDialogV2({
  open,
  onOpenChange,
  monthlyCents,
  currency,
  accessEnds,
  planName,
  readOnly,
  sample,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** What they pay now, per month. */
  monthlyCents: number | null;
  currency: string;
  /** The end of the period they've paid for. */
  accessEnds: string | null;
  planName: string | null;
  readOnly: boolean;
  /** The canary's sample account: walk the flow, send nothing. */
  sample: boolean;
}) {
  const { pending, hasPending, isLoading, submit } = useCancellationRequest();
  const queryClient = useQueryClient();
  const [step, setStep] = useState<Step>("start");
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [sending, setSending] = useState(false);
  useEffect(() => {
    if (open) {
      setStep("start");
      setOutcome(null);
    }
  }, [open]);

  const money = (c: number) => formatMoney(c, currency);
  const ends = formatBillDate(accessEnds);

  /** Files the request — or, on the sample account, pretends to. */
  const send = (kind: Outcome, note: string) => {
    setSending(true);
    const finish = () => {
      setSending(false);
      setOutcome(kind);
      setStep("done");
    };
    if (sample) {
      if (kind === "discount") {
        try {
          window.sessionStorage.setItem(
            SAMPLE_RETENTION_KEY,
            JSON.stringify({ percent: RETENTION_PERCENT, bills: RETENTION_BILLS, acceptedAt: new Date().toISOString() }),
          );
        } catch {
          /* the breakdown just won't show it */
        }
        void queryClient.invalidateQueries({ queryKey: ["retention-offer"] });
      }
      setTimeout(finish, 600);
      return;
    }
    submit.mutate(
      { reason: note },
      {
        onSuccess: () => {
          void queryClient.invalidateQueries({ queryKey: ["retention-offer"] });
          finish();
        },
        onError: (e: Error) => {
          setSending(false);
          toast.error("We couldn't send that", { description: `${e.message}. You can also email support@drive-247.com.` });
        },
      },
    );
  };

  const busy = sending || readOnly;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={`flex max-h-[90vh] flex-col gap-0 overflow-y-auto p-0 sm:max-w-2xl`}>
        {isLoading ? (
          <div className="flex justify-center py-16">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            <DialogTitle className="sr-only">Cancel subscription</DialogTitle>
          </div>
        ) : hasPending && pending && step !== "done" && !sample ? (
          <Done
            title="We already have your request"
            body={`You reached out on ${formatBillDate(pending.created_at)}. A member of the team will be in touch — your subscription carries on as normal until then.`}
            onClose={() => onOpenChange(false)}
          />
        ) : step === "start" ? (
          <Start
            onIssue={() => setStep("ticket")}
            onPrice={() => setStep("offer")}
            onCancel={() => setStep("cancel")}
          />
        ) : step === "ticket" ? (
          <Ticket
            busy={busy}
            onBack={() => setStep("start")}
            onSend={(type, details) => {
              // Opened inside the click itself, before any await — a window.open
              // after the request resolves is treated as a popup and blocked.
              window.open(BOOK_A_CALL_URL, "_blank", "noopener,noreferrer");
              send("call", `CALL REQUESTED — ${type}. ${details}`.trim());
            }}
          />
        ) : step === "offer" ? (
          <Offer
            monthlyCents={monthlyCents}
            money={money}
            busy={busy}
            onBack={() => setStep("start")}
            onAccept={() =>
              send(
                "discount",
                `RETENTION OFFER ACCEPTED — ${RETENTION_PERCENT}% off the next ${RETENTION_BILLS} bills${
                  monthlyCents != null ? ` (${money(monthlyCents)} → ${money(Math.round(monthlyCents * (1 - RETENTION_PERCENT / 100)))}/month)` : ""
                }. Please apply it.`,
              )
            }
            onDecline={() => setStep("cancel")}
          />
        ) : step === "cancel" ? (
          <Cancel
            planName={planName}
            ends={ends}
            busy={busy}
            onBack={() => setStep("start")}
            onSend={(reason, details) => send("cancel", `CANCELLATION — ${reason}.${details ? ` ${details}` : ""}`)}
          />
        ) : outcome === "call" ? (
          <Done
            Art={RetentionCallBookedArt}
            eyebrow="Call requested"
            title="Your request is in"
            body="A dedicated specialist will work through it with you. Your subscription carries on as normal in the meantime."
            steps={[
              "We read what you sent and match you with the right specialist.",
              "Pick a time in the calendar that opened in a new tab.",
              "You meet online, and they resolve it with you there.",
            ]}
            extra={
              <a href={BOOK_A_CALL_URL} target="_blank" rel="noopener noreferrer" className={LINK}>
                Calendar didn&apos;t open? Book your call here
              </a>
            }
            onClose={() => onOpenChange(false)}
          />
        ) : outcome === "discount" ? (
          <Done
            Art={RetentionDiscountArt}
            eyebrow="Offer accepted"
            title={`${RETENTION_PERCENT}% off, on its way`}
            body={`Thanks for staying. Your next ${RETENTION_BILLS} bills will be ${RETENTION_PERCENT}% lower${
              monthlyCents != null ? ` — ${money(Math.round(monthlyCents * (1 - RETENTION_PERCENT / 100)))}/month instead of ${money(monthlyCents)}` : ""
            }. You'll see it on your next invoice.`}
            onClose={() => onOpenChange(false)}
          />
        ) : (
          <Done
            // A little sad, a little funny: the car under its own rain cloud.
            Art={RetentionLeavingArt}
            title="Your subscription is cancelled"
            body="We're sorry to see you go — thank you for running your business with Drive247."
            closeLabel="Goodbye"
            extra={
              <div className="w-full rounded-2xl bg-muted/40 px-5 py-4 text-left text-sm">
                <p className="font-medium">When it&apos;s cancelled</p>
                <ul className="mt-2 space-y-1.5 text-muted-foreground">
                  <li>Your booking website goes offline</li>
                  <li>New bookings and online payments stop</li>
                  <li>You lose access to your records and agreements</li>
                </ul>
                <p className="mt-3 border-t pt-3 text-xs text-muted-foreground">
                  You keep {planName ? planName.replace(/\s*\(.*\)$/, "") : "full access"} until{" "}
                  <span className="font-medium text-foreground">{ends ?? "the end of your paid period"}</span>.
                </p>
              </div>
            }
            onClose={() => onOpenChange(false)}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function Header({ eyebrow, title, body }: { eyebrow?: string; title: string; body: string }) {
  return (
    <DialogHeader className="shrink-0 px-8 pb-2 pt-8 text-left">
      {eyebrow && <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">{eyebrow}</p>}
      <DialogTitle className="text-2xl font-semibold tracking-tight">{title}</DialogTitle>
      <DialogDescription>{body}</DialogDescription>
    </DialogHeader>
  );
}

function Footer({ onBack, children, note }: { onBack?: () => void; children?: React.ReactNode; note?: string }) {
  return (
    <div className="flex shrink-0 items-center justify-between gap-4 border-t px-8 py-4">
      <div className="flex min-w-0 items-center gap-4">
        {onBack && (
          <button type="button" onClick={onBack} className={`inline-flex items-center gap-1 ${LINK}`}>
            <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
            Back
          </button>
        )}
        {note && <span className="hidden truncate text-xs text-muted-foreground sm:inline">{note}</span>}
      </div>
      <div className="flex shrink-0 items-center gap-2">{children}</div>
    </div>
  );
}

function Choice({
  title,
  body,
  onClick,
  tone,
  Art,
}: {
  title: string;
  body: string;
  onClick: () => void;
  tone: "indigo" | "green";
  Art: React.ComponentType<{ className?: string }>;
}) {
  const t =
    tone === "green"
      ? "border-green-200 bg-green-50/60 hover:border-green-300 dark:border-green-400/25 dark:bg-green-500/10 dark:hover:border-green-400/40"
      : "border-border bg-card hover:border-indigo-200 dark:hover:border-indigo-400/30";
  return (
    <button
      type="button"
      onClick={onClick}
      className={`group flex aspect-square w-full flex-col rounded-2xl border p-5 text-left transition-colors duration-200 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 motion-reduce:transition-none ${t}`}
    >
      <span className="flex min-h-0 flex-1 items-center justify-center">
        <Art className="max-w-[210px]" />
      </span>
      <span className="mt-3 block min-w-0">
        <span className="block text-base font-semibold tracking-tight">{title}</span>
        <span className="mt-1 block truncate text-sm text-muted-foreground">{body}</span>
      </span>
    </button>
  );
}

function Start({ onIssue, onPrice, onCancel }: { onIssue: () => void; onPrice: () => void; onCancel: () => void }) {
  return (
    <>
      <Header
        eyebrow="Cancel subscription"
        title="Before you go — can we help?"
        body="Most problems can be fixed. Tell us what's getting in the way and we'll sort it out with you."
      />
      {/* Two square choices, side by side, each with its picture. */}
      <div className="grid gap-4 px-8 pb-6 pt-5 sm:grid-cols-2">
        <Choice
          tone="indigo"
          Art={RetentionHelpArt}
          title="Something isn't working for us"
          body="Book a call with a specialist."
          onClick={onIssue}
        />
        <Choice
          tone="indigo"
          Art={RetentionPriceArt}
          title="The price is too high for us"
          body="We'll see what we can do."
          onClick={onPrice}
        />
      </div>
      <Footer>
        <button type="button" onClick={onCancel} className="text-sm text-muted-foreground underline-offset-4 transition-colors duration-200 ease-out hover:text-foreground hover:underline motion-reduce:transition-none">
          I still want to cancel
        </button>
      </Footer>
    </>
  );
}

function Ticket({ busy, onBack, onSend }: { busy: boolean; onBack: () => void; onSend: (type: string, details: string) => void }) {
  const [type, setType] = useState("");
  const [details, setDetails] = useState("");
  const ok = !!type && details.trim().length >= 10;
  return (
    <>
      <Header
        eyebrow="Raise an issue"
        title="Tell us what's going on"
        body="Tell us what it is, then pick a time that suits you. A dedicated specialist will meet you online and resolve it with you."
      />
      <div className="space-y-4 px-8 pb-6 pt-5">
        <div className="space-y-1.5">
          <label className="text-xs text-muted-foreground">What's it about?</label>
          <Select value={type} onValueChange={setType}>
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Choose an issue type" />
            </SelectTrigger>
            <SelectContent tone="surface">
              {ISSUE_TYPES.map((t) => (
                <SelectItem key={t} value={t}>
                  {t}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <label htmlFor="ticket-details" className="text-xs text-muted-foreground">
            Describe the problem
          </label>
          <Textarea
            id="ticket-details"
            rows={5}
            value={details}
            onChange={(e) => setDetails(e.target.value)}
            placeholder="What happened, where, and what you expected instead. Screens, booking numbers or customers involved all help."
            className="resize-none rounded-xl"
            maxLength={2000}
          />
        </div>
      </div>
      <Footer onBack={onBack} note="Your subscription carries on as normal.">
        <Button onClick={() => onSend(type, details.trim())} disabled={!ok || busy} className="h-9 rounded-xl px-5">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Book a call"}
        </Button>
      </Footer>
    </>
  );
}

function Offer({
  monthlyCents,
  money,
  busy,
  onBack,
  onAccept,
  onDecline,
}: {
  monthlyCents: number | null;
  money: (c: number) => string;
  busy: boolean;
  onBack: () => void;
  onAccept: () => void;
  onDecline: () => void;
}) {
  const after = monthlyCents != null ? Math.round(monthlyCents * (1 - RETENTION_PERCENT / 100)) : null;
  return (
    <>
      <Header eyebrow="An offer for you" title={`Stay, and save ${RETENTION_PERCENT}%`} body="We'd rather keep you. Here's what that looks like on your bill." />
      <div className="px-8 pb-6 pt-5">
        <div className="rounded-2xl border border-green-200 bg-green-50/70 p-6 dark:border-green-400/25 dark:bg-green-500/10">
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-green-700 dark:text-green-300">
            {RETENTION_PERCENT}% off your next {RETENTION_BILLS} bills
          </p>
          {after != null && monthlyCents != null ? (
            <div className="mt-2 flex items-baseline gap-3">
              <span className="text-4xl font-bold tracking-tighter">{money(after)}</span>
              <span className="text-sm text-muted-foreground">/month</span>
              <span className="text-base text-muted-foreground line-through">{money(monthlyCents)}</span>
            </div>
          ) : (
            <p className="mt-2 text-2xl font-bold tracking-tight">{RETENTION_PERCENT}% off</p>
          )}
          <p className="mt-2 text-sm text-muted-foreground">
            {after != null && monthlyCents != null
              ? `You save ${money((monthlyCents - after) * RETENTION_BILLS)} over ${RETENTION_BILLS} months. Then back to your regular price — nothing else changes.`
              : "Then back to your regular price — nothing else changes."}
          </p>
        </div>
      </div>
      <Footer onBack={onBack}>
        <button type="button" onClick={onDecline} disabled={busy} className="mr-2 text-sm text-muted-foreground underline-offset-4 transition-colors duration-200 ease-out hover:text-foreground hover:underline disabled:opacity-40 motion-reduce:transition-none">
          No thanks, continue to cancel
        </button>
        <Button onClick={onAccept} disabled={busy} className="h-9 rounded-xl bg-green-600 px-5 text-white hover:bg-green-700">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : `Accept ${RETENTION_PERCENT}% off`}
        </Button>
      </Footer>
    </>
  );
}

function Cancel({
  planName,
  ends,
  busy,
  onBack,
  onSend,
}: {
  planName: string | null;
  ends: string | null;
  busy: boolean;
  onBack: () => void;
  onSend: (reason: string, details: string) => void;
}) {
  const [reason, setReason] = useState("");
  const [details, setDetails] = useState("");
  const needsDetails = reason === "Something else";
  const ok = !!reason && (!needsDetails || details.trim().length >= 3);
  return (
    <>
      <Header
        eyebrow="Cancel subscription"
        title="We're sorry to see you go"
        body="Tell us why, so we can do better. Our team will confirm the cancellation with you — nothing ends straight away."
      />
      <div className="px-8 pb-6 pt-5">
        <div className="space-y-4">
          <div className="space-y-1.5">
            <label className="text-xs text-muted-foreground">Main reason</label>
            <Select value={reason} onValueChange={setReason}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Choose a reason" />
              </SelectTrigger>
              <SelectContent tone="surface">
                {CANCEL_REASONS.map((r) => (
                  <SelectItem key={r} value={r}>
                    {r}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <label htmlFor="cancel-details" className="text-xs text-muted-foreground">
              Tell us more {needsDetails ? "" : "(optional)"}
            </label>
            <Textarea
              id="cancel-details"
              rows={4}
              value={details}
              onChange={(e) => setDetails(e.target.value)}
              placeholder="Anything that would help us understand."
              className="resize-none rounded-xl"
              maxLength={2000}
            />
          </div>
        </div>
      </div>
      <Footer onBack={onBack} note="A person confirms it with you first.">
        <Button
          onClick={() => onSend(reason, details.trim())}
          disabled={!ok || busy}
          className="h-9 rounded-xl border border-red-200 bg-red-50 px-5 text-red-700 hover:bg-red-100 dark:border-red-400/30 dark:bg-red-500/10 dark:text-red-300 dark:hover:bg-red-500/20"
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Request cancellation"}
        </Button>
      </Footer>
    </>
  );
}

function Done({
  eyebrow,
  title,
  body,
  steps,
  Art,
  extra,
  wide,
  closeLabel = "Done",
  onClose,
}: {
  eyebrow?: string;
  title: string;
  body: string;
  /** "What happens next", in order. */
  steps?: string[];
  Art?: React.ComponentType<{ className?: string }>;
  /** Anything else under the steps, e.g. what changes once it's cancelled. */
  extra?: React.ReactNode;
  /** Two columns: the picture and message left, the details right. */
  wide?: boolean;
  /** The button's word. "Done" unless the moment wants another. */
  closeLabel?: string;
  onClose: () => void;
}) {
  if (wide) {
    return (
      <div className="grid gap-8 px-8 pb-8 pt-10 md:grid-cols-2 md:gap-10">
        <div className="flex flex-col items-center text-center">
          {Art && <Art className="max-w-[300px] animate-in fade-in slide-in-from-bottom-3 duration-200 ease-out motion-reduce:animate-none" />}
          {eyebrow && <p className="mt-5 text-[11px] font-semibold uppercase tracking-[0.18em] text-indigo-600 dark:text-indigo-400">{eyebrow}</p>}
          <DialogTitle className="mt-2 text-2xl font-semibold tracking-tight">{title}</DialogTitle>
          <DialogDescription className="mt-2 max-w-sm">{body}</DialogDescription>
        </div>
        <div className="flex flex-col justify-center gap-3">
          {steps && steps.length > 0 && (
            <ol className="rounded-2xl bg-muted/40 px-5 py-4">
              {steps.map((st, i) => (
                <li key={st} className="relative flex gap-3 pb-3 last:pb-0">
                  {i < steps.length - 1 && <span aria-hidden className="absolute left-[11px] top-6 h-[calc(100%-1.25rem)] w-px bg-border" />}
                  <span className="relative z-10 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-card text-xs font-semibold text-indigo-700 ring-1 ring-indigo-200 dark:text-indigo-200 dark:ring-indigo-400/30">
                    {i + 1}
                  </span>
                  <span className="pt-0.5 text-sm">{st}</span>
                </li>
              ))}
            </ol>
          )}
          {extra}
          <Button onClick={onClose} className="mt-2 h-10 w-full rounded-xl">
            {closeLabel}
          </Button>
        </div>
      </div>
    );
  }
  return (
    <div className="flex flex-col items-center px-8 pb-8 pt-10 text-center">
      {Art ? (
        <Art className="max-w-[220px] animate-in fade-in slide-in-from-bottom-3 duration-200 ease-out motion-reduce:animate-none" />
      ) : (
        <span className="flex h-14 w-14 items-center justify-center rounded-full bg-indigo-50 text-indigo-600 dark:bg-indigo-500/15 dark:text-indigo-300">
          <Check className="h-7 w-7" strokeWidth={2.5} />
        </span>
      )}
      {eyebrow && (
        <p className="mt-6 text-[11px] font-semibold uppercase tracking-[0.18em] text-indigo-600 dark:text-indigo-400">{eyebrow}</p>
      )}
      <DialogTitle className={`${eyebrow ? "mt-2" : "mt-6"} text-2xl font-semibold tracking-tight`}>{title}</DialogTitle>
      <DialogDescription className="mt-2 max-w-md">{body}</DialogDescription>

      {steps && steps.length > 0 && (
        <ol className="mt-6 w-full max-w-md space-y-0 rounded-2xl bg-muted/40 px-5 py-4 text-left">
          {steps.map((s, i) => (
            <li key={s} className="relative flex gap-3 pb-3 last:pb-0">
              {i < steps.length - 1 && <span aria-hidden className="absolute left-[11px] top-6 h-[calc(100%-1.25rem)] w-px bg-border" />}
              <span className="relative z-10 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-card text-xs font-semibold text-indigo-700 ring-1 ring-indigo-200 dark:text-indigo-200 dark:ring-indigo-400/30">
                {i + 1}
              </span>
              <span className="pt-0.5 text-sm">{s}</span>
            </li>
          ))}
        </ol>
      )}

      {extra && <div className="mt-6 w-full max-w-md">{extra}</div>}

      <Button onClick={onClose} className="mt-7 h-10 rounded-xl px-10">
        {closeLabel}
      </Button>
    </div>
  );
}
