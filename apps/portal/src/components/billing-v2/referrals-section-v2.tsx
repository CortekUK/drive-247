"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Copy, Gift, Loader2, Mail, MessageCircle } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { SettingsLoadError, SettingsReadOnlyFieldset } from "@/components/settings-v2/section-states";
import { useReferralClaim, useReferrals, type ReferralsData } from "@/hooks/use-referrals";

/**
 * Referrals, as one section of the v2 Billing page (no sub-tabs anywhere in v2,
 * so it sits in the page's single column beside Next invoice). The reward is
 * money off the operator's own Drive247 bill, which is why it lives here.
 *
 * Same data as the standalone `/referrals` screen (`useReferrals`); that screen
 * now redirects here for v2-chrome tenants.
 */

const money = (cents: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: cents % 100 === 0 ? 0 : 2,
  }).format(cents / 100);

const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });

export function ReferralsSectionV2({ readOnly }: { readOnly: boolean }) {
  const { data, isLoading, error, refetch, isFetching } = useReferrals();

  /* `/referrals` redirects to `/subscription#referrals`, but this section mounts
     after the billing data loads, so the browser's own anchor jump has already
     missed it. Scroll once, when the section has something in it. */
  const ref = useRef<HTMLElement>(null);
  const scrolled = useRef(false);
  useEffect(() => {
    if (scrolled.current || isLoading || window.location.hash !== "#referrals") return;
    scrolled.current = true;
    ref.current?.scrollIntoView({ block: "start" });
  }, [isLoading]);

  let body;
  if (isLoading) {
    body = <Skeleton className="h-48 w-full rounded-lg" />;
  } else if (error && !data) {
    body = <SettingsLoadError thing="your referrals" error={error} onRetry={() => refetch()} retrying={isFetching} />;
  } else if (data && !data.enabled) {
    body = (
      <div className="rounded-lg border bg-card p-5 text-sm text-muted-foreground">
        The referral programme isn&apos;t available on your account right now. If someone joined Drive247 because of you, let us know through Support.
      </div>
    );
  } else if (data) {
    body = <ReferralsCard data={data} readOnly={readOnly} />;
  }

  return (
    <section ref={ref} id="referrals" className="scroll-mt-6">
      <h2 className="mb-1 flex items-center gap-2 text-lg font-semibold tracking-tight">
        <Gift className="size-4 text-muted-foreground" aria-hidden />
        Referrals
      </h2>
      <p className="mb-4 text-sm text-muted-foreground">
        Tell another rental operator about Drive247. They save on their subscription, and you save on yours.
      </p>
      {body}
    </section>
  );
}

