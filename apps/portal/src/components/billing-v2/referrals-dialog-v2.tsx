"use client";

import type React from "react";

import { useState } from "react";
import { Loader2 } from "lucide-react";
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
import { Textarea } from "@/components/ui-v2/textarea";
import { Progress } from "@/components/ui/progress";
import { AutoSkeleton } from "@/components/skeleton-v2/auto-skeleton";
import { useSkeletonLoading } from "@/hooks/use-skeleton-loading";
import { SKELETON_REFERRALS } from "@/components/referrals/referrals-view";
import { useReferralClaim, useReferrals, type ReferralsData } from "@/hooks/use-referrals";
import { formatBillDate } from "@/lib/integration-billing/catalog";

/**
 * Everything the Referrals page has, in one wide dialog — opened by clicking
 * the referral coupon on v2 Billing: your code and link (copy, share), what a
 * new operator gets, your reward and the level ladder, the totals, who you
 * referred, the code you joined with, and "someone joined without your code?".
 *
 * Same data as /referrals (`useReferrals`, the `tenant-referrals` function).
 * Minimal like the other Billing dialogs: text, hairlines, no icons.
 */

const money = (cents: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: cents % 100 === 0 ? 0 : 2,
  }).format(cents / 100);

const LINK =
  "text-sm text-primary dark:text-[hsl(var(--v2-link,var(--primary)))] transition-opacity duration-200 ease-out hover:opacity-70 disabled:cursor-not-allowed disabled:opacity-40 motion-reduce:transition-none";

function Caption({ children }: { children: React.ReactNode }) {
  return <h3 className="mb-3 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">{children}</h3>;
}

/** "1–2 referrals", "3 referrals", "5+ referrals". */
function tierRange(min: number, nextMin: number | undefined): string {
  if (nextMin === undefined) return `${min}+ referrals`;
  const max = nextMin - 1;
  if (max > min) return `${min}–${max} referrals`;
  return `${min} referral${min === 1 ? "" : "s"}`;
}

function shareText(data: ReferralsData): string {
  const offer = data.refereeOffer ? ` You'll get ${data.refereeOffer.discountText} ${data.refereeOffer.durationText}.` : "";
  return `I run my rental business on Drive247 and I think you'd like it.${offer} Sign up with my link: ${data.code?.link ?? ""} (or use code ${data.code?.code ?? ""}).`;
}

function CopyField({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error("Couldn't copy. Select it and copy by hand.");
    }
  };
  return (
    <div className="flex items-center justify-between gap-4 rounded-xl bg-muted/50 px-4 py-3">
      <div className="min-w-0">
        <p className="text-[11px] uppercase tracking-wider text-muted-foreground">{label}</p>
        <p className={`truncate ${mono ? "font-mono text-lg font-semibold tracking-wider" : "text-sm"}`} title={value}>
          {value}
        </p>
      </div>
      <button type="button" onClick={copy} className={LINK}>
        {copied ? "Copied" : "Copy"}
      </button>
    </div>
  );
}

