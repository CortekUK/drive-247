"use client";

import { useState } from "react";
import type React from "react";
import { toast } from "sonner";
import { Share2 } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { useReferrals, type ReferralsData } from "@/hooks/use-referrals";
import { formatBillDate } from "@/lib/integration-billing/catalog";
import { ShareReferralDialogV2 } from "@/components/billing-v2/share-referral-dialog-v2";
import { ClaimReferralDialogV2 } from "@/components/billing-v2/claim-referral-dialog-v2";

/**
 * The referrals band on v2 Billing, left of the coupon — everything an
 * operator needs to know about referring, in one place:
 *
 *   (What the operator they refer gets is on the coupon beside this panel;
 *    what they get back is the level filled on the ladder.)
 *   - the reward ladder: every level, its discount, where they are on it,
 *     and how many more subscribed referrals reach the next one;
 *   - their numbers: referrals given, still subscribed, saved so far;
 *   - the operators who joined through them;
 *   - "Claim a referral", for someone who joined without the code (a dialog).
 *
 * Same data as /referrals (`useReferrals`, the `tenant-referrals` function).
 */

const money = (cents: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: cents % 100 === 0 ? 0 : 2,
  }).format(cents / 100);

const LINK =
  "text-sm text-primary transition-opacity duration-200 ease-out hover:opacity-70 disabled:cursor-not-allowed disabled:opacity-40 motion-reduce:transition-none dark:text-[hsl(var(--v2-link,var(--primary)))]";

/** "1–2", "3–4", "5+" — the referrals a level covers. */
function range(min: number, nextMin: number | undefined): string {
  if (nextMin === undefined) return `${min}+`;
  return nextMin - 1 > min ? `${min}–${nextMin - 1}` : `${min}`;
}

/** "10% off every bill" → "10% off". The ladder is narrow. */
const shortReward = (r: string) => r.replace(/\s+every bill.*$/i, "").replace(/\s+on every.*$/i, "");

export function ReferralSummaryV2({ readOnly = false }: { readOnly?: boolean }) {
  const { data, isLoading, error } = useReferrals();
  const [shareOpen, setShareOpen] = useState(false);
  const [claimOpen, setClaimOpen] = useState(false);

  if (isLoading) {
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <Skeleton className="h-20 rounded-xl" />
          <Skeleton className="h-20 rounded-xl" />
        </div>
        <Skeleton className="h-16 w-full rounded-xl" />
        <Skeleton className="h-24 w-full rounded-xl" />
      </div>
    );
  }
  if (error || !data) return <p className="text-sm text-muted-foreground">We couldn&apos;t load your referrals right now.</p>;
  if (!data.enabled) return <p className="text-sm text-muted-foreground">The referral programme isn&apos;t available on your account right now.</p>;

  const { standing } = data;

  return (
    <div className="flex min-h-0 flex-col gap-5 md:h-full">
      {/* ── the ladder ────────────────────────────────────────────── */}
      <Ladder
        standing={standing}
        referrals={data.referrals}
        actions={
          <span className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setShareOpen(true)}
              aria-label="Share your code"
              title="Share your code"
              className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-primary/15 bg-primary/[0.04] text-foreground transition-colors duration-200 ease-out hover:bg-primary/[0.08] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/25 motion-reduce:transition-none"
            >
              <Share2 className="h-4 w-4" aria-hidden />
            </button>
            <button type="button" onClick={() => setClaimOpen(true)} disabled={readOnly} className="inline-flex h-8 items-center rounded-lg px-3.5 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50 border border-primary/15 bg-primary/[0.04] text-foreground transition-colors duration-200 ease-out hover:bg-primary/[0.08] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/25 motion-reduce:transition-none">
              Claim
            </button>
          </span>
        }
      />
      <ShareReferralDialogV2 open={shareOpen} onOpenChange={setShareOpen} data={data} />
      <ClaimReferralDialogV2 open={claimOpen} onOpenChange={setClaimOpen} claims={data.claims} readOnly={readOnly} />

    </div>
  );
}

/** Hinted levels after the real ones: blank, faded, no reward named. */
const HINTED = 2;

/**
 * The reward levels as tiles stacked in a column, aligned left, joined by a
 * line, with two blank faded tiles after them hinting that more may come
 * (nothing promised). Hovering (or focusing) a level shows everything about
 * it on the right — what it gives, how many subscribed referrals reach it,
 * how far away it is — and its SPOTS: the operators who subscribed with your
 * code in that range, and the open spots still to fill. With nothing hovered,
 * the right side shows the level they're on.
 */
