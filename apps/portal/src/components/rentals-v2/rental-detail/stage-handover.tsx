"use client";

/**
 * The Handover stage — the day itself, on real data.
 *
 * The design is the playground's `rental-create-fake/_handover-tab.tsx`. Two
 * mirrored halves, matching the two `rental_key_handovers` rows the product
 * actually keeps:
 *
 *   giving     "Vehicle collection"  before the rental
 *   receiving  "Vehicle return"      after it
 *
 * Each carries photographs, an odometer reading and notes, and each is confirmed
 * with a timestamp that can be undone. The return half stays locked until the
 * car has gone out, because you cannot receive a car you never gave.
 *
 * ── the third output, and why it belongs on this screen ─────────────────────
 *
 * The damage report is treated as exactly what the agreement and the policy are:
 * something PRODUCED from inputs that can move underneath it. Add a photograph
 * after running it and it goes out of date and says so, in the same amber banner
 * — which is not a flourish, it is the thesis of the screen applied to its last
 * stage.
 *
 * And here the drift is not an inference of any kind. `rental_damage_reports`
 * stores `giving_photo_count` and `receiving_photo_count`: what the model was
 * actually run against. Comparing those two integers with the photographs on
 * file today is exact. Of the three outputs on this screen it is the only one
 * whose staleness can be proven outright rather than argued from a timestamp.
 *
 * ── the prototype's shot list did not survive ───────────────────────────────
 *
 * The sandbox prescribed six named angles on both sides and drew a tidy grid of
 * them. The real product takes free-form photographs, and `detect-vehicle-damage`
 * pairs them BY INDEX in `uploaded_at` order — it has no idea what a "driver
 * side" is, and `rental_handover_photos.caption` is never read by it.
 *
 * So a shot list here would be decoration over a mechanism that ignores it: six
 * tidy slots implying an alignment the model does not perform. What replaced it
 * is the truth, which turns out to be more useful — the photographs are numbered
 * in the order they will be compared, on both sides, so an operator can see at a
 * glance that shot 3 on the left and shot 3 on the right are the pair the model
 * will look at. Shooting the same angles in the same order is then an obvious
 * thing to do rather than a rule nobody explained.
 */

import { useCallback, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  Camera,
  Check,
  Gauge,
  ImageOff,
  KeyRound,
  Loader2,
  Lock,
  RefreshCw,
  ScanSearch,
  ShieldCheck,
  Sparkles,
  Trash2,
  Undo2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useTenant } from "@/contexts/TenantContext";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Badge } from "@/components/ui-v2/badge";
