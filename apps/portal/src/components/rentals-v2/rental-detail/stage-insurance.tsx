"use client";

/**
 * The Insurance stage — the second OUTPUT, on real data.
 *
 * The design is the playground's `rental-create-fake/_insurance-tab.tsx`. What
 * makes this stage worth having is a single sentence from the prototype, and it
 * turns out to be literally true of the real table:
 *
 *   "a policy is written against the car and the cover period and nothing else,
 *    so moving the daily rate or adding a child seat must NOT put it out of
 *    date. Drift is only drift if the document carried the term."
 *
 * `bonzah_insurance_policies` carries `trip_start_date` and `trip_end_date` —
 * a genuine, stored snapshot of the window the customer was actually sold. So
 * unlike the agreement, whose terms are not recorded anywhere, the policy can
 * be compared against the rental honestly and precisely.
 *
 * ── the case this screen exists for ─────────────────────────────────────────
 *
 * A rental's dates move. Nobody re-buys the cover. The policy still ends on the
 * old date, and the car is out on the road with no insurance behind it for the
 * days that were added. Nothing in v1 says so: the policy still reads "Active",
 * because it IS active — for a window that no longer matches the hire.
 *
 * That is the drift this stage puts in amber, and it is the one place on the
 * screen where the banner also states the consequence in days, because "out of
 * date" undersells it. The tone stays amber all the same: red is for a fault,
 * and an operator who moved a rental’s dates did nothing wrong.
 *
 * ── what could not be compared, and is therefore not claimed ────────────────
 *
 * The policy row has NO vehicle. There is no `vehicle_id`, and the car is not
 * recoverable from `renter_details`. So a swap after the policy was bought means
 * the certificate names a car nobody can read back from this row — and this
 * stage says nothing about it rather than inventing a "was". The agreement stage
 * CAN report vehicle drift, because `rental_vehicle_swaps` gives it both sides.
 *
 * Bonzah covers the trip only. INSHUR (off-trip / general fleet) is a separate
 * integration and is hidden from the lean product, so it is gated exactly as v1
 * gates it rather than being reproduced here.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui-v2/button";
import { TraxMark } from "@/components/trax/trax-greeting";
import {
  AlertTriangle,
  Check,
  FlaskConical,
  ShieldCheck,
  Upload,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useTenant } from "@/contexts/TenantContext";
import { useToast } from "@/hooks/use-toast";
import { Badge } from "@/components/ui-v2/badge";
import { useIsAreaHidden } from "@/lib/lean-context";
import { isBonzahSellable, bonzahBlockedReason } from "@/lib/bonzah";
// Bonzah refuses to start a policy today — the earliest insurable night begins
// tomorrow, Pacific. Every UI that gates a purchase has to mirror the clamp in
// `bonzah-create-quote`, or it offers a premium the purchase step then refuses.
// GoNiko was charged $26.95 for a policy that never existed exactly that way.
import { bonzahCanInsureThrough, getPacificTomorrow } from "@/lib/bonzah-dates";
import { getActiveCoverageLabels } from "@/lib/coverage-labels";
import {
  useRentalInsurancePolicies,
  type InsurancePolicy,
} from "@/hooks/use-rental-insurance-policies";
import { useBonzahBalance } from "@/hooks/use-bonzah-balance";
import { useBonzahVehicleEligibility } from "@/hooks/use-bonzah-vehicle-eligibility";
import {
  useAttachInsuranceVerification,
  useRentalInsuranceVerifications,
  useUploadAndVerifyInsurance,
} from "@/hooks/use-insurance-verifications";
// Reused as it stands, exactly as the Customer stage reuses the verification
// dialogs. It is the ONLY working route to a Bonzah quote, a payment and the
// ledger entry that follows, and a v2 copy would be a second call-site for
// `bonzah-create-quote` to keep in step. A modal in v1's grammar over a v2
// screen is much the cheaper mismatch.
import { BuyInsuranceDialog } from "@/components/rentals/buy-insurance-dialog";
import type { StageProps } from "./stages";
import { SHOW_MULTI_PERIOD } from "./multi-period";
import { BonzahCoverCard } from "./bonzah-cover-card";
import {
  fmtDate,
  fmtDateTime,
  insetCls,
  listCls,
  money,
  EmptyHint,
  OutOfDateBanner,
  Panel,
  Pill,
  StageAction,
  Surface,
  type Drift,
} from "./_kit";

/* ══════════════════════════════════════════════════════════════════════════
   Acknowledging drift
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * "Keep the current policy" — the second exit from the amber banner.
 *
 * Held in `localStorage` because no column exists to record it, and keyed on a
 * FINGERPRINT of the drift so accepting one mismatch cannot silence the next
 * one. See the fuller note in `stage-agreement.tsx`; it is duplicated here
 * rather than shared because a fourth file in this directory is one nobody owns
 * while four authors are editing it at once.
 */
