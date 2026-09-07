"use client";

/**
 * The When & where stage of the rental control centre — real data, real actions.
 *
 * The design is the playground's `rental-create-fake/_when-where-tab.tsx`, and
 * its central argument is kept: this is ONE stage, not four.
 *
 * Dates, times, delivery mode and location look like four separate questions
 * until you try to answer them. Whether the car is delivered changes what
 * LOCATION even means — one of your own sites becomes an address of the
 * customer's — and whether a lockbox is in play depends on the car and on the
 * tenant, not on the calendar. Split apart, an operator answers one by bouncing
 * between three others. Kept together it reads as one sentence: the car leaves
 * HERE at THIS time and comes back THERE at THAT one.
 *
 * The two halves stay mirrored — Out and Back carry the same four facts in the
 * same order — but the prototype's "comes back the same way" switch is gone.
 * That switch was a create-time shortcut for filling a form; this rental's two
 * legs are already recorded, and hiding the return behind a toggle would hide a
 * fact rather than save a click. Where the two legs match, the Back card simply
 * says so in a line.
 *
 * ── what the prototype invented, and what is actually here ─────────────────
 *
 * The sandbox had a geocoder-shaped address book, so it could show a live
 * distance and light up the matching delivery band. A real rental stores no
 * distance — `rentals` carries the addresses, the two fees, and nothing about
 * how far apart they are. So the band ladder is shown as the operator's own
 * price list (what it WOULD cost further out, which is the question they get on
 * the phone) with no band lit, and the fee shown is the one actually on the
 * rental. Inventing a matched band would be inventing a distance.
 *
 * ── editing ────────────────────────────────────────────────────────────────
 *
 * `EditPickupReturnDialog` is the only writer, and it deliberately writes TIMES
 * AND LOCATIONS ONLY. Dates are frozen at creation because moving them would
 * desync the price, the insurance policy and a signed agreement — so this stage
 * says that rather than offering a date field that does nothing.
 */

import { useMemo, useState } from "react";
import {
  AlertTriangle,
  CalendarDays,
  Clock,
  KeyRound,
  Lock,
  MapPin,
  Pencil,
  Store,
  Truck,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useTenant } from "@/contexts/TenantContext";
import { useManagerPermissions } from "@/hooks/use-manager-permissions";
import { usePickupLocations, type PickupLocation } from "@/hooks/use-pickup-locations";
import { useRentalSettings } from "@/hooks/use-rental-settings";
import { formatCurrency } from "@/lib/format-utils";
import { resolveAgreementTimeZone } from "@/lib/agreement-datetime";
// v1's dialog, reused as it stands. It is the only writer of pickup/return
// times and locations, it clears the saved-location FKs when a freeform address
// is typed, and it writes an audit-log entry. A v2 copy would be a second
// writer of the same four columns.
import { EditPickupReturnDialog } from "@/components/rentals/edit-pickup-return-dialog";
import type { RentalRow } from "./use-rental-detail-v2";
import type { StageProps } from "./stages";
import {
  cardCls,
  fmtDate,
  fmtDateTime,
  insetCls,
  ActionButton,
  EmptyHint,
  Panel,
  Pill,
} from "./_kit";

/* ══════════════════════════════════════════════════════════════════════════
   Reading a leg off the rental
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * "14:00:00" → "2:00 PM".
 *
 * `rentals.pickup_time` is a bare `time` column with no date and no zone — it
 * means "two in the afternoon wherever the car is". Built against an arbitrary
 * local date rather than parsed as an instant, because there is no instant to
 * parse; the zone it should be read in is stated once in the footer.
 */
