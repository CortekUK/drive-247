"use client";

/**
 * PRICING, part two — Extras & surcharges.
 *
 * Everything charged ON TOP of the base rate: add-ons a customer picks, and
 * dates that cost more.
 *
 * The fleet-wide rules — the weekend percentage, the holiday periods — are set
 * once in Settings and are shown here READ-ONLY on purpose. What this car owns
 * is whether it takes part, and at what number. Letting a vehicle screen edit
 * the fleet rule would mean editing every car at once from a page that is
 * about one of them.
 */

import { useMemo, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import {
  ActionButton,
  AffixInput,
  Aside,
  DataRow,
  EmptyHint,
  Field,
  IconButton,
  List,
  NumberInput,
  Panel,
  Pill,
  Section,
  Select,
  SwitchRow,
  fmtDate,
  num,
  todayISO,
  useFmt,
} from "./kit";
import type { RentalExtra } from "@/hooks/use-rental-extras";
import type { VehicleExtra } from "@/hooks/use-vehicle-extras";
import type { TenantHoliday } from "@/hooks/use-tenant-holidays";
import type {
  VehiclePricingOverride,
  VehiclePricingOverrideUpsert,
} from "@/hooks/use-vehicle-pricing-overrides";
import type { VehicleDailyPriceRow } from "@/hooks/use-vehicle-daily-prices";

const WEEKDAYS = [
  { day: 1, label: "Mon" },
  { day: 2, label: "Tue" },
  { day: 3, label: "Wed" },
  { day: 4, label: "Thu" },
  { day: 5, label: "Fri" },
  { day: 6, label: "Sat" },
  { day: 0, label: "Sun" },
];

/** What a surcharge rule does on THIS car. `inherit` means no override row. */
type Mode = "inherit" | "excluded" | "custom_percent" | "fixed_price";

const MODES: { value: Mode; label: string }[] = [
  { value: "inherit", label: "Fleet rule" },
  { value: "excluded", label: "Opted out" },
  { value: "custom_percent", label: "Custom %" },
  { value: "fixed_price", label: "Fixed price" },
];

export function AddonsTab({
  vehicleId,
  dailyRate,
  allExtras,
  vehicleExtras,
  onAssignExtra,
  onRemoveExtra,
  weekendPercent,
  weekendDays,
  holidays,
  overrides,
  onUpsertOverride,
  onResetOverride,
  dayPrices,
  onSetDayPrice,
  onClearDayPrice,
  readOnly,
}: {
  vehicleId: string;
  dailyRate: number;
  allExtras: RentalExtra[];
  vehicleExtras: VehicleExtra[];
  onAssignExtra: (extraId: string, price: number) => void;
  onRemoveExtra: (extraId: string) => void;
  weekendPercent: number;
  weekendDays: number[];
  holidays: TenantHoliday[];
  overrides: VehiclePricingOverride[];
  onUpsertOverride: (o: VehiclePricingOverrideUpsert) => void;
  onResetOverride: (ruleType: "weekend" | "holiday", holidayId?: string | null) => void;
  dayPrices: VehicleDailyPriceRow[];
  onSetDayPrice: (date: string, price: number) => void;
  onClearDayPrice: (date: string) => void;
  readOnly: boolean;
}) {
  const fmt = useFmt();
  const [dayDraft, setDayDraft] = useState({ date: "", price: "" });

  const perVehicle = useMemo(
    () => allExtras.filter((e) => e.pricing_type === "per_vehicle"),
    [allExtras],
  );
  const globalExtras = useMemo(
    () => allExtras.filter((e) => e.pricing_type === "global" && e.is_active),
    [allExtras],
  );
  const assigned = useMemo(
    () => new Map(vehicleExtras.map((v) => [v.extra_id, v])),
    [vehicleExtras],
  );

  const lifted = (percent: number) => Math.round(dailyRate * (1 + percent / 100));

  const weekendOverride = overrides.find((o) => o.rule_type === "weekend");
  const holidayOverride = (id: string) =>
    overrides.find((o) => o.rule_type === "holiday" && o.holiday_id === id);

  const upcoming = useMemo(() => {
    const today = todayISO();
    return holidays.filter((h) => h.recurs_annually || h.end_date >= today);
  }, [holidays]);

  return (
    <Panel title="Extras & surcharges" description="Everything charged on top of the base rate.">
      {/* ── extras ──────────────────────────────────────────────────────── */}
      <Section
        title="Extras"
        hint="Switch one on to offer it with this car, and set what it costs here."
      >
        {perVehicle.length === 0 ? (
          <EmptyHint>
            No per-vehicle extras exist yet. Create them in Settings → Rental extras and they will
            appear here.
          </EmptyHint>
        ) : (
          <List>
            {perVehicle.map((e) => {
              const row = assigned.get(e.id);
              const on = !!row;
              return (
                <div key={e.id} className="flex items-center gap-3 pr-3">
                  <div className="min-w-0 flex-1">
                    <SwitchRow
                      checked={on}
                      disabled={readOnly}
                      onChange={(v) =>
                        v ? onAssignExtra(e.id, Number(e.price) || 0) : onRemoveExtra(e.id)
                      }
                      label={e.name}
                      hint={
                        on
                          ? e.description || undefined
                          : `Not offered with this car · ${fmt.money(e.price)} elsewhere`
                      }
                    />
                  </div>
                  {on && (
                    <div className="w-28 shrink-0">
                      <ExtraPriceInput
                        value={row!.price}
                        disabled={readOnly}
                        prefix={fmt.currencySymbol}
                        onCommit={(n) => onAssignExtra(e.id, n)}
                      />
                    </div>
                  )}
                </div>
              );
            })}
          </List>
        )}

        {globalExtras.length > 0 && (
          <div className="mt-4">
            <Aside>
              <span className="font-medium text-foreground">Offered with every car:</span>{" "}
              {globalExtras.map((e) => `${e.name} (${fmt.money(e.price)})`).join(" · ")}
            </Aside>
          </div>
        )}
      </Section>

      {/* ── weekends ────────────────────────────────────────────────────── */}
      <Section
        title="Weekends"
        hint={
          weekendPercent > 0
            ? `The fleet rule adds ${weekendPercent}% on ${weekendDays
                .map((d) => WEEKDAYS.find((w) => w.day === d)?.label)
                .filter(Boolean)
                .join(", ")}. Change it in Settings → Pricing.`
            : "No weekend surcharge is set for the fleet. Set one in Settings → Pricing."
        }
        action={
          weekendPercent > 0 && dailyRate > 0 ? (
            <Pill tone="neutral">
              {fmt.money(dailyRate)} → {fmt.money(lifted(weekendPercent))}
            </Pill>
          ) : undefined
        }
      >
        {weekendPercent > 0 ? (
          <RuleRow
            label="This car"
            override={weekendOverride}
            dailyRate={dailyRate}
            fleetPercent={weekendPercent}
            disabled={readOnly}
            onChange={(mode, value) => {
              if (mode === "inherit") onResetOverride("weekend", null);
              else
                onUpsertOverride({
                  vehicle_id: vehicleId,
                  rule_type: "weekend",
                  holiday_id: null,
                  override_type: mode,
                  fixed_price: mode === "fixed_price" ? value : null,
                  custom_percent: mode === "custom_percent" ? value : null,
                });
            }}
          />
        ) : (
          <EmptyHint>Nothing to opt out of while the fleet has no weekend surcharge.</EmptyHint>
        )}
      </Section>

      {/* ── holidays ────────────────────────────────────────────────────── */}
      <Section
        title="Holidays"
        hint="Periods are set for the whole fleet in Settings. This car decides whether it takes part."
      >
        {upcoming.length === 0 ? (
          <EmptyHint>No holiday periods are set up.</EmptyHint>
        ) : (
          <div className="space-y-2.5">
            {upcoming.map((h) => {
              const excludedGlobally = h.excluded_vehicle_ids?.includes(vehicleId);
              return (
                <div key={h.id} className="rounded-3xl bg-muted/40 px-5 py-4 ring-1 ring-foreground/5">
                  <div className="flex items-center gap-4">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{h.name}</p>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {fmtDate(h.start_date)} → {fmtDate(h.end_date)} · +{h.surcharge_percent}%
                        {h.recurs_annually ? " · every year" : ""}
                      </p>
                    </div>
                    {excludedGlobally && <Pill tone="neutral">Excluded fleet-side</Pill>}
                  </div>
                  {!excludedGlobally && (
                    <div className="mt-3">
                      <RuleRow
                        label="This car"
                        override={holidayOverride(h.id)}
                        dailyRate={dailyRate}
                        fleetPercent={Number(h.surcharge_percent) || 0}
                        disabled={readOnly}
                        onChange={(mode, value) => {
                          if (mode === "inherit") onResetOverride("holiday", h.id);
                          else
                            onUpsertOverride({
                              vehicle_id: vehicleId,
                              rule_type: "holiday",
                              holiday_id: h.id,
                              override_type: mode,
                              fixed_price: mode === "fixed_price" ? value : null,
                              custom_percent: mode === "custom_percent" ? value : null,
                            });
                        }}
                      />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </Section>

      {/* ── individual days ─────────────────────────────────────────────── */}
      <Section
        title="Individual days"
        hint="A price here wins over the base rate and over both surcharges."
      >
        {dayPrices.length > 0 && (
          <List className="mb-4">
            {dayPrices.map((d) => (
              <DataRow
                key={d.id}
                label={fmtDate(d.date)}
                sub={
                  dailyRate > 0
                    ? `${fmt.money(d.price)} instead of ${fmt.money(dailyRate)}`
                    : fmt.money(d.price)
                }
                right={
                  !readOnly && (
                    <IconButton title="Remove this day" onClick={() => onClearDayPrice(d.date)}>
                      <Trash2 className="size-3.5" />
                    </IconButton>
                  )
                }
              />
            ))}
          </List>
        )}
        {!readOnly && (
          <div className="grid grid-cols-[1fr_1fr_auto] items-end gap-3">
            <AffixInput
              type="date"
              value={dayDraft.date}
              onChange={(v) => setDayDraft((d) => ({ ...d, date: v }))}
            />
            <AffixInput
              value={dayDraft.price}
              onChange={(v) => setDayDraft((d) => ({ ...d, price: v }))}
              prefix={fmt.currencySymbol}
              placeholder="Price that day"
            />
            <ActionButton
              variant="outline"
              disabled={!dayDraft.date || !dayDraft.price}
              onClick={() => {
                onSetDayPrice(dayDraft.date, num(dayDraft.price));
                setDayDraft({ date: "", price: "" });
              }}
            >
              <Plus className="size-4" />
              Add
            </ActionButton>
          </div>
        )}
      </Section>
    </Panel>
  );
}

/* ── one surcharge rule, as it applies to this car ─────────────────────── */

function RuleRow({
  label,
  override,
  dailyRate,
  fleetPercent,
  disabled,
  onChange,
}: {
  label: string;
  override: VehiclePricingOverride | undefined;
  dailyRate: number;
  fleetPercent: number;
  disabled: boolean;
  onChange: (mode: Mode, value: number | null) => void;
}) {
  const fmt = useFmt();
  const mode: Mode = (override?.override_type as Mode) ?? "inherit";
  const [draft, setDraft] = useState<string>(() =>
    override?.override_type === "fixed_price"
      ? String(override.fixed_price ?? "")
      : override?.override_type === "custom_percent"
        ? String(override.custom_percent ?? "")
        : "",
  );

  /** What a day actually costs under the current answer. */
  const effective =
    mode === "excluded"
      ? dailyRate
      : mode === "fixed_price"
        ? num(draft)
        : mode === "custom_percent"
          ? Math.round(dailyRate * (1 + num(draft) / 100))
          : Math.round(dailyRate * (1 + fleetPercent / 100));

  return (
    <div className="flex flex-wrap items-end gap-3">
      <div className="w-40">
        <Field label={label}>
          <Select
            value={mode}
            disabled={disabled}
            options={MODES}
            onChange={(v) => {
              const next = v as Mode;
              setDraft("");
              // Switching to a numeric mode with nothing typed yet would write a
              // null price, so hold off until there is a number to store.
              if (next === "inherit" || next === "excluded") onChange(next, null);
            }}
          />
        </Field>
      </div>

      {(mode === "custom_percent" || mode === "fixed_price") && (
        <div className="w-32">
          <Field label={mode === "custom_percent" ? "Percent" : "Per day"}>
            <AffixInput
              value={draft}
              disabled={disabled}
              prefix={mode === "fixed_price" ? fmt.currencySymbol : undefined}
              suffix={mode === "custom_percent" ? "%" : undefined}
              placeholder="0"
              onChange={setDraft}
              onBlur={() => {
                if (draft.trim() !== "") onChange(mode, num(draft));
              }}
            />
          </Field>
        </div>
      )}

      {dailyRate > 0 && (
        <p className="pb-2.5 text-xs text-muted-foreground">
          {mode === "excluded" ? "Stays at " : "A day costs "}
          <span className="font-medium text-foreground">{fmt.money(effective)}</span>
        </p>
      )}
    </div>
  );
}

/* ── a per-vehicle extra's price ───────────────────────────────────────── */

/**
 * Commits on blur rather than per keystroke.
 *
 * Every other input on this screen writes through `patch()`, which coalesces
 * into one UPDATE on the vehicle row. This one goes through a react-query
 * mutation with its own toast, so a keystroke commit would fire a request and
 * a toast per character.
 */
function ExtraPriceInput({
  value,
  prefix,
  disabled,
  onCommit,
}: {
  value: number;
  prefix: string;
  disabled: boolean;
  onCommit: (n: number) => void;
}) {
  const [raw, setRaw] = useState(String(value));
  return (
    <AffixInput
      value={raw}
      prefix={prefix}
      disabled={disabled}
      className="h-8 text-xs"
      onChange={setRaw}
      onBlur={() => {
        const next = num(raw);
        if (next !== value) onCommit(next);
      }}
    />
  );
}
