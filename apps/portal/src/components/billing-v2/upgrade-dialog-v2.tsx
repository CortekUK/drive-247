"use client";

import { useEffect, useMemo, useState } from "react";
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
import { Input } from "@/components/ui-v2/input";
import { supabase } from "@/integrations/supabase/client";
import { useSubscriptionPlans } from "@/hooks/use-subscription-plans";
import { useTenant } from "@/contexts/TenantContext";
import { formatBillDate, formatMoney } from "@/lib/integration-billing/catalog";
import { PLATFORM_INCLUDED, PLATFORM_PLANS, prorate, type PlatformPlan } from "@/lib/platform-plans";
import { ConfettiV2 } from "@/components/billing-v2/confetti-v2";

/**
 * Upgrade — the plans, laid out the way drive-247.com sells them, with the
 * operator's current plan marked. Picking another plan opens a review with
 * the whole calculation in plain view:
 *
 *   - the plan's real monthly price, always;
 *   - for a move UP: what the rest of this billing period costs on the new
 *     plan, less what's unused on the current one, = due today; then the new
 *     price from the next bill;
 *   - for a move DOWN: nothing today, the new price from the next bill;
 *   - a promo code, checked against Drive247's codes (`promo-code-lookup`),
 *     and shown in the figures before anything is agreed.
 *
 * Plans come from the tenant's own plans when there are several set up, and
 * otherwise from the site's three (lib/platform-plans).
 *
 * "Continue to payment" opens Stripe's hosted "confirm your plan change" page
 * (change-subscription-plan-v2): Stripe shows the same prorated figures,
 * charges them, switches the plan, and returns to Billing with
 * ?status=plan-updated, where the page records the new plan. The canary's
 * sample account has no Stripe subscription, so there it only confirms.
 */

interface Offer {
  displayCode: string;
  discountText: string;
  durationText: string;
  discountType: "percent" | "fixed";
  /** Percent, or whole currency units for a fixed discount. */
  discountValue: number;
}

const REJECTED: Record<string, string> = {
  not_found: "We don't recognise that code.",
  expired: "That code has expired.",
  maxed_out: "That code has been used as many times as it allows.",
  inactive: "That code is no longer active.",
  plan_not_eligible: "That code can't be used with this plan.",
  programme_disabled: "Referral codes aren't available right now.",
  owner_disabled: "That referral code isn't active right now.",
  self_referral: "You can't use your own referral code.",
  rate_limited: "Too many tries. Please wait a few minutes.",
};

function offCents(cents: number, offer: Offer | null): number {
  if (!offer) return 0;
  const off = offer.discountType === "percent" ? Math.round((cents * offer.discountValue) / 100) : Math.round(offer.discountValue * 100);
  return Math.min(cents, off);
}

const LINK =
  "text-sm text-primary transition-opacity duration-200 ease-out hover:opacity-70 disabled:cursor-not-allowed disabled:opacity-40 motion-reduce:transition-none";

