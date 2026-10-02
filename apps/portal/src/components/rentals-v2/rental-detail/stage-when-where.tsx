"use client";

/**
 * The When & where stage of the rental control centre — WHEN, HOW, WHERE.
 *
 * Island layout (Oct 2026, the Customer stage's grammar), as simple as it
 * gets: two sections, Pickup and Return, each with WHEN (date and time), HOW
 * the car changes hands, and WHERE, with its fee — then a map filling the rest
 * (`where-map.tsx`): P and R pins joined by a dashed line, a hover card on each
 * with its date, time, how and address, your places and delivery area under it.
 *
 * ── the three "how"s, as Settings → Locations defines them ────────────────
 *
 *   fixed     the customer comes to the tenant's fixed address — no fee
 *   location  one of the tenant's saved locations — that location's fee
 *   area      the tenant delivers to the customer's address within a radius —
 *             one fee, or priced by distance (`resolveDeliveryFee`, the same
 *             function the create flow's LocationPicker uses)
 *
 * `rentals.delivery_option` records the pickup's how, as the create flow
 * writes it. The return's how is not stored on its own, so it is read back from
 * what the return carries (a saved location, the fixed address, or an address).
 *
 * ── editing, in place ─────────────────────────────────────────────────────
 *
 * No edit button: while the rental can still change, the fields ARE the
 * display, and a Save bar appears over the map once something differs. Locked
 * past its first four stages (`update_rental_terms_v2`'s own guard, asked with
 * `p_dry_run`), it reads as plain text and says why in the stage-action spot.
 *
 * Moving the dates moves the money, so saving RE-PRICES (Ghulam, Oct 2 2026):
 * the rental price is re-run with the same engine bookings use
 * (`calculateRentalPriceBreakdown`: tiers, weekend/holiday surcharges, per-car
 * overrides and day prices), tax and service fee with the same rules as the
 * create flow, and `update_rental_terms_v2` rewrites the invoice and
 * regenerates the still-unpaid charges in one transaction. The new total is on
 * screen before Save. When only times or places change, the rental price is
 * left exactly as it is — only the delivery and collection fees move.
 */

import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Building2, Lock, MapPin, Truck } from "lucide-react";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/contexts/TenantContext";
import { useToast } from "@/hooks/use-toast";
import { usePickupLocations, type PickupLocation } from "@/hooks/use-pickup-locations";
import { useRentalSettings } from "@/hooks/use-rental-settings";
import { useWeekendPricing } from "@/hooks/use-weekend-pricing";
import { useTenantHolidays } from "@/hooks/use-tenant-holidays";
import { useVehiclePricingOverrides } from "@/hooks/use-vehicle-pricing-overrides";
import { useVehicleDailyPrices } from "@/hooks/use-vehicle-daily-prices";
import { calculateRentalPriceBreakdown } from "@/lib/calculate-rental-price";
import { formatCurrency, type DistanceUnit } from "@/lib/format-utils";
import { resolveAgreementTimeZone } from "@/lib/agreement-datetime";
import { LocationAutocomplete } from "@/components/ui/location-autocomplete";
import { Button } from "@/components/ui-v2/button";
import type { RentalRow } from "./use-rental-detail-v2";
import type { StageProps } from "./stages";
import { WhereMap, type MapPlace } from "./where-map";
import { RentalDatesDialog } from "./rental-dates-dialog";
import { fmtDate, Panel, Pill, StageAction, Surface } from "./_kit";

type How = "fixed" | "location" | "area";
type End = { how: How; address: string; locationId: string | null; fee: number; outOfRadius?: boolean };

const HOW_LABEL: Record<How, { out: string; back: string; icon: typeof Building2 }> = {
  fixed: { out: "Collects from us", back: "Returns to us", icon: Building2 },
  location: { out: "At one of our locations", back: "At one of our locations", icon: MapPin },
  area: { out: "We deliver", back: "We collect", icon: Truck },
};

