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

import { useCallback, useMemo, useState } from "react";
import {
  AlertTriangle,
  Check,
  ExternalLink,
  FileCheck2,
  FlaskConical,
  ShieldCheck,
  ShieldOff,
  Sparkles,
  Upload,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useTenant } from "@/contexts/TenantContext";
import { useToast } from "@/hooks/use-toast";
import { Badge } from "@/components/ui-v2/badge";
import { isAreaHidden } from "@/lib/lean-areas";
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
import { useRentalInsuranceVerifications } from "@/hooks/use-insurance-verifications";
// Reused as it stands, exactly as the Customer stage reuses the verification
// dialogs. It is the ONLY working route to a Bonzah quote, a payment and the
// ledger entry that follows, and a v2 copy would be a second call-site for
// `bonzah-create-quote` to keep in step. A modal in v1's grammar over a v2
// screen is much the cheaper mismatch.
import { BuyInsuranceDialog } from "@/components/rentals/buy-insurance-dialog";
import type { StageProps } from "./stages";
import { SHOW_MULTI_PERIOD } from "./multi-period";
import {
  fmtDate,
  fmtDateTime,
  insetCls,
  listCls,
  money,
  ActionButton,
  EmptyHint,
  OutOfDateBanner,
  Panel,
  Pill,
  Section,
  StatBlock,
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

  /* ── the panel ──────────────────────────────────────────────────────── */

  if (isLoading) {
    return (
      <Panel title="Insurance" description="Cover for the hire period, priced from the car and the dates.">
        <EmptyHint>Reading the cover on this rental…</EmptyHint>
      </Panel>
    );
  }

  const buyLabel = covered ? "Re-quote and replace" : "Add cover";

  return (
    <Panel
      title="Insurance"
      description="Optional cover for the hire period. Written against the car and the dates — and nothing else, so only those can put it out of date."
      footer={
        canBuy ? (
          <ActionButton onClick={() => setBuyOpen(true)} disabled={eligibilityLoading}>
            <ShieldCheck className="size-4" />
            {buyLabel}
          </ActionButton>
        ) : (
          <ActionButton disabled title={blockedReason ?? undefined}>
            <ShieldCheck className="size-4" />
            {buyLabel}
          </ActionButton>
        )
      }
    >
      {/* ── out of date ─────────────────────────────────────────────────── */}
      {showBanner && (
        <div>
          <OutOfDateBanner
            title={
              gapDays
                ? `The car is uninsured for the last ${gapDays} day${gapDays === 1 ? "" : "s"}`
                : "This policy no longer matches the rental"
            }
            meta={
              gapDays
                ? `Cover bought for ${money(Number(current?.premium_amount ?? 0))} and ends ${fmtDate(
                    current?.trip_end_date
                  )}. The rental now runs to ${fmtDate(rental.end_date)}.`
                : `Cover bought for ${money(Number(current?.premium_amount ?? 0))}${
                    current?.policy_no ? ` · policy ${current.policy_no}` : ""
                  }`
            }
            drift={drift}
            primaryLabel="Re-quote and replace"
            onPrimary={() => setBuyOpen(true)}
            secondaryLabel="Keep the current policy"
            onSecondary={acknowledge}
          />
          <p className="mt-2 px-6 text-[11px] text-muted-foreground">
            Keeping it only hides this notice on this browser — there is nowhere on the policy to record the
            decision yet, so a colleague will still see it. If the dates move again, it comes back.
          </p>
        </div>
      )}

      {/* ── the policy ──────────────────────────────────────────────────── */}
      {!current ? (
        <Section
          title="No cover on this rental"
          description="Bonzah is optional. Without it the customer is on their own policy, which is a legitimate way to run a hire."
        >
          <EmptyHint>
            Nothing has been bought for {detail.customerName ?? "this customer"}. If they are bringing their own
            insurance, upload the certificate below so it is on the rental when somebody needs it.
          </EmptyHint>

          {/* The decision the rental itself records, which is what the stage rail
              reads. Shown here because without it the two disagree in a way that
              looks like a bug: the rail can say "Customer's own" while the
              section below says nothing is uploaded — both true, and together
              they are the actual finding (a decision was made, no certificate
              backs it). Separately is where it reads as a contradiction. */}
          {recordedDecision && (
            <div className={cn(insetCls, "mt-5 px-5 py-4")}>
              <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                Recorded on the rental
              </p>
              <p className="mt-1 text-sm">{recordedDecision}</p>
            </div>
          )}

          {blockedReason && (
            <p className="mt-4 text-xs text-muted-foreground">{blockedReason}</p>
          )}
        </Section>
      ) : (
        <Surface>
          <div className="flex flex-wrap items-start gap-4">
            <span
              className={cn(
                "flex size-11 shrink-0 items-center justify-center rounded-3xl",
                covered ? "bg-success-light text-success" : "bg-muted text-muted-foreground"
              )}
            >
              {covered ? <ShieldCheck className="size-5" /> : <ShieldOff className="size-5" />}
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="font-heading text-sm font-semibold">
                  {coverageLabels.length
                    ? coverageLabels.map((c) => c.label).join(" + ")
                    : "Bonzah cover"}
                </h3>
                <StatusChip status={current.status} />
                {/* Sandbox policies are NOT real cover, while the customer can
                    still be charged real money for them — which is why selling
                    is normally blocked in test mode at all. One that exists must
                    be unmistakable. */}
                {bonzahMode === "test" && (
                  <Badge variant="outline" className="gap-1.5">
                    <FlaskConical />
                    Sandbox
                  </Badge>
                )}
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                {current.policy_no ? `Policy ${current.policy_no}` : `Quote ${current.quote_no ?? current.quote_id}`}
                {current.policy_issued_at && ` · issued ${fmtDateTime(current.policy_issued_at)}`}
              </p>
            </div>
          </div>

          <div className="mt-5 grid gap-2 sm:grid-cols-3">
            <StatBlock
              label="Cover from"
              value={fmtDate(current.trip_start_date)}
              hint={current.pickup_state ? `Garaged ${current.pickup_state}` : undefined}
            />
            <StatBlock
              label="Cover to"
              value={fmtDate(current.trip_end_date)}
              hint={
                gapDays
                  ? `${gapDays} day${gapDays === 1 ? "" : "s"} short of the rental`
                  : "Matches the rental"
              }
              tone={gapDays ? "text-warning" : undefined}
            />
            <StatBlock label="Premium" value={money(Number(current.premium_amount ?? 0))} hint="Charged to the rental" />
          </div>

          {coverageLabels.length > 0 && (
            <div className="mt-5 flex flex-wrap gap-1.5">
              {coverageLabels.map((c) => (
                <Pill key={c.key} tone="neutral">
                  {c.label}
                </Pill>
              ))}
            </div>
          )}

          {/* A quote that was never paid, or a policy blocked on an empty
              wallet, is money already taken with nothing behind it. It is the
              one thing on this stage that warrants the destructive tone. */}
          {current.status === "insufficient_balance" && (
            <div className="mt-5 rounded-3xl bg-destructive-light px-5 py-4 ring-1 ring-destructive/20">
              <p className="text-sm font-medium text-destructive">
                The policy did not issue — your Bonzah wallet was empty.
              </p>
              <p className="mt-1 text-xs text-destructive/80">
                {balanceNumber !== null
                  ? `The wallet currently holds ${money(balanceNumber)}. `
                  : ""}
                Top it up and buy again; the customer has no cover until you do.
              </p>
              <a
                href={portalUrl}
                target="_blank"
                rel="noreferrer"
                className="mt-3 inline-flex items-center gap-1.5 text-xs font-medium text-destructive underline-offset-2 hover:underline"
              >
                <ExternalLink className="size-3.5" />
                Open the Bonzah portal
              </a>
            </div>
          )}

          {/* NOT WIRED here, and shown rather than hidden. Retrying a stalled
              policy, refreshing it against Bonzah and downloading the
              certificate PDFs are three separate edge-function calls that live
              on v1's insurance timeline; each has its own failure handling and
              re-implementing them from a description would be guesswork. */}
          {(current.status === "quoted" ||
            current.status === "failed" ||
            current.status === "insufficient_balance") && (
            <div className="mt-5">
              <ActionButton
                variant="outline"
                disabled
                title="Retrying a stalled policy calls bonzah-confirm-payment with the original quote — that path is on v1's insurance timeline and is not on this stage yet. Buying fresh cover above works."
              >
                <ShieldCheck className="size-4" />
                Retry this policy
              </ActionButton>
            </div>
          )}

          {covered && (
            <div className="mt-5">
              <ActionButton
                variant="outline"
                disabled
                title="The certificate PDFs are fetched per coverage through bonzah-download-pdf, which is not on this stage yet."
              >
                <FileCheck2 className="size-4" />
                Download the certificate
              </ActionButton>
            </div>
          )}
        </Surface>
      )}

      {/* ── the customer's own policy ───────────────────────────────────── */}
      <Section
        title="The customer's own policy"
        description="Certificates uploaded against this rental, read by the document checker."
      >
        {uploaded.length === 0 ? (
          <EmptyHint>
            Nothing uploaded. If {detail.customerName?.split(" ")[0] ?? "the customer"} is covering the car on their
            own insurance, the certificate belongs here — it is the only proof on the rental if there is a claim.
          </EmptyHint>
        ) : (
          <div className={listCls}>
            {uploaded.map((v) => {
              const flags = v.ai_findings?.flags ?? [];
              return (
                <div key={v.id} className="flex gap-4 px-5 py-4">
                  <span
                    className={cn(
                      "flex size-10 shrink-0 items-center justify-center rounded-2xl",
                      v.status === "verified"
                        ? "bg-success-light text-success"
                        : v.status === "flagged" || v.status === "rejected"
                          ? "bg-destructive-light text-destructive"
                          : "bg-muted text-muted-foreground"
                    )}
                  >
                    <FileCheck2 className="size-4" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="truncate text-sm font-medium">{v.file_name}</p>
                      <Pill
                        tone={
                          v.status === "verified"
                            ? "success"
                            : v.status === "flagged" || v.status === "rejected"
                              ? "warning"
                              : "neutral"
                        }
                      >
                        {v.status}
                      </Pill>
                      {v.ai_score != null && <Pill tone="neutral">{v.ai_score}/100</Pill>}
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {[
                        v.extracted_fields?.insurer,
                        v.extracted_fields?.policy_number,
                        v.extracted_fields?.end_date ? `to ${v.extracted_fields.end_date}` : null,
                      ]
                        .filter(Boolean)
                        .join(" · ") || "Nothing was read off the document."}
                    </p>
                    {flags.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {flags.map((f) => (
                          <Pill key={f} tone="warning">
                            {f}
                          </Pill>
                        ))}
                      </div>
                    )}
                    {v.ai_findings?.reasoning && (
                      <div className={cn(insetCls, "mt-3 px-4 py-3")}>
                        <div className="mb-1.5 flex items-center gap-1.5">
                          <Sparkles className="size-3 text-primary" />
                          <span className="text-[11px] font-medium">What the checker saw</span>
                        </div>
                        <p className="text-xs leading-relaxed text-muted-foreground">
                          {v.ai_findings.reasoning}
                        </p>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* NOT WIRED. Uploading is a file input, a storage write to the
            `insurance-verifications` bucket and an edge-function call to read
            the document — v1 builds that inline on its rental page rather than
            exposing it as a component, so there is nothing here to call. */}
        <div className="mt-5">
          <ActionButton
            variant="outline"
            disabled
            title="The upload-and-verify flow is built inline on v1's rental page rather than exposed as a component, so it cannot be called from here yet. Uploading from the Insurances page attaches to the rental the same way."
          >
            <Upload className="size-4" />
            Upload a certificate
          </ActionButton>
        </div>
      </Section>

      {/* Bonzah covers the trip and only the trip. INSHUR is the off-trip half
          and a separate integration; it is hidden from the lean product, and its
          own block explains its absence when the integration is off — so without
          this gate the canary would be told to go and configure a product it has
          not been sold. Gated exactly as v1 gates it. */}
      {!isAreaHidden("inshur", tenantSlug) && tenant?.integration_inshur && (
        <Section
          title="Off-trip cover"
          description="INSHUR writes the general fleet policy, which Bonzah does not cover."
        >
          <EmptyHint>
            INSHUR is on for this account, but its panel is not on this stage yet. It is unchanged on the rental&rsquo;s
            v1 page and on the Insurances page.
          </EmptyHint>
        </Section>
      )}

      <p className="text-xs text-muted-foreground">
        Cover is priced from the car and the dates.{" "}
        <button
          type="button"
          onClick={() => onStage("when")}
          className="cursor-pointer font-medium text-primary underline-offset-2 hover:underline"
        >
          Change the dates
        </button>{" "}
        and the policy above will say so.
      </p>

      {/* ── the reused v1 dialog ────────────────────────────────────────── */}
      {detail.customer && vehicle && (
        <BuyInsuranceDialog
          open={buyOpen}
          onOpenChange={setBuyOpen}
          rental={rental as any}
          /**
           * The dialog writes the ledger entry itself — the premium becomes a
           * charge on the rental the moment the policy issues. What it does NOT
           * do is collect the money, which is why v1 chains a payment dialog off
           * this callback. That dialog belongs to the Payments stage, so this
           * hands the operator there rather than opening a second modal that
           * would duplicate it.
           */
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