function useDriftAcknowledgement(scope: string, fingerprint: string) {
  const key = `d247.v2.drift.${scope}.${fingerprint}`;

  const [acknowledged, setAcknowledged] = useState(() => {
    try {
      return typeof window !== "undefined" && window.localStorage.getItem(key) === "1";
    } catch {
      return false;
    }
  });

  const acknowledge = useCallback(() => {
    setAcknowledged(true);
    try {
      window.localStorage.setItem(key, "1");
    } catch {
      /* Dismissed for this view; it just will not survive a reload. */
    }
  }, [key]);

  return { acknowledged, acknowledge };
}

/* ══════════════════════════════════════════════════════════════════════════
   Reading a policy
   ══════════════════════════════════════════════════════════════════════════ */

const COVERAGE_SHORT = { cdw: "CDW", rcli: "RCLI", sli: "SLI", pai: "PAI" } as const;

/**
 * Bonzah's own statuses, as `InsuranceTimeline` reads them.
 *
 * `insufficient_balance` is the one worth its own tone: the customer's money was
 * taken and the policy did NOT issue, because the tenant's Bonzah wallet was
 * empty. That is a real fault, so it is the only status here allowed to go red.
 */
const STATUS: Record<string, { label: string; tone: "neutral" | "primary" | "success" | "warning"; bad?: boolean }> = {
  active: { label: "Active", tone: "success" },
  quoted: { label: "Quoted, not paid", tone: "warning" },
  payment_pending: { label: "Payment pending", tone: "warning" },
  payment_confirmed: { label: "Paid, issuing", tone: "primary" },
  failed: { label: "Failed", tone: "neutral", bad: true },
  insufficient_balance: { label: "Blocked — wallet empty", tone: "neutral", bad: true },
  cancelled: { label: "Cancelled", tone: "neutral" },
};

function StatusChip({ status }: { status: string }) {
  const info = STATUS[status] ?? { label: status, tone: "neutral" as const };
  if (info.bad) {
    return (
      <Badge variant="destructive" className="gap-1.5">
        <AlertTriangle />
        {info.label}
      </Badge>
    );
  }
  return (
    <Pill tone={info.tone}>
      {status === "active" && <Check />}
      {info.label}
    </Pill>
  );
}

/** Whole days between two `date` columns, built at local midnight. See `fmtDate`. */
function daysBetween(from: string | null | undefined, to: string | null | undefined): number | null {
  if (!from || !to) return null;
  const a = new Date(`${String(from).slice(0, 10)}T00:00:00`).getTime();
  const b = new Date(`${String(to).slice(0, 10)}T00:00:00`).getTime();
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.round((b - a) / 86_400_000);
}

/* ══════════════════════════════════════════════════════════════════════════
   The stage
   ══════════════════════════════════════════════════════════════════════════ */