/** "14:00:00" → "2:00 PM"; null when unset. A bare wall-clock time — no zone. */
function fmtClock(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const [h, m] = String(raw).split(":").map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
  return new Date(2000, 0, 1, h, m).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

/** date + "HH:MM[:SS]" → "yyyy-MM-ddTHH:mm" for the picker; 10:00 when unset. */
const joinAt = (date: string | null | undefined, time: string | null | undefined) =>
  date ? `${String(date).slice(0, 10)}T${time ? String(time).slice(0, 5) : "10:00"}` : "";

/** Read each end's HOW back off the rental, the way the create flow wrote it. */
function readEnds(rental: RentalRow, fixedOut: string | null, fixedBack: string | null): { out: End; back: End } {
  const opt = String(rental.delivery_option ?? "");
  const outAddr = rental.pickup_location || rental.delivery_address || "";
  const backAddr = rental.return_location || rental.collection_address || "";
  const outHow: How =
    opt === "location" || opt === "area" || opt === "fixed"
      ? (opt as How)
      : rental.pickup_location_id
        ? "location"
        : rental.uses_delivery_service || rental.delivery_address
          ? "area"
          : "fixed";
  const backHow: How = rental.return_location_id
    ? "location"
    : backAddr && fixedBack && backAddr === fixedBack
      ? "fixed"
      : backAddr && backAddr === outAddr
        ? outHow
        : rental.collection_address || (opt === "area" && backAddr)
          ? "area"
          : "fixed";
  return {
    out: {
      how: outHow,
      address: outAddr || (outHow === "fixed" ? (fixedOut ?? "") : ""),
      locationId: rental.pickup_location_id ?? null,
      fee: Number(rental.delivery_fee) || 0,
    },
    back: {
      how: backHow,
      address: backAddr || (backHow === "fixed" ? (fixedBack ?? "") : ""),
      locationId: rental.return_location_id ?? null,
      fee: Number(rental.collection_fee) || 0,
    },
  };
}

/** May this rental's terms still change? The database's answer, never a guess. */
function useTermsEditable(rentalId: string) {
  return useQuery({
    queryKey: ["rental-terms-editable-v2", rentalId],
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc("update_rental_terms_v2", {
        p_rental_id: rentalId,
        p_terms: {},
        p_dry_run: true,
      });
      if (error) throw error;
      return data as { ok: boolean; reason?: string };
    },
    staleTime: 0,
    refetchOnMount: "always",
    refetchOnWindowFocus: true,
  });
}