import { Button } from "@/components/ui-v2/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui-v2/alert-dialog";
import { useRentalSettings } from "@/hooks/use-rental-settings";
import {
  useKeyHandover,
  type HandoverPhoto,
  type HandoverType,
  type KeyHandover,
  type MileageSummary,
} from "@/hooks/use-key-handover";
import {
  useDamageReport,
  useDetectDamage,
  useReviewDamageReport,
  type DamageSeverity,
} from "@/hooks/use-damage-detection";
import type { StageProps } from "./stages";
import {
  fmtDateTime,
  inputCls,
  insetCls,
  listCls,
  money,
  textareaCls,
  ActionButton,
  EmptyHint,
  Field,
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
 * "Keep this report" — the second exit from the amber banner.
 *
 * Held in `localStorage`, keyed on a fingerprint of the drift so that accepting
 * one mismatch cannot silence the next. See the fuller note in
 * `stage-agreement.tsx`; duplicated rather than shared for the reason given
 * there.
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
   Findings
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * A weight ramp, not a colour code.
 *
 * Outline reads lighter than a filled grey, which reads lighter than the
 * destructive tone. Amber is deliberately absent: on this screen it means "out
 * of date" and nothing else, and a moderate scuff is not an out-of-date scuff.
 */
const SEVERITY: Record<DamageSeverity, { label: string; variant: "secondary" | "outline" | "destructive" }> = {
  minor: { label: "Minor", variant: "outline" },
  moderate: { label: "Moderate", variant: "secondary" },
  severe: { label: "Severe", variant: "destructive" },
};

/** The model's own comparison order — `uploaded_at` ascending, as the edge function sorts. */
const inOrder = (photos: HandoverPhoto[]) =>
  photos
    .slice()
    .sort((a, b) => new Date(a.uploaded_at).getTime() - new Date(b.uploaded_at).getTime());

/* ══════════════════════════════════════════════════════════════════════════
   The stage
   ══════════════════════════════════════════════════════════════════════════ */

export function StageHandover({ detail, onStage, refetch }: StageProps) {
  const { tenant } = useTenant();
  const { settings } = useRentalSettings();

  const rental = detail.rental;
  const vehicle = detail.vehicle;

  const {
    givingHandover,
    receivingHandover,
    isLoading,
    uploadPhoto,
    deletePhoto,
    markKeyHanded,
    unmarkKeyHanded,
    updateNotes,
    updateMileage,
    fetchMileageSummary,
    isUploading,
  } = useKeyHandover(rental.id);

  const { data: report } = useDamageReport(rental.id);
  const detect = useDetectDamage(rental.id);
  const review = useReviewDamageReport(rental.id);

  const [confirming, setConfirming] = useState<HandoverType | null>(null);
  const { toast } = useToast();
  /** How the car leaves, chosen in the collection confirm (QA R10.5). */
  const [collectBy, setCollectBy] = useState<"in_person" | "lockbox">("in_person");
  const [sendingCode, setSendingCode] = useState(false);

  /* -- what has to be true before the car goes out (QA R10.1) ------------
     The agreement signed and nothing owed. Before this the stage offered
     "Confirm collection" on any rental, recorded it, and left an unsigned or
     unpaid rental quietly Pending without saying why. */
  const { data: owedCents } = useQuery({
    queryKey: ["handover-owed-v2", rental.id, tenant?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("ledger_entries")
        .select("remaining_amount, category")
        .eq("rental_id", rental.id)
        .eq("tenant_id", tenant!.id)
        .eq("type", "Charge");
      if (error) throw error;
      return (data ?? [])
        .filter((r: any) => r.category !== "Security Deposit")
        .reduce((sum: number, r: any) => sum + Math.round(Number(r.remaining_amount || 0) * 100), 0);
    },
    enabled: !!tenant?.id,
  });
  const signed = ["completed", "signed"].includes(String(rental.document_status ?? "").toLowerCase());
  const missing: { text: string; stage?: "agreement" | "payments" | "customer" | "vehicle" }[] = [];
  if (!detail.customer) missing.push({ text: "No customer is on this rental.", stage: "customer" });
  if (!vehicle) missing.push({ text: "No car is on this rental.", stage: "vehicle" });
  if (!signed)
    missing.push({
      text:
        rental.document_status === "sent" || rental.document_status === "delivered"
          ? "The agreement has been sent but not signed yet."
          : "The agreement has not been signed yet.",
      stage: "agreement",
    });
  if (owedCents === undefined) missing.push({ text: "Checking what is owed..." });
  else if (owedCents > 0)
    missing.push({ text: `${money(owedCents / 100)} is still owed on this rental.`, stage: "payments" });

  const giving = inOrder(givingHandover?.photos ?? []);
  const receiving = inOrder(receivingHandover?.photos ?? []);

  const wentOut = !!givingHandover?.handed_at;
  const cameBack = !!receivingHandover?.handed_at;

  /**
   * The mileage reckoning, which only exists once BOTH readings are in.
   *
   * `fetchMileageSummary` is a plain async function on the hook rather than a
   * query, so it is wrapped here. The key carries both readings: a corrected
   * odometer has to re-run the excess-mileage arithmetic, and keying on the
   * rental alone would leave the old figure on screen after the fix.
   */
  const { data: mileage } = useQuery<MileageSummary | null>({
    queryKey: [
      "handover-mileage-v2",
      rental.id,
      givingHandover?.mileage ?? null,
      receivingHandover?.mileage ?? null,
    ],
    queryFn: fetchMileageSummary,
    enabled: givingHandover?.mileage != null && receivingHandover?.mileage != null,
  });

  /* ── drift on the report ────────────────────────────────────────────── */

  const drift = useMemo<Drift[]>(() => {
    if (!report) return [];
    const out: Drift[] = [];
    if (report.giving_photo_count !== giving.length) {
      out.push({
        label: "Collection set",
        was: `${report.giving_photo_count} photo${report.giving_photo_count === 1 ? "" : "s"}`,
        now: `${giving.length} photo${giving.length === 1 ? "" : "s"}`,
      });
    }
    if (report.receiving_photo_count !== receiving.length) {
      out.push({
        label: "Return set",
        was: `${report.receiving_photo_count} photo${report.receiving_photo_count === 1 ? "" : "s"}`,
        now: `${receiving.length} photo${receiving.length === 1 ? "" : "s"}`,
      });
    }
    return out;
  }, [report, giving.length, receiving.length]);

  const fingerprint = `${report?.id ?? "none"}:${giving.length}-${receiving.length}`;
  const { acknowledged, acknowledge } = useDriftAcknowledgement("damage", fingerprint);
  const showBanner = drift.length > 0 && !acknowledged;

  const canAnalyse = giving.length > 0 && receiving.length > 0;

  /* ── lockbox ────────────────────────────────────────────────────────── */

  const lockboxOn = !!settings?.lockbox_enabled;
  const channels = settings?.lockbox_notification_methods?.length
    ? settings.lockbox_notification_methods
    : ["email"];

  /**
   * Send the lockbox code: v1's send (key-handover-section.tsx) on this stage
   * (QA R10.5). Same edge function, same log rows, same rental flags; the
   * channels are the tenant's setting rather than a per-send override.
   */
  const sendLockboxCode = async (): Promise<boolean> => {
    if (!vehicle?.lockbox_code || !tenant?.id) return false;
    setSendingCode(true);
    const sendEmail = channels.includes("email");
    const sendSms = channels.includes("sms");
    const channel = sendSms && !sendEmail ? "sms" : "email";
    const to = channel === "sms" ? detail.customer?.phone : detail.customer?.email;
    try {
      await supabase.from("rentals").update({ delivery_method: "lockbox" }).eq("id", rental.id).eq("tenant_id", tenant.id);
      const { error } = await supabase.functions.invoke("notify-lockbox-code", {
        body: {
          customerName: detail.customerName ?? detail.customer?.name ?? "",
          customerEmail: detail.customer?.email ?? null,
          customerPhone: detail.customer?.phone ?? null,
          vehicleName: detail.vehicleName ?? `${vehicle.make ?? ""} ${vehicle.model ?? ""}`.trim(),
          vehicleReg: vehicle.reg,
          lockboxCode: vehicle.lockbox_code,
          lockboxInstructions: vehicle.lockbox_instructions || "",
          deliveryAddress: rental.delivery_address || "",
          bookingRef: rental.rental_number ?? "",
          rentalId: rental.id,
          tenantId: tenant.id,
          odometerReading: givingHandover?.mileage ?? null,
          notes: givingHandover?.notes ?? null,
          photoUrls: (givingHandover?.photos ?? []).map((ph) => ph.file_url),
          defaultInstructions: (settings as any)?.lockbox_default_instructions ?? null,
          sendEmail,
          sendSms,
        },
      });
      if (error) {
        await supabase.from("lockbox_send_log").insert({
          rental_id: rental.id,
          tenant_id: tenant.id,
          event_type: "failed",
          channel,
          details: `Send failed: ${error.message || "Unknown error"}`,
        } as any);
        toast({ title: "The code was not sent", description: "Contact the customer another way, or try again.", variant: "destructive" });
        return false;
      }
      await supabase.from("lockbox_send_log").insert({
        rental_id: rental.id,
        tenant_id: tenant.id,
        event_type: wentOut ? "resent" : "sent",
        channel,
        sent_by_name: "Admin",
        details: `Lockbox code sent to ${to || "customer"} via ${channel}`,
      } as any);
      await supabase.from("rentals").update({ lockbox_sent_at: new Date().toISOString() }).eq("id", rental.id).eq("tenant_id", tenant.id);
      toast({ title: "Lockbox code sent", description: `Sent to ${to || "the customer"} by ${channel}.` });
      return true;
    } finally {
      setSendingCode(false);
    }
  };

  /**
   * Collection. v2 has no Approve step, and v1's hook only turns a rental
   * Active when approval_status is "approved" AND payment_status "fulfilled",
   * which a rental made and paid on this screen never gets, so it stayed
   * Pending after the keys went out (QA R10.2). The gate above has already
   * proved what those flags stand for (signed, nothing owed), so they are set
   * here, then the shared hook records the handover and activates.
   */
  const confirmCollection = async () => {
    if (!tenant?.id || missing.length > 0) return;
    if (collectBy === "lockbox" && lockboxOn && vehicle?.lockbox_code) {
      const ok = await sendLockboxCode();
      if (!ok) return;
    } else {
      await supabase.from("rentals").update({ delivery_method: "in_person" }).eq("id", rental.id).eq("tenant_id", tenant.id);
    }
    if (rental.approval_status !== "approved" || rental.payment_status !== "fulfilled") {
      await supabase
        .from("rentals")
        .update({ approval_status: "approved", payment_status: "fulfilled" })
        .eq("id", rental.id)
        .eq("tenant_id", tenant.id);
    }
    markKeyHanded.mutate("giving", { onSuccess: () => refetch() });
  };

  /* ── the panel ──────────────────────────────────────────────────────── */

  if (isLoading) {
    return (
      <Panel title="Handover" description="What the car looked like going out, and coming back.">
        <EmptyHint>Reading the handover records…</EmptyHint>
      </Panel>
    );
  }

  const confirmCopy =
    confirming === "giving"
      ? {
          title: "Confirm the car has gone out?",
          body: `This records the collection against ${
            detail.customerName ?? "this customer"
          }. If the rental is approved and paid, it also turns the rental Active, emails them to say it has started, and places the deposit hold on their card.`,
        }
      : {
          title: "Confirm the car is back?",
          body: "This closes the rental, returns the car to Available, releases any deposit hold, and emails the customer to say the hire is complete.",
        };

  return (
    <Panel
      title="Handover & condition"
      description="What the car looked like when it left, what it looked like when it came back, and what changed in between."
      footer={
        !wentOut ? (
          <ActionButton
            onClick={() => setConfirming("giving")}
            disabled={markKeyHanded.isPending || missing.length > 0}
            title={missing.length > 0 ? `Not yet: ${missing.map((m) => m.text).join(" ")}` : undefined}
          >
            {markKeyHanded.isPending ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <KeyRound className="size-4" />
            )}
            Confirm collection
          </ActionButton>
        ) : !cameBack ? (
          <ActionButton onClick={() => setConfirming("receiving")} disabled={markKeyHanded.isPending}>
            {markKeyHanded.isPending ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <KeyRound className="size-4" />
            )}
            Confirm return
          </ActionButton>
        ) : (
          <ActionButton
            variant="outline"
            onClick={() => onStage("payments")}
          >
            <Check className="size-4" />
            The car is back — settle up
          </ActionButton>
        )
      }
    >
      {!wentOut && missing.length > 0 && (
        <div role="status" className="rounded-3xl border border-warning/40 bg-warning/10 px-5 py-4 text-sm">
          <p className="font-medium">The car can&apos;t go out yet</p>
          <ul className="mt-2 space-y-1.5">
            {missing.map((m) => (
              <li key={m.text} className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span>{m.text}</span>
                {m.stage && (
                  <button
                    type="button"
                    onClick={() => onStage(m.stage!)}
                    className="cursor-pointer text-xs font-medium text-primary underline-offset-2 hover:underline dark:text-[hsl(var(--v2-link,var(--primary)))]"
                  >
                    {m.stage === "agreement"
                      ? "Go to Agreement"
                      : m.stage === "payments"
                        ? "Go to Payments"
                        : m.stage === "customer"
                          ? "Go to Customer"
                          : "Go to Vehicle"}
                  </button>
                )}
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-muted-foreground">
            Confirm collection opens once the agreement is signed and nothing is owed.
          </p>
        </div>
      )}

      {/* ── the two halves ──────────────────────────────────────────────── */}
      <HandoverCard
        kind="giving"
        handover={givingHandover}
        photos={giving}
        locked={false}
        vehicleLabel={detail.vehicleLabel}
        onUpload={(file) => uploadPhoto.mutate({ type: "giving", file })}
        onDelete={(photo) => deletePhoto.mutate(photo)}
        minMileage={vehicle?.current_mileage ?? null}
        minMileageWhy="the car's recorded mileage"
        onMileage={(m) => updateMileage.mutate({ type: "giving", mileage: m })}
        onNotes={(notes) => updateNotes.mutate({ type: "giving", notes })}
        onUndo={() => unmarkKeyHanded.mutate("giving")}
        uploading={isUploading}
        undoing={unmarkKeyHanded.isPending}
      />

      <HandoverCard
        kind="receiving"
        handover={receivingHandover}
        photos={receiving}
        /* You cannot receive a car you never gave — and confirming the return
           first would close the rental before it ever became active. */
        locked={!wentOut}
        vehicleLabel={detail.vehicleLabel}
        onUpload={(file) => uploadPhoto.mutate({ type: "receiving", file })}
        onDelete={(photo) => deletePhoto.mutate(photo)}
        minMileage={givingHandover?.mileage ?? null}
        minMileageWhy="the reading when it went out"
        onMileage={(m) => updateMileage.mutate({ type: "receiving", mileage: m })}
        onNotes={(notes) => updateNotes.mutate({ type: "receiving", notes })}
        onUndo={() => unmarkKeyHanded.mutate("receiving")}
        uploading={isUploading}
        undoing={unmarkKeyHanded.isPending}
      />

      {/* ── the mileage reckoning ───────────────────────────────────────── */}
      {mileage && (
        <Section
          title="Mileage"
          description="Read off the two odometer entries above, against the allowance this rental was sold on."
        >
          <div className="grid gap-2 sm:grid-cols-3">
            <StatBlock
              label="Driven"
              value={`${mileage.milesDriven.toLocaleString("en-US")} mi`}
              hint={`${mileage.pickupMileage.toLocaleString("en-US")} → ${mileage.returnMileage.toLocaleString("en-US")}`}
            />
            <StatBlock
              label={`Allowed · ${mileage.tier}`}
              value={
                mileage.isUnlimited || mileage.allowedMileage === null
                  ? "Unlimited"
                  : `${mileage.allowedMileage.toLocaleString("en-US")} mi`
              }
              hint={mileage.isUnlimited ? "Marked unlimited on this rental" : "Across the whole hire"}
            />
            <StatBlock
              label="Over"
              value={
                mileage.excessMiles > 0 ? `${mileage.excessMiles.toLocaleString("en-US")} mi` : "None"
              }
              hint={
                mileage.excessMiles > 0 && mileage.excessRate != null
                  ? `at ${mileage.excessRate.toFixed(2)} a mile`
                  : "Within the allowance"
              }
              tone={mileage.excessMiles > 0 ? "text-destructive" : "text-success"}
            />
          </div>

          {mileage.chargeAmount != null && mileage.chargeAmount > 0 && (
            <div className="mt-5 rounded-3xl bg-destructive-light px-5 py-4 ring-1 ring-destructive/20">
              <p className="text-sm font-medium text-destructive">
                {money(mileage.chargeAmount)} of excess mileage to collect.
              </p>
              <p className="mt-1 text-xs text-destructive/80">
                Nothing has been charged — raise it on the Payments stage, where it can be taken against a card.
              </p>
            </div>
          )}

          {/* Tesla Supercharger is a lean-hidden area, so this block only ever
              appears for a tenant that has the integration; the hook returns
              undefined otherwise rather than an empty summary. */}
          {mileage.supercharger && mileage.supercharger.chargeCount > 0 && (
            <p className="mt-4 text-xs text-muted-foreground">
              {mileage.supercharger.chargeCount} Supercharger session
              {mileage.supercharger.chargeCount === 1 ? "" : "s"} totalling{" "}
              {money(mileage.supercharger.totalAmount)}
              {mileage.supercharger.pendingCount > 0 &&
                ` · ${mileage.supercharger.pendingCount} still to bill`}
              .
            </p>
          )}
        </Section>
      )}

      {/* ── the analysis ────────────────────────────────────────────────── */}
      <Section
        title="Damage analysis"
        description="The two sets of photographs, compared in the order they were taken."
        right={
          report ? (
            <Badge variant={report.has_new_damage ? "destructive" : "success"} className="gap-1.5">
              {report.has_new_damage ? <AlertTriangle /> : <ShieldCheck />}
              {report.has_new_damage ? "New damage" : "Nothing new"}
            </Badge>
          ) : undefined
        }
      >
        {showBanner && (
          <div className="mb-5">
            <OutOfDateBanner
              title="This analysis was run on a different set of photographs"
              meta={report ? `Run ${fmtDateTime(report.generated_at)}` : undefined}
              drift={drift}
              primaryLabel="Re-run the analysis"
              onPrimary={() => detect.mutate()}
              secondaryLabel="Keep this report"
              onSecondary={acknowledge}
            />
            <p className="mt-2 px-6 text-[11px] text-muted-foreground">
              Keeping it only hides this notice on this browser — there is nowhere on the report to record the
              decision yet. If the photographs change again, it comes back.
            </p>
          </div>
        )}

        {!report ? (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              {canAnalyse
                ? `Ready to compare ${giving.length} collection photo${
                    giving.length === 1 ? "" : "s"
                  } against ${receiving.length} return photo${receiving.length === 1 ? "" : "s"}.`
                : "Photograph the car on both sides of the rental and this unlocks itself. With nothing to compare against, there is nothing to find."}
            </p>
            <Button onClick={() => detect.mutate()} disabled={!canAnalyse || detect.isPending}>
              {detect.isPending ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Sparkles className="size-4" />
              )}
              Analyse the photographs
            </Button>
          </div>
        ) : (
          <div className="space-y-5">
            <div
              className={cn(
                "flex items-start gap-3 rounded-3xl p-5 ring-1",
                report.has_new_damage
                  ? "bg-destructive-light ring-destructive/20"
                  : "bg-success-light ring-success/20"
              )}
            >
              {report.has_new_damage ? (
                <AlertTriangle className="mt-0.5 size-4 shrink-0 text-destructive" />
              ) : (
                <ShieldCheck className="mt-0.5 size-4 shrink-0 text-success" />
              )}
              <div className="min-w-0">
                <p
                  className={cn(
                    "text-sm font-medium",
                    report.has_new_damage ? "text-destructive" : "text-success"
                  )}
                >
                  {report.summary ?? "The comparison returned no summary."}
                </p>
                <p className="mt-1 text-[11px] text-muted-foreground">
                  Run {fmtDateTime(report.generated_at)} · {report.giving_photo_count} before /{" "}
                  {report.receiving_photo_count} after
                  {report.model ? ` · ${report.model}` : ""}
                  {report.reviewed_at && ` · reviewed ${fmtDateTime(report.reviewed_at)}`}
                </p>
              </div>
            </div>

            {(report.findings ?? []).map((f, i) => {
              const sev = SEVERITY[f.severity] ?? SEVERITY.minor;
              return (
                <div key={`${f.location}-${i}`} className={cn(insetCls, "p-5")}>
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant={sev.variant}>{sev.label}</Badge>
                    <span className="text-sm font-medium">{f.location}</span>
                    {f.confidence != null && (
                      <span className="text-xs text-muted-foreground">
                        {Math.round(f.confidence * (f.confidence <= 1 ? 100 : 1))}% confident
                      </span>
                    )}
                  </div>
                  <p className="mt-2 text-sm text-muted-foreground">{f.description}</p>
                  {/* The model anchors each finding to a pair of photograph
                      INDICES. Naming them is what lets an operator go and look
                      at the two pictures it is talking about. */}
                  {(f.before_photo_index != null || f.after_photo_index != null) && (
                    <p className="mt-2 text-[11px] text-muted-foreground">
                      {f.before_photo_index != null && `Collection shot ${f.before_photo_index + 1}`}
                      {f.before_photo_index != null && f.after_photo_index != null && " vs "}
                      {f.after_photo_index != null && `return shot ${f.after_photo_index + 1}`}
                    </p>
                  )}
                </div>
              );
            })}

            {report.reviewer_notes && (
              <div className={cn(insetCls, "px-5 py-4")}>
                <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                  Reviewer&rsquo;s note
                </p>
                <p className="mt-1 text-sm">{report.reviewer_notes}</p>
              </div>
            )}

            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                onClick={() => review.mutate({ reviewerNotes: null })}
                disabled={!!report.reviewed_at || review.isPending}
              >
                <Check className="size-4" />
                {report.reviewed_at ? "Reviewed" : "Mark as reviewed"}
              </Button>
              <Button variant="ghost" onClick={() => detect.mutate()} disabled={detect.isPending}>
                {detect.isPending ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <RefreshCw className="size-4" />
                )}
                Re-run
              </Button>
            </div>

            <p className="text-xs text-muted-foreground">
              A finding is a prompt to go and look, not a verdict. Nothing here charges anybody — an excess is
              raised on the Payments stage.
            </p>
          </div>
        )}
      </Section>

      {/* ── lockbox ─────────────────────────────────────────────────────── */}
      {lockboxOn && (
        <Section
          title="Lockbox"
          description="Self-service collection. The code lives on the car, not on the rental, so it is the same one for every hire of it."
        >
          {vehicle?.lockbox_code ? (
            <>
              <div className={listCls}>
                <div className="flex items-baseline justify-between gap-4 px-5 py-3">
                  <span className="text-xs text-muted-foreground">Code</span>
                  <span className="font-heading text-sm font-semibold tracking-[0.3em]">
                    {vehicle.lockbox_code}
                  </span>
                </div>
                <div className="flex items-baseline justify-between gap-4 px-5 py-3">
                  <span className="shrink-0 text-xs text-muted-foreground">Where it is</span>
                  <span className="min-w-0 text-right text-sm">
                    {vehicle.lockbox_instructions || "Not recorded on the car"}
                  </span>
                </div>
                <div className="flex items-baseline justify-between gap-4 px-5 py-3">
                  <span className="text-xs text-muted-foreground">Sent by</span>
                  <span className="text-sm">{channels.join(" and ")}</span>
                </div>
                <div className="flex items-baseline justify-between gap-4 px-5 py-3">
                  <span className="text-xs text-muted-foreground">This rental</span>
                  <span className="text-sm">
                    {rental.delivery_method === "lockbox"
                      ? "Marked as lockbox collection"
                      : rental.delivery_method === "in_person"
                        ? "Marked as in-person handover"
                        : "No collection method recorded yet"}
                  </span>
                </div>
              </div>

              {/* NOT WIRED, and shown rather than hidden. The send is not one
                  call: it picks channels, can override the address or number,
                  writes a `lockbox_send_log` row, flips
                  `rentals.delivery_method`, and carries the photographs and
                  odometer with it. That flow lives on v1's handover section, and
                  a partial copy of it would be worse than none — this message
                  carries the code that opens the box holding the car keys. */}
              <div className="mt-5">
                <ActionButton
                  variant="outline"
                  disabled={sendingCode || !detail.customer}
                  onClick={() => void sendLockboxCode()}
                >
                  {sendingCode ? <Loader2 className="size-4 animate-spin" /> : <KeyRound className="size-4" />}
                  {wentOut || rental.lockbox_sent_at ? "Send the code again" : "Send the code to the customer"}
                </ActionButton>
              </div>
            </>
          ) : (
            <EmptyHint>
              No lockbox code is set on {detail.vehicleName ?? "this car"}. Set it on the vehicle and it applies to
              every hire of it.
            </EmptyHint>
          )}
        </Section>
      )}

      {/* ── the confirm ─────────────────────────────────────────────────── */}
      <AlertDialog open={confirming !== null} onOpenChange={(open) => !open && setConfirming(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{confirmCopy.title}</AlertDialogTitle>
            {/* Spelled out rather than summarised: confirming a handover emails
                a real customer and moves real money, and an operator should know
                that before pressing it, not after. */}
            <AlertDialogDescription>{confirmCopy.body}</AlertDialogDescription>
          </AlertDialogHeader>
          {confirming === "giving" && lockboxOn && vehicle?.lockbox_code && (
            <div role="radiogroup" aria-label="How is the car collected?" className="space-y-2 text-sm">
              <p className="font-medium">How is the car collected?</p>
              {(["in_person", "lockbox"] as const).map((m) => (
                <label key={m} className="flex cursor-pointer items-start gap-2">
                  <input type="radio" name="collect-by" checked={collectBy === m} onChange={() => setCollectBy(m)} className="mt-1" />
                  <span>
                    {m === "in_person"
                      ? "In person: the keys are handed over at the desk"
                      : `By lockbox: sends code ${vehicle.lockbox_code} for ${vehicle.reg} to ${
                          channels.includes("sms") && !channels.includes("email")
                            ? detail.customer?.phone ?? "the customer"
                            : detail.customer?.email ?? "the customer"
                        }`}
                  </span>
                </label>
              ))}
            </div>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel>Not yet</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (confirming === "giving") void confirmCollection();
                else if (confirming) markKeyHanded.mutate(confirming, { onSuccess: () => refetch() });
                setConfirming(null);
              }}
            >
              {confirming === "giving" ? "The car has gone out" : "The car is back"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Panel>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   One handover
   ══════════════════════════════════════════════════════════════════════════ */

function HandoverCard({
  kind,
  handover,
  photos,
  locked,
  vehicleLabel,
  onUpload,
  onDelete,
  onMileage,
  onNotes,
  onUndo,
  uploading,
  undoing,
  minMileage,
  minMileageWhy,
}: {
  /** The lowest reading that makes sense here (QA R10.4). */
  minMileage?: number | null;
  minMileageWhy?: string;
  kind: HandoverType;
  handover: KeyHandover | undefined;
  /** Already sorted into the order the model will compare them in. */
  photos: HandoverPhoto[];
  locked: boolean;
  vehicleLabel: string | null;
  onUpload: (file: File) => void;
  onDelete: (photo: HandoverPhoto) => void;
  onMileage: (mileage: number | null) => void;
  onNotes: (notes: string) => void;
  onUndo: () => void;
  uploading: boolean;
  undoing: boolean;
}) {
  const giving = kind === "giving";
  const done = !!handover?.handed_at;
  const fileInput = useRef<HTMLInputElement>(null);

  /**
   * Both fields are uncommitted local state until blur.
   *
   * Writing on every keystroke would put one row-update per character on the
   * wire, and — worse for the odometer — would briefly persist "1", then "12",
   * then "123" as real readings that the mileage query would each time recompute
   * an excess charge from.
   */
  const [odometer, setOdometer] = useState(handover?.mileage != null ? String(handover.mileage) : "");
  const [notes, setNotes] = useState(handover?.notes ?? "");

  const [odometerProblem, setOdometerProblem] = useState<string | null>(null);
  const commitOdometer = () => {
    const trimmed = odometer.trim();
    const next = trimmed === "" ? null : Number(trimmed);
    if (next !== null && !Number.isFinite(next)) return;
    /* A reading below the floor is refused, not saved (QA R10.4): it would
       understate the miles driven and the excess charge worked out from them. */
    if (next !== null && (next < 0 || (minMileage != null && next < minMileage))) {
      setOdometerProblem(
        next < 0
          ? "A reading can't be negative. Not saved."
          : `That is below ${minMileageWhy ?? "the last reading"} (${minMileage!.toLocaleString()}). Check the dashboard: the odometer can't go backwards. Not saved.`
      );
      return;
    }
    setOdometerProblem(null);
    if ((handover?.mileage ?? null) !== next) onMileage(next);
  };

  const commitNotes = () => {
    if ((handover?.notes ?? "") !== notes) onNotes(notes);
  };

  return (
    <Surface className={cn(locked && "opacity-60")}>
      <div
        className="mb-5 flex flex-wrap items-center justify-between gap-3"
        data-tour="rental-handover-half"
      >
        <div className="flex items-center gap-2.5">
          <span
            className={cn(
              "flex size-8 items-center justify-center rounded-full",
              done ? "bg-success-light text-success" : "bg-muted text-muted-foreground"
            )}
          >
            {locked ? <Lock className="size-4" /> : <KeyRound className="size-4" />}
          </span>
          <div>
            <p className="font-heading text-sm font-semibold">
              {giving ? "Vehicle collection" : "Vehicle return"}
            </p>
            <p className="text-[11px] text-muted-foreground">
              {giving
                ? "Before the rental — the condition before the keys leave"
                : "After the rental — the condition when the keys come back"}
            </p>
          </div>
        </div>

        {done && handover?.handed_at && (
          <div className="flex items-center gap-2">
            <Pill tone="success">
              <Check />
              {giving ? "Collected" : "Returned"} {fmtDateTime(handover.handed_at)}
            </Pill>
            <Button variant="ghost" size="sm" onClick={onUndo} disabled={undoing}>
              {undoing ? <Loader2 className="size-4 animate-spin" /> : <Undo2 className="size-4" />}
              Undo
            </Button>
          </div>
        )}
      </div>

      {locked ? (
        <p className={cn(insetCls, "px-5 py-4 text-sm text-muted-foreground")}>
          The car has not gone out yet. Confirm the collection above and this opens.
        </p>
      ) : (
        <div className="space-y-6">
          {/* ── the photographs ──────────────────────────────────────────── */}
          <Field
            label={`Photographs — ${photos.length}`}
            hint="Numbered in the order they were taken, which is the order the comparison pairs them in. Shoot the same angles in the same order on both sides and the pairs line up."
          >
            {photos.length === 0 ? (
              <div className={cn(insetCls, "flex items-center gap-3 px-5 py-4")}>
                <ImageOff className="size-4 shrink-0 text-muted-foreground/60" />
                <p className="text-xs text-muted-foreground">
                  Nothing photographed. You can still confirm the handover — but with no photographs on this side
                  there is nothing to compare, and the analysis stays locked.
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                {photos.map((photo, i) => (
                  <div key={photo.id} className="group relative">
                    <a
                      href={photo.file_url}
                      target="_blank"
                      rel="noreferrer"
                      className="block aspect-[4/3] overflow-hidden rounded-3xl bg-muted ring-1 ring-foreground/5"
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={photo.file_url}
                        alt={photo.caption ?? `${giving ? "Collection" : "Return"} photo ${i + 1}`}
                        className="size-full object-cover"
                      />
                    </a>
                    <span className="absolute left-2 top-2 flex size-5 items-center justify-center rounded-full bg-foreground/70 text-[10px] font-semibold text-background">
                      {i + 1}
                    </span>
                    <button
                      type="button"
                      onClick={() => onDelete(photo)}
                      aria-label={`Delete photo ${i + 1}`}
                      className="absolute right-2 top-2 flex size-6 cursor-pointer items-center justify-center rounded-full bg-foreground/70 text-background opacity-0 transition-opacity hover:bg-destructive group-hover:opacity-100"
                    >
                      <Trash2 className="size-3" />
                    </button>
                  </div>
                ))}
              </div>
            )}

            <input
              ref={fileInput}
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={(e) => {
                Array.from(e.target.files ?? []).forEach(onUpload);
                // Cleared so choosing the same file twice still fires a change.
                e.target.value = "";
              }}
            />
            <Button
              variant="outline"
              className="mt-3"
              onClick={() => fileInput.current?.click()}
              disabled={uploading}
            >
              {uploading ? <Loader2 className="size-4 animate-spin" /> : <Camera className="size-4" />}
              Add photographs
            </Button>
          </Field>

          {/* ── odometer + car ───────────────────────────────────────────── */}
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Odometer reading">
              <div className="relative">
                <Gauge className="pointer-events-none absolute left-3.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                <input
                  type="number"
                  value={odometer}
                  onChange={(e) => setOdometer(e.target.value)}
                  onBlur={commitOdometer}
                  placeholder={giving ? "Mileage at pickup" : "Mileage at return"}
                  aria-label={giving ? "Mileage at pickup" : "Mileage at return"}
                  aria-invalid={odometerProblem ? true : undefined}
                  className={cn(inputCls, "pl-9", odometerProblem && "border-destructive")}
                />
              </div>
              {odometerProblem ? (
                <p role="alert" className="mt-1.5 text-xs font-medium text-destructive">
                  {odometerProblem}
                </p>
              ) : minMileage != null ? (
                <p className="mt-1.5 text-xs text-muted-foreground">
                  At least {minMileage.toLocaleString()} ({minMileageWhy}).
                </p>
              ) : null}
            </Field>
            <Field label="Vehicle">
              <div className={cn(inputCls, "items-center bg-muted/40 text-muted-foreground")}>
                {vehicleLabel ?? "No car on this rental"}
              </div>
            </Field>
          </div>

          <Field label="Notes">
            <textarea
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              onBlur={commitNotes}
              placeholder={
                giving
                  ? "Fuel level, existing marks, anything worth recording"
                  : "Condition on return, fuel level, anything the photographs miss"
              }
              className={textareaCls}
            />
          </Field>
        </div>
      )}
    </Surface>
  );
}

export default StageHandover;
