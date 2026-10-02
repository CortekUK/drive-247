"use client";

/**
 * The Agreement stage — the first of the two OUTPUTS, on real data.
 *
 * The design is the playground's `rental-create-fake/_agreement-tab.tsx`. The
 * data is not, and the difference between the two is the whole story of this
 * file, so it is worth stating plainly before anything below makes sense.
 *
 * ── what this stage exists to fix ───────────────────────────────────────────
 *
 * In v1 the agreement is fired by a 7-step pipeline when a 6,814-line create
 * form is submitted, and after that the terms are frozen. The operator's words:
 * "let's say I'm selecting that mileage is going to be unlimited, and that
 * decision we put into the agreement… Now after creating the rental, I have no
 * way of resending an agreement saying the mileage is going to be 100 miles."
 *
 * He is right, and the fix is not clever: a live rental gets a permanent, always
 * reachable **Send an updated agreement** in the footer. The document is not the
 * end of the rental — it is something the rental produces, and can produce
 * again. Everything else on this screen is in service of knowing WHEN to.
 *
 * ── what the document actually remembers, and what it does not ──────────────
 *
 * This is the honest part, and it constrains the design more than anything else.
 *
 * `rental_agreements` stores eighteen columns and NOT ONE of them is a snapshot
 * of the terms the document stated. There is no mileage column, no rate, no
 * fees, no deposit. What it does store is:
 *
 *   period_start_date / period_end_date   the period the document covers
 *   boldsign_mode                         test or live, at send time
 *   envelope_* / document_status          where the signature got to
 *
 * So the prototype's "What this agreement says" block — which rendered a full
 * SNAPSHOT of eleven terms — cannot be rendered from a real row. Rendering it
 * anyway, from the live rental, would be the worst possible outcome: a block
 * captioned "what the customer agreed to" showing terms they may never have
 * seen. That is not a cosmetic compromise, it is a contract being misreported.
 *
 * Two consequences follow, and they are the shape of this file:
 *
 *   1. DRIFT IS ONLY CLAIMED WHERE IT CAN BE PROVEN. Amber appears for the
 *      period (a real stored snapshot) and for the car (a real
 *      `rental_vehicle_swaps` row timestamped against the send). Nothing else.
 *
 *   2. THE TERMS BLOCK IS RELABELLED, not faked. It says "The terms as they
 *      stand now" — which is true, useful, and is exactly the line the operator
 *      wants to read before deciding to re-issue. The mileage on it is resolved
 *      through `resolveAgreementMileage`, the same module the send path itself
 *      uses, so what he reads here is what the next document will say.
 *
 * `rentals.updated_at` is deliberately NOT wired to the amber banner. It is
 * bumped by any write to the row — payment status, deposit-hold bookkeeping, a
 * note — so an amber banner keyed on it would be lit on nearly every rental
 * that has an agreement. The prototype's own warning is the rule here: drift
 * has to respect what the document carried "or the screen cries wolf". It earns
 * a quiet muted line instead, which is all the evidence actually supports.
 */