export function StageWhenWhere({ detail, refetch }: StageProps) {
  const { tenant } = useTenant();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { locationSettings: ls, pickupLocations, returnLocations } = usePickupLocations();
  const { settings: rentalSettings } = useRentalSettings();
  const { settings: weekend } = useWeekendPricing();
  const { holidays } = useTenantHolidays();
  const vehicleId = detail.vehicle?.id;
  const { overrides } = useVehiclePricingOverrides(vehicleId);
  const { prices: dayPrices } = useVehicleDailyPrices(vehicleId);
  const editable = useTermsEditable(detail.rental.id);

  const rental = detail.rental;
  const currency = tenant?.currency_code || "USD";
  const unit = (tenant?.distance_unit || "miles") as DistanceUnit;
  const timezone = resolveAgreementTimeZone(rental as never, tenant as never);
  const mtd = tenant?.monthly_tier_days ?? 30;

  const current = useMemo(
    () => readEnds(rental, ls.fixed_pickup_address, ls.fixed_return_address),
    [rental, ls.fixed_pickup_address, ls.fixed_return_address]
  );

  /* ── the draft — live whenever the rental can still change ───────────── */
  const canEdit = editable.data?.ok === true;
  const [datesOpen, setDatesOpen] = useState(false);
  const [pickupAt, setPickupAt] = useState("");
  const [returnAt, setReturnAt] = useState("");
  const [out, setOut] = useState<End>(current.out);
  const [back, setBack] = useState<End>(current.back);
  const origPickup = joinAt(rental.start_date, rental.pickup_time);
  const origReturn = joinAt(rental.end_date, rental.return_time);
  const reset = () => {
    setPickupAt(origPickup);
    setReturnAt(origReturn);
    setOut(current.out);
    setBack(current.back);
  };
  // Re-seed from the rental whenever it (or the settings it is read with) changes.
  useEffect(reset, [origPickup, origReturn, current]); // eslint-disable-line react-hooks/exhaustive-deps
  const sameEnd = (a: End, b: End) => a.how === b.how && a.address === b.address && a.locationId === b.locationId && a.fee === b.fee;
  const dirty =
    pickupAt !== origPickup || returnAt !== origReturn || !sameEnd(out, current.out) || !sameEnd(back, current.back);
  const backEnd: End = back;

  /* ── the re-price, only when the dates move ───────────────────────────── */
  const newStart = pickupAt.slice(0, 10);
  const newEnd = returnAt.slice(0, 10);
  const datesMoved =
    canEdit &&
    (newStart !== String(rental.start_date ?? "").slice(0, 10) || newEnd !== String(rental.end_date ?? "").slice(0, 10));
  const reprice = useMemo(() => {
    if (!datesMoved || !newStart || !newEnd || newEnd <= newStart || !detail.vehicle) return null;
    const breakdown = calculateRentalPriceBreakdown(
      newStart,
      newEnd,
      {
        daily_rent: Number(detail.vehicle.daily_rent) || 0,
        weekly_rent: Number(detail.vehicle.weekly_rent) || 0,
        monthly_rent: Number(detail.vehicle.monthly_rent) || 0,
      },
      weekend as never,
      holidays as never,
      overrides as never,
      vehicleId,
      mtd,
      rental.auto_extend_enabled === true,
      false,
      dayPrices as never
    );
    const price = Math.round(breakdown.rentalPrice * 100) / 100;
    const discounted = price - (Number(rental.discount_applied) || 0);
    const rs = rentalSettings as any;
    const tax =
      rs?.tax_enabled && rs?.tax_percentage ? Math.round(discounted * (rs.tax_percentage / 100) * 100) / 100 : 0;
    let service = 0;
    if (rs?.service_fee_enabled) {
      const v = Number(rs.service_fee_value ?? rs.service_fee_amount ?? 0) || 0;
      service = rs.service_fee_type === "percentage" ? Math.round(((discounted * v) / 100) * 100) / 100 : v;
    }
    return { price, tax, service, days: breakdown.rentalDays, tier: breakdown.pricingTier };
  }, [datesMoved, newStart, newEnd, detail.vehicle, weekend, holidays, overrides, vehicleId, mtd, rental, dayPrices, rentalSettings]);

  const save = useMutation({
    mutationFn: async () => {
      if (!pickupAt || !returnAt) throw new Error("Both a pickup and a return date are needed.");
      if (newEnd <= newStart) throw new Error("The return has to be after the pickup.");
      if (!out.address.trim()) throw new Error("Say where the car goes out.");
      if (!backEnd.address.trim()) throw new Error("Say where the car comes back.");
      const terms: Record<string, unknown> = {
        start_date: newStart,
        end_date: newEnd,
        pickup_time: pickupAt.slice(11, 16),
        return_time: returnAt.slice(11, 16),
        pickup_location: out.address.trim(),
        return_location: backEnd.address.trim(),
      };
      // A changed address no longer points at a saved location.
      if (out.address !== current.out.address) terms.pickup_location_id = "";
      if (backEnd.address !== current.back.address) terms.return_location_id = "";
      if (reprice) Object.assign(terms, { monthly_amount: reprice.price, tax_amount: reprice.tax, service_fee: reprice.service });
      const { data, error } = await (supabase as any).rpc("update_rental_terms_v2", {
        p_rental_id: rental.id,
        p_terms: terms,
        p_dry_run: false,
      });
      if (error) throw error;
      if (!data?.ok) throw new Error(data?.reason ?? "Nothing was saved.");
      return data as { ok: true; total: number };
    },
    onSuccess: (data) => {
      toast({ title: `Saved. This rental now comes to ${formatCurrency(Number(data.total) || 0, currency)}.` });
      void queryClient.invalidateQueries({ queryKey: ["rental-detail-v2", rental.id] });
      void queryClient.invalidateQueries({ queryKey: ["rental-terms-editable-v2", rental.id] });
      refetch();
    },
    onError: (e: Error) => toast({ title: "Nothing was saved", description: e.message, variant: "destructive" }),
  });

  const period =
    detail.days == null
      ? "No return date set"
      : `${detail.days} day${detail.days === 1 ? "" : "s"}${
          rental.rental_period_type ? ` · billed ${String(rental.rental_period_type).toLowerCase()}` : ""
        }`;

  /* ── what the cards show ──────────────────────────────────────────────── */
  const area =
    (ls.pickup_area_enabled || ls.return_area_enabled) && ls.area_center_lat != null && ls.area_center_lon != null
      ? {
          lat: Number(ls.area_center_lat),
          lng: Number(ls.area_center_lon),
          radiusKm: Number((ls.pickup_area_enabled ? ls.pickup_area_radius_km : ls.return_area_radius_km) || 25),
        }
      : null;

  const shownOut = canEdit ? out : current.out;
  const shownBack = canEdit ? back : current.back;
  const whenText = (at: string, date: string | null | undefined, time: string | null | undefined) =>
    canEdit && at
      ? `${fmtDate(at.slice(0, 10))}, ${fmtClock(at.slice(11, 16)) ?? ""}`
      : `${date ? fmtDate(date) : "No date"}${time ? `, ${fmtClock(time)}` : ""}`;
  const howText = (side: "out" | "back", e: End, locs: PickupLocation[]) => {
    const l = e.locationId ? locs.find((x) => x.id === e.locationId) : null;
    return e.how === "location" && l ? `At ${l.name}` : side === "out" ? HOW_LABEL[e.how].out : HOW_LABEL[e.how].back;
  };

  const mapPlaces: MapPlace[] = [
    ...(ls.fixed_pickup_address
      ? [{ key: "fixed", label: "Your address", address: ls.fixed_pickup_address, kind: "site" as const }]
      : []),
    ...[...pickupLocations, ...returnLocations]
      .filter((l, i, all) => all.findIndex((x) => x.id === l.id) === i)
      .map((l) => ({ key: l.id, label: l.name, address: l.address, kind: "site" as const })),
    ...(shownOut.address
      ? [{
          key: "out",
          label: "Pickup",
          address: shownOut.address,
          kind: "out" as const,
          when: whenText(pickupAt, rental.start_date, rental.pickup_time),
          how: howText("out", shownOut, pickupLocations),
        }]
      : []),
    ...(shownBack.address
      ? [{
          key: "back",
          label: "Drop-off",
          address: shownBack.address,
          kind: "back" as const,
          when: whenText(returnAt, rental.end_date, rental.return_time),
          how: howText("back", shownBack, returnLocations),
        }]
      : []),
  ];


  return (
    <Panel
      fill
      title="When & where"
      description="When the car goes out and comes back, how it changes hands, and where."
      action={
        !canEdit && editable.data ? (
          /* Locked past Extras — say so, in the stage-action spot. */
          <StageAction icon={Lock} label="Locked" onClick={() => {}} disabledReason={editable.data.reason ?? null} />
        ) : null
      }
    >
      <div className="flex h-full min-h-0 flex-col gap-4">
        {/* ── picker one: the dates — the whole bar is the button ──────────── */}
        <DateBar
          editable={canEdit}
          onOpen={() => setDatesOpen(true)}
          pickup={canEdit ? pickupAt : joinAt(rental.start_date, rental.pickup_time)}
          ret={canEdit ? returnAt : joinAt(rental.end_date, rental.return_time)}
          hasPickupTime={canEdit || !!rental.pickup_time}
          hasReturnTime={canEdit || !!rental.return_time}
          summary={canEdit && reprice ? `${reprice.days} days · ${reprice.tier}` : period}
          timezone={timezone}
        />
        <RentalDatesDialog
          open={datesOpen}
          onOpenChange={setDatesOpen}
          vehicleId={detail.vehicle?.id ?? null}
          vehicleName={detail.vehicleName ?? "car"}
          rentalId={rental.id}
          pickupAt={pickupAt}
          returnAt={returnAt}
          onApply={(p, r) => {
            setPickupAt(p);
            setReturnAt(r);
          }}
        />

        {/* ── picker two: pickup and drop-off places, over their map ──────── */}
        <Surface className="relative flex min-h-0 flex-1 flex-col overflow-hidden p-0">
          <div className="shrink-0 space-y-3 px-5 py-4">
            <PlaceRow
              side="out"
              title="Pickup"
              editable={canEdit}
              end={shownOut}
              setEnd={setOut}
            />
            <div className="h-px bg-foreground/5" />
            <PlaceRow
              side="back"
              title="Drop-off"
              editable={canEdit}
              end={shownBack}
              setEnd={setBack}
            />
          </div>

          <div className="relative min-h-40 flex-1 border-t border-foreground/5">
            <WhereMap places={mapPlaces} area={area} />
            <div className={cn("pointer-events-none absolute bottom-4 left-4 flex flex-wrap gap-1.5", canEdit && dirty && "hidden")}>
              <Legend dot="bg-primary" label="P pickup · R drop-off" />
              <Legend dot="bg-[#9a9aa6]" label="Your places" />
              {area && <Legend dot="bg-primary/30 ring-1 ring-primary/50" label="Delivery area" />}
            </div>
          </div>

          {/* Once something changed: what saving does to the money, then Save. */}
          {canEdit && dirty && (
            <div className="absolute inset-x-4 bottom-4 flex flex-wrap items-center gap-x-5 gap-y-2 rounded-3xl bg-card/95 px-5 py-3 shadow-md ring-1 ring-foreground/10 backdrop-blur">
              {reprice ? (
                <span className="text-xs text-muted-foreground">
                  Rental{" "}
                  <span className="font-semibold text-foreground">
                    {formatCurrency(Number(rental.monthly_amount) || 0, currency)} → {formatCurrency(reprice.price, currency)}
                  </span>
                  {reprice.tax > 0 && <> · Tax {formatCurrency(reprice.tax, currency)}</>}
                  {reprice.service > 0 && <> · Service {formatCurrency(reprice.service, currency)}</>}
                </span>
              ) : (
                <span className="text-xs text-muted-foreground">Same dates — the rental price stays as it is.</span>
              )}
              <span className="ml-auto flex items-center gap-2">
                <Button size="sm" variant="ghost" onClick={reset}>
                  Undo
                </Button>
                <Button size="sm" disabled={save.isPending} onClick={() => save.mutate()}>
                  {save.isPending ? "Saving…" : reprice ? "Save and re-price" : "Save"}
                </Button>
              </span>
            </div>
          )}
        </Surface>
      </div>
    </Panel>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   Pieces
   ══════════════════════════════════════════════════════════════════════════ */

function Legend({ dot, label }: { dot: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-card/90 px-2.5 py-1 text-[11px] text-muted-foreground shadow-sm ring-1 ring-foreground/5 backdrop-blur">
      <span className={cn("size-2 rounded-full", dot)} />
      {label}
    </span>
  );
}

/**
 * Picker one — the rental's dates, start to end, as ONE bar. The whole bar is
 * the button: it opens the car's calendar (`rental-dates-dialog.tsx`), where
 * both days and both times are picked together.
 */
function DateBar({
  editable,
  onOpen,
  pickup,
  ret,
  hasPickupTime,
  hasReturnTime,
  summary,
  timezone,
}: {
  editable: boolean;
  onOpen: () => void;
  /** "yyyy-MM-ddTHH:mm" */
  pickup: string;
  ret: string;
  hasPickupTime: boolean;
  hasReturnTime: boolean;
  summary: string;
  timezone: string;
}) {
  const End = ({ label, at, hasTime }: { label: string; at: string; hasTime: boolean }) => (
    <div className="min-w-0">
      <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className="mt-0.5 truncate font-heading text-lg font-semibold tracking-tight">
        {at ? fmtDate(at.slice(0, 10)) : label === "Drop-off" ? "Open-ended" : "No date"}
        <span className="ml-2 text-sm font-normal text-muted-foreground">
          {at && hasTime ? fmtClock(at.slice(11, 16)) : "no time set"}
        </span>
      </p>
    </div>
  );
  const body = (
    <>
      <End label="Pickup" at={pickup} hasTime={hasPickupTime} />
      <span className="text-muted-foreground">→</span>
      <End label="Drop-off" at={ret} hasTime={hasReturnTime} />
      <span className="ml-auto shrink-0 text-right text-xs text-muted-foreground">
        <span className="block font-medium text-foreground">{summary}</span>
        Times in {timezone}
      </span>
    </>
  );
  const cls =
    "flex flex-none items-center gap-6 rounded-4xl bg-card px-5 py-4 text-left shadow-md ring-1 ring-foreground/5 dark:ring-foreground/10";
  return editable ? (
    <button
      type="button"
      onClick={onOpen}
      className={cn(cls, "transition-shadow duration-200 ease-out hover:ring-primary/30 motion-reduce:transition-none")}
    >
      {body}
    </button>
  ) : (
    <div className={cls}>{body}</div>
  );
}

/**
 * One row of picker two: just the address this end happens at — typed with the
 * app's Google address search. No "how", no fee (Ghulam, Oct 2 2026: "just the
 * pickup and drop-off address"); the rental's existing delivery fees are left
 * exactly as they are.
 */
function PlaceRow({
  side,
  title,
  editable,
  end,
  setEnd,
}: {
  side: "out" | "back";
  title: string;
  editable: boolean;
  end: End;
  setEnd: (e: End) => void;
}) {
  return (
    <div className="flex items-center gap-x-5">
      <h3 className="w-16 shrink-0 font-heading text-sm font-semibold">{title}</h3>
      <div className="min-w-0 flex-1">
        {editable ? (
          <LocationAutocomplete
            id={`${side}-address`}
            value={end.address}
            // A typed address replaces any saved location — v1's dialog clears
            // the FK the same way.
            onChange={(address) => setEnd({ ...end, address, locationId: null })}
            placeholder={side === "out" ? "Pickup address" : "Drop-off address"}
            v2States
          />
        ) : (
          <p className="truncate text-sm font-medium">
            {end.address || <span className="font-normal text-muted-foreground">Not recorded</span>}
          </p>
        )}
      </div>
    </div>
  );
}