function Ladder({
  standing,
  referrals,
  actions,
}: {
  standing: ReferralsData["standing"];
  referrals: ReferralsData["referrals"];
  /** Share / Claim, on the title row. */
  actions?: React.ReactNode;
}) {
  const tiers = [...standing.tiers].sort((a, b) => a.min - b.min);
  const n = standing.activeReferrals;
  const current = tiers.reduce((acc, t, i) => (n >= t.min ? i : acc), -1);
  const [hover, setHover] = useState<number | null>(null);
  if (tiers.length === 0) return null;

  // The referrals that count, oldest first: referral #1, #2, …
  const counting = referrals.filter((r) => r.counts).sort((a, b) => a.since.localeCompare(b.since));

  const shownIdx = hover ?? (current >= 0 ? current : 0);
  const hinted = shownIdx >= tiers.length;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="mb-3 flex shrink-0 items-center justify-between gap-4">
        <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Your reward level</p>
        {actions}
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-6 md:flex-row md:items-stretch">
        {/* the levels — the only part that scrolls */}
        <div
          className="flex shrink-0 flex-col items-start md:min-h-0 md:overflow-y-auto md:pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          onMouseLeave={() => setHover(null)}
        >
          {tiers.map((tier, i) => {
            const on = i === current;
            const passed = i < current;
            const active = i === shownIdx;
            return (
              <div key={tier.min} className="flex flex-col items-start">
                {i > 0 && <span aria-hidden className={`ml-[26px] h-5 w-0.5 ${i <= current ? "bg-primary/30" : "bg-border"}`} />}
                <button
                  type="button"
                  onMouseEnter={() => setHover(i)}
                  onFocus={() => setHover(i)}
                  onBlur={() => setHover(null)}
                  aria-label={`${tier.reward}, from ${tier.min} subscribed referral${tier.min === 1 ? "" : "s"}${on ? " — your level" : ""}`}
                  className={`flex w-44 items-baseline justify-between gap-3 rounded-xl border px-4 py-3 text-left transition-colors duration-200 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 motion-reduce:transition-none ${
                    on
                      ? "border-primary/25 bg-primary/[0.07] text-foreground"
                      : passed
                        ? "border-primary/15 bg-primary/[0.035] text-foreground/80"
                        : active
                          ? "border-primary/20 bg-card text-foreground"
                          : "border-border bg-card text-muted-foreground"
                  }`}
                >
                  <span className="text-base font-medium leading-none tracking-tight">{shortReward(tier.reward).replace(/\s*off$/i, "")}</span>
                  <span className={`text-xs leading-none ${on ? "text-muted-foreground" : ""}`}>{range(tier.min, tiers[i + 1]?.min)} refs</span>
                </button>
              </div>
            );
          })}
          {/* more may come — blank, faded, nothing promised */}
          {Array.from({ length: HINTED }, (_, k) => {
            const i = tiers.length + k;
            return (
              <div key={`hint-${k}`} className="flex flex-col items-start" style={{ opacity: k === 0 ? 0.6 : 0.35 }}>
                <span aria-hidden className="ml-[26px] h-5 w-0 border-l-2 border-dashed border-border" />
                <button
                  type="button"
                  onMouseEnter={() => setHover(i)}
                  onFocus={() => setHover(i)}
                  onBlur={() => setHover(null)}
                  aria-label="More levels may come"
                  className="flex w-44 items-center justify-between rounded-xl border border-dashed px-4 py-3 text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                >
                  <span className="h-2.5 w-10 rounded-full bg-muted" />
                  <span className="h-2 w-12 rounded-full bg-muted" />
                </button>
              </div>
            );
          })}
        </div>

        {/* what the hovered (or current) level means */}
        <div className="min-w-0 flex-1 md:min-h-0 md:border-l md:pl-6" aria-live="polite">
          {hinted ? (
            <div className="py-1">
              <p className="text-xs text-muted-foreground">Beyond level {tiers.length}</p>
              <p className="mt-0.5 text-lg font-medium tracking-tight">More may open up</p>
              <p className="mt-1 max-w-sm text-sm text-muted-foreground">
                As the programme grows, there may be more to reach. Keep sharing your code — the referrals you make now all count.
              </p>
            </div>
          ) : (
            <LevelDetail
              tiers={tiers}
              idx={shownIdx}
              current={current}
              n={n}
              nextNeeded={standing.next?.needed ?? null}
              counting={counting}
            />
          )}
        </div>
      </div>
    </div>
  );
}