function fmtClock(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const [h, m] = String(raw).split(":");
  const hours = Number(h);
  const minutes = Number(m);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null;
  const d = new Date(2000, 0, 1, hours, minutes);
  return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

/** One end of the rental, as the row actually records it. */
type Leg = {
  /** The `date` column for this end. Null on a rental with no return date. */
  date: string | null;
  time: string | null;
  /** True when WE move the car, rather than the customer coming to us. */
  delivered: boolean;
  /** A saved location row, when the rental points at one. */
  location: PickupLocation | null;
  /** Whatever address the rental carries — freeform, or the delivery address. */
  address: string | null;
  /** What this leg adds to the rental. */
  fee: number;
};

/**
 * The Out and Back legs, read exactly the way v1's Pickup & Return card reads
 * them (`rentals/[id]/page.tsx:5823`): the freeform column first, the legacy
 * delivery column as the fallback, and the same pair of location FKs.
 *
 * `uses_delivery_service` is the explicit flag; an address in `delivery_address`
 * / `collection_address` is the older way of saying the same thing. Either is
 * enough. A FEE ON ITS OWN IS NOT — a rental can carry a delivery fee with no
 * address (they exist), and treating money as evidence of a delivery would
 * invent a delivery that never happened. The mismatch gets its own line below
 * instead.
 */
function readLegs(rental: RentalRow, locations: PickupLocation[]): { out: Leg; back: Leg } {
  const byId = (id: string | null | undefined) =>
    id ? (locations.find((l) => l.id === id) ?? null) : null;

  const delivers = rental.uses_delivery_service === true;

  return {
    out: {
      date: rental.start_date ?? null,
      time: rental.pickup_time ?? null,
      delivered: delivers || !!rental.delivery_address,
      location: byId(rental.pickup_location_id ?? rental.delivery_location_id),
      address: rental.pickup_location || rental.delivery_address || null,
      fee: Number(rental.delivery_fee) || 0,
    },
    back: {
      date: rental.end_date ?? null,
      time: rental.return_time ?? null,
      delivered: delivers || !!rental.collection_address,
      location: byId(rental.return_location_id ?? rental.collection_location_id),
      address: rental.return_location || rental.collection_address || null,
      fee: Number(rental.collection_fee) || 0,
    },
  };
}

/** Are both ends the same place, handled the same way? */
const sameBothWays = (out: Leg, back: Leg) =>
  out.delivered === back.delivered &&
  (out.location?.id ?? null) === (back.location?.id ?? null) &&
  (out.address ?? "") === (back.address ?? "");

const miles = (km: number) => Math.round(km / 1.609);

/* ══════════════════════════════════════════════════════════════════════════
   The stage
   ══════════════════════════════════════════════════════════════════════════ */

export function StageWhenWhere({ detail, refetch }: StageProps) {
  const { tenant } = useTenant();
  const { canEdit } = useManagerPermissions();
  const { locations, locationSettings } = usePickupLocations();
  const { settings } = useRentalSettings();
  const [editOpen, setEditOpen] = useState(false);

  const rental = detail.rental;
  const currency = tenant?.currency_code || "USD";

  const { out, back } = useMemo(() => readLegs(rental, locations), [rental, locations]);

  const mirrored = sameBothWays(out, back);
  const anyDelivery = out.delivered || back.delivered;

  /* A fee with no delivery behind it. Not an error and not amber — amber on this
     screen means "out of date" and nothing else — but an operator reading the
     rental deserves to know the money and the arrangement disagree. */
  const orphanFee =
    (!out.delivered && out.fee > 0) || (!back.delivered && back.fee > 0);

  const lockboxOffered = settings?.lockbox_enabled === true;
  const lockboxChosen = String(rental.delivery_method ?? "") === "lockbox";
  const lockboxFitted = !!detail.vehicle?.lockbox_code;

  const mayEdit = canEdit("rentals");
  const timezone = resolveAgreementTimeZone(rental as never, tenant as never);

  /* Neither end has an address. Not a broken record — a rental created before
     the locations feature, or one an operator has not filled in — so it says
     what is missing rather than rendering two empty cards. */
  const nothingRecorded = !out.address && !back.address && !out.location && !back.location;

  return (
    <Panel
      title="When & where"
      description="One stage, because it is one decision. Where the car changes hands depends on whether you are delivering it, and the lockbox depends on the car."
      footer={
        <div className="flex flex-wrap items-center gap-3">
          <ActionButton
            variant="outline"
            onClick={() => setEditOpen(true)}
            disabled={!mayEdit}
            title={mayEdit ? undefined : "Your role cannot change rentals."}
          >
            <Pencil className="size-4" />
            Edit times &amp; locations
          </ActionButton>
          <p className="text-xs text-muted-foreground">
            Dates are fixed after creation — moving them would desync price, cover and agreement.
          </p>
        </div>
      }
    >
      {nothingRecorded ? (
        <EmptyHint>
          No pickup or return location is recorded on this rental. The dates below are real; where the car
          changes hands has simply never been filled in.
        </EmptyHint>
      ) : null}

      {/* ── out ──────────────────────────────────────────────────────────── */}
      <LegCard kind="out" leg={out} currency={currency} />

      {/* ── the time that passes ──────────────────────────────────────────
          Between the two halves, where it actually elapses. */}
      <div className="flex items-center gap-3">
        <span className="h-px flex-1 bg-foreground/10" />
        <span className="inline-flex items-center gap-1.5 rounded-full bg-muted/70 px-3 py-1 text-[11px] font-medium text-muted-foreground">
          <Clock className="size-3" />
          {detail.days == null
            ? "No return date set"
            : `${detail.days} day${detail.days === 1 ? "" : "s"}${
                rental.rental_period_type ? ` · billed ${String(rental.rental_period_type).toLowerCase()}` : ""
              }`}
        </span>
        <span className="h-px flex-1 bg-foreground/10" />
      </div>

      {/* ── back ─────────────────────────────────────────────────────────── */}
      <LegCard kind="back" leg={back} currency={currency} mirrors={mirrored} />

      {orphanFee && (
        <div className={cn(insetCls, "flex items-start gap-3 px-5 py-4")}>
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-muted-foreground/70" />
          <p className="text-xs text-muted-foreground">
            A delivery or collection fee is on this rental, but neither end is recorded as a delivery. The money
            is real — the arrangement behind it was never written down.
          </p>
        </div>
      )}

      {/* ── delivery ──────────────────────────────────────────────────────
          Only once the rental actually says a car is being moved. */}
      {anyDelivery && <DeliveryBlock settings={locationSettings} currency={currency} />}

      {/* ── lockbox ───────────────────────────────────────────────────────
          Two conditions, both real: the car is being DELIVERED (a customer
          standing at your counter is handed the keys by a person), and the
          tenant has lockboxes turned on at all. A disabled lockbox control on a
          tenant that does not run lockboxes would be a promise nothing keeps. */}
      {anyDelivery && lockboxOffered && (
        <div className={cn(cardCls, "p-6")}>
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <span className="flex size-8 items-center justify-center rounded-full bg-primary-light text-primary">
                <KeyRound className="size-4" />
              </span>
              <div>
                <p className="font-heading text-sm font-semibold">Keys</p>
                <p className="text-[11px] text-muted-foreground">How the customer gets into the car</p>
              </div>
            </div>
            <Pill tone={lockboxChosen ? "primary" : "neutral"}>
              {lockboxChosen ? "Lockbox" : "In person"}
            </Pill>
          </div>

          {lockboxChosen ? (
            lockboxFitted ? (
              <div className={cn(insetCls, "px-5 py-4")}>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                      Code
                    </p>
                    <p className="mt-1 font-heading text-lg font-semibold tracking-tight tabular-nums">
                      {detail.vehicle?.lockbox_code}
                    </p>
                  </div>
                  <div>
                    <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                      Where the box is
                    </p>
                    <p className="mt-1 text-sm">
                      {detail.vehicle?.lockbox_instructions || "Not recorded on the car."}
                    </p>
                  </div>
                </div>
                <p className="mt-4 text-xs text-muted-foreground">
                  {rental.lockbox_sent_at
                    ? `Sent ${fmtDateTime(rental.lockbox_sent_at)}`
                    : settings?.lockbox_send_offset_minutes
                      ? `Goes out ${settings.lockbox_send_offset_minutes} minutes before the handover.`
                      : "Not sent yet."}
                  {Array.isArray(settings?.lockbox_notification_methods) &&
                    settings.lockbox_notification_methods.length > 0 &&
                    ` By ${settings.lockbox_notification_methods.join(" and ")}.`}
                </p>
              </div>
            ) : (
              <div className={cn(insetCls, "flex items-start gap-3 px-5 py-4")}>
                <Lock className="mt-0.5 size-4 shrink-0 text-muted-foreground/70" />
                <p className="text-xs text-muted-foreground">
                  This rental is set to a lockbox handover, but no lockbox code is recorded on{" "}
                  {detail.vehicle?.reg ?? "the car"}. Nothing can be sent until one is — it is set on the
                  vehicle.
                </p>
              </div>
            )
          ) : (
            <p className="text-xs text-muted-foreground">
              Somebody hands the keys over. Lockbox delivery is chosen when the rental is created, and the
              handover itself is recorded on the Handover stage.
            </p>
          )}
        </div>
      )}

      <p className="text-xs italic text-muted-foreground">Times shown in {timezone}.</p>

      {/* ── the reused v1 dialog ─────────────────────────────────────────── */}
      {/* Re-read on close, always. The dialog invalidates v1's key
          (`["rental", id]`) and three list keys, but not `rental-detail-v2` —
          the control centre reads a different column set under a different key
          on purpose. Without this the edit lands in the database and this
          screen keeps showing the old time. */}
      <EditPickupReturnDialog
        open={editOpen}
        onOpenChange={(open) => {
          setEditOpen(open);
          if (!open) refetch();
        }}
        rental={rental}
      />
    </Panel>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   One half
   ══════════════════════════════════════════════════════════════════════════ */

function LegCard({
  kind,
  leg,
  currency,
  mirrors,
}: {
  kind: "out" | "back";
  leg: Leg;
  currency: string;
  /** Only the Back card notes that it repeats the Out card. */
  mirrors?: boolean;
}) {
  const isOut = kind === "out";
  const clock = fmtClock(leg.time);

  /* A saved location wins the headline — an operator knows "DFW International"
     and would have to read the street address to recognise it. Where the rental
     only carries freeform text (which is what the edit dialog writes, since it
     clears the FKs), that text IS the place. */
  const place = leg.location?.name ?? leg.address ?? null;
  const placeDetail = leg.location?.address ?? null;

  return (
    <div className={cn(cardCls, "p-6")}>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <span className="flex size-8 items-center justify-center rounded-full bg-primary-light text-primary">
            {isOut ? <Truck className="size-4" /> : <Store className="size-4" />}
          </span>
          <div>
            <p className="font-heading text-sm font-semibold">{isOut ? "Out" : "Back"}</p>
            <p className="text-[11px] text-muted-foreground">
              {isOut ? "The car leaves you" : "The car returns to you"}
            </p>
          </div>
        </div>
        <Pill tone={leg.delivered ? "primary" : "neutral"}>
          {leg.delivered ? (isOut ? "We deliver" : "We collect") : isOut ? "Customer collects" : "Customer returns it"}
        </Pill>
      </div>

      <div className="grid gap-2 sm:grid-cols-2">
        <div className={cn(insetCls, "px-4 py-3")}>
          <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
            {isOut ? "Pickup date" : "Return date"}
          </p>
          <p className="mt-1 flex items-center gap-2 font-heading text-sm font-semibold">
            <CalendarDays className="size-3.5 text-muted-foreground" />
            {leg.date ? fmtDate(leg.date) : "Open-ended"}
          </p>
        </div>
        <div className={cn(insetCls, "px-4 py-3")}>
          <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
            {isOut ? "Pickup time" : "Return time"}
          </p>
          <p
            className={cn(
              "mt-1 flex items-center gap-2 font-heading text-sm font-semibold",
              !clock && "font-normal text-muted-foreground"
            )}
          >
            <Clock className="size-3.5 text-muted-foreground" />
            {clock ?? "No time set"}
          </p>
        </div>
      </div>

      <div className={cn(insetCls, "mt-2 flex items-start gap-3 px-5 py-4")}>
        <MapPin className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          {place ? (
            <>
              <p className="text-[13px] font-medium">{place}</p>
              {placeDetail && <p className="mt-0.5 text-xs text-muted-foreground">{placeDetail}</p>}
              {leg.location?.description && (
                <p className="mt-0.5 text-xs text-muted-foreground">{leg.location.description}</p>
              )}
            </>
          ) : (
            <p className="text-[13px] text-muted-foreground">
              {isOut ? "No pickup location recorded." : "No return location recorded."}
            </p>
          )}
          {mirrors && (
            <p className="mt-1.5 text-xs text-muted-foreground">Same place, same way, as the pickup.</p>
          )}
        </div>
        {leg.fee > 0 && (
          <span className="shrink-0 text-xs font-medium text-muted-foreground">
            +{formatCurrency(leg.fee, currency)}
          </span>
        )}
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   Delivery bands
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * The operator's own delivery price list.
 *
 * NO BAND IS LIT, and that is the honest part. `rentals` stores the fee that was
 * charged but never the distance it was charged for, so which band applied is
 * not recoverable — the sandbox knew because it made the distance up. What the
 * ladder still answers is the question an operator gets on the phone: what would
 * it cost if they were ten miles further out. The fee actually on this rental is
 * shown on the leg card above, where the money belongs.
 *
 * Bands are stored in kilometres (matching `pickup_area_radius_km`) and shown in
 * miles, exactly as the settings screen and the booking flow show them.
 */
function DeliveryBlock({
  settings,
  currency,
}: {
  settings: ReturnType<typeof usePickupLocations>["locationSettings"];
  currency: string;
}) {
  const tiers = settings?.delivery_tiers_enabled ? (settings.delivery_distance_tiers ?? []) : [];
  const capKm = settings?.delivery_max_distance_km ?? null;

  if (tiers.length === 0) {
    // Flat-fee tenant, or no delivery pricing configured at all. One line beats
    // an empty ladder.
    return (
      <div className={cn(insetCls, "flex items-center justify-between gap-3 px-5 py-3.5")}>
        <p className="text-xs text-muted-foreground">Your delivery charge</p>
        <p className="text-sm font-semibold">
          {settings?.area_delivery_fee ? formatCurrency(settings.area_delivery_fee, currency) : "Not set"}
        </p>
      </div>
    );
  }

  return (
    <div className={cn(insetCls, "overflow-hidden")}>
      <p className="px-5 py-3.5 text-xs font-medium text-muted-foreground">
        Your delivery bands — the rental&rsquo;s own fee is on the card above
      </p>
      <div className="divide-y divide-foreground/5 border-t border-foreground/5">
        {tiers.map((t, i) => (
          <div
            key={i}
            className="flex items-center justify-between px-5 py-2.5 text-xs text-muted-foreground"
          >
            <span>{t.up_to_km === null ? "Anywhere further" : `Up to ${miles(t.up_to_km)} miles`}</span>
            <span>{formatCurrency(t.fee, currency)}</span>
          </div>
        ))}
      </div>
      {capKm !== null && (
        <p className="border-t border-foreground/5 px-5 py-2.5 text-[11px] text-muted-foreground">
          You deliver up to {miles(capKm)} miles.
        </p>
      )}
    </div>
  );
}