function ReferralsCard({ data, readOnly }: { data: ReferralsData; readOnly: boolean }) {
  const { standing } = data;
  const target = standing.next ? standing.activeReferrals + standing.next.needed : null;
  const [claimOpen, setClaimOpen] = useState(false);

  return (
    <div className="rounded-lg border bg-card">
      {data.joinedWith && <JoinedWithLine joined={data.joinedWith} />}

      <div className="grid md:grid-cols-2 md:divide-x divide-border">
        {/* ── share ─────────────────────────────────────────────────── */}
        <div className="space-y-3 p-5">
          <div>
            <h3 className="text-[15px] font-semibold tracking-tight">Your referral code</h3>
            <p className="text-sm text-muted-foreground">
              {data.refereeOffer ? (
                <>
                  A new operator who uses it gets{" "}
                  <span className="font-medium text-foreground">
                    {data.refereeOffer.discountText} {data.refereeOffer.durationText}
                  </span>
                  .
                </>
              ) : (
                "Share it with other rental operators."
              )}
            </p>
          </div>
          {data.code ? (
            <>
              <CopyRow label="Code" value={data.code.code} large />
              <CopyRow label="Link" value={data.code.link} />
              <div className="flex flex-wrap gap-2 pt-1">
                <Button variant="outline" size="sm" className="gap-1.5" asChild>
                  <a href={`https://wa.me/?text=${encodeURIComponent(shareText(data))}`} target="_blank" rel="noopener noreferrer">
                    <MessageCircle className="h-4 w-4" /> WhatsApp
                  </a>
                </Button>
                <Button variant="outline" size="sm" className="gap-1.5" asChild>
                  <a
                    href={`mailto:?subject=${encodeURIComponent("Try Drive247 for your rental business")}&body=${encodeURIComponent(shareText(data))}`}
                  >
                    <Mail className="h-4 w-4" /> Email
                  </a>
                </Button>
              </div>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">
              {data.subscribed
                ? "Your code is being set up. Check back in a few minutes."
                : "Your referral code appears here once your Drive247 subscription is active."}
            </p>
          )}
        </div>

        {/* ── reward ────────────────────────────────────────────────── */}
        <div className="space-y-3 border-t p-5 md:border-t-0">
          <div>
            <h3 className="text-[15px] font-semibold tracking-tight">Your reward</h3>
            <p className="text-sm text-muted-foreground">A discount on your own Drive247 bill.</p>
          </div>
          <div>
            <p className="text-2xl font-semibold tracking-tight">{standing.reward ?? "Not yet"}</p>
            <p className="text-sm text-muted-foreground">
              {standing.reward
                ? `From ${standing.activeReferrals} subscribed referral${standing.activeReferrals === 1 ? "" : "s"}.`
                : "Refer your first operator to start saving."}
            </p>
          </div>
          {standing.next && target !== null && (
            <div className="space-y-1.5">
              <Progress value={(standing.activeReferrals / target) * 100} className="h-1.5" />
              <p className="text-xs text-muted-foreground">
                {standing.next.needed} more subscribed referral{standing.next.needed === 1 ? "" : "s"} to get {standing.next.reward}.
              </p>
            </div>
          )}
          <div className="divide-y divide-border/50 [&>div]:py-1.5">
            {standing.tiers.map((t, i) => {
              const nextMin = standing.tiers[i + 1]?.min;
              const on =
                standing.activeReferrals >= t.min && (nextMin === undefined || standing.activeReferrals < nextMin);
              return (
                <div key={t.min} className={`flex items-center justify-between text-sm ${on ? "font-medium text-primary dark:text-[hsl(var(--v2-link,var(--primary)))]" : "text-muted-foreground"}`}>
                  <span>{tierRange(t.min, nextMin)}</span>
                  <span>{t.reward}</span>
                </div>
              );
            })}
          </div>
          <p className="text-xs text-muted-foreground">
            You get the level you&apos;re on, not a total. A referral counts while that operator stays subscribed; changes apply from your next bill.
          </p>
        </div>
      </div>

      {/* ── totals ──────────────────────────────────────────────────── */}
      <div className="grid grid-cols-3 divide-x divide-border border-t">
        <Stat label="Subscribed referrals" value={String(standing.activeReferrals)} />
        <Stat label="Operators referred" value={String(standing.totalReferrals)} />
        <Stat label="Saved so far" value={money(data.savedCents)} />
      </div>

      {/* ── who ─────────────────────────────────────────────────────── */}
      <div className="border-t p-5">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-[15px] font-semibold tracking-tight">Operators you referred</h3>
          <Button variant="link" size="sm" className="h-auto p-0" onClick={() => setClaimOpen(true)}>
            Someone joined without your code?
          </Button>
        </div>
        {data.referrals.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nobody yet. When someone subscribes with your code, they appear here.</p>
        ) : (
          <div className="divide-y divide-border/50">
            {data.referrals.map((r) => (
              <div key={r.id} className="flex items-center justify-between gap-3 py-2.5">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{r.name}</p>
                  <p className="text-xs text-muted-foreground">Since {fmtDate(r.since)}</p>
                </div>
                {/* Text-only status, per the design system. */}
                <span className={`shrink-0 text-sm font-medium ${r.counts ? "text-green-600 dark:text-green-400" : "text-muted-foreground"}`}>
                  {r.counts ? "Subscribed" : "Not subscribed"}
                </span>
              </div>
            ))}
          </div>
        )}
        {data.claims.length > 0 && (
          <div className="mt-3 divide-y divide-border/50 border-t pt-2">
            {data.claims.map((c) => (
              <div key={c.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                <span className="truncate">{c.claimed_business_name}</span>
                <span
                  className={`shrink-0 font-medium ${
                    c.status === "approved" ? "text-green-600 dark:text-green-400" : c.status === "rejected" ? "text-muted-foreground" : "text-amber-600 dark:text-amber-400"
                  }`}
                >
                  {c.status === "approved" ? "Added" : c.status === "rejected" ? "Not matched" : "Checking"}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      <ClaimDialog open={claimOpen} onOpenChange={setClaimOpen} readOnly={readOnly} />
    </div>
  );
}

/** "1–2 referrals", "3 referrals", "5+ referrals", "1 referral". */
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

function JoinedWithLine({ joined }: { joined: NonNullable<ReferralsData["joinedWith"]> }) {
  const who = joined.referrerName
    ? `${joined.referrerName}'s code`
    : joined.code
      ? `the code ${joined.code}`
      : "a promo code";
  return (
    <div className="flex items-start gap-2.5 border-b bg-primary/5 px-5 py-3 text-sm">
      <Gift className="mt-0.5 h-4 w-4 shrink-0 text-primary dark:text-[hsl(var(--v2-link,var(--primary)))]" aria-hidden />
      <p>
        You joined with {who}:{" "}
        <span className="font-medium">
          {joined.discountText} {joined.durationText}
        </span>
        {joined.active && joined.endsAt ? (
          <>
            , until {fmtDate(joined.endsAt)}
            {joined.billsLeft !== null ? ` (${joined.billsLeft} bill${joined.billsLeft === 1 ? "" : "s"} left)` : ""}.
          </>
        ) : joined.active ? (
          "."
        ) : (
          ". This discount has now finished."
        )}
      </p>
    </div>
  );
}

function ClaimDialog({
  open,
  onOpenChange,
  readOnly,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  readOnly: boolean;
}) {
  const claim = useReferralClaim();
  const [businessName, setBusinessName] = useState("");
  const [contact, setContact] = useState("");
  const [note, setNote] = useState("");

  const submit = async () => {
    try {
      await claim.mutateAsync({ businessName, contact, note });
      setBusinessName("");
      setContact("");
      setNote("");
      onOpenChange(false);
      toast.success("Thanks. We'll check and add them to your referrals.");
    } catch (e) {
      toast.error((e as Error).message || "Could not send that right now");
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Someone joined because of you?</DialogTitle>
          <DialogDescription>
            If they subscribed without your code, tell us and we&apos;ll add them to your referrals.
          </DialogDescription>
        </DialogHeader>
        <SettingsReadOnlyFieldset readOnly={readOnly}>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="claim-business">Their business name</Label>
              <Input
                id="claim-business"
                value={businessName}
                onChange={(e) => setBusinessName(e.target.value)}
                placeholder="e.g. Sunrise Car Hire"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="claim-contact">Their email or phone (optional)</Label>
              <Input id="claim-contact" value={contact} onChange={(e) => setContact(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="claim-note">Anything else (optional)</Label>
              <Textarea id="claim-note" rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
            </div>
          </div>
        </SettingsReadOnlyFieldset>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={readOnly || claim.isPending || businessName.trim().length < 2}>
            {claim.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Send
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CopyRow({ label, value, large }: { label: string; value: string; large?: boolean }) {
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
    <div className="flex items-center gap-2 rounded-lg border bg-muted/30 px-3 py-2">
      <span className="w-10 shrink-0 text-xs text-muted-foreground">{label}</span>
      <span
        className={`min-w-0 flex-1 truncate font-mono ${large ? "text-lg font-semibold tracking-wide" : "text-sm"}`}
        title={value}
      >
        {value}
      </span>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="shrink-0 gap-1.5"
        onClick={copy}
        aria-label={`Copy ${label.toLowerCase()}`}
      >
        {copied ? <Check className="h-4 w-4 text-green-600 dark:text-green-400" /> : <Copy className="h-4 w-4" />}
        {copied ? "Copied" : "Copy"}
      </Button>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="px-5 py-3">
      <p className="text-lg font-semibold tabular-nums">{value}</p>
      <p className="text-xs text-muted-foreground">{label}</p>
    </div>
  );
}
