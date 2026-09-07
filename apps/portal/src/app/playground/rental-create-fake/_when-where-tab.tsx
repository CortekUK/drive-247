"use client";

/**
 * When & where — DESIGN SANDBOX. Nothing here is real.
 *
 * ONE stage, not four, and that is the whole argument of this file.
 *
 * Dates, times, delivery mode and location look like four separate questions
 * until you try to answer them. Choosing "we deliver" changes what LOCATION
 * even means — a branch on your list becomes an address of the customer's — and
 * whether a lockbox is offered at all depends on the car, not on the calendar.
 * Split across four rail stages, the operator answers one question by bouncing
 * between three others. Kept together, the second half of the stage rewrites
 * itself as the first half is answered, and it reads as one decision: the car
 * leaves HERE at THIS time and comes back THERE at THAT one.
 *
 * The two halves are mirrored on purpose — Out and Back carry exactly the same
 * controls — and the Back half opens collapsed behind a "comes back the same
 * way" switch, because most rentals do. One click settles half the stage; the
 * one-way rental is still one click away.
 *
 * GROUNDED IN THE REAL SCHEMA, not invented:
 *   - `pickup_locations` really does carry `is_pickup_enabled` and
 *     `is_return_enabled` separately, so a location can be return-only. The
 *     Brickell lot below is exactly that, and it appears in the Back list only.
 *   - tiered delivery pricing is resolved by `@/lib/delivery-tiers`, the SAME
 *     pure module the live booking flow and portal use. Bands are stored in
 *     kilometres (matching `pickup_area_radius_km`) and shown in miles, and the
 *     hard cap (`delivery_max_distance_km`) is what stops the open-ended band.
 *   - `rentals.delivery_method` really is the enum `lockbox | in_person`, and a
 *     lockbox is only possible when one is fitted to the chosen car.
 *
 * There is no geocoder in a sandbox, so the address field is backed by a short
 * address book with known distances. Typing something not in it leaves the
 * distance unknown — which is a real state the resolver handles, returning the
 * cheapest band as a "from" estimate.
 *
 * OWNS: nothing. Every value is the host page's state, because the rail summary,
 * the price and the agreement all read it.
 *
 * Renders its own `Panel` — drop it straight into the tab switch.
 */