export function UpgradeDialogV2({
  open,
  onOpenChange,
  currentPlanName,
  currentAmountCents,
  currency,
  periodStart,
  periodEnd,
  readOnly,
  sample,
  cardOnFile,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currentPlanName: string | null;
  currentAmountCents: number | null;
  currency: string;
  periodStart: string | null;
  periodEnd: string | null;
  readOnly: boolean;
  /** The canary's sample account: a request is acknowledged here, not sent. */
  sample: boolean;
  /** The primary card, shown on the demo checkout. */
  cardOnFile?: { brand: string | null; last4: string } | null;
}) {
  const { data: tenantPlans } = useSubscriptionPlans();
  const plans: PlatformPlan[] = useMemo(() => {
    const own = (tenantPlans ?? []).filter((p) => p.is_active);
    if (own.length >= 2) {
      return own.map((p) => ({
        id: p.id,
        name: p.name,
        amountCents: p.amount,
        currency: p.currency,
        interval: p.interval === "year" ? "year" : "month",
        fleetBand: "",
        tagline: p.description ?? "",
        bullets: p.features ?? [],
        highlighted: false,
      }));
    }
    return PLATFORM_PLANS;
  }, [tenantPlans]);

  // The plan they're on: by name ("Growth (Sample)" is Growth), else by price.
  const current = useMemo(() => {
    const n = (currentPlanName ?? "").toLowerCase();
    return (
      plans.find((p) => n && n.includes(p.name.toLowerCase())) ??
      plans.find((p) => currentAmountCents != null && p.amountCents === currentAmountCents) ??
      null
    );
  }, [plans, currentPlanName, currentAmountCents]);

  const [picked, setPicked] = useState<PlatformPlan | null>(null);
  useEffect(() => {
    if (open) setPicked(null);
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[90vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-5xl">
        {picked && current ? (
          <Review
            from={current}
            to={picked}
            currency={currency}
            periodStart={periodStart}
            periodEnd={periodEnd}
            readOnly={readOnly}
            sample={sample}
            cardOnFile={cardOnFile ?? null}
            onBack={() => setPicked(null)}
            onDone={() => onOpenChange(false)}
          />
        ) : (
          <>
            <DialogHeader className="shrink-0 px-8 pb-1 pt-8 text-center sm:text-center">
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-indigo-600 dark:text-indigo-400">Plans</p>
              <DialogTitle className="text-3xl font-semibold tracking-tight">Choose your plan</DialogTitle>
              <DialogDescription>
                {current
                  ? `You're on ${current.name} at ${formatMoney(current.amountCents, current.currency).replace(/\.00$/, "")}/month. Every plan is the full platform — they differ by fleet size.`
                  : "Every plan is the full platform — they differ by the size of fleet they're built for."}
              </DialogDescription>
            </DialogHeader>

            <div className="overflow-y-auto px-8 pb-6 pt-6">
              <div className="grid gap-4 md:grid-cols-3">
                {plans.map((p) => (
                  <PlanCard
                    key={p.id}
                    plan={p}
                    current={current}
                    disabled={readOnly}
                    onPick={() => setPicked(p)}
                  />
                ))}
              </div>

              {/* What every plan has, once — not three identical bullet lists. */}
              {plans === PLATFORM_PLANS && (
                <div className="mt-6 rounded-2xl bg-muted/40 px-6 py-5">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Every plan includes</p>
                  <ul className="mt-3 grid gap-x-6 gap-y-2 sm:grid-cols-2 lg:grid-cols-3">
                    {PLATFORM_INCLUDED.map((f) => (
                      <li key={f} className="flex items-start gap-2 text-sm text-muted-foreground">
                        <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-indigo-600 dark:text-indigo-400" aria-hidden />
                        {f}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>

            <p className="shrink-0 border-t px-8 py-3.5 text-center text-xs text-muted-foreground">
              Prices in USD, billed monthly. Moving up is charged only for the days left in this billing period.
            </p>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function PlanCard({
  plan,
  current,
  disabled,
  onPick,
}: {
  plan: PlatformPlan;
  current: PlatformPlan | null;
  disabled: boolean;
  onPick: () => void;
}) {
  const isCurrent = current?.id === plan.id;
  const diff = current ? plan.amountCents - current.amountCents : 0;
  const up = diff > 0;
  const price = formatMoney(plan.amountCents, plan.currency).replace(/\.00$/, "");
  const delta = formatMoney(Math.abs(diff), plan.currency).replace(/\.00$/, "");
  // Only the lines that differ between plans; what they share is listed once, below.
  const own = plan.fleetBand ? plan.bullets.filter((b) => !PLATFORM_INCLUDED.includes(b) && !b.startsWith("The full platform") && !b.startsWith("Sized for fleets")) : plan.bullets;

  return (
    <div
      className={`group relative flex flex-col rounded-2xl border p-6 transition-colors duration-200 ease-out motion-reduce:transition-none ${
        isCurrent
          ? "border-indigo-200 bg-gradient-to-b from-indigo-50 to-indigo-50/30 dark:border-indigo-400/30 dark:from-indigo-500/15 dark:to-indigo-500/5"
          : "border-border bg-card hover:border-indigo-200 dark:hover:border-indigo-400/30"
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-base font-semibold tracking-tight">{plan.name}</p>
          {plan.fleetBand && (
            <p className="mt-0.5 text-[11px] font-medium uppercase tracking-[0.14em] text-indigo-600 dark:text-indigo-400">{plan.fleetBand}</p>
          )}
        </div>
        {isCurrent ? (
          <span className="shrink-0 rounded-full bg-indigo-600 px-2.5 py-1 text-[11px] font-semibold leading-none text-white dark:bg-indigo-500">
            Your plan
          </span>
        ) : plan.highlighted ? (
          <span className="shrink-0 rounded-full border border-indigo-200 px-2.5 py-1 text-[11px] font-semibold leading-none text-indigo-700 dark:border-indigo-400/30 dark:text-indigo-200">
            Most popular
          </span>
        ) : null}
      </div>

      <div className="mt-6 flex items-baseline gap-1">
        <span className="text-[44px] font-bold leading-none tracking-tighter">{price}</span>
        <span className="text-sm text-muted-foreground">/{plan.interval}</span>
      </div>
      {/* How it compares with the plan they're on. */}
      <p className="mt-2 h-5 text-sm font-medium">
        {isCurrent ? (
          <span className="text-indigo-700 dark:text-indigo-300">What you pay today</span>
        ) : current && diff !== 0 ? (
          <span className={up ? "text-foreground" : "text-green-600 dark:text-green-400"}>
            {up ? `+${delta}/month` : `Save ${delta}/month`}
          </span>
        ) : null}
      </p>

      {plan.tagline && <p className="mt-3 min-h-[2.75rem] text-sm leading-relaxed text-muted-foreground">{plan.tagline}</p>}
      {own.length > 0 && (
        <ul className="mt-3 space-y-1.5">
          {own.map((b) => (
            <li key={b} className="flex items-start gap-2 text-sm text-muted-foreground">
              <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-indigo-600 dark:text-indigo-400" aria-hidden />
              {b}
            </li>
          ))}
        </ul>
      )}

      <div className="mt-auto pt-6">
        {isCurrent ? (
          <div className="flex h-10 items-center justify-center rounded-xl border border-indigo-200 text-sm font-medium text-indigo-700 dark:border-indigo-400/30 dark:text-indigo-200">
            Current plan
          </div>
        ) : (
          <Button
            onClick={onPick}
            disabled={disabled}
            variant={up || !current ? "default" : "outline"}
            className="h-10 w-full rounded-xl"
          >
            {!current ? `Choose ${plan.name}` : up ? `Upgrade to ${plan.name}` : `Switch to ${plan.name}`}
          </Button>
        )}
      </div>
    </div>
  );
}

function Row({ label, sub, value, strong, tone }: { label: string; sub?: string; value: string; strong?: boolean; tone?: "credit" }) {
  return (
    <div className={`flex items-baseline justify-between gap-6 py-2.5 ${strong ? "border-t pt-3" : ""}`}>
      <div className="min-w-0">
        <p className={`text-sm ${strong ? "font-semibold" : ""}`}>{label}</p>
        {sub && <p className="text-xs text-muted-foreground">{sub}</p>}
      </div>
      <p
        className={`shrink-0 tabular-nums ${strong ? "text-base font-bold" : "text-sm"} ${
          tone === "credit" ? "text-green-600 dark:text-green-400" : ""
        }`}
      >
        {value}
      </p>
    </div>
  );
}

function Review({
  from,
  to,
  currency,
  periodStart,
  periodEnd,
  readOnly,
  sample,
  cardOnFile,
  onBack,
  onDone,
}: {
  from: PlatformPlan;
  to: PlatformPlan;
  currency: string;
  periodStart: string | null;
  periodEnd: string | null;
  readOnly: boolean;
  sample: boolean;
  cardOnFile: { brand: string | null; last4: string } | null;
  onBack: () => void;
  onDone: () => void;
}) {
  const [checkout, setCheckout] = useState(false);
  const money = (c: number) => formatMoney(c, to.currency || currency);
  const p = prorate(from.amountCents, to.amountCents, periodStart, periodEnd);
  const nextBill = formatBillDate(periodEnd);

  // ── promo code ─────────────────────────────────────────────────────────
  const [code, setCode] = useState("");
  const [offer, setOffer] = useState<Offer | null>(null);
  const [checking, setChecking] = useState(false);
  const [codeError, setCodeError] = useState<string | null>(null);
  const apply = async () => {
    const c = code.trim();
    if (!c) return;
    setChecking(true);
    setCodeError(null);
    try {
      const { data, error } = await supabase.functions.invoke("promo-code-lookup", { body: { code: c, planKey: to.id } });
      if (error || !data) throw error ?? new Error("unavailable");
      if (!data.valid) {
        setOffer(null);
        setCodeError(REJECTED[data.reason] ?? "That code can't be used.");
        return;
      }
      setOffer({
        displayCode: data.displayCode,
        discountText: data.discountText,
        durationText: data.durationText,
        discountType: data.discountType,
        discountValue: Number(data.discountValue),
      });
    } catch {
      setOffer(null);
      setCodeError("We couldn't check that code right now. Try again in a moment.");
    } finally {
      setChecking(false);
    }
  };

  const promoToday = offer && !p.downgrade ? offCents(p.dueNowCents, offer.discountType === "percent" ? offer : null) : 0;
  const dueToday = Math.max(0, p.dueNowCents - promoToday);
  const monthlyOff = offCents(to.amountCents, offer);
  const monthly = to.amountCents - monthlyOff;

  // ── request ────────────────────────────────────────────────────────────
  const [sending, setSending] = useState(false);
  const { tenant } = useTenant();
  const request = async () => {
    if (sample) {
      // The canary's sample account has no Stripe subscription to change: show
      // the checkout here, as a demo, and charge nothing.
      setCheckout(true);
      return;
    }
    // Stripe's hosted confirm page: it shows the prorated amount, charges it,
    // switches the plan, and sends them back to Billing, which records it.
    setSending(true);
    try {
      const isSitePlan = PLATFORM_PLANS.some((x) => x.id === to.id);
      const planParam = isSitePlan ? `key:${to.id}` : `id:${to.id}`;
      const { data, error } = await supabase.functions.invoke("change-subscription-plan-v2", {
        body: {
          tenantId: tenant?.id,
          action: "session",
          ...(isSitePlan ? { planKey: to.id } : { planId: to.id }),
          promoCode: offer?.displayCode ?? undefined,
          returnUrl: `${window.location.origin}/subscription?status=plan-updated&plan=${encodeURIComponent(planParam)}`,
        },
      });
      if (error) throw error;
      if (!data?.url) throw new Error("Stripe didn't return a page to continue on.");
      window.location.href = data.url;
    } catch (e) {
      setSending(false);
      let message = (e as Error).message;
      try {
        const ctx = (e as { context?: Response }).context;
        if (ctx && typeof ctx.json === "function") message = (await ctx.json())?.error ?? message;
      } catch {
        /* keep the first message */
      }
      toast.error("Couldn't open the payment page", { description: message || "Please try again in a moment." });
    }
  };

  if (checkout) {
    return (
      <DemoCheckout
        from={from}
        to={to}
        proration={p}
        offer={offer}
        promoToday={promoToday}
        dueToday={dueToday}
        monthly={monthly}
        nextBill={nextBill}
        money={money}
        cardOnFile={cardOnFile}
        onBack={() => setCheckout(false)}
        onDone={onDone}
      />
    );
  }

  return (
    <>
      <DialogHeader className="shrink-0 px-8 pb-2 pt-8 text-left">
        <DialogTitle className="text-2xl">
          {p.downgrade ? "Switch" : "Upgrade"} to {to.name}
        </DialogTitle>
        <DialogDescription>
          From {from.name} ({money(from.amountCents)}/month) to {to.name} ({money(to.amountCents)}/month). Here&apos;s exactly what you&apos;ll pay.
        </DialogDescription>
      </DialogHeader>

      <div className="grid gap-8 overflow-y-auto px-8 pb-6 pt-5 md:grid-cols-2">
        {/* ── today ──────────────────────────────────────────────────── */}
        <section>
          <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Today</p>
          <p className="mt-1 text-4xl font-bold tracking-tighter">{money(dueToday)}</p>
          {p.downgrade ? (
            <p className="mt-1 text-sm text-muted-foreground">
              Nothing to pay now. You keep {from.name} until {nextBill}, and move to {to.name} on that bill.
            </p>
          ) : (
            <>
              <p className="mt-1 text-sm text-muted-foreground">
                For the {p.daysLeft} day{p.daysLeft === 1 ? "" : "s"} left in this billing period (of {p.periodDays}).
              </p>
              <div className="mt-4 rounded-xl bg-muted/40 px-4 py-1">
                <Row
                  label={`${to.name} for ${p.daysLeft} days`}
                  sub={`${money(to.amountCents)} × ${p.daysLeft}/${p.periodDays}`}
                  value={money(p.chargeCents)}
                />
                <Row
                  label={`Unused ${from.name} for ${p.daysLeft} days`}
                  sub={`${money(from.amountCents)} × ${p.daysLeft}/${p.periodDays}`}
                  value={`−${money(p.creditCents)}`}
                  tone="credit"
                />
                {promoToday > 0 && offer && (
                  <Row label={`Code ${offer.displayCode}`} sub={offer.discountText} value={`−${money(promoToday)}`} tone="credit" />
                )}
                <Row label="Due today" value={money(dueToday)} strong />
              </div>
            </>
          )}
        </section>

        {/* ── from the next bill ─────────────────────────────────────── */}
        <section>
          <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">From your next bill{nextBill ? `, ${nextBill}` : ""}</p>
          <div className="mt-1 flex items-baseline gap-2">
            <p className="text-4xl font-bold tracking-tighter">{money(monthly)}</p>
            <span className="text-sm text-muted-foreground">/month</span>
            {monthlyOff > 0 && <span className="text-sm text-muted-foreground line-through">{money(to.amountCents)}</span>}
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            {offer && monthlyOff > 0
              ? `${offer.discountText} ${offer.durationText}, then ${money(to.amountCents)}/month.`
              : `${to.name} at its regular price, every month.`}
          </p>

          {/* Promo code */}
          <div className="mt-6">
            <label htmlFor="upgrade-promo" className="text-xs text-muted-foreground">
              Promo code
            </label>
            {offer ? (
              <div className="mt-1.5 flex items-center justify-between gap-3 rounded-xl bg-green-50 px-4 py-2.5 text-sm dark:bg-green-500/10">
                <span>
                  <span className="font-mono font-semibold">{offer.displayCode}</span>
                  <span className="text-muted-foreground"> · {offer.discountText} {offer.durationText}</span>
                </span>
                <button
                  type="button"
                  className={LINK}
                  onClick={() => {
                    setOffer(null);
                    setCode("");
                  }}
                >
                  Remove
                </button>
              </div>
            ) : (
              <div className="mt-1.5 flex gap-2">
                <Input
                  id="upgrade-promo"
                  value={code}
                  onChange={(e) => {
                    setCode(e.target.value.toUpperCase());
                    setCodeError(null);
                  }}
                  onKeyDown={(e) => e.key === "Enter" && apply()}
                  placeholder="e.g. LAUNCH50"
                  className="font-mono uppercase"
                />
                <Button variant="secondary" onClick={apply} disabled={!code.trim() || checking} className="shrink-0 rounded-xl">
                  {checking ? <Loader2 className="h-4 w-4 animate-spin" /> : "Apply"}
                </Button>
              </div>
            )}
            {codeError && <p className="mt-1.5 text-xs text-red-600">{codeError}</p>}
          </div>
        </section>
      </div>

      <div className="flex shrink-0 items-center justify-between gap-4 border-t px-8 py-4">
        <div className="flex min-w-0 items-center gap-4">
          <button type="button" onClick={onBack} className={`inline-flex items-center gap-1 ${LINK}`}>
            <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
            All plans
          </button>
          <span className="hidden truncate text-xs text-muted-foreground sm:inline">
            {sample
              ? "Sample account: nothing is charged."
              : p.downgrade
                ? "You'll confirm the switch on Stripe's secure page."
                : "You'll confirm and pay on Stripe's secure page."}
          </span>
        </div>
        <Button onClick={request} disabled={readOnly || sending} className="h-9 shrink-0 rounded-xl px-5">
          {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : p.downgrade ? "Continue to switch" : "Continue to payment"}
        </Button>
      </div>
    </>
  );
}

/**
 * A Stripe-Checkout-style payment step, for the canary's SAMPLE account only:
 * northwind has no Stripe subscription to change, so the real hosted page
 * can't open. It looks and behaves like the real thing — order summary on the
 * left, the card on the right, Pay, then a confirmation — and charges nothing.
 * It says "Test mode" at the top, as Stripe's own test pages do.
 */
function DemoCheckout({
  from,
  to,
  proration,
  offer,
  promoToday,
  dueToday,
  monthly,
  nextBill,
  money,
  cardOnFile,
  onBack,
  onDone,
}: {
  from: PlatformPlan;
  to: PlatformPlan;
  proration: ReturnType<typeof prorate>;
  offer: Offer | null;
  promoToday: number;
  dueToday: number;
  monthly: number;
  nextBill: string | null;
  money: (c: number) => string;
  cardOnFile: { brand: string | null; last4: string } | null;
  onBack: () => void;
  onDone: () => void;
}) {
  const [useNew, setUseNew] = useState(!cardOnFile);
  const [state, setState] = useState<"idle" | "paying" | "paid">("idle");
  const [number, setNumber] = useState("");
  const [exp, setExp] = useState("");
  const [cvc, setCvc] = useState("");
  const digits = number.replace(/\D/g, "");
  const newOk = digits.length >= 15 && /^\d{2} \/ \d{2}$/.test(exp) && cvc.length >= 3;
  const canPay = state === "idle" && (!useNew || newOk);
  const verb = proration.downgrade ? "Switch" : "Upgrade";

  const pay = () => {
    if (!canPay) return;
    setState("paying");
    setTimeout(() => setState("paid"), 1400);
  };

  if (state === "paid") {
    return (
      <div className="relative overflow-hidden px-8 pb-12 pt-14">
        <ConfettiV2 />
        {/* A soft indigo glow behind the mark. */}
        <div aria-hidden className="pointer-events-none absolute left-1/2 top-0 h-64 w-[36rem] -translate-x-1/2 rounded-full bg-indigo-400/15 blur-3xl dark:bg-indigo-500/20" />

        <div className="relative z-10 flex flex-col items-center text-center">
          <span className="relative flex h-16 w-16 items-center justify-center rounded-full bg-gradient-to-br from-indigo-500 to-indigo-700 text-white shadow-lg shadow-indigo-500/30 animate-in zoom-in-50 fade-in duration-500 motion-reduce:animate-none">
            <span aria-hidden className="absolute inset-0 rounded-full ring-8 ring-indigo-500/10" />
            <Check className="h-8 w-8" strokeWidth={2.5} />
          </span>

          <p className="mt-6 text-[11px] font-semibold uppercase tracking-[0.18em] text-indigo-600 dark:text-indigo-400">
            {proration.downgrade ? "Plan switched" : "Payment successful"}
          </p>
          <DialogTitle className="mt-2 text-3xl font-semibold tracking-tight">
            {proration.downgrade ? `See you on ${to.name}` : `Welcome to ${to.name}`}
          </DialogTitle>
          <DialogDescription className="mt-2 max-w-md">
            {proration.downgrade
              ? `You keep ${from.name} until ${nextBill}, then move to ${to.name}.`
              : `Your plan is upgraded and everything on ${to.name} is yours from now.`}
          </DialogDescription>

          {/* The receipt, at a glance. */}
          <div className="mt-8 grid w-full max-w-md grid-cols-2 divide-x divide-border/60 rounded-2xl border bg-card text-left">
            <div className="px-5 py-4">
              <p className="text-xs text-muted-foreground">{proration.downgrade ? "Today" : "Paid today"}</p>
              <p className="mt-1 text-xl font-bold tracking-tight tabular-nums">{money(dueToday)}</p>
            </div>
            <div className="px-5 py-4">
              <p className="text-xs text-muted-foreground">Next bill · {nextBill}</p>
              <p className="mt-1 text-xl font-bold tracking-tight tabular-nums">
                {money(monthly)}
                <span className="text-sm font-normal text-muted-foreground">/month</span>
              </p>
            </div>
          </div>

          <Button
            className="mt-8 h-10 rounded-xl px-10"
            onClick={() => {
              toast.success(`You're now on ${to.name}`);
              onDone();
            }}
          >
            Done
          </Button>
          <p className="mt-3 text-xs text-muted-foreground">Test mode — nothing was charged.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="grid min-h-[520px] md:grid-cols-2">
      {/* ── order summary (Stripe's left panel) ────────────────────── */}
      <div className="flex flex-col bg-muted/40 px-8 py-8">
        <div className="flex items-center gap-3">
          <button type="button" onClick={onBack} disabled={state !== "idle"} className={`inline-flex items-center gap-1 ${LINK}`}>
            <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
            Back
          </button>
          <span className="text-sm font-semibold tracking-tight">Drive247</span>
          <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-amber-800 dark:bg-amber-500/20 dark:text-amber-200">
            Test mode
          </span>
        </div>

        <DialogTitle className="mt-8 text-sm font-medium text-muted-foreground">
          {verb} to {to.name}
        </DialogTitle>
        <p className="mt-1 text-4xl font-bold tracking-tighter">{money(dueToday)}</p>
        <DialogDescription className="mt-1">
          {proration.downgrade ? `Nothing today · ${money(monthly)}/month from ${nextBill}` : `due today · then ${money(monthly)}/month from ${nextBill}`}
        </DialogDescription>

        {!proration.downgrade && (
          <div className="mt-8 space-y-3 text-sm">
            <div className="flex justify-between gap-4">
              <span>
                {to.name} plan
                <span className="block text-xs text-muted-foreground">
                  {proration.daysLeft} of {proration.periodDays} days
                </span>
              </span>
              <span className="tabular-nums">{money(proration.chargeCents)}</span>
            </div>
            <div className="flex justify-between gap-4">
              <span>
                Unused {from.name} time
                <span className="block text-xs text-muted-foreground">Credit</span>
              </span>
              <span className="tabular-nums text-green-600 dark:text-green-400">−{money(proration.creditCents)}</span>
            </div>
            {promoToday > 0 && offer && (
              <div className="flex justify-between gap-4">
                <span>
                  {offer.displayCode}
                  <span className="block text-xs text-muted-foreground">{offer.discountText}</span>
                </span>
                <span className="tabular-nums text-green-600 dark:text-green-400">−{money(promoToday)}</span>
              </div>
            )}
            <div className="flex justify-between gap-4 border-t pt-3 font-semibold">
              <span>Total due today</span>
              <span className="tabular-nums">{money(dueToday)}</span>
            </div>
          </div>
        )}

        <p className="mt-auto pt-8 text-xs text-muted-foreground">Powered by Stripe · Terms · Privacy</p>
      </div>

      {/* ── payment (Stripe's right panel) ─────────────────────────── */}
      <div className="flex flex-col px-8 py-8">
        <p className="text-base font-semibold">Pay with card</p>

        <div className="mt-4 space-y-2">
          {cardOnFile && (
            <label
              className={`flex cursor-pointer items-center gap-3 rounded-xl border px-4 py-3 text-sm transition-colors duration-200 ease-out motion-reduce:transition-none ${
                !useNew ? "border-primary bg-primary/5" : "border-border"
              }`}
            >
              <input type="radio" name="demo-card" checked={!useNew} onChange={() => setUseNew(false)} className="accent-[hsl(var(--primary))]" />
              <span className="flex-1">
                {cardBrandName(cardOnFile.brand)} •••• {cardOnFile.last4}
                <span className="block text-xs text-muted-foreground">Your primary card</span>
              </span>
            </label>
          )}
          <label
            className={`flex cursor-pointer items-center gap-3 rounded-xl border px-4 py-3 text-sm transition-colors duration-200 ease-out motion-reduce:transition-none ${
              useNew ? "border-primary bg-primary/5" : "border-border"
            }`}
          >
            <input type="radio" name="demo-card" checked={useNew} onChange={() => setUseNew(true)} className="accent-[hsl(var(--primary))]" />
            <span className="flex-1">Use a different card</span>
          </label>
        </div>

        {useNew && (
          <div className="mt-4 overflow-hidden rounded-xl border">
            <Input
              inputMode="numeric"
              autoComplete="cc-number"
              placeholder="1234 1234 1234 1234"
              value={digits.replace(/(\d{4})(?=\d)/g, "$1 ")}
              onChange={(e) => setNumber(e.target.value.replace(/\D/g, "").slice(0, 19))}
              className="rounded-none border-0 border-b font-mono shadow-none focus-visible:ring-0"
            />
            <div className="grid grid-cols-2">
              <Input
                inputMode="numeric"
                placeholder="MM / YY"
                value={exp}
                onChange={(e) => {
                  const d = e.target.value.replace(/\D/g, "").slice(0, 4);
                  setExp(d.length > 2 ? `${d.slice(0, 2)} / ${d.slice(2)}` : d);
                }}
                className="rounded-none border-0 border-r font-mono shadow-none focus-visible:ring-0"
              />
              <Input
                type="password"
                inputMode="numeric"
                placeholder="CVC"
                value={cvc}
                onChange={(e) => setCvc(e.target.value.replace(/\D/g, "").slice(0, 4))}
                className="rounded-none border-0 font-mono shadow-none focus-visible:ring-0"
              />
            </div>
          </div>
        )}

        <div className="mt-auto pt-8">
          <Button onClick={pay} disabled={!canPay} className="h-11 w-full rounded-xl text-base">
            {state === "paying" ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Processing…
              </>
            ) : proration.downgrade ? (
              `Confirm switch to ${to.name}`
            ) : (
              `Pay ${money(dueToday)}`
            )}
          </Button>
          <p className="mt-3 text-center text-xs text-muted-foreground">
            Test mode — this is a demo and nothing is charged.
          </p>
        </div>
      </div>
    </div>
  );
}

function cardBrandName(brand: string | null): string {
  const b = (brand ?? "").toLowerCase();
  return b === "visa" ? "Visa" : b === "mastercard" ? "Mastercard" : b === "amex" ? "American Express" : b ? b[0].toUpperCase() + b.slice(1) : "Card";
}