function LevelDetail({
  tiers,
  idx,
  current,
  n,
  nextNeeded,
  counting,
}: {
  tiers: ReferralsData["standing"]["tiers"];
  idx: number;
  current: number;
  n: number;
  nextNeeded: number | null;
  counting: ReferralsData["referrals"];
}) {
  const t = tiers[idx];
  const nextMin = tiers[idx + 1]?.min;
  const reached = n >= t.min;
  const isCurrent = idx === current;
  const needed = Math.max(0, t.min - n);
  const progress = reached ? (nextMin ? Math.min(1, (n - t.min + 1) / (nextMin - t.min)) : 1) : Math.min(1, n / t.min);

  // This level's spots: referral #min … #(next − 1); the top level shows three.
  const last = nextMin ? nextMin - 1 : t.min + 2;
  const spots = Array.from({ length: last - t.min + 1 }, (_, k) => t.min + k);

  return (
    <div>
      {/* one row: the level on the left, how far along on the right */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:gap-8">
        <div className="shrink-0">
          <p className="text-xs text-muted-foreground">
            Level {idx + 1} of {tiers.length}
            {isCurrent ? " · You're here" : reached ? " · Passed" : ""}
          </p>
          <p className="mt-0.5 text-lg font-medium tracking-tight">{t.reward}</p>
        </div>
        <div className="min-w-0 flex-1">
          <div className="h-1.5 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full origin-left rounded-full bg-primary/40 transition-transform duration-200 ease-out motion-reduce:transition-none"
              style={{ transform: `scaleX(${progress})` }}
            />
          </div>
          <p className="mt-1.5 text-xs text-muted-foreground">
            {(() => {
              const so = `${n} operator${n === 1 ? "" : "s"} subscribed with your code`;
              const more = (k: number) => `${k} more subscribed referral${k === 1 ? "" : "s"}`;
              if (!reached) return `${so} so far. Get ${more(needed)} to unlock ${shortReward(t.reward)}.`;
              if (!isCurrent) return "You've already passed this level.";
              if (nextNeeded && tiers[idx + 1])
                return `${so} so far. Get ${more(nextNeeded)} to move up to ${shortReward(tiers[idx + 1].reward)}.`;
              return `${so} — you're on the top level.`;
            })()}
          </p>
        </div>
      </div>

      {/* the spots in this level, as a table */}
      <p className="mb-1 mt-5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Subscribed using your code</p>
      <ul className="space-y-2">
        {spots.map((k) => {
          const r = counting[k - 1];
          return r ? (
            <li
              key={k}
              className="grid grid-cols-[2rem_minmax(0,1fr)_8rem_6.5rem] items-center gap-4 rounded-xl border border-border/60 bg-card/50 px-4 py-3"
            >
              <span className="text-xs font-medium tabular-nums text-muted-foreground">#{k}</span>
              <span className="flex min-w-0 items-center gap-3">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary/80">
                  {r.name.trim().charAt(0).toUpperCase()}
                </span>
                <span className="truncate text-sm font-semibold">{r.name}</span>
              </span>
              <span className="text-sm text-muted-foreground">{formatBillDate(r.since)}</span>
              <span className="justify-self-end rounded-full bg-green-50 px-2.5 py-0.5 text-xs font-medium text-green-700 dark:bg-green-500/15 dark:text-green-300">
                Subscribed
              </span>
            </li>
          ) : (
            <li
              key={k}
              className="grid grid-cols-[2rem_minmax(0,1fr)] items-center gap-4 rounded-xl border border-dashed px-4 py-3 text-muted-foreground"
            >
              <span className="text-xs font-medium tabular-nums">#{k}</span>
              <span className="flex min-w-0 items-center gap-3">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-dashed text-sm">+</span>
                <span className="text-sm">
                  Open spot <span className="text-muted-foreground/70">· share your code to fill it</span>
                </span>
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function ShareLink({ data }: { data: ReferralsData }) {
  const [copied, setCopied] = useState(false);
  if (!data.code) return null;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(data.code!.link);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error("Couldn't copy. Select the link and copy it by hand.");
    }
  };
  return (
    <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 border-t pt-3">
      <span className="min-w-0 max-w-full truncate font-mono text-xs text-muted-foreground" title={data.code.link}>
        {data.code.link}
      </span>
      <button type="button" onClick={copy} className={LINK}>
        {copied ? "Copied" : "Copy link"}
      </button>
    </div>
  );
}
