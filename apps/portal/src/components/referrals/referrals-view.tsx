"use client";

import { useState } from "react";
import { Check, Copy, Gift, Loader2, Mail, MessageCircle, Users } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { useReferralClaim, useReferrals, type ReferralsData } from "@/hooks/use-referrals";

const money = (cents: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: cents % 100 === 0 ? 0 : 2 }).format(cents / 100);

const fmtDate = (iso: string) => new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });

/**
 * The operator's Drive247 referral programme: share a code or link; a new
 * operator gets money off; they get a growing discount on their own Drive247
 * bill while the operators they referred stay subscribed.
 */
export function ReferralsView() {
  const { data, isLoading, error } = useReferrals();

  return (
    <div className="mx-auto w-full max-w-5xl space-y-6 p-4 md:p-6">
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10">
          <Gift className="h-5 w-5 text-primary" />
        </div>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Referrals</h1>
          <p className="text-sm text-muted-foreground">
            Tell another rental operator about Drive247. They save on their subscription, and you save on yours.
          </p>
        </div>
      </div>

      {isLoading && <LoadingState />}
      {error && (
        <Card><CardContent className="p-6 text-sm text-muted-foreground">We couldn&apos;t load your referrals right now. Please try again in a moment.</CardContent></Card>
      )}
      {data && <ReferralsBody data={data} />}
    </div>
  );
}

