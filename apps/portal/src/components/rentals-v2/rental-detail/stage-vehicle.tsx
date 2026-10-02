"use client";

/**
 * The Vehicle stage of the rental control centre — real data, real actions.
 *
 * LAYOUT (Oct 2026, island UI — the Customer stage's grammar): three stacked
 * cards — a slim identity strip (Open vehicle for the full file), a mileage
 * card and a pricing card (the same three tiers each, this hire marked)
 * stacked on the left, the car's photos on the right — four sections. Mileage
 * and pricing are read-only for now. The pane never scrolls.
 *
 * CHANGING THE CAR is "Clear vehicle" on the description line, exactly where
 * Customer has "Clear customer". It does not open a dialog: the stage turns
 * into an in-pane picker (`vehicle-picker.tsx`) — search, an illustrated empty
 * state, then a list that says per car whether it is free for these dates.
 * Saving is v1's `swap_rental_vehicle` RPC via `useVehicleSwap`, which moves
 * the car, frees the old one and records the swap. It does NOT re-price the
 * rental. Allowed while the rental is pending or active (a car can be swapped
 * mid-hire, e.g. a breakdown); a closed rental's car is a matter of record.
 *
 * What survives from the prototype is its SELECTED view, which was always the
 * interesting half: which car went out, and what mileage it went out on.
 *
 * ── why mileage lives here ─────────────────────────────────────────────────
 *
 * Mileage is not a setting of the rental — it is a property of the car, resolved
 * for this hire. Which tier applies depends on how long the rental runs, so the
 * answer moves when the dates move; and the allowance itself can be overridden
 * per rental. It is unanswerable until a car exists, and it is the only question
 * choosing a car actually opens. So it sits on this stage and nowhere else.
 *
 * The resolution is `@/lib/agreement-mileage` — the SAME module that writes the
 * mileage line into the signed agreement (and which is duplicated byte-for-byte
 * into booking and the edge functions). Using it here means the screen an
 * operator reads and the document a customer signs cannot state different terms,
 * and it carries the safety rule with it: an unconfigured allowance renders
 * "Not specified", NEVER "Unlimited".
 *
 * ── what is NOT here ───────────────────────────────────────────────────────
 *
 * The car's lifetime facts — service history, MOT, ownership, the whole photo
 * gallery, its other rentals — are on `/vehicles/<id>`, and there is one link to
 * it. This stage answers a question about THIS rental.
 *
 * Money is also absent on purpose. The rate that priced this rental and what is
 * owed on it belong to the Payments stage; quoting the car's list rate here
 * would give an operator two figures to disagree with each other.
 *
 * The odometer readings taken at handover are the Handover stage's — this stage
 * carries the TERMS the car goes out on, not the event.
 */

import { useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Car, ExternalLink, Gauge, Image as ImageIcon, Undo2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/contexts/TenantContext";
import { useManagerPermissions } from "@/hooks/use-manager-permissions";
import { formatCurrency, formatDistance, type DistanceUnit } from "@/lib/format-utils";
import { resolveAgreementMileage } from "@/lib/agreement-mileage";
import { getUnlimitedMileageOption } from "@/lib/mileage-utils";
import { Button } from "@/components/ui-v2/button";
import type { StageProps } from "./stages";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui-v2/hover-card";
import { VehiclePicker } from "./vehicle-picker";
import { insetCls, EmptyHint, HeroChip, Panel, Pill, StageAction, Surface } from "./_kit";

/* ══════════════════════════════════════════════════════════════════════════
   The car's own row
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * The columns this stage needs that the rental's join does not carry.
 *
 * `use-rental-detail-v2` selects the vehicle fields every stage shares (plate,
 * make, model, the three rents, the lockbox). The mileage configuration and the
 * cover photo are this stage's alone, so they are read here rather than widened
 * into the shared join — where seven other stages would pay for them on every
 * screen.
 *
 * This is the same scoped read `MileageSummaryCard` already does for v1
 * (`["vehicle-mileage", vehicleId]`), with the presentational columns added and
 * the `tenant_id` filter made unconditional rather than optional.
 */
type VehicleFacts = {
  id: string;
  photo_url: string | null;
  colour: string | null;
  fuel_type: string | null;
  category: string | null;
  current_mileage: number | null;
  daily_mileage: number | null;
  weekly_mileage: number | null;
  monthly_mileage: number | null;
  excess_mileage_rate: number | null;
  unlimited_mileage_available: boolean | null;
  unlimited_mileage_price_daily: number | string | null;
  unlimited_mileage_price_weekly: number | string | null;
  unlimited_mileage_price_monthly: number | string | null;
};

function useVehicleFacts(vehicleId: string | null) {
  const { tenant } = useTenant();

  return useQuery({
    queryKey: ["rental-stage-vehicle-facts", tenant?.id, vehicleId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("vehicles")
        .select(
          `id, photo_url, colour, fuel_type, category, current_mileage,
           daily_mileage, weekly_mileage, monthly_mileage, excess_mileage_rate,
           unlimited_mileage_available, unlimited_mileage_price_daily,
           unlimited_mileage_price_weekly, unlimited_mileage_price_monthly`
        )
        .eq("id", vehicleId!)
        .eq("tenant_id", tenant!.id)
        .maybeSingle();

      if (error) throw error;
      return (data as VehicleFacts | null) ?? null;
    },
    enabled: !!vehicleId && !!tenant?.id,
  });
}

/* ══════════════════════════════════════════════════════════════════════════
   What the terms actually cost
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * The excess-mileage charge on this rental, if the hire ran over.
 *
 * Terms with no outcome are half an answer on a rental that is already back, so
 * the stage that states the allowance also states what going past it came to.
 * The money itself — what has been paid against it — stays on the Payments
 * stage, and this block says so rather than quoting a balance that could
 * disagree with it.
 *
 * v1 reads the same row (`mileage-summary-card.tsx:135`) with `.maybeSingle()`.
 * Summed here instead: `maybeSingle` throws outright if a second row ever
 * exists, and a total is the same number when there is only one.
 */
function useExcessMileageCharge(rentalId: string) {
  return useQuery({
    queryKey: ["rental-stage-excess-mileage", rentalId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("ledger_entries")
        .select("id, amount, remaining_amount")
        .eq("rental_id", rentalId)
        .eq("type", "Charge")
        .eq("category", "Excess Mileage");

      if (error) throw error;
      const rows = (data ?? []) as { amount: number; remaining_amount: number }[];
      if (rows.length === 0) return null;
      return {
        amount: rows.reduce((s, r) => s + Number(r.amount || 0), 0),
        remaining: rows.reduce((s, r) => s + Number(r.remaining_amount || 0), 0),
      };
    },
    enabled: !!rentalId,
  });
}

/* ══════════════════════════════════════════════════════════════════════════
   The stage
   ══════════════════════════════════════════════════════════════════════════ */

const TIER_WORD = { daily: "day", weekly: "week", monthly: "month" } as const;
/** For the slim tier lines, where every character counts. */
const TIER_SHORT = { daily: "day", weekly: "wk", monthly: "mo" } as const;

export function StageVehicle({ detail, refetch }: StageProps) {
  const { tenant } = useTenant();
  const { canEdit } = useManagerPermissions();
  /** Cleared: the stage shows the picker instead of the car. Nothing is written until a pick. */
  const [picking, setPicking] = useState(false);

  const vehicle = detail.vehicle;
  const { data: facts, isLoading: factsLoading } = useVehicleFacts(vehicle?.id ?? null);
  const { data: excessCharge } = useExcessMileageCharge(detail.rental.id);
  const { data: photos } = useVehiclePhotos(vehicle?.id ?? null);

  const currency = tenant?.currency_code || "USD";
  const distanceUnit = (tenant?.distance_unit || "miles") as DistanceUnit;
  const monthlyTierDays = tenant?.monthly_tier_days ?? 30;

  /* No car yet: a rental started from "New Rental" (a draft — Pending, no
     customer or car) is created empty and filled in here. The stage IS the
     picker until a car is chosen; picking goes through the same swap path. */
  if (!vehicle) {
    return (
      <Panel fill title="Vehicle" description="Which car goes out? Pick one to put it on this rental.">
        <VehiclePicker
          rentalId={detail.rental.id}
          currentVehicleId={null}
          startDate={detail.rental.start_date ? String(detail.rental.start_date).slice(0, 10) : null}
          endDate={detail.rental.end_date ? String(detail.rental.end_date).slice(0, 10) : null}
          onDone={(changed) => {
            if (changed) refetch();
          }}
        />
      </Panel>
    );
  }

  const name = detail.vehicleName ?? vehicle.reg;

  /* The mileage answer, resolved exactly as the agreement resolves it. The
     rental row carries the overrides and the unlimited flag; the vehicle row
     carries the defaults AND the three rents, which the resolver reads only to
     pick the billing tier — a car with no monthly rate is billed weekly on a
     40-day hire, and the allowance has to follow the money. */
  const mileage = resolveAgreementMileage(
    detail.rental,
    facts
      ? {
          daily_mileage: facts.daily_mileage,
          weekly_mileage: facts.weekly_mileage,
          monthly_mileage: facts.monthly_mileage,
          excess_mileage_rate: facts.excess_mileage_rate,
          daily_rent: vehicle.daily_rent,
          weekly_rent: vehicle.weekly_rent,
          monthly_rent: vehicle.monthly_rent,
        }
      : null,
    { monthlyTierDays, currencyCode: currency, distanceUnit: distanceUnit }
  );

  const rental = detail.rental;

  /** An allowance set for THIS rental rather than inherited from the car. */
  const overridden =
    rental.daily_mileage_override != null ||
    rental.weekly_mileage_override != null ||
    rental.monthly_mileage_override != null ||
    rental.excess_mileage_rate_override != null;

  /* The unlimited upgrade the CAR offers, priced for this hire's tier. Shown
     only to explain what was on the table — it cannot be taken from here, see
     the note on the disabled action below. */
  const upgrade = facts
    ? getUnlimitedMileageOption(facts, Math.max(1, detail.days ?? 1), monthlyTierDays)
    : { available: false, tier: mileage.tier, flatAmount: 0 };

  const mileageHeadline = mileage.isUnlimited
    ? "Unlimited mileage"
    : mileage.isUnspecified
      ? "No allowance is set"
      : mileage.allowance;

  const mileageBlurb = mileage.isUnlimited
    ? `Bought on this rental${
        rental.unlimited_mileage_total != null && Number(rental.unlimited_mileage_total) > 0
          ? ` for ${formatCurrency(Number(rental.unlimited_mileage_total), currency)}${
              rental.unlimited_mileage_tier ? ` on the ${rental.unlimited_mileage_tier} tier` : ""
            }`
          : ""
      }. There is no excess charge to reckon at return.`
    : mileage.isUnspecified
      ? "Neither the car nor this rental has a mileage limit configured, so the agreement says so in as many words. It does not say unlimited — nobody has granted that."
      : `Anything over the allowance is charged at ${mileage.excessRate}, reckoned from the two odometer readings taken at handover.`;

  /* v1 offers Swap only while the rental is pending or active. A completed or
     cancelled rental's car is a matter of record, and the RPC would be moving a
     car onto a hire that is over. Kept identical rather than made more
     permissive — this is a money path, not a display. */
  const swappable = detail.status.value === "active" || detail.status.value === "pending";
  const mayEdit = canEdit("rentals");

  const swapBlocked = !mayEdit
    ? "Your role cannot change rentals."
    : !swappable
      ? "A completed or cancelled rental's car is a matter of record — swapping is only offered while it is pending or active."
      : null;

  const tierLabel = mileage.isUnlimited
    ? "Unlimited"
    : mileage.isUnspecified
      ? "Not specified"
      : `${mileage.tier.charAt(0).toUpperCase() + mileage.tier.slice(1)} tier`;

  const subline = [vehicle.year, facts?.colour, facts?.fuel_type, facts?.category].filter(Boolean).join(" · ");
  const photoSlots = (photos?.length ? photos : facts?.photo_url ? [facts.photo_url] : []).slice(0, 3);
  const cover = photoSlots[0] ?? null;

  return (
    <Panel
      fill
      title="Vehicle"
      description="Which car went out, and the mileage it went out on."
      action={
        picking ? (
          /* Back out: the rental still has its car — clearing wrote nothing. */
          <StageAction icon={Undo2} label={`Keep the ${vehicle.model || vehicle.reg}`} onClick={() => setPicking(false)} />
        ) : (
          /* Same place, same grammar as Customer's "Clear customer". Allowed
             while the rental is pending or active (v1's rule — a car can be
             swapped mid-hire, e.g. a breakdown). */
          <StageAction icon={X} label="Clear vehicle" onClick={() => setPicking(true)} disabledReason={swapBlocked} />
        )
      }
    >
      {picking ? (
        <VehiclePicker
          rentalId={rental.id}
          currentVehicleId={vehicle.id}
          startDate={rental.start_date ? String(rental.start_date).slice(0, 10) : null}
          endDate={rental.end_date ? String(rental.end_date).slice(0, 10) : null}
          onDone={(changed) => {
            setPicking(false);
            if (changed) refetch();
          }}
        />
      ) : (
        /* Island layout, the Customer stage's three cards: a slim identity
           strip, a compact summary, and the visual card filling the rest. */
        <div className="flex h-full min-h-0 flex-col gap-4">
          {/* ── which car — brief; its full file is one click away ──────── */}
          <Surface className="shrink-0 px-5 py-4">
            <div className="flex items-center gap-3.5">
              <span className="relative flex size-11 shrink-0 items-center justify-center overflow-hidden rounded-3xl bg-primary-light text-primary dark:text-[hsl(var(--v2-link,var(--primary)))]">
                {cover ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={cover} alt="" className="absolute inset-0 size-full object-cover" />
                ) : (
                  <Car className="size-5" />
                )}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="font-heading text-base font-semibold tracking-tight">{name}</h3>
                  {/* The car's PRESENT status — a fact about the car, not this
                      rental. An Available car on an Active rental is worth
                      seeing: the fleet thinks it is on the lot. */}
                  <HeroChip tone={vehicle.status === "Available" ? "success" : "muted"}>
                    {vehicle.status || "No status"}
                  </HeroChip>
                </div>
                <p className="mt-0.5 truncate text-[13px] text-muted-foreground">
                  <span className="font-mono tracking-wide">{vehicle.reg}</span>
                  {subline && <> · <span className="capitalize">{subline}</span></>}
                </p>
              </div>
              <Button variant="outline" size="sm" asChild>
                <Link href={`/vehicles/${vehicle.id}`}>
                  <ExternalLink />
                  Open vehicle
                </Link>
              </Button>
            </div>
          </Surface>

          {/* Four sections, always stacked vertically — never arranged side by
              side (Ghulam, Oct 2 2026): the strip, mileage, pricing (the same
              three tiers each, this hire's tier marked in both), then the
              photos filling what is left. Mileage and pricing are read-only. */}
              {/* ── mileage — one slim line: the tiers, then the terms ─────────
                  Little to read here, so it gives the height to the photos. */}
              <Surface className="flex flex-none flex-wrap items-center gap-x-4 gap-y-2 px-5 py-3.5">
                <h3 className="w-16 shrink-0 font-heading text-sm font-semibold">Mileage</h3>
                <TierRow
                  activeTier={mileage.isUnlimited ? null : mileage.tier}
                  tiers={(["daily", "weekly", "monthly"] as const).map((tier) => {
                    const allowance = mileage.isUnlimited
                      ? null
                      : (rental[`${tier}_mileage_override`] ?? facts?.[`${tier}_mileage`] ?? null);
                    return {
                      tier,
                      value: mileage.isUnlimited
                        ? "Unlimited"
                        : allowance != null && Number(allowance) > 0
                          ? `${formatDistance(Number(allowance), distanceUnit)}/${TIER_SHORT[tier]}`
                          : "—",
                    };
                  })}
                />
                <span className="ml-auto flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  {overridden && (
                    <span title="These figures were set for this rental. The car's own defaults are on its page.">
                      <Pill tone="neutral">Set for this rental</Pill>
                    </span>
                  )}
                  {/* The hire ran over. Neither amber nor red: a charge, not a
                      fault. Whether it is settled is the Payments stage's answer. */}
                  {excessCharge && excessCharge.amount > 0 && (
                    <span title={`Reckoned at ${mileage.excessRate}. What has been paid against it is on the Payments stage.`}>
                      <Pill tone={excessCharge.remaining <= 0 ? "success" : "primary"}>
                        Over by {formatCurrency(excessCharge.amount, currency)} ·{" "}
                        {excessCharge.remaining <= 0
                          ? "paid"
                          : excessCharge.remaining < excessCharge.amount
                            ? "part paid"
                            : "unpaid"}
                      </Pill>
                    </span>
                  )}
                  <span>
                    Excess{" "}
                    <span className="font-medium text-foreground">
                      {mileage.isUnlimited
                        ? "none"
                        : facts?.excess_mileage_rate != null || rental.excess_mileage_rate_override != null
                          ? `${formatCurrency(Number(rental.excess_mileage_rate_override ?? facts?.excess_mileage_rate), currency)}/${distanceUnit === "km" ? "km" : "mi"}`
                          : "not set"}
                    </span>
                  </span>
                  <span>
                    Odo{" "}
                    <span className="font-medium text-foreground">
                      {facts?.current_mileage != null ? formatDistance(facts.current_mileage, distanceUnit) : "—"}
                    </span>
                  </span>
                  <MileageHover
                    tone={mileage.isUnlimited ? "success" : mileage.isUnspecified ? "neutral" : "primary"}
                    label={mileage.isUnlimited ? "Unlimited" : mileage.isUnspecified ? "Not specified" : factsLoading ? "…" : mileage.allowance.split(" (")[0]}
                    blurb={factsLoading ? "Reading the car's mileage terms…" : mileageBlurb}
                    upgrade={
                      !mileage.isUnlimited && upgrade.available
                        ? `This car offers unlimited on the ${upgrade.tier} tier for ${formatCurrency(upgrade.flatAmount, currency)} — but only at booking. Adding it later would need a ledger charge, and nothing raises one.`
                        : null
                    }
                  />
                </span>
              </Surface>

              {/* ── pricing — the same slim line ──────────────────────────────── */}
              <Surface className="flex flex-none flex-wrap items-center gap-x-4 gap-y-2 px-5 py-3.5">
                <h3 className="w-16 shrink-0 font-heading text-sm font-semibold">Pricing</h3>
                <TierRow
                  activeTier={mileage.tier}
                  tiers={(
                    [
                      ["daily", vehicle.daily_rent],
                      ["weekly", vehicle.weekly_rent],
                      ["monthly", vehicle.monthly_rent],
                    ] as const
                  ).map(([tier, rate]) => ({
                    tier,
                    value: rate != null && Number(rate) > 0 ? `${formatCurrency(Number(rate), currency)}/${TIER_SHORT[tier]}` : "—",
                  }))}
                />
                <span className="ml-auto text-xs text-muted-foreground">
                  This rental{" "}
                  <span className="font-semibold text-foreground">
                    {rental.monthly_amount != null ? formatCurrency(Number(rental.monthly_amount), currency) : "—"}
                  </span>
                  {detail.days != null && ` for ${detail.days} ${detail.days === 1 ? "day" : "days"}`}
                </span>
              </Surface>

            {/* ── photos — the car, filling what is left ───────────────────── */}
            <Surface className="flex min-h-0 flex-1 flex-col p-5">
              <div className="flex items-center gap-2.5">
                <h3 className="font-heading text-sm font-semibold">Photos</h3>
                <span className="flex-1 text-xs text-muted-foreground">
                  {photos?.length ? `${photos.length} on file` : ""}
                </span>
              </div>
              <div className="mt-4 grid min-h-24 flex-1 grid-cols-3 gap-3">
                {[0, 1, 2].map((i) => (
                  <div key={i} className={cn(insetCls, "relative min-h-0 overflow-hidden")}>
                    {photoSlots[i] ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={photoSlots[i]} alt="" className="absolute inset-0 size-full object-cover" />
                    ) : (
                      <div className="absolute inset-0 flex flex-col items-center justify-center gap-1.5 text-muted-foreground/50">
                        <ImageIcon className="size-4" />
                        <span className="text-[10px]">{i === 0 ? "No photos on file" : "No photo"}</span>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </Surface>
        </div>
      )}
    </Panel>
  );
}

/**
 * Three tiers in one line — daily, weekly, monthly — the one this hire runs
 * on filled in. Mileage and Pricing both use it, so the two read the same.
 */
function TierRow({
  tiers,
  activeTier,
}: {
  tiers: { tier: "daily" | "weekly" | "monthly"; value: string }[];
  activeTier: "daily" | "weekly" | "monthly" | null;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {tiers.map((t) => {
        const active = t.tier === activeTier;
        return (
          <span
            key={t.tier}
            title={active ? "The tier this hire runs on" : undefined}
            className={cn(
              "inline-flex items-baseline gap-2 rounded-full px-3 py-1.5 ring-1",
              active
                ? "bg-primary/[0.08] ring-primary/25"
                : "bg-muted/40 ring-foreground/5"
            )}
          >
            <span
              className={cn(
                "text-[10px] font-medium uppercase tracking-wider",
                active ? "text-primary dark:text-[hsl(var(--v2-link,var(--primary)))]" : "text-muted-foreground"
              )}
            >
              {t.tier}
            </span>
            <span className="text-sm font-semibold">{t.value}</span>
          </span>
        );
      })}
    </div>
  );
}

/**
 * The car's gallery, in display order. Tenant-scoped like every read here
 * (RLS is off — V2_PLAN §5).
 */
function useVehiclePhotos(vehicleId: string | null) {
  const { tenant } = useTenant();
  return useQuery({
    queryKey: ["rental-stage-vehicle-photos-v2", tenant?.id, vehicleId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("vehicle_photos")
        .select("photo_url, display_order")
        .eq("vehicle_id", vehicleId!)
        .eq("tenant_id", tenant!.id)
        .order("display_order", { ascending: true });
      if (error) throw error;
      return ((data ?? []) as { photo_url: string | null }[]).map((p) => p.photo_url).filter(Boolean) as string[];
    },
    enabled: !!vehicleId && !!tenant?.id,
  });
}

/** The tier chip; hover explains the terms, in Trax's white explainer card. */
function MileageHover({
  tone,
  label,
  blurb,
  upgrade,
}: {
  tone: "success" | "neutral" | "primary";
  label: string;
  blurb: string;
  upgrade: string | null;
}) {
  return (
    <HoverCard openDelay={120} closeDelay={60}>
      <HoverCardTrigger asChild>
        <span className="inline-flex cursor-default">
          <Pill tone={tone}>
            <Gauge />
            {label}
          </Pill>
        </span>
      </HoverCardTrigger>
      <HoverCardContent side="top" align="start" sideOffset={8} collisionPadding={16} className="w-80 rounded-2xl p-4 text-left">
        <p className="text-[13px] font-semibold text-foreground">How mileage works on this hire</p>
        <p className="mt-1.5 text-[12.5px] leading-snug text-muted-foreground">{blurb}</p>
        {upgrade && <p className="mt-3 border-t border-foreground/5 pt-3 text-[12px] text-muted-foreground">{upgrade}</p>}
      </HoverCardContent>
    </HoverCard>
  );
}