export function ReferralsDialogV2({
  open,
  onOpenChange,
  readOnly,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  readOnly: boolean;
}) {
  const { data, isLoading: referralsLoading, error } = useReferrals();
  const isLoading = useSkeletonLoading(referralsLoading);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[88vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-3xl">
        <DialogHeader className="shrink-0 px-8 pb-2 pt-8 text-left">
          <DialogTitle>Referrals</DialogTitle>
          <DialogDescription>
            Tell another rental operator about Drive247. They save on their subscription, and you save on yours.
          </DialogDescription>
        </DialogHeader>

        <div className="overflow-y-auto px-8 pb-8 pt-5">
          {isLoading ? (
            // The real body over a placeholder programme, as its own skeleton.
            <AutoSkeleton loading>
              <Body data={SKELETON_REFERRALS} readOnly />
            </AutoSkeleton>
          ) : error || !data ? (
            <p className="text-sm text-muted-foreground">We couldn&apos;t load your referrals right now. Please try again in a moment.</p>
          ) : !data.enabled ? (
            <p className="text-sm text-muted-foreground">
              The referral programme isn&apos;t available on your account right now. If someone joined Drive247 because of you, let us know through Support.
            </p>
          ) : (
            <Body data={data} readOnly={readOnly} />
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Body({ data, readOnly }: { data: ReferralsData; readOnly: boolean }) {
  const { standing, joinedWith } = data;
  const target = standing.next ? standing.activeReferrals + standing.next.needed : null;

  return (
    <div className="space-y-8">
      {joinedWith && (
        <p className="rounded-xl bg-muted/50 px-4 py-3 text-sm">
          You joined with{" "}
          {joinedWith.referrerName ? `${joinedWith.referrerName}'s code` : joinedWith.code ? `the code ${joinedWith.code}` : "a promo code"}:{" "}
          <span className="font-medium">
            {joinedWith.discountText} {joinedWith.durationText}
          </span>
          {joinedWith.active && joinedWith.endsAt ? (
            <>
              , until {formatBillDate(joinedWith.endsAt)}
              {joinedWith.billsLeft !== null ? ` (${joinedWith.billsLeft} bill${joinedWith.billsLeft === 1 ? "" : "s"} left)` : ""}.
            </>
          ) : joinedWith.active ? (
            "."
          ) : (
            ". This discount has now finished."
          )}
        </p>
      )}

      <div className="grid gap-8 md:grid-cols-2">
        {/* ── share ─────────────────────────────────────────────── */}
        <section>
          <Caption>Your code</Caption>
          {data.code ? (
            <div className="space-y-2">
              <CopyField label="Code" value={data.code.code} mono />
              <CopyField label="Link" value={data.code.link} />
              <div className="flex gap-5 pt-2">
                <a
                  href={`https://wa.me/?text=${encodeURIComponent(shareText(data))}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={LINK}
                >
                  Share on WhatsApp
                </a>
                <a
                  href={`mailto:?subject=${encodeURIComponent("Try Drive247 for your rental business")}&body=${encodeURIComponent(shareText(data))}`}
                  className={LINK}
                >
                  Share by email
                </a>
              </div>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              {data.subscribed
                ? "Your code is being set up. Check back in a few minutes."
                : "Your referral code appears here once your Drive247 subscription is active."}
            </p>
          )}
          {data.refereeOffer && (
            <p className="mt-4 text-sm text-muted-foreground">
              A new operator who uses it gets{" "}
              <span className="font-medium text-foreground">
                {data.refereeOffer.discountText} {data.refereeOffer.durationText}
              </span>
              .
            </p>
          )}
        </section>

        {/* ── reward ────────────────────────────────────────────── */}
        <section>
          <Caption>Your reward</Caption>
          <p className="text-3xl font-semibold tracking-tight">{standing.reward ?? "Not yet"}</p>
          <p className="mt-1 text-sm text-muted-foreground">
            {standing.reward
              ? `From ${standing.activeReferrals} subscribed referral${standing.activeReferrals === 1 ? "" : "s"}.`
              : "Refer your first operator to start saving."}
          </p>
          {standing.next && target !== null && (
            <div className="mt-4 space-y-1.5">
              <Progress value={(standing.activeReferrals / target) * 100} className="h-1.5" />
              <p className="text-xs text-muted-foreground">
                {standing.next.needed} more subscribed referral{standing.next.needed === 1 ? "" : "s"} to get {standing.next.reward}.
              </p>
            </div>
          )}
          <div className="mt-5 divide-y divide-border/60">
            {standing.tiers.map((t, i) => {
              const nextMin = standing.tiers[i + 1]?.min;
              const on = standing.activeReferrals >= t.min && (nextMin === undefined || standing.activeReferrals < nextMin);
              return (
                <div key={t.min} className={`flex items-center justify-between py-2 text-sm ${on ? "font-medium" : "text-muted-foreground"}`}>
                  <span>
                    {tierRange(t.min, nextMin)}
                    {on && <span className="ml-2 text-xs font-normal text-muted-foreground">You&apos;re here</span>}
                  </span>
                  <span>{t.reward}</span>
                </div>
              );
            })}
          </div>
          <p className="mt-3 text-xs text-muted-foreground">
            You get the level you&apos;re on, not a total. A referral counts while that operator stays subscribed; changes apply from your next bill.
          </p>
        </section>
      </div>

      {/* ── totals ──────────────────────────────────────────────── */}
      <div className="grid grid-cols-3 divide-x divide-border/60 rounded-xl bg-muted/40">
        {[
          { label: "Subscribed referrals", value: String(standing.activeReferrals) },
          { label: "Operators referred", value: String(standing.totalReferrals) },
          { label: "Saved so far", value: money(data.savedCents) },
        ].map((st) => (
          <div key={st.label} className="px-5 py-4">
            <p className="text-2xl font-semibold tabular-nums">{st.value}</p>
            <p className="text-xs text-muted-foreground">{st.label}</p>
          </div>
        ))}
      </div>

      {/* ── who ─────────────────────────────────────────────────── */}
      <section>
        <Caption>Operators you referred</Caption>
        {data.referrals.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nobody yet. When someone subscribes with your code, they appear here.</p>
        ) : (
          <div className="divide-y divide-border/60">
            {data.referrals.map((r) => (
              <div key={r.id} className="flex items-baseline justify-between gap-4 py-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{r.name}</p>
                  <p className="text-xs text-muted-foreground">Since {formatBillDate(r.since)}</p>
                </div>
                <span className={`shrink-0 text-sm ${r.counts ? "" : "text-muted-foreground"}`}>
                  {r.counts ? "Subscribed" : "Not subscribed"}
                </span>
              </div>
            ))}
          </div>
        )}
      </section>

      <ClaimSection claims={data.claims} readOnly={readOnly} />
    </div>
  );
}

function ClaimSection({ claims, readOnly }: { claims: ReferralsData["claims"]; readOnly: boolean }) {
  const claim = useReferralClaim();
  const [openForm, setOpenForm] = useState(false);
  const [businessName, setBusinessName] = useState("");
  const [contact, setContact] = useState("");
  const [note, setNote] = useState("");

  const submit = async () => {
    try {
      await claim.mutateAsync({ businessName, contact, note });
      setBusinessName("");
      setContact("");
      setNote("");
      setOpenForm(false);
      toast.success("Thanks. We'll check and add them to your referrals.");
    } catch (e) {
      toast.error((e as Error).message || "Could not send that right now");
    }
  };

  return (
    <section>
      <Caption>Someone joined because of you?</Caption>
      {!openForm ? (
        <p className="text-sm text-muted-foreground">
          If they subscribed without your code, tell us and we&apos;ll add them to your referrals.{" "}
          <button type="button" className={LINK} onClick={() => setOpenForm(true)} disabled={readOnly}>
            Tell us
          </button>
        </p>
      ) : (
        <div className="space-y-3 rounded-xl bg-muted/40 p-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <label htmlFor="claim-business-v2" className="text-xs text-muted-foreground">
                Their business name
              </label>
              <Input id="claim-business-v2" value={businessName} onChange={(e) => setBusinessName(e.target.value)} placeholder="e.g. Sunrise Car Hire" />
            </div>
            <div className="space-y-1.5">
              <label htmlFor="claim-contact-v2" className="text-xs text-muted-foreground">
                Their email or phone (optional)
              </label>
              <Input id="claim-contact-v2" value={contact} onChange={(e) => setContact(e.target.value)} />
            </div>
          </div>
          <div className="space-y-1.5">
            <label htmlFor="claim-note-v2" className="text-xs text-muted-foreground">
              Anything else (optional)
            </label>
            <Textarea id="claim-note-v2" rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => setOpenForm(false)} disabled={claim.isPending}>
              Cancel
            </Button>
            <Button size="sm" onClick={submit} disabled={readOnly || claim.isPending || businessName.trim().length < 2}>
              {claim.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Send
            </Button>
          </div>
        </div>
      )}
      {claims.length > 0 && (
        <div className="mt-3 divide-y divide-border/60">
          {claims.map((c) => (
            <div key={c.id} className="flex items-baseline justify-between gap-4 py-2.5 text-sm">
              <span className="truncate">{c.claimed_business_name}</span>
              <span className="shrink-0 text-muted-foreground">
                {c.status === "approved" ? "Added" : c.status === "rejected" ? "Not matched" : "Checking"}
              </span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