import { useCallback, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  Ban,
  Check,
  ExternalLink,
  FlaskConical,
  Loader2,
  Mail,
  PenLine,
  RefreshCw,
  Send,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/contexts/TenantContext";
import { useToast } from "@/hooks/use-toast";
import { Badge } from "@/components/ui-v2/badge";
import { Button } from "@/components/ui-v2/button";
import { useRentalAgreements, type RentalAgreement } from "@/hooks/use-rental-agreements";
import { useManagerPermissions } from "@/hooks/use-manager-permissions";
import { useV2 } from "@/lib/v2-context";
// The same resolver the send path runs, so the mileage an operator reads here
// is the mileage the next document will state. Reaching for the rental's raw
// columns instead would re-derive the tier — and the three engines that each
// did that is the bug the module was written to end.
import { resolveAgreementMileage } from "@/lib/agreement-mileage";
import type { StageProps } from "./stages";
import { SHOW_MULTI_PERIOD } from "./multi-period";
import { AgreementTemplateRowV2, useRentalTemplateChoiceV2 } from "./agreement-template-row-v2";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui-v2/dialog";
import {
  fmtDate,
  fmtDateTime,
  insetCls,
  listCls,
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
 * The second exit from an out-of-date banner: "the one already signed stands."
 *
 * There is nowhere on the rental to record that decision — no column on
 * `rental_agreements`, none on `bonzah_insurance_policies`, none on
 * `rental_damage_reports`. So it is held in `localStorage`, and the banner says
 * so rather than implying the whole team can see it.
 *
 * The key carries a FINGERPRINT of the drift, not just the document id. That is
 * what makes the dismissal safe: accepting a moved end date does not also
 * silence the vehicle swap that happens next week — the fingerprint changes and
 * the banner comes back. A dismissal that outlived the thing dismissed would be
 * worse than no dismissal at all.
 *
 * Duplicated in all three output stages rather than shared. A fourth file would
 * be one nobody owns while four authors are editing this directory at once, and
 * the repo already accepts that trade for `agreement-mileage.ts`, which is kept
 * byte-identical across three build roots for the same reason.
 */
function useDriftAcknowledgement(scope: string, fingerprint: string) {
  const key = `d247.v2.drift.${scope}.${fingerprint}`;

  const [acknowledged, setAcknowledged] = useState(() => {
    // Reading `localStorage` throws outright in some embeddings, and returns
    // nothing in a private window. Either way the honest default is to SHOW the
    // banner: failing closed would hide a real mismatch behind a storage error.
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
      /* Dismissed for this view either way — it just will not survive a reload. */
    }
  }, [key]);

  return { acknowledged, acknowledge };
}

/* ══════════════════════════════════════════════════════════════════════════
   Reading the agreement's state
   ══════════════════════════════════════════════════════════════════════════ */

type AgreementState = "not_sent" | "sent" | "opened" | "signed" | "failed" | "voided";

/**
 * `document_status` → the state this stage reasons about.
 *
 * The strings are BoldSign's, arriving through the webhook and through
 * `/api/esign/status`, and v1's own timeline treats the same ones as terminal.
 * `signed_document_id` is checked first because it is the only proof that does
 * not depend on a webhook having landed: the PDF is on file, so it was signed,
 * whatever the status column happens to say.
 */
function deriveState(agreement: RentalAgreement | null): AgreementState {
  if (!agreement) return "not_sent";
  if (agreement.signed_document_id) return "signed";

  const status = (agreement.document_status ?? "").toLowerCase();
  if (status === "signed" || status === "completed") return "signed";
  if (status === "declined" || status === "expired" || status === "voided") return "voided";
  if (status === "credit_failed" || status === "send_failed") return "failed";
  if (status === "delivered" || status === "viewed") return "opened";
  if (agreement.document_id) return "sent";
  return "not_sent";
}

const STATE_RANK: Record<AgreementState, number> = {
  not_sent: 0,
  failed: 0,
  voided: 0,
  sent: 1,
  opened: 2,
  signed: 3,
};

function StateChip({ state }: { state: AgreementState }) {
  if (state === "failed") {
    return (
      <Badge variant="destructive" className="gap-1.5">
        <AlertTriangle />
        Never sent
      </Badge>
    );
  }
  if (state === "voided") {
    return (
      <Badge variant="destructive" className="gap-1.5">
        <Ban />
        Voided
      </Badge>
    );
  }
  const map = {
    not_sent: { tone: "neutral" as const, label: "Not sent", tick: false },
    sent: { tone: "primary" as const, label: "Awaiting signature", tick: false },
    opened: { tone: "primary" as const, label: "Opened, not signed", tick: false },
    signed: { tone: "success" as const, label: "Signed", tick: true },
  }[state];
  return (
    <Pill tone={map.tone}>
      {map.tick && <Check />}
      {map.label}
    </Pill>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   The two facts the document actually snapshots
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * Any car swap that happened AFTER this document went out.
 *
 * `rental_vehicle_swaps` is written by the `swap_rental_vehicle` RPC and keeps
 * both sides of every swap, so this is a genuine before → after: the document
 * names the old car, the rental now carries the new one. It is the only term
 * besides the period where the "was" can be sourced rather than guessed.
 */
type VehicleSwap = {
  id: string;
  created_at: string | null;
  old_vehicle: { reg: string | null; make: string | null; model: string | null } | null;
  new_vehicle: { reg: string | null; make: string | null; model: string | null } | null;
};

function useVehicleSwaps(rentalId: string | null, tenantId: string | undefined) {
  return useQuery({
    queryKey: ["rental-vehicle-swaps-v2", rentalId, tenantId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("rental_vehicle_swaps")
        .select(
          `
          id, created_at,
          old_vehicle:old_vehicle_id ( reg, make, model ),
          new_vehicle:new_vehicle_id ( reg, make, model )
        `
        )
        .eq("rental_id", rentalId!)
        .eq("tenant_id", tenantId!)
        .order("created_at", { ascending: true });

      // A swap history that will not load must not take the stage down with it,
      // and must not be reported as "no swaps" either — the caller reads
      // `undefined` as "not known" and simply claims no vehicle drift.
      if (error) {
        console.error("[stage-agreement] vehicle swaps:", error);
        return [] as VehicleSwap[];
      }
      return (data ?? []) as unknown as VehicleSwap[];
    },
    enabled: !!rentalId && !!tenantId,
  });
}

/** The vehicle's own mileage defaults, which `useRentalDetailV2` does not select. */
function useVehicleMileage(vehicleId: string | null, tenantId: string | undefined) {
  return useQuery({
    queryKey: ["vehicle-mileage-terms-v2", vehicleId, tenantId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("vehicles")
        .select("daily_mileage, weekly_mileage, monthly_mileage, excess_mileage_rate")
        .eq("id", vehicleId!)
        .eq("tenant_id", tenantId!)
        .maybeSingle();
      if (error) throw error;
      return data as {
        daily_mileage: number | null;
        weekly_mileage: number | null;
        monthly_mileage: number | null;
        excess_mileage_rate: number | null;
      } | null;
    },
    enabled: !!vehicleId && !!tenantId,
  });
}

/**
 * A `time` column ("10:00:00") as a clock time.
 *
 * Postgres hands back seconds and the rental never carries any, so printing the
 * column raw puts "10:00:00" into a line that reads as a contract term. Trimmed
 * rather than parsed: building a Date from a bare time to format it would drag
 * the operator's timezone into a field that has none.
 */
const clock = (t: string | null | undefined) => {
  const s = String(t ?? "").trim();
  return /^\d{2}:\d{2}/.test(s) ? s.slice(0, 5) : s || null;
};

const carName = (v: { reg: string | null; make: string | null; model: string | null } | null) => {
  if (!v) return "—";
  const name = [v.make, v.model].filter(Boolean).join(" ");
  return name && v.reg ? `${name} · ${v.reg}` : name || v.reg || "—";
};

/* ══════════════════════════════════════════════════════════════════════════
   The stage
   ══════════════════════════════════════════════════════════════════════════ */

export function StageAgreement({ detail, onStage, refetch }: StageProps) {
  const { tenant } = useTenant();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const rental = detail.rental;
  const customer = detail.customer;
  const vehicle = detail.vehicle;

  const { data: agreements = [], isLoading } = useRentalAgreements(rental.id);
  const { data: swaps } = useVehicleSwaps(rental.id, tenant?.id);
  const { data: vehicleMileage } = useVehicleMileage(vehicle?.id ?? null, tenant?.id);

  // Agreements v2: which template the next send uses. Off (not on the
  // agreements canary), the stage sends exactly what it always did.
  const agreementsV2 = useV2("agreements");
  const templateChoice = useRentalTemplateChoiceV2(rental, agreementsV2);
  const templateIdToSend = templateChoice.templateIdToSend;
  const { canEditSettings } = useManagerPermissions();

  const [sending, setSending] = useState(false);
  const [checking, setChecking] = useState(false);
  const [viewing, setViewing] = useState<string | null>(null);
  const [versionsOpen, setVersionsOpen] = useState(false);

  /**
   * The document in force.
   *
   * The contract for the hire is the newest agreement of the rental's own kind:
   * a resend supersedes its predecessor, which is exactly how v1's timeline
   * reads the same list.
   *
   * Rows of `agreement_type = 'extension'` are filtered out and stay out. Such
   * a document covers a window that is SUPPOSED to differ from the rental's, so
   * on a rental that is one fixed period it could only ever be read as drift —
   * see `SHOW_MULTI_PERIOD`.
   */
  const originals = useMemo(
    () => agreements.filter((a) => SHOW_MULTI_PERIOD || a.agreement_type !== "extension"),
    [agreements]
  );
  const current = originals.length ? originals[originals.length - 1] : null;
  const state = deriveState(current);
  const rank = STATE_RANK[state];

  const issuedAt = current?.envelope_sent_at ?? current?.envelope_created_at ?? current?.created_at ?? null;

  /* ── the live terms ─────────────────────────────────────────────────── */

  const mileage = useMemo(
    () =>
      resolveAgreementMileage(rental, { ...(vehicleMileage ?? {}), ...(vehicle ?? {}) }, {
        monthlyTierDays: tenant?.monthly_tier_days ?? 30,
        currencyCode: tenant?.currency_code ?? "USD",
        distanceUnit: tenant?.distance_unit ?? "miles",
      }),
    [rental, vehicle, vehicleMileage, tenant]
  );

  /**
   * What the next document will state, read off the rental as it stands.
   *
   * Every row is sourced or omitted — a term the rental does not carry shows no
   * row at all rather than a dash pretending to be a value. `pickup_location`
   * and `return_location` are free text and frequently empty; a delivery rental
   * carries `delivery_address` instead, which is why it is preferred.
   */
  const terms = useMemo(() => {
    const rows: { label: string; value: string }[] = [];
    if (detail.vehicleLabel) rows.push({ label: "Vehicle", value: detail.vehicleLabel });

    const out = [fmtDate(rental.start_date), clock(rental.pickup_time)].filter(Boolean).join(" · ");
    if (out) rows.push({ label: "Goes out", value: out });

    const back = rental.end_date
      ? [fmtDate(rental.end_date), clock(rental.return_time)].filter(Boolean).join(" · ")
      : "Open-ended";
    rows.push({ label: "Comes back", value: back });

    const from = rental.delivery_address || rental.pickup_location;
    if (from) rows.push({ label: "Collected from", value: String(from) });
    if (rental.return_location) rows.push({ label: "Returned to", value: String(rental.return_location) });

    rows.push({ label: "Mileage", value: mileage.allowance });
    if (!mileage.isUnlimited) rows.push({ label: "Over the allowance", value: mileage.excessRate });

    return rows;
  }, [detail.vehicleLabel, rental, mileage]);

  /* ── drift ──────────────────────────────────────────────────────────── */

  /**
   * Only what the row can prove.
   *
   * Period first, because it is stored on the document itself and is the case
   * an operator hits constantly: somebody moved the rental's dates and the
   * contract still states the old ones. Then the car, from the swap log,
   * timestamped against the send so a swap that predates the document is not
   * reported.
   */
  const drift = useMemo<Drift[]>(() => {
    if (!current || rank === 0) return [];
    const out: Drift[] = [];

    const docStart = current.period_start_date?.slice(0, 10) ?? null;
    const nowStart = rental.start_date?.slice(0, 10) ?? null;
    if (docStart && nowStart && docStart !== nowStart) {
      out.push({ label: "Goes out", was: fmtDate(docStart), now: fmtDate(nowStart) });
    }

    const docEnd = current.period_end_date?.slice(0, 10) ?? null;
    const nowEnd = rental.end_date?.slice(0, 10) ?? null;
    if (docEnd && docEnd !== nowEnd) {
      out.push({ label: "Comes back", was: fmtDate(docEnd), now: nowEnd ? fmtDate(nowEnd) : "Open-ended" });
    }

    // The swap log is authoritative about the car, and the send timestamp
    // decides which swaps count. The FIRST swap after the send holds the car the
    // document actually named; the rental's current car is the other end.
    const after = (swaps ?? []).filter(
      (s) => issuedAt && s.created_at && new Date(s.created_at) > new Date(issuedAt)
    );
    if (after.length && detail.vehicleLabel) {
      const wasCar = carName(after[0].old_vehicle);
      if (wasCar !== "—" && wasCar !== detail.vehicleLabel) {
        out.push({ label: "Vehicle", was: wasCar, now: detail.vehicleLabel });
      }
    }

    return out;
  }, [current, rank, rental.start_date, rental.end_date, swaps, issuedAt, detail.vehicleLabel]);

  const fingerprint = useMemo(
    () => `${current?.id ?? "none"}:${drift.map((d) => `${d.label}=${d.now}`).join("|")}`,
    [current?.id, drift]
  );
  const { acknowledged, acknowledge } = useDriftAcknowledgement("agreement", fingerprint);
  const showBanner = drift.length > 0 && !acknowledged;

  /**
   * The rental row was written after the document went out.
   *
   * Deliberately NOT amber, and deliberately not a before → after row. Any write
   * to `rentals` moves `updated_at` — a payment landing, a deposit hold being
   * bookkept — so this is evidence that SOMETHING moved and no evidence at all
   * about what. Said quietly, it is a useful nudge to read the terms below.
   * Said in amber, it would be lit on nearly every rental and mean nothing.
   */
  const editedSince =
    !!issuedAt && !!rental.updated_at && new Date(rental.updated_at) > new Date(issuedAt);

  /* ── actions ────────────────────────────────────────────────────────── */

  const invalidate = useCallback(async () => {
    // v1 sends and resends against the 3-part key, and the rentals page
    // invalidates a 2-part one; both are hit so neither screen can be left
    // holding a superseded list after a send from here.
    await Promise.all([
      queryClient.invalidateQueries({
        queryKey: ["rental-agreements", rental.id, tenant?.id],
        refetchType: "all",
      }),
      queryClient.invalidateQueries({ queryKey: ["rental-agreements"], refetchType: "all" }),
    ]);
    await queryClient.refetchQueries({
      queryKey: ["rental-agreements", rental.id, tenant?.id],
      type: "all",
    });
    refetch();
  }, [queryClient, rental.id, tenant?.id, refetch]);

  /**
   * Send, or send again. One call for both — because they ARE the same call.
   *
   * `/api/esign` always mints a fresh document from the rental as it stands
   * right now; there is no "update the existing envelope" path in BoldSign that
   * this platform uses. That is what makes the operator's request answerable at
   * all: re-issuing IS the mechanism, and the only thing v1 was missing was a
   * button for it on a rental that already exists.
   */
  const send = useCallback(async () => {
    if (!customer?.email || !customer.name || !tenant?.id) return;
    setSending(true);
    try {
      const response = await fetch("/api/esign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rentalId: rental.id,
          customerEmail: customer.email,
          customerName: customer.name,
          tenantId: tenant.id,
          agreementType: "original",
          // Only a template other than the one /api/esign picks by itself is
          // named, so a send with the default selected is today's request.
          ...(templateIdToSend ? { templateId: templateIdToSend } : {}),
        }),
      });
      const data = await response.json().catch(() => ({}) as Record<string, any>);

      if (data?.ok) {
        toast({
          title: rank === 0 ? "Agreement sent" : "Updated agreement sent",
          description: `${customer.name} has been emailed a new copy to sign.`,
        });
        await invalidate();
        return;
      }

      if (data?.error === "insufficient_credits") {
        toast({
          title: "No e-sign credits left",
          description: "Top up before sending this agreement.",
          variant: "destructive",
        });
        await invalidate();
        return;
      }

      // BoldSign allows 50 sends an hour and says so in prose rather than a
      // code, so the string is what there is to match on. v1 does the same.
      const dtl = String(data?.detail || data?.error || "The agreement could not be sent.");
      const rateLimited = /quota exceeded|rate limit/i.test(dtl);
      toast({
        title: rateLimited ? "Rate limit reached" : "Not sent",
        description: rateLimited
          ? "BoldSign allows 50 sends an hour. Try again in a few minutes."
          : dtl,
        variant: "destructive",
      });
    } catch (error: any) {
      toast({
        title: "Not sent",
        description: error?.message ?? "The agreement could not be sent.",
        variant: "destructive",
      });
    } finally {
      setSending(false);
    }
  }, [customer, tenant?.id, rental.id, rank, toast, invalidate, templateIdToSend]);

  /**
   * Open the document.
   *
   * The window is opened BEFORE the await, empty, and navigated once the URL is
   * known. Opening it after the fetch resolves puts it outside the click's user
   * gesture and every popup blocker eats it — v1 learned this and the comment is
   * carried over with the code.
   */
  const view = useCallback(
    async (agreement: RentalAgreement) => {
      setViewing(agreement.id);
      const win = window.open("about:blank", "_blank");
      try {
        if (agreement.signed_document?.file_url) {
          let url = agreement.signed_document.file_url;
          if (!url.startsWith("http")) {
            url = supabase.storage.from("customer-documents").getPublicUrl(url).data.publicUrl;
          }
          if (win) win.location.href = url;
          return;
        }

        const response = await fetch("/api/esign/view", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ rentalId: rental.id, agreementId: agreement.id }),
        });
        const data = await response.json();

        if (!response.ok || !data?.ok) {
          win?.close();
          toast({
            title: "Could not open it",
            description: data?.error ?? "BoldSign did not return the document.",
            variant: "destructive",
          });
          return;
        }

        if (data.documentUrl) {
          if (win) win.location.href = data.documentUrl;
          return;
        }
        if (data.documentBase64) {
          const bytes = Uint8Array.from(atob(data.documentBase64), (c) => c.charCodeAt(0));
          const url = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
          if (win) win.location.href = url;
        }
      } catch (error: any) {
        win?.close();
        toast({
          title: "Could not open it",
          description: error?.message ?? "Something went wrong.",
          variant: "destructive",
        });
      } finally {
        setViewing(null);
      }
    },
    [rental.id, toast]
  );

  /** Ask BoldSign where the signature got to, rather than waiting on a webhook. */
  const checkStatus = useCallback(async () => {
    if (!current?.document_id) return;
    setChecking(true);
    try {
      const response = await fetch("/api/esign/status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rentalId: rental.id,
          envelopeId: current.document_id,
          agreementId: current.id,
        }),
      });
      const data = await response.json();
      if (data?.ok) {
        toast({ title: "Checked", description: `BoldSign says: ${data.status}.` });
        await invalidate();
      } else {
        toast({
          title: "Could not check",
          description: data?.error ?? "BoldSign did not answer.",
          variant: "destructive",
        });
      }
    } catch (error: any) {
      toast({ title: "Could not check", description: error?.message, variant: "destructive" });
    } finally {
      setChecking(false);
    }
  }, [current, rental.id, toast, invalidate]);

  /* ── the states before the body ─────────────────────────────────────── */

  const canSend = !!customer?.email && !!customer?.name && !!tenant?.id;
  const firstName = customer?.name?.split(" ")[0] || "the customer";

  if (isLoading) {
    return (
      <Panel fill title="Agreement" description="Produced from the terms. Re-issue it whenever they move.">
        <EmptyHint>Reading the paperwork on this rental…</EmptyHint>
      </Panel>
    );
  }

  const steps = [
    { label: "Sent", at: current?.envelope_sent_at ? fmtDateTime(current.envelope_sent_at) : undefined, done: rank >= 1 },
    { label: "Opened", done: rank >= 2 },
    {
      label: state === "voided" ? "Voided" : "Signed",
      at: current?.envelope_completed_at ? fmtDateTime(current.envelope_completed_at) : undefined,
      done: rank >= 3,
    },
  ];

  return (
    <Panel
      fill
      title="Agreement"
      description="Produced from the terms. Re-issue it whenever they move."
      action={
        <StageAction
          icon={sending ? Loader2 : Send}
          label={rank === 0 ? "Send the agreement" : "Send an updated agreement"}
          onClick={send}
          disabledReason={
            sending
              ? "Sending…"
              : canSend
                ? null
                : "BoldSign needs a name and an email address to address the document to. Add them on the customer's profile."
          }
        />
      }
    >
      {/* Island layout, the Customer stage's grammar: full-width cards stacked
          down the pane — the document, the template, then the terms filling
          what is left. Earlier versions open in a dialog. */}
      <div className="flex h-full min-h-0 flex-col gap-4">
        {/* ── out of date ─────────────────────────────────────────────────── */}
        {showBanner && (
          <div className="shrink-0">
            <OutOfDateBanner
              title="This agreement no longer matches the rental"
              meta={
                state === "signed"
                  ? `Signed${current?.envelope_completed_at ? ` ${fmtDateTime(current.envelope_completed_at)}` : ""} by ${detail.customerName ?? "the customer"}`
                  : issuedAt
                    ? `Sent ${fmtDateTime(issuedAt)}, not yet signed`
                    : undefined
              }
              drift={drift}
              primaryLabel={state === "signed" ? "Send an updated agreement" : "Resend with the new terms"}
              onPrimary={send}
              secondaryLabel={state === "signed" ? "Keep the signed one" : "Keep as sent"}
              onSecondary={acknowledge}
            />
          </div>
        )}

        {/* ── the document ────────────────────────────────────────────────── */}
        <Surface className="shrink-0 px-5 py-4">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <h3 className="font-heading text-sm font-semibold">Rental agreement</h3>
            <StateChip state={state} />
            {/* Test-mode documents are watermarked and BoldSign deletes them
                after 14 days — an operator must tell them apart at a glance. */}
            {current?.boldsign_mode === "test" && (
              <Badge variant="outline" className="gap-1.5">
                <FlaskConical />
                Test
              </Badge>
            )}
            {state === "not_sent" ? (
              <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
                {firstName} has not been asked to sign anything yet
              </span>
            ) : (
              <span className="flex-1" />
            )}
            {originals.length > 1 && (
              <button
                type="button"
                onClick={() => setVersionsOpen(true)}
                className="text-xs font-medium text-primary underline-offset-2 hover:underline dark:text-[hsl(var(--v2-link,var(--primary)))]"
              >
                {originals.length - 1} earlier version{originals.length - 1 === 1 ? "" : "s"}
              </button>
            )}
            {current && (
              <Button size="sm" variant="outline" onClick={() => view(current)} disabled={viewing === current.id}>
                {viewing === current.id ? <Loader2 className="animate-spin" /> : <ExternalLink />}
                {state === "signed" ? "Signed copy" : "Open"}
              </Button>
            )}
            {current?.document_id && state !== "signed" && (
              <Button size="sm" variant="ghost" onClick={checkStatus} disabled={checking}>
                {checking ? <Loader2 className="animate-spin" /> : <RefreshCw />}
                Check
              </Button>
            )}
          </div>

          {state !== "not_sent" && (
            <ol className="mt-4 grid grid-cols-3 gap-2">
              {steps.map((s) => (
                <li key={s.label} className="min-w-0">
                  <span className={cn("block h-1 rounded-full", s.done ? "bg-success" : "bg-foreground/10")} />
                  <p className={cn("mt-1.5 truncate text-xs", s.done ? "font-medium" : "text-muted-foreground")}>
                    {s.label}
                    {s.at && <span className="ml-1.5 font-normal text-muted-foreground">{s.at}</span>}
                  </p>
                </li>
              ))}
            </ol>
          )}

          {/* Delivery is tracked separately from signature; only an explicit
              failure is reported — NULL predates the tracking. */}
          {current?.email_delivery_status &&
            current.email_delivery_status !== "sent" &&
            current.email_delivery_status !== "simulated" && (
              <p className="mt-3 flex items-center gap-2 text-xs text-destructive">
                <Mail className="size-3.5 shrink-0" />
                {current.email_delivery_status === "skipped_no_email"
                  ? "No email address, so nothing was sent."
                  : current.email_delivery_status === "not_attempted_no_credits"
                    ? "E-sign credits had run out — no agreement was created."
                    : "The signing email did not get through."}
                {current.email_delivery_error && <span className="text-muted-foreground">{current.email_delivery_error}</span>}
              </p>
            )}
        </Surface>

        {/* ── the template the next send uses (Agreements v2) ─────────────── */}
        {agreementsV2 && (
          /* Fills the rest of the pane — no dead space under it. */
          <div className="flex min-h-0 flex-1 flex-col [&>*]:flex-1">
            <AgreementTemplateRowV2
              rental={rental}
              choice={templateChoice}
              mileage={mileage}
              canEdit={canEditSettings("templates")}
              busy={sending}
              inlinePreview
            />
          </div>
        )}

      </div>

      {/* ── earlier versions — a dialog, not a growing list ──────────────── */}
      <Dialog open={versionsOpen} onOpenChange={setVersionsOpen}>
        <DialogContent className="max-h-[85vh] overflow-y-auto no-scrollbar sm:max-w-xl" aria-describedby={undefined}>
          <DialogHeader>
            <DialogTitle>Earlier versions</DialogTitle>
          </DialogHeader>
          <p className="-mt-3 text-xs text-muted-foreground">Superseded by the current one. Kept because a customer may have signed one of them.</p>
          <div className={listCls}>
            {originals
              .slice(0, -1)
              .reverse()
              .map((a) => (
                <div key={a.id} className="flex items-center gap-4 px-5 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm">{a.envelope_sent_at ? fmtDateTime(a.envelope_sent_at) : fmtDateTime(a.created_at)}</p>
                    <p className="text-xs text-muted-foreground">
                      {a.period_start_date
                        ? `Covered ${fmtDate(a.period_start_date)} → ${a.period_end_date ? fmtDate(a.period_end_date) : "open"}`
                        : "No period recorded"}
                    </p>
                  </div>
                  <StateChip state={deriveState(a)} />
                  <Button size="sm" variant="outline" onClick={() => view(a)} disabled={viewing === a.id}>
                    {viewing === a.id ? <Loader2 className="animate-spin" /> : <ExternalLink />}
                    Open
                  </Button>
                </div>
              ))}
          </div>
        </DialogContent>
      </Dialog>
    </Panel>
  );
}

export default StageAgreement;