import { useMemo } from "react";
import {
  CalendarDays,
  Clock,
  MapPin,
  Truck,
  Store,
  KeyRound,
  Lock,
  AlertTriangle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui-v2/button";
import { Switch } from "@/components/ui-v2/switch";
import { resolveDeliveryFee, type DeliveryTier } from "@/lib/delivery-tiers";
import { money, Panel, Field, inputCls, cardCls, OptionCard } from "@/app/playground/_shared";

/* ══════════════════════════════════════════════════════════════════════════
   The operator's locations and delivery area
   ══════════════════════════════════════════════════════════════════════════ */

export type SandboxLocation = {
  id: string;
  name: string;
  address: string;
  /** Charged on top of the rental when the customer uses this location. */
  fee: number;
  /** `pickup_locations.is_pickup_enabled` / `is_return_enabled` — genuinely separate. */
  pickup: boolean;
  back: boolean;
};

export const LOCATIONS: SandboxLocation[] = [
  { id: "l1", name: "Downtown Miami", address: "1200 Biscayne Blvd, Miami FL", fee: 0, pickup: true, back: true },
  { id: "l2", name: "Miami International Airport", address: "2100 NW 42nd Ave, Miami FL", fee: 25, pickup: true, back: true },
  { id: "l3", name: "Fort Lauderdale", address: "500 SE 17th St, Fort Lauderdale FL", fee: 15, pickup: true, back: true },
  // Return-only. It exists to prove the two flags are not the same flag.
  { id: "l4", name: "Brickell overflow lot", address: "88 SW 7th St, Miami FL", fee: 0, pickup: false, back: true },
];

/**
 * The tenant's delivery configuration, in the exact shape `@/lib/delivery-tiers`
 * expects. Bands are kilometres; the UI shows miles.
 *   ≤ 16 km (10 mi) → $25   ≤ 40 km (25 mi) → $45   further → $70
 *   hard cap 80 km (50 mi) — beyond it, not deliverable at all.
 */
export const DELIVERY_CFG = {
  delivery_tiers_enabled: true,
  delivery_distance_tiers: [
    { up_to_km: 16, fee: 25 },
    { up_to_km: 40, fee: 45 },
    { up_to_km: null, fee: 70 },
  ] as DeliveryTier[],
  area_delivery_fee: 40,
  delivery_max_distance_km: 80,
};

/** Standing in for a geocoder. Distances are from the operator's area centre. */
const ADDRESS_BOOK: { label: string; km: number }[] = [
  { label: "1200 Biscayne Blvd, Miami FL", km: 6 },
  { label: "820 NE 125th St, North Miami FL", km: 22 },
  { label: "3400 Griffin Rd, Fort Lauderdale FL", km: 51 },
  { label: "700 S Ocean Blvd, Boca Raton FL", km: 92 },
];

const miles = (km: number) => Math.round(km / 1.609);

/** Which cars have a lockbox fitted, and what is in it.
 *  In the real product this is `vehicles.lockbox_code` / `lockbox_instructions`
 *  being set, gated by `tenants.lockbox_enabled`. */
export const LOCKBOX_FLEET: Record<string, { code: string; instructions: string }> = {
  v1: { code: "4821", instructions: "Rear left wheel arch" },
  v3: { code: "7390", instructions: "Under the front bumper, driver side" },
  v6: { code: "1157", instructions: "Behind the rear number plate" },
};

/* ══════════════════════════════════════════════════════════════════════════
   A leg
   ══════════════════════════════════════════════════════════════════════════ */

/** One end of the rental: when the car moves, and how it changes hands. */
export type Leg = {
  date: string;
  time: string;
  /** "" until decided — an undecided mode is a real state, not a default. */
  mode: "" | "collect" | "deliver";
  locationId: string | null;
  address: string;
  /** null when the typed address has not been matched to a known distance. */
  distanceKm: number | null;
  keys: "in_person" | "lockbox";
};

export const emptyLeg = (time: string): Leg => ({
  date: "",
  time,
  mode: "",
  locationId: null,
  address: "",
  distanceKm: null,
  keys: "in_person",
});

/**
 * The Back leg as it actually applies. "Same way" copies the PLACE and the
 * method — never the date and time, which are always the return's own. That is
 * the difference between "comes back the same way" and "comes back at the same
 * moment", and conflating them would make the switch nonsense.
 */
export const effectiveBack = (out: Leg, back: Leg, same: boolean): Leg =>
  same
    ? { ...back, mode: out.mode, locationId: out.locationId, address: out.address, distanceKm: out.distanceKm, keys: out.keys }
    : back;

/** The fee this leg adds to the rental — a location's own fee, or the delivery band. */
export function legFee(leg: Leg): number {
  if (leg.mode === "collect") return LOCATIONS.find((l) => l.id === leg.locationId)?.fee ?? 0;
  if (leg.mode === "deliver") {
    const r = resolveDeliveryFee(leg.distanceKm, DELIVERY_CFG);
    return r.blocked ? 0 : r.fee;
  }
  return 0;
}

/** One short line naming where this leg happens. Written into the agreement. */
export function legPlace(leg: Leg): string {
  if (leg.mode === "collect") return LOCATIONS.find((l) => l.id === leg.locationId)?.name ?? "Not set";
  if (leg.mode === "deliver") return leg.address.trim() || "Address not set";
  return "Not set";
}

/** A leg is settled when it has a date and a place that is actually reachable. */
export function legSettled(leg: Leg): boolean {
  if (!leg.date) return false;
  if (leg.mode === "collect") return !!leg.locationId;
  if (leg.mode === "deliver") {
    if (!leg.address.trim()) return false;
    return !resolveDeliveryFee(leg.distanceKm, DELIVERY_CFG).blocked;
  }
  return false;
}

/* ── duration ───────────────────────────────────────────────────────────── */

export type Span = {
  /** Whole days billed. A part day bills as a day, so this is a ceiling. */
  days: number;
  /** "6 days 4 hours" — what actually elapses. */
  label: string;
  /** True when the elapsed time is not a whole number of days, so `days` rounded up. */
  rounded: boolean;
  /** The return is at or before the pickup. */
  invalid: boolean;
  ready: boolean;
};

export function rentalSpan(out: Leg, back: Leg): Span {
  const blank: Span = { days: 0, label: "", rounded: false, invalid: false, ready: false };
  if (!out.date || !back.date) return blank;

  const a = new Date(`${out.date}T${out.time || "00:00"}`).getTime();
  const b = new Date(`${back.date}T${back.time || "00:00"}`).getTime();
  if (!Number.isFinite(a) || !Number.isFinite(b)) return blank;

  const ms = b - a;
  if (ms <= 0) return { days: 0, label: "", rounded: false, invalid: true, ready: true };

  const whole = Math.floor(ms / 86_400_000);
  const hours = Math.floor((ms - whole * 86_400_000) / 3_600_000);
  const days = Math.ceil(ms / 86_400_000);

  const parts: string[] = [];
  if (whole > 0) parts.push(`${whole} day${whole === 1 ? "" : "s"}`);
  if (hours > 0) parts.push(`${hours} hour${hours === 1 ? "" : "s"}`);

  return {
    days,
    label: parts.length ? parts.join(" ") : "under an hour",
    rounded: days !== whole,
    invalid: false,
    ready: true,
  };
}

/* ══════════════════════════════════════════════════════════════════════════
   Tab
   ══════════════════════════════════════════════════════════════════════════ */

export function WhenWhereTab({
  out,
  back,
  sameAsPickup,
  onOut,
  onBack,
  onSameAsPickup,
  lockbox,
  vehicleReg,
  lockboxCode,
  lockboxInstructions,
  onLockboxCode,
  onLockboxInstructions,
}: {
  out: Leg;
  back: Leg;
  sameAsPickup: boolean;
  onOut: (patch: Partial<Leg>) => void;
  onBack: (patch: Partial<Leg>) => void;
  onSameAsPickup: (on: boolean) => void;
  /** Present only when the chosen car has a lockbox fitted. */
  lockbox: { code: string; instructions: string } | null;
  vehicleReg: string | null;
  lockboxCode: string;
  lockboxInstructions: string;
  onLockboxCode: (v: string) => void;
  onLockboxInstructions: (v: string) => void;
}) {
  const shownBack = effectiveBack(out, back, sameAsPickup);
  const span = rentalSpan(out, shownBack);

  return (
    <Panel
      title="When & where"
      description="One stage, because it is one decision. Where the car changes hands depends on whether you are delivering it, and the lockbox depends on the car."
    >
      <LegCard
        kind="out"
        leg={out}
        onChange={onOut}
        lockbox={lockbox}
        vehicleReg={vehicleReg}
        lockboxCode={lockboxCode}
        lockboxInstructions={lockboxInstructions}
        onLockboxCode={onLockboxCode}
        onLockboxInstructions={onLockboxInstructions}
      />

      {/* The span sits between the two halves, where the time actually passes. */}
      <div className="flex items-center gap-3">
        <span className="h-px flex-1 bg-foreground/10" />
        {span.invalid ? (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-destructive-light px-3 py-1 text-[11px] font-medium text-destructive">
            <AlertTriangle className="size-3" />
            The car comes back before it goes out
          </span>
        ) : span.ready ? (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-muted/70 px-3 py-1 text-[11px] font-medium text-muted-foreground">
            <Clock className="size-3" />
            {span.label}
            {span.rounded && ` · billed as ${span.days} day${span.days === 1 ? "" : "s"}`}
          </span>
        ) : (
          <span className="rounded-full bg-muted/70 px-3 py-1 text-[11px] text-muted-foreground">
            Set both dates for a duration
          </span>
        )}
        <span className="h-px flex-1 bg-foreground/10" />
      </div>

      <LegCard
        kind="back"
        leg={shownBack}
        onChange={onBack}
        lockbox={lockbox}
        vehicleReg={vehicleReg}
        lockboxCode={lockboxCode}
        lockboxInstructions={lockboxInstructions}
        onLockboxCode={onLockboxCode}
        onLockboxInstructions={onLockboxInstructions}
        mirror={{ same: sameAsPickup, onSame: onSameAsPickup, of: out }}
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
  onChange,
  lockbox,
  vehicleReg,
  lockboxCode,
  lockboxInstructions,
  onLockboxCode,
  onLockboxInstructions,
  mirror,
}: {
  kind: "out" | "back";
  leg: Leg;
  onChange: (patch: Partial<Leg>) => void;
  lockbox: { code: string; instructions: string } | null;
  vehicleReg: string | null;
  lockboxCode: string;
  lockboxInstructions: string;
  onLockboxCode: (v: string) => void;
  onLockboxInstructions: (v: string) => void;
  /** Only the Back half mirrors another leg. */
  mirror?: { same: boolean; onSame: (on: boolean) => void; of: Leg };
}) {
  const isOut = kind === "out";
  const collapsed = !!mirror?.same;

  const places = LOCATIONS.filter((l) => (isOut ? l.pickup : l.back));

  const delivery = useMemo(() => resolveDeliveryFee(leg.distanceKm, DELIVERY_CFG), [leg.distanceKm]);

  const suggestions = useMemo(() => {
    const q = leg.address.trim().toLowerCase();
    if (!q) return ADDRESS_BOOK;
    const exact = ADDRESS_BOOK.find((a) => a.label.toLowerCase() === q);
    // Once one is chosen the OTHERS stay on offer rather than the list vanishing.
    // An address that turns out to be beyond the cap has to have a way out that
    // is not "retype the whole thing".
    if (exact) return ADDRESS_BOOK.filter((a) => a !== exact);
    return ADDRESS_BOOK.filter((a) => a.label.toLowerCase().includes(q));
  }, [leg.address]);

  return (
    <div className={cn(cardCls, "p-6")}>
      {/* ── header ─────────────────────────────────────────────────────── */}
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

        {mirror && (
          <label className="flex cursor-pointer items-center gap-2.5 text-[13px] text-muted-foreground">
            Comes back the same way
            <Switch checked={mirror.same} onCheckedChange={mirror.onSame} />
          </label>
        )}
      </div>

      {/* ── when ───────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-4">
        <Field label={isOut ? "Pickup date" : "Return date"}>
          <div className="relative">
            <CalendarDays className="pointer-events-none absolute left-3.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <input
              type="date"
              value={leg.date}
              onChange={(e) => onChange({ date: e.target.value })}
              className={cn(inputCls, "pl-9")}
            />
          </div>
        </Field>
        <Field label={isOut ? "Pickup time" : "Return time"}>
          <div className="relative">
            <Clock className="pointer-events-none absolute left-3.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <input
              type="time"
              value={leg.time}
              onChange={(e) => onChange({ time: e.target.value })}
              className={cn(inputCls, "pl-9")}
            />
          </div>
        </Field>
      </div>

      {/* ── where ──────────────────────────────────────────────────────── */}
      {collapsed ? (
        <div className="mt-5 flex items-start gap-3 rounded-3xl bg-muted/40 px-5 py-4 ring-1 ring-foreground/5">
          <MapPin className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
          <div className="min-w-0 text-[13px]">
            <p className="font-medium">{summarise(mirror!.of)}</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Turn the switch off to return the car somewhere else.
            </p>
          </div>
        </div>
      ) : (
        <div className="mt-6 space-y-6">
          <Field label={isOut ? "How does the customer get the car?" : "How does the car get back?"}>
            <div className="grid grid-cols-2 gap-3">
              <OptionCard
                selected={leg.mode === "collect"}
                onClick={() => onChange({ mode: "collect", address: "", distanceKm: null })}
                title={isOut ? "Customer collects" : "Customer returns it"}
                subtitle={isOut ? "They come to one of your locations" : "They bring it back to you"}
              />
              <OptionCard
                selected={leg.mode === "deliver"}
                onClick={() => onChange({ mode: "deliver", locationId: null })}
                title={isOut ? "We deliver" : "We collect"}
                subtitle={
                  isOut ? "Driven to their address" : "Picked up from their address"
                }
              />
            </div>
          </Field>

          {leg.mode === "collect" && (
            <Field
              label={isOut ? "Pickup location" : "Return location"}
              hint={
                isOut
                  ? "Only locations you have enabled for pickup are listed."
                  : "The return list is its own — the Brickell lot takes returns but never hands cars out."
              }
            >
              <div className="space-y-2">
                {places.map((l) => (
                  <OptionCard
                    key={l.id}
                    selected={leg.locationId === l.id}
                    onClick={() => onChange({ locationId: l.id })}
                    title={l.name}
                    subtitle={l.address}
                    right={
                      l.fee > 0 ? (
                        <span className="shrink-0 text-xs font-medium text-muted-foreground">
                          +{money(l.fee)}
                        </span>
                      ) : undefined
                    }
                  />
                ))}
              </div>
            </Field>
          )}

          {leg.mode === "deliver" && (
            <div className="space-y-4">
              <Field label={isOut ? "Delivery address" : "Collection address"}>
                <div className="relative">
                  <MapPin className="pointer-events-none absolute left-3.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                  <input
                    value={leg.address}
                    onChange={(e) => onChange({ address: e.target.value, distanceKm: null })}
                    placeholder="Start typing an address"
                    className={cn(inputCls, "pl-9")}
                  />
                </div>
              </Field>

              {suggestions.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {suggestions.map((s) => (
                    <Button
                      key={s.label}
                      size="xs"
                      variant="outline"
                      onClick={() => onChange({ address: s.label, distanceKm: s.km })}
                    >
                      {s.label} · {miles(s.km)} mi
                    </Button>
                  ))}
                </div>
              )}

              <DeliveryBands leg={leg} />
            </div>
          )}

          {leg.mode !== "" && (
            <Field
              label="Key handover"
              hint={
                lockbox
                  ? "The code goes out shortly before the handover, by email or SMS."
                  : undefined
              }
            >
              <div className={cn("grid gap-3", lockbox ? "grid-cols-2" : "grid-cols-1")}>
                <OptionCard
                  selected={leg.keys === "in_person"}
                  onClick={() => onChange({ keys: "in_person" })}
                  title="In person"
                  subtitle="Someone hands the keys over"
                />
                {/* Only rendered when a lockbox is genuinely possible: a car has
                    been chosen and one is fitted to it. A disabled control here
                    would be a promise the fleet cannot keep. */}
                {lockbox && (
                  <OptionCard
                    selected={leg.keys === "lockbox"}
                    onClick={() => onChange({ keys: "lockbox" })}
                    title="Lockbox"
                    subtitle={`Fitted to ${vehicleReg ?? "this car"}`}
                  />
                )}
              </div>
            </Field>
          )}

          {leg.mode !== "" && !lockbox && vehicleReg && (
            <p className="-mt-3 flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <Lock className="size-3" />
              No lockbox is fitted to {vehicleReg}, so the keys change hands in person.
            </p>
          )}

          {leg.keys === "lockbox" && lockbox && (
            <div className="space-y-4 rounded-3xl bg-muted/40 p-5 ring-1 ring-foreground/5">
              <div className="flex items-center gap-2">
                <KeyRound className="size-4 text-muted-foreground" />
                <p className="font-heading text-sm font-semibold">What the customer will be sent</p>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <Field label="Code">
                  <input
                    value={lockboxCode}
                    onChange={(e) => onLockboxCode(e.target.value)}
                    placeholder={lockbox.code}
                    className={inputCls}
                  />
                </Field>
                <Field label="Where the box is">
                  <input
                    value={lockboxInstructions}
                    onChange={(e) => onLockboxInstructions(e.target.value)}
                    placeholder={lockbox.instructions}
                    className={inputCls}
                  />
                </Field>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** "Delivered to 1200 Biscayne Blvd, keys in a lockbox" — the collapsed line. */
function summarise(leg: Leg): string {
  const how = leg.keys === "lockbox" ? "keys in the lockbox" : "keys in person";
  if (leg.mode === "collect") {
    const l = LOCATIONS.find((x) => x.id === leg.locationId);
    return l ? `Back to ${l.name}, ${how}` : "Pick where the car goes out from first";
  }
  if (leg.mode === "deliver") {
    return leg.address.trim() ? `Collected from ${leg.address}, ${how}` : "Set the delivery address first";
  }
  return "Decide how the car goes out first";
}

/* ══════════════════════════════════════════════════════════════════════════
   Delivery bands
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * The bands, always visible once delivery is chosen, with the matched one lit.
 * Showing the whole ladder rather than just the resolved number is what lets an
 * operator answer "what would it cost if they were ten miles further out" —
 * which is the question they are actually being asked on the phone.
 */
function DeliveryBands({ leg }: { leg: Leg }) {
  const resolved = resolveDeliveryFee(leg.distanceKm, DELIVERY_CFG);
  const capKm = DELIVERY_CFG.delivery_max_distance_km;
  const known = leg.distanceKm !== null;

  return (
    <div className="overflow-hidden rounded-3xl bg-muted/40 ring-1 ring-foreground/5">
      <div className="flex flex-wrap items-center justify-between gap-2 px-5 py-3.5">
        <p className="text-xs font-medium text-muted-foreground">
          {known ? `${miles(leg.distanceKm as number)} miles from you` : "Distance not known yet"}
        </p>
        {resolved.blocked ? (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-destructive-light px-2.5 py-0.5 text-[11px] font-medium text-destructive">
            <AlertTriangle className="size-3" />
            Outside your delivery area
          </span>
        ) : (
          <p className="text-sm font-semibold">
            {known ? money(resolved.fee) : `from ${money(resolved.fee)}`}
          </p>
        )}
      </div>

      <div className="divide-y divide-foreground/5 border-t border-foreground/5">
        {DELIVERY_CFG.delivery_distance_tiers.map((t, i) => {
          const matched = !resolved.blocked && known && resolved.matchedTier === t;
          return (
            <div
              key={i}
              className={cn(
                "flex items-center justify-between px-5 py-2.5 text-xs",
                matched ? "bg-primary-light font-medium text-primary" : "text-muted-foreground"
              )}
            >
              <span>{t.up_to_km === null ? "Anywhere further" : `Up to ${miles(t.up_to_km)} miles`}</span>
              <span>{money(t.fee)}</span>
            </div>
          );
        })}
      </div>

      <p className="border-t border-foreground/5 px-5 py-2.5 text-[11px] text-muted-foreground">
        {resolved.blocked
          ? `You deliver up to ${miles(capKm)} miles. This address is further out — collect it from a location instead.`
          : known
            ? `You deliver up to ${miles(capKm)} miles.`
            : "Pick a suggested address to price it exactly — the estimate is the cheapest band until then."}
      </p>
    </div>
  );
}