function ReferralsBody({ data }: { data: ReferralsData }) {
  if (!data.enabled) {
    return (
      <Card>
        <CardContent className="p-6 text-sm text-muted-foreground">
          The referral programme isn&apos;t available on your account right now. If someone joined Drive247 because of you, let us know through Support.
        </CardContent>
      </Card>
    );
  }

  const { standing } = data;
  const target = standing.next ? standing.activeReferrals + standing.next.needed : null;

  return (
    <div className="space-y-6">
      {data.joinedWith && <JoinedWithCard joined={data.joinedWith} />}

      <div className="grid gap-6 lg:grid-cols-5">
        {/* ── share ───────────────────────────────────────────────────── */}
        <Card className="lg:col-span-3">
          <CardHeader>
            <CardTitle className="text-lg">Your referral code</CardTitle>
            <CardDescription>
              {data.refereeOffer
                ? <>A new operator who uses it gets <span className="font-medium text-foreground">{data.refereeOffer.discountText} {data.refereeOffer.durationText}</span>.</>
                : "Share it with other rental operators."}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {data.code ? (
              <>
                <CopyRow label="Code" value={data.code.code} large />
                <CopyRow label="Link" value={data.code.link} />
                <div className="flex flex-wrap gap-2 pt-1">
                  <Button variant="outline" size="sm" className="gap-1.5" asChild>
                    <a href={`https://wa.me/?text=${encodeURIComponent(shareText(data))}`} target="_blank" rel="noopener noreferrer">
                      <MessageCircle className="h-4 w-4" /> Share on WhatsApp
                    </a>
                  </Button>
                  <Button variant="outline" size="sm" className="gap-1.5" asChild>
                    <a href={`mailto:?subject=${encodeURIComponent("Try Drive247 for your rental business")}&body=${encodeURIComponent(shareText(data))}`}>
                      <Mail className="h-4 w-4" /> Share by email
                    </a>
                  </Button>
                </div>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">
                {data.subscribed
                  ? "Your code is being set up — check back in a few minutes."
                  : "Your referral code appears here once your Drive247 subscription is active."}
              </p>
            )}
          </CardContent>
        </Card>

        {/* ── reward ──────────────────────────────────────────────────── */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-lg">Your reward</CardTitle>
            <CardDescription>A discount on your own Drive247 bill.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <p className="text-2xl font-semibold">{standing.reward ?? "Not yet"}</p>
              <p className="text-sm text-muted-foreground">
                {standing.reward
                  ? `From ${standing.activeReferrals} subscribed referral${standing.activeReferrals === 1 ? "" : "s"}.`
                  : "Refer your first operator to start saving."}
              </p>
            </div>
            {standing.next && target !== null && (
              <div className="space-y-1.5">
                <Progress value={(standing.activeReferrals / target) * 100} />
                <p className="text-xs text-muted-foreground">
                  {standing.next.needed} more subscribed referral{standing.next.needed === 1 ? "" : "s"} to get {standing.next.reward}.
                </p>
              </div>
            )}
            <div className="space-y-1 border-t border-border pt-3">
              {standing.tiers.map((t, i) => {
                const nextMin = standing.tiers[i + 1]?.min;
                const on = standing.activeReferrals >= t.min && (nextMin === undefined || standing.activeReferrals < nextMin);
                return (
                  <div key={t.min} className={`flex items-center justify-between rounded-md px-2 py-1 text-sm ${on ? "bg-primary/10 font-medium" : ""}`}>
                    <span>{tierRange(t.min, nextMin)}</span>
                    <span>{t.reward}</span>
                  </div>
                );
              })}
              <p className="pt-1 text-xs text-muted-foreground">
                You get the level you&apos;re on, not a total. A referral counts while that operator stays subscribed; changes apply from your next bill.
              </p>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Stat label="Subscribed referrals" value={String(standing.activeReferrals)} />
        <Stat label="Operators you referred" value={String(standing.totalReferrals)} />
        <Stat label="Saved so far" value={money(data.savedCents)} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Operators you referred</CardTitle>
        </CardHeader>
        <CardContent>
          {data.referrals.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nobody yet. When someone subscribes with your code, they appear here.</p>
          ) : (
            <div className="divide-y divide-border">
              {data.referrals.map(r => (
                <div key={r.id} className="flex items-center justify-between gap-3 py-2.5">
                  <div className="flex min-w-0 items-center gap-2.5">
                    <Users className="h-4 w-4 shrink-0 text-muted-foreground" />
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{r.name}</p>
                      <p className="text-xs text-muted-foreground">Since {fmtDate(r.since)}</p>
                    </div>
                  </div>
                  <Badge variant={r.counts ? "success" : "secondary"}>{r.counts ? "Subscribed" : "Not subscribed"}</Badge>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <ClaimCard claims={data.claims} />
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

function JoinedWithCard({ joined }: { joined: NonNullable<ReferralsData["joinedWith"]> }) {
  const who = joined.referrerName ? `${joined.referrerName}'s code` : joined.code ? `the code ${joined.code}` : "a promo code";
  return (
    <Card className="border-primary/30 bg-primary/5">
      <CardContent className="flex items-start gap-3 p-4">
        <Gift className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
        <p className="text-sm">
          You joined with {who}: <span className="font-medium">{joined.discountText} {joined.durationText}</span>
          {joined.active && joined.endsAt
            ? <>, until {fmtDate(joined.endsAt)}{joined.billsLeft !== null ? ` (${joined.billsLeft} bill${joined.billsLeft === 1 ? "" : "s"} left)` : ""}.</>
            : joined.active ? "." : " — this discount has now finished."}
        </p>
      </CardContent>
    </Card>
  );
}

function ClaimCard({ claims }: { claims: ReferralsData["claims"] }) {
  const claim = useReferralClaim();
  const [businessName, setBusinessName] = useState("");
  const [contact, setContact] = useState("");
  const [note, setNote] = useState("");

  const submit = async () => {
    try {
      await claim.mutateAsync({ businessName, contact, note });
      setBusinessName(""); setContact(""); setNote("");
      toast.success("Thanks — we'll check and add them to your referrals.");
    } catch (e) {
      toast.error((e as Error).message || "Could not send that right now");
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Someone joined because of you?</CardTitle>
        <CardDescription>If they subscribed without your code, tell us and we&apos;ll add them to your referrals.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="claim-business">Their business name</Label>
            <Input id="claim-business" value={businessName} onChange={e => setBusinessName(e.target.value)} placeholder="e.g. Sunrise Car Hire" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="claim-contact">Their email or phone (optional)</Label>
            <Input id="claim-contact" value={contact} onChange={e => setContact(e.target.value)} />
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="claim-note">Anything else (optional)</Label>
          <Textarea id="claim-note" rows={2} value={note} onChange={e => setNote(e.target.value)} />
        </div>
        <Button onClick={submit} disabled={claim.isPending || businessName.trim().length < 2}>
          {claim.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Send
        </Button>
        {claims.length > 0 && (
          <div className="space-y-1 border-t border-border pt-3">
            {claims.map(c => (
              <div key={c.id} className="flex items-center justify-between text-sm">
                <span>{c.claimed_business_name}</span>
                <Badge variant={c.status === "approved" ? "success" : c.status === "rejected" ? "outline" : "secondary"}>
                  {c.status === "approved" ? "Added" : c.status === "rejected" ? "Not matched" : "Checking"}
                </Badge>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
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
      toast.error("Couldn't copy — select it and copy by hand");
    }
  };
  return (
    <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/30 px-3 py-2">
      <span className="w-10 shrink-0 text-xs text-muted-foreground">{label}</span>
      <span className={`min-w-0 flex-1 truncate font-mono ${large ? "text-lg font-semibold tracking-wide" : "text-sm"}`} title={value}>{value}</span>
      <Button type="button" variant="ghost" size="sm" className="shrink-0 gap-1.5" onClick={copy} aria-label={`Copy ${label.toLowerCase()}`}>
        {copied ? <Check className="h-4 w-4 text-green-600" /> : <Copy className="h-4 w-4" />}
        {copied ? "Copied" : "Copy"}
      </Button>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <Card>
      <CardContent className="p-4">
        <p className="text-2xl font-semibold">{value}</p>
        <p className="text-sm text-muted-foreground">{label}</p>
      </CardContent>
    </Card>
  );
}

function LoadingState() {
  return (
    <div className="space-y-6">
      <div className="grid gap-6 lg:grid-cols-5">
        <Skeleton className="h-56 lg:col-span-3" />
        <Skeleton className="h-56 lg:col-span-2" />
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        <Skeleton className="h-20" /><Skeleton className="h-20" /><Skeleton className="h-20" />
      </div>
    </div>
  );
}
