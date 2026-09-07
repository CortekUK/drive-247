"use client";

/**
 * The Vehicle stage of the rental control centre — real data, real actions.
 *
 * The design is the playground's `rental-create-fake/_vehicle-tab.tsx`; the data
 * is not, and neither is the shape. The sandbox was a CREATE screen, so its
 * Vehicle tab was a search box over a grid of photo cards — walk the lot, pick a
 * car. THAT DOES NOT BELONG HERE. This rental already has a car: it is on the
 * agreement, it is on the insurance policy, and on an Active rental it is
 * physically with the customer. A picker on this screen would be an invitation
 * to silently reassign a live rental, and reassignment is not a click — it is
 * `SwapVehicleDialog`, which checks the new car is free for the dates, re-prices
 * the rental, and can block the old car out for maintenance on the way past.
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
import { Car, ExternalLink, Gauge, Repeat, Info } from "lucide-react";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/contexts/TenantContext";
import { useManagerPermissions } from "@/hooks/use-manager-permissions";
import { formatCurrency, formatDistance, type DistanceUnit } from "@/lib/format-utils";
import { resolveAgreementMileage } from "@/lib/agreement-mileage";
import { getUnlimitedMileageOption } from "@/lib/mileage-utils";
// v1's dialog, reused as it stands rather than re-skinned. It is the ONLY route
// to `swap_rental_vehicle`, and it does considerably more than change a foreign
// key — availability check, re-pricing, optional maintenance block on the car
// coming off. A v2 copy would be a second call-site for that RPC that has to be
// kept in step with the first. A modal in v1's grammar over a v2 screen is the
// cheaper mismatch, and it is the same trade the Customer stage makes.
import { SwapVehicleDialog } from "@/components/rentals/swap-vehicle-dialog";
import { Button } from "@/components/ui-v2/button";
import type { StageProps } from "./stages";
import {
  insetCls,
  ActionButton,
  EmptyHint,
  HeroChip,
  Panel,
  Pill,
  Section,
  StatBlock,
  Surface,
} from "./_kit";

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

export function StageVehicle({ detail, refetch }: StageProps) {
  const { tenant } = useTenant();
  const { canEdit } = useManagerPermissions();
  const [swapOpen, setSwapOpen] = useState(false);

  const vehicle = detail.vehicle;
  const { data: facts, isLoading: factsLoading } = useVehicleFacts(vehicle?.id ?? null);
  const { data: excessCharge } = useExcessMileageCharge(detail.rental.id);

  const currency = tenant?.currency_code || "USD";
  const distanceUnit = (tenant?.distance_unit || "miles") as DistanceUnit;
  const monthlyTierDays = tenant?.monthly_tier_days ?? 30;

  /* A rental with no vehicle row is a broken record, not an empty state — the
     FK is set on creation. Cheaper to say so plainly than to render a screen of
     dashes that reads like a car with no details. */
  if (!vehicle) {
    return (
      <Panel title="Vehicle" description="Which car went out.">
        <EmptyHint>
          This rental has no vehicle attached to it. Nothing here can describe a car until one is — open it in
          the rentals list and set a vehicle.
        </EmptyHint>
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

  const mileageTone = mileage.isUnlimited
    ? "bg-success-light text-success"
    : mileage.isUnspecified
      ? "bg-muted text-muted-foreground"
      : "bg-primary-light text-primary";

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

  return (
    <Panel
      title="Vehicle"
      description="Which car went out, and the mileage it went out on."
      footer={
        <div className="flex flex-wrap items-center gap-3">
          <ActionButton
            variant="outline"
            onClick={() => setSwapOpen(true)}
            disabled={!swappable || !mayEdit}
            title={
              !mayEdit
                ? "Your role cannot change rentals."
                : !swappable
                  ? "A completed or cancelled rental's car is a matter of record — swapping is only offered while it is pending or active."
                  : undefined
            }
          >
            <Repeat className="size-4" />
            Swap the car
          </ActionButton>
          <p className="text-xs text-muted-foreground">
            Swapping checks the new car is free for these dates and re-prices the rental.
          </p>
        </div>
      }
    >
      {/* ── the car ──────────────────────────────────────────────────────── */}
      <Surface className="overflow-hidden p-0">
        {facts?.photo_url && (
          <div className="aspect-[21/8] w-full overflow-hidden bg-muted">
            {/* A plain <img>, not next/image: these URLs come from whatever
                storage host the row happens to carry, and next/image throws at
                runtime on a host that is not in `remotePatterns`. Same call the
                vehicles-v2 gallery makes. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={facts.photo_url} alt="" className="size-full object-cover" />
          </div>
        )}

        <div className="flex items-start gap-4 p-6">
          {!facts?.photo_url && (
            <span className="flex size-12 shrink-0 items-center justify-center rounded-3xl bg-primary-light text-primary">
              <Car className="size-5" />
            </span>
          )}
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="font-heading text-lg font-semibold tracking-tight">{name}</h3>
              <Pill tone="neutral">{vehicle.reg}</Pill>
              {/* The car's PRESENT status, which is a fact about the car and not
                  about this rental — an Available car on an Active rental is
                  worth seeing, because it means the fleet thinks it is on the
                  lot. The rental's own status lives in the right rail. */}
              <HeroChip tone={vehicle.status === "Available" ? "success" : "muted"}>
                {vehicle.status || "No status"}
              </HeroChip>
            </div>
            <p className="mt-1 truncate text-sm text-muted-foreground">
              {[vehicle.year, facts?.colour, facts?.fuel_type, facts?.category]
                .filter(Boolean)
                .join(" · ") || "No description on file"}
            </p>
          </div>
          {/* The one navigation off this stage. The car's own page is where you
              edit it, photograph it, or read its whole file; this stage answers
              a question about THIS rental and hands off for the rest. */}
          <Button variant="outline" size="sm" asChild>
            <Link href={`/vehicles/${vehicle.id}`}>
              <ExternalLink />
              Open vehicle
            </Link>
          </Button>
        </div>
      </Surface>

      {/* ── mileage ──────────────────────────────────────────────────────── */}
      <Section
        title="Mileage"
        description="What this hire includes, and what it costs to go past it."
        right={
          mileage.isUnlimited ? (
            <Pill tone="success">Unlimited</Pill>
          ) : mileage.isUnspecified ? (
            <Pill tone="neutral">Not specified</Pill>
          ) : (
            <Pill tone="primary">
              {mileage.tier.charAt(0).toUpperCase() + mileage.tier.slice(1)} tier
            </Pill>
          )
        }
      >
        <div className="flex items-start gap-4">
          <span className={cn("flex size-11 shrink-0 items-center justify-center rounded-3xl", mileageTone)}>
            <Gauge className="size-5" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="font-heading text-sm font-semibold">
              {factsLoading ? "Reading the car's mileage terms…" : mileageHeadline}
            </p>
            {!factsLoading && (
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{mileageBlurb}</p>
            )}
          </div>
        </div>

        <div className="mt-5 grid gap-2 sm:grid-cols-3">
          <StatBlock
            label="Allowance"
            value={
              mileage.isUnlimited
                ? "Unlimited"
                : mileage.perUnit != null
                  ? formatDistance(Math.round(mileage.perUnit), distanceUnit)
                  : "—"
            }
            hint={
              mileage.isUnlimited
                ? "No limit on this rental"
                : mileage.perUnit != null
                  ? `per ${TIER_WORD[mileage.tier]}, pro-rata across the hire`
                  : "Nothing configured"
            }
          />
          <StatBlock
            label="Excess"
            value={
              mileage.isUnlimited
                ? "None"
                : facts?.excess_mileage_rate != null || rental.excess_mileage_rate_override != null
                  ? formatCurrency(
                      Number(rental.excess_mileage_rate_override ?? facts?.excess_mileage_rate),
                      currency
                    )
                  : "—"
            }
            hint={
              mileage.isUnlimited
                ? "Unlimited rentals cannot run over"
                : `per additional ${distanceUnit === "km" ? "km" : "mile"}`
            }
          />
          <StatBlock
            label="Odometer"
            value={
              facts?.current_mileage != null ? formatDistance(facts.current_mileage, distanceUnit) : "—"
            }
            hint={facts?.current_mileage != null ? "Latest reading on the car" : "No reading on file"}
          />
        </div>

        {/* The hire ran over. Neither amber nor red — amber on this screen means
            "out of date" and red means a fault, and a customer who drove further
            than they bought is neither. It is a charge, and whether it has been
            settled is the Payments stage's answer, not this one's. */}
        {excessCharge && excessCharge.amount > 0 && (
          <div className={cn(insetCls, "mt-4 flex flex-wrap items-center justify-between gap-3 px-5 py-4")}>
            <div className="min-w-0">
              <p className="text-sm font-medium">
                This hire went over its allowance — {formatCurrency(excessCharge.amount, currency)} charged
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Reckoned at {mileage.excessRate}. What has been paid against it is on the Payments stage.
              </p>
            </div>
            <Pill
              tone={
                excessCharge.remaining <= 0
                  ? "success"
                  : excessCharge.remaining < excessCharge.amount
                    ? "primary"
                    : "neutral"
              }
            >
              {excessCharge.remaining <= 0
                ? "Paid"
                : excessCharge.remaining < excessCharge.amount
                  ? "Part paid"
                  : "Unpaid"}
            </Pill>
          </div>
        )}

        {overridden && (
          <div className={cn(insetCls, "mt-4 flex items-start gap-3 px-5 py-4")}>
            <Info className="mt-0.5 size-4 shrink-0 text-muted-foreground/70" />
            <p className="text-xs text-muted-foreground">
              These figures were set for this rental specifically. The car&rsquo;s own defaults are on its page
              and are not what this hire runs on.
            </p>
          </div>
        )}

        {/* The upgrade the car offers but this rental did not take. Stated, not
            offered: unlimited mileage is only ever written at rental creation
            (`rentals/new` and `rental-create-v2` are the sole writers of
            `is_unlimited_mileage`), and taking it later would mean raising a
            ledger charge as well as flipping a flag. There is no path for that,
            so the button says so rather than doing nothing. */}
        {!mileage.isUnlimited && upgrade.available && (
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <ActionButton
              variant="outline"
              disabled
              title="Unlimited mileage is only ever set when the rental is created — adding it later would need a ledger charge as well, and nothing raises one. Cancel and rebook, or add the charge on the Payments stage."
            >
              Add unlimited mileage
            </ActionButton>
            <p className="text-xs text-muted-foreground">
              This car offers unlimited on the {upgrade.tier} tier for{" "}
              {formatCurrency(upgrade.flatAmount, currency)} — but only at booking.
            </p>
          </div>
        )}
      </Section>

      {/* ── the reused v1 dialog ─────────────────────────────────────────── */}
      {/* Re-read on close, always. `useVehicleSwap` invalidates v1's key
          (`["rental", id]`) and five list keys, but not `rental-detail-v2` —
          the control centre reads a different column set under a different key
          on purpose (see `use-rental-detail-v2`). Without this the swap lands
          in the database and the screen keeps showing the old car. Refetching
          on a cancelled dialog too is the cheaper half of the trade. */}
      <SwapVehicleDialog
        open={swapOpen}
        onOpenChange={(open) => {
          setSwapOpen(open);
          if (!open) refetch();
        }}
        rental={detail.rental}
      />
    </Panel>
  );
}