export function StageInsurance({ detail, onStage, refetch }: StageProps) {
  const { tenant, tenantSlug } = useTenant();
  // Hoisted: the off-trip cover Section is behind a JSX branch, which a
  // hook cannot be called from.
  const inshurHidden = useIsAreaHidden("inshur");
  const { toast } = useToast();

  const rental = detail.rental;
  const vehicle = detail.vehicle;

  const { data: policies = [], isLoading } = useRentalInsurancePolicies(rental.id);
  const { data: uploaded = [] } = useRentalInsuranceVerifications(rental.id);
  const { balanceNumber, isBonzahConnected, bonzahMode, portalUrl } = useBonzahBalance();
  const { isEligible, isLoading: eligibilityLoading, reason: ineligibleReason } =
    useBonzahVehicleEligibility({
      vehicleMake: vehicle?.make ?? null,
      vehicleModel: vehicle?.model ?? null,
      enabled: !!vehicle && isBonzahConnected,
    });

  const [buyOpen, setBuyOpen] = useState(false);

  /* ── which policy is the one in force ───────────────────────────────── */

  /**
   * The policy that covers the hire, and the only one compared against the
   * rental's own dates.
   *
   * Rows of `policy_type = 'extension'` are filtered out and stay out: such a
   * policy's window is SUPPOSED to differ from the rental's, so on a rental
   * that is one fixed period it could only ever be read as drift — see
   * `SHOW_MULTI_PERIOD`.
   */
  const originals = useMemo(
    () => policies.filter((p) => SHOW_MULTI_PERIOD || p.policy_type !== "extension"),
    [policies]
  );

  /**
   * The live one, preferring an issued policy over a stalled attempt.
   *
   * A rental can carry a failed quote AND a good policy — a first attempt that
   * hit an empty wallet, then a successful retry. Sorting by date alone would
   * make the newest row win and could report a rental as uninsured when it is
   * covered, so an `active` row is preferred outright.
   */
  const current: InsurancePolicy | null = useMemo(() => {
    if (!originals.length) return null;
    return originals.find((p) => p.status === "active") ?? originals[originals.length - 1];
  }, [originals]);

  const covered = current?.status === "active";

  /* ── drift ──────────────────────────────────────────────────────────── */

  const gapDays = useMemo(() => {
    if (!covered || !current) return null;
    const gap = daysBetween(current.trip_end_date, rental.end_date);
    return gap && gap > 0 ? gap : null;
  }, [covered, current, rental.end_date]);

  const drift = useMemo<Drift[]>(() => {
    if (!current || !covered) return [];
    const out: Drift[] = [];

    const from = current.trip_start_date?.slice(0, 10) ?? null;
    const nowFrom = rental.start_date?.slice(0, 10) ?? null;
    if (from && nowFrom && from !== nowFrom) {
      out.push({ label: "Cover from", was: fmtDate(from), now: fmtDate(nowFrom) });
    }

    const to = current.trip_end_date?.slice(0, 10) ?? null;
    const nowTo = rental.end_date?.slice(0, 10) ?? null;
    if (to && to !== nowTo) {
      out.push({ label: "Cover to", was: fmtDate(to), now: nowTo ? fmtDate(nowTo) : "Open-ended" });
    }

    return out;
  }, [current, covered, rental.start_date, rental.end_date]);

  const fingerprint = useMemo(
    () => `${current?.id ?? "none"}:${drift.map((d) => `${d.label}=${d.now}`).join("|")}`,
    [current?.id, drift]
  );
  const { acknowledged, acknowledge } = useDriftAcknowledgement("insurance", fingerprint);
  const showBanner = drift.length > 0 && !acknowledged;

  /* ── whether cover can be sold at all ───────────────────────────────── */

  /**
   * Four independent gates, each with its own honest sentence. They are kept
   * apart rather than collapsed into one boolean because "you cannot buy this"
   * is useless to an operator — WHICH of the four is broken is the whole answer,
   * and each has a different remedy.
   */
  const sellable = isBonzahConnected && isBonzahSellable(tenant);
  const hasInsurableDays = bonzahCanInsureThrough(rental.end_date);
  const canBuy = sellable && isEligible && hasInsurableDays && !!vehicle && !!detail.customer;

  const blockedReason = !isBonzahConnected
    ? "Bonzah is not connected for this account. Connect it in Settings → Integrations."
    : !isBonzahSellable(tenant)
      ? (bonzahBlockedReason(tenant) ?? null)
      : !isEligible
        ? (ineligibleReason ?? "Bonzah does not write cover for this make and model.")
        : !hasInsurableDays
          ? `Bonzah cannot start a policy before ${fmtDate(getPacificTomorrow())}, and this rental ends on or before then — there are no days left to cover. Upload the customer's own policy instead.`
          : !vehicle
            ? "No car is on this rental, and a policy is written against one."
            : !detail.customer
              ? "No customer is on this rental, and a policy is written in their name."
              : null;

  const coverageLabels = current ? getActiveCoverageLabels(current.coverage_types, COVERAGE_SHORT) : [];

  /**
   * `rentals.insurance_status` in words — the operator's own recorded choice,
   * set when the rental was created. It is the value the stage rail shows, so
   * saying it here keeps the two in step. `pending` is deliberately absent:
   * it means undecided, which the empty state above already says better.
   */
  const recordedDecision = {
    not_required: "Marked as not requiring cover.",
    uploaded: "Marked as the customer using their own policy.",
    verified: "Marked as the customer's own policy, checked.",
    bonzah: "Marked as covered by Bonzah — but no policy is attached to this rental.",
  }[String(rental.insurance_status ?? "").toLowerCase()];

  /* ── the customer's own policy: upload, then Trax reads it ──────────── */
  const queryClient = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const uploadDoc = useUploadAndVerifyInsurance();
  const attachDoc = useAttachInsuranceVerification();
  const [uploading, setUploading] = useState(false);
  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setUploading(true);
    try {
      // v1's own two steps, as the Insurances page runs them: store the file
      // and start Trax's check, then attach the result to this rental.
      const verificationId = await uploadDoc.mutateAsync({ file });
      await attachDoc.mutateAsync({ verificationId, rentalId: rental.id });
      toast({ title: "Uploaded — I'm reading it now.", description: "The result lands here in a moment." });
    } catch (e: any) {
      toast({ title: "Not uploaded", description: e?.message ?? "Something went wrong.", variant: "destructive" });
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };
  // While Trax is still reading a document, look again every few seconds.
  const reading = uploaded.some((v) => v.status === "pending" || v.status === "processing");
  useEffect(() => {
    if (!reading) return;
    const t = setInterval(
      () => void queryClient.invalidateQueries({ queryKey: ["insurance-verifications", "by-rental", rental.id] }),
      3000
    );
    return () => clearInterval(t);
  }, [reading, queryClient, rental.id]);

  /* ── the panel ──────────────────────────────────────────────────────── */

  if (isLoading) {
    return (
      <Panel fill title="Insurance" description="Cover for the hire — Bonzah, or the customer's own policy.">
        <EmptyHint>Reading the cover on this rental…</EmptyHint>
      </Panel>
    );
  }

  const buyLabel = covered ? "Re-quote Bonzah cover" : "Add Bonzah cover";

  return (
    <Panel
      fill
      title="Insurance"
      description="Cover for the hire — Bonzah, or the customer's own policy checked by Trax."
      action={
        <StageAction
          icon={ShieldCheck}
          label={buyLabel}
          onClick={() => setBuyOpen(true)}
          disabledReason={canBuy && !eligibilityLoading ? null : (blockedReason ?? "Checking whether Bonzah can cover this car…")}
        />
      }
    >
      {/* Island layout, the Customer stage's grammar: the two ways a hire is
          covered, as two full-width cards sharing the pane's height. */}
      <div className="flex h-full min-h-0 flex-col gap-4">
        {/* ── out of date ─────────────────────────────────────────────────── */}
        {showBanner && (
          <div className="shrink-0">
            <OutOfDateBanner
              title={
                gapDays
                  ? `The car is uninsured for the last ${gapDays} day${gapDays === 1 ? "" : "s"}`
                  : "This policy no longer matches the rental"
              }
              meta={
                gapDays
                  ? `Cover ends ${fmtDate(current?.trip_end_date)}. The rental now runs to ${fmtDate(rental.end_date)}.`
                  : `Cover bought for ${money(Number(current?.premium_amount ?? 0))}${current?.policy_no ? ` · policy ${current.policy_no}` : ""}`
              }
              drift={drift}
              primaryLabel="Re-quote and replace"
              onPrimary={() => setBuyOpen(true)}
              secondaryLabel="Keep the current policy"
              onSecondary={acknowledge}
            />
          </div>
        )}

        {/* ── Bonzah — pick the cover, see the price, open the documents ──── */}
        <BonzahCoverCard
          policy={current}
          covered={covered}
          live={sellable}
          sandbox={bonzahMode === "test"}
          days={Math.max(1, detail.days ?? 1)}
          rentalStart={rental.start_date ?? null}
          rentalEnd={rental.end_date ?? null}
          customerName={detail.customerName ?? "The renter"}
          tenantId={tenant?.id}
          emptyNote={current ? null : (recordedDecision ?? null)}
          statusChip={current ? <StatusChip status={current.status} /> : <StatusChip status="active" />}
          gapDays={gapDays}
          onRequote={() => setBuyOpen(true)}
        />

        {/* ── the customer's own policy, checked by Trax ──────────────────── */}
        <Surface className="flex min-h-0 flex-1 flex-col p-5">
          <div className="flex items-center gap-2.5">
            <h3 className="font-heading text-sm font-semibold">Customer&rsquo;s own policy</h3>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-primary-light px-2 py-0.5 text-[11px] font-medium text-primary dark:text-[hsl(var(--v2-link,var(--primary)))]">
              <TraxMark size="xs" className="-ml-1 size-4" />
              Checked by Trax
            </span>
            <span className="flex-1" />
            <input
              ref={fileRef}
              type="file"
              accept="application/pdf,image/*"
              className="hidden"
              onChange={(e) => void onFile(e.target.files?.[0])}
            />
            <Button size="sm" variant="outline" disabled={uploading} onClick={() => fileRef.current?.click()}>
              {uploading ? <Loader2 className="animate-spin" /> : <Upload />}
              Upload certificate
            </Button>
          </div>

          {uploaded.length === 0 ? (
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className={cn(
                insetCls,
                "mt-4 flex min-h-16 flex-1 flex-col items-center justify-center gap-2 border border-dashed border-foreground/10 px-6 text-center transition-colors duration-200 ease-out hover:bg-primary/[0.04] motion-reduce:transition-none"
              )}
            >
              <Upload className="size-5 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">
                Drop in {detail.customerName?.split(" ")[0] ?? "the customer"}&rsquo;s insurance certificate — I&rsquo;ll read it and check it.
              </p>
              <p className="text-xs text-muted-foreground/70">PDF or a photo</p>
            </button>
          ) : (
            <div className="mt-4 min-h-0 flex-1 overflow-y-auto no-scrollbar">
              <div className={listCls}>
                {uploaded.map((v) => {
                  const flags = v.ai_findings?.flags ?? [];
                  const busy = v.status === "pending" || v.status === "processing";
                  const ok = v.status === "verified";
                  return (
                    <div key={v.id} className="flex items-center gap-4 px-5 py-3">
                      <div className="min-w-0 flex-1">
                        <a
                          href={v.file_url || undefined}
                          target="_blank"
                          rel="noreferrer"
                          className="block truncate text-sm font-medium underline-offset-2 hover:underline"
                        >
                          {v.extracted_fields?.insurer || v.file_name}
                        </a>
                        <p
                          className="truncate text-xs text-muted-foreground"
                          title={v.ai_findings?.reasoning ?? undefined}
                        >
                          {busy
                            ? "Reading the document…"
                            : ok
                              ? [
                                  v.extracted_fields?.policy_number,
                                  v.extracted_fields?.end_date ? `to ${v.extracted_fields.end_date}` : null,
                                ]
                                  .filter(Boolean)
                                  .join(" · ") || "Nothing was read off the document."
                              : flags.join(" · ") || "Needs a look"}
                        </p>
                      </div>
                      <span
                        className={cn(
                          "flex shrink-0 items-center gap-1.5 text-xs font-medium",
                          busy ? "text-muted-foreground" : ok ? "text-success" : "text-warning"
                        )}
                      >
                        {busy ? <Loader2 className="size-3.5 animate-spin" /> : ok ? <Check className="size-3.5" /> : null}
                        {busy ? "Reading" : ok ? "Valid" : "Needs a look"}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </Surface>
      </div>

      {/* ── the reused v1 dialog — the one route to a Bonzah quote ───────── */}
      {detail.customer && vehicle && (
        <BuyInsuranceDialog
          open={buyOpen}
          onOpenChange={setBuyOpen}
          rental={rental as any}
          onPurchaseComplete={(premium) => {
            toast({
              title: "Cover bought",
              description: `${money(premium)} has been added to the rental as an insurance charge. Take the payment on the Payments stage.`,
            });
            refetch();
            onStage("payments");
          }}
        />
      )}
    </Panel>
  );
}

export default StageInsurance;
