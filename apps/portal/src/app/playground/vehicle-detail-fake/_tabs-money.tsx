"use client";

/**
 * PRICING — two tabs.
 *
 *   Rates & mileage      the price sheet: what a day costs, what mileage that
 *                        buys, what going over costs, and which hire lengths
 *                        are on offer
 *   Extras & surcharges  everything charged ON TOP of the base rate — add-ons
 *                        a customer picks, and dates that cost more
 *
 * v1 spreads the same content over four cards on two screens. Here it is two
 * tabs with one question each, and nothing on either tab explains itself: the
 * inputs are the explanation.
 */

import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { ActionButton, EmptyHint, Field, Panel, Pill, fmtDate, money } from "@/app/playground/_shared";
import {
  WEEKDAYS,
  type Extra,
  type Mileage,
  type Rates,
  type Seasonal,
  num,
} from "./_data";
import { AffixInput, Aside, DataRow, IconButton, List, NumberInput, Section, SwitchRow } from "./_ui";

/* ══════════════════════════════════════════════════════════════════════════
 * Rates & mileage
 * ═════════════════════════════════════════════════════════════════════════ */

export function RatesTab({
  rates,
  onRates,
  mileage,
  onMileage,
}: {
  rates: Rates;
  onRates: (fn: (r: Rates) => Rates) => void;
  mileage: Mileage;
  onMileage: (fn: (m: Mileage) => Mileage) => void;
}) {
  const setRate = (k: "daily" | "weekly" | "monthly" | "deposit") => (n: number) =>
    onRates((r) => ({ ...r, [k]: n }));
  const setOn = (k: "availableDaily" | "availableWeekly" | "availableMonthly") => (v: boolean) =>
    onRates((r) => ({ ...r, [k]: v }));
  const setMiles = (k: keyof Mileage) => (n: number) => onMileage((m) => ({ ...m, [k]: n }));

  /** The per-day figure an operator works out in their head for every weekly rate. */
  const perDay = (total: number, days: number) =>
    total > 0 && rates.daily > 0
      ? `${money(Math.round(total / days))}/day · ${Math.round((1 - total / days / rates.daily) * 100)}% off`
      : undefined;

  const noneOn = !rates.availableDaily && !rates.availableWeekly && !rates.availableMonthly;

  return (
    <Panel title="Rates & mileage" description="What a hire costs and what it includes.">
      <Section title="Rates">
        <div className="grid grid-cols-2 gap-5 xl:grid-cols-4">
          <Field label="Daily">
            <NumberInput value={rates.daily} onChange={setRate("daily")} prefix="$" suffix="/day" placeholder="0" />
          </Field>
          <Field label="Weekly" hint={perDay(rates.weekly, 7)}>
            <NumberInput value={rates.weekly} onChange={setRate("weekly")} prefix="$" suffix="/week" placeholder="0" />
          </Field>
          <Field label="Monthly" hint={perDay(rates.monthly, 30)}>
            <NumberInput value={rates.monthly} onChange={setRate("monthly")} prefix="$" suffix="/month" placeholder="0" />
          </Field>
          <Field label="Deposit" hint="Held, not charged.">
            <NumberInput value={rates.deposit} onChange={setRate("deposit")} prefix="$" placeholder="0" />
          </Field>
        </div>

        <div className="mt-5">
          <List>
            <SwitchRow checked={rates.availableDaily} onChange={setOn("availableDaily")} label="Daily hire" hint="Under 7 days" />
            <SwitchRow checked={rates.availableWeekly} onChange={setOn("availableWeekly")} label="Weekly hire" hint="7 to 27 days" />
            <SwitchRow checked={rates.availableMonthly} onChange={setOn("availableMonthly")} label="Monthly hire" hint="28 days and over" />
          </List>
          {noneOn && (
            <div className="mt-3">
              <Aside tone="warning">Nothing is switched on, so nobody can book this car.</Aside>
            </div>
          )}
        </div>
      </Section>

      <Section title="Mileage" hint="Included per hire length, and what going over costs.">
        <div className="grid grid-cols-2 gap-5 xl:grid-cols-4">
          <Field label="Daily">
            <NumberInput value={mileage.dailyMiles} onChange={setMiles("dailyMiles")} suffix="miles" placeholder="0" />
          </Field>
          <Field label="Weekly">
            <NumberInput value={mileage.weeklyMiles} onChange={setMiles("weeklyMiles")} suffix="miles" placeholder="0" />
          </Field>
          <Field label="Monthly">
            <NumberInput value={mileage.monthlyMiles} onChange={setMiles("monthlyMiles")} suffix="miles" placeholder="0" />
          </Field>
          <Field label="Over the limit">
            <NumberInput value={mileage.excessPerMile} onChange={setMiles("excessPerMile")} prefix="$" suffix="/mile" placeholder="0.00" />
          </Field>
        </div>

        <div className="mt-5">
          <List>
            <SwitchRow
              checked={mileage.unlimitedAvailable}
              onChange={(v) => onMileage((m) => ({ ...m, unlimitedAvailable: v }))}
              label="Offer unlimited mileage"
              hint="A paid upgrade at checkout"
            />
          </List>
          {mileage.unlimitedAvailable && (
            <div className="mt-3 grid grid-cols-3 gap-5 rounded-3xl bg-primary-light/50 p-5 ring-1 ring-primary/20">
              <Field label="Per daily hire">
                <NumberInput value={mileage.unlimitedDaily} onChange={setMiles("unlimitedDaily")} prefix="$" placeholder="0" />
              </Field>
              <Field label="Per weekly hire">
                <NumberInput value={mileage.unlimitedWeekly} onChange={setMiles("unlimitedWeekly")} prefix="$" placeholder="0" />
              </Field>
              <Field label="Per monthly hire">
                <NumberInput value={mileage.unlimitedMonthly} onChange={setMiles("unlimitedMonthly")} prefix="$" placeholder="0" />
              </Field>
            </div>
          )}
        </div>
      </Section>
    </Panel>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
 * Extras & surcharges
 * ═════════════════════════════════════════════════════════════════════════ */

export function AddonsTab({
  extras,
  onExtras,
  seasonal,
  onSeasonal,
  dailyRate,
  makeId,
}: {
  extras: Extra[];
  onExtras: (fn: (e: Extra[]) => Extra[]) => void;
  seasonal: Seasonal;
  onSeasonal: (fn: (s: Seasonal) => Seasonal) => void;
  dailyRate: number;
  makeId: () => string;
}) {
  const [extraDraft, setExtraDraft] = useState({ name: "", perDay: "" });
  const [dayDraft, setDayDraft] = useState({ date: "", price: "" });

  const addExtra = () => {
    if (!extraDraft.name.trim()) return;
    onExtras((list) => [...list, { id: makeId(), name: extraDraft.name.trim(), perDay: num(extraDraft.perDay), enabled: true }]);
    setExtraDraft({ name: "", perDay: "" });
  };

  const addDay = () => {
    if (!dayDraft.date || !dayDraft.price) return;
    onSeasonal((s) => ({
      ...s,
      dayPrices: [...s.dayPrices, { id: makeId(), date: dayDraft.date, price: num(dayDraft.price) }].sort((a, b) =>
        a.date.localeCompare(b.date),
      ),
    }));
    setDayDraft({ date: "", price: "" });
  };

  const lifted = (percent: number) => Math.round(dailyRate * (1 + percent / 100));
  const weekendHint =
    dailyRate > 0 && seasonal.weekendPercent > 0
      ? `${money(dailyRate)} → ${money(lifted(seasonal.weekendPercent))} per day`
      : "0 switches it off.";

  return (
    <Panel title="Extras & surcharges" description="Everything charged on top of the base rate.">
      <Section title="Extras" hint="Per day. Off hides it for this car only.">
        {extras.length > 0 && (
          <List className="mb-4">
            {extras.map((e) => (
              <div key={e.id} className="flex items-center gap-3 pr-3">
                <div className="min-w-0 flex-1">
                  <SwitchRow
                    checked={e.enabled}
                    onChange={(v) => onExtras((list) => list.map((x) => (x.id === e.id ? { ...x, enabled: v } : x)))}
                    label={e.name}
                  />
                </div>
                <div className="w-24 shrink-0">
                  <AffixInput
                    value={e.perDay}
                    prefix="$"
                    onChange={(v) => onExtras((list) => list.map((x) => (x.id === e.id ? { ...x, perDay: num(v) } : x)))}
                    className="h-8 text-xs"
                  />
                </div>
                <IconButton title={`Remove ${e.name}`} onClick={() => onExtras((list) => list.filter((x) => x.id !== e.id))}>
                  <Trash2 className="size-3.5" />
                </IconButton>
              </div>
            ))}
          </List>
        )}
        <div className="grid grid-cols-[2fr_1fr_auto] items-end gap-3">
          <AffixInput value={extraDraft.name} onChange={(v) => setExtraDraft((d) => ({ ...d, name: v }))} placeholder="Roof box" />
          <AffixInput value={extraDraft.perDay} onChange={(v) => setExtraDraft((d) => ({ ...d, perDay: v }))} prefix="$" placeholder="0" />
          <ActionButton onClick={addExtra} disabled={!extraDraft.name.trim()} variant="outline">
            <Plus className="size-4" />
            Add
          </ActionButton>
        </div>
      </Section>

      <Section title="Weekends" hint="Lifts the daily rate on the days below.">
        <div className="grid grid-cols-[8rem_1fr] items-end gap-5">
          <Field label="Surcharge" hint={weekendHint}>
            <NumberInput
              value={seasonal.weekendPercent}
              onChange={(n) => onSeasonal((s) => ({ ...s, weekendPercent: n }))}
              suffix="%"
              placeholder="0"
            />
          </Field>
          <div className="flex flex-wrap gap-1.5 pb-6">
            {WEEKDAYS.map((d) => {
              const active = seasonal.weekendDays.includes(d.day);
              return (
                <button
                  key={d.day}
                  type="button"
                  aria-pressed={active}
                  onClick={() =>
                    onSeasonal((s) => ({
                      ...s,
                      weekendDays: active ? s.weekendDays.filter((x) => x !== d.day) : [...s.weekendDays, d.day],
                    }))
                  }
                  className={cn(
                    "h-9 w-12 cursor-pointer rounded-3xl text-[13px] font-medium transition-all",
                    active
                      ? "bg-primary-light text-primary ring-2 ring-primary/40"
                      : "bg-card text-muted-foreground shadow-md ring-1 ring-foreground/5 hover:ring-primary/30 dark:ring-foreground/10",
                  )}
                >
                  {d.label}
                </button>
              );
            })}
          </div>
        </div>
      </Section>

      {/* Holidays are set once for the whole fleet. What this car owns is only
          whether it takes part — anything else here would edit every car at
          once from a screen that is about one. */}
      <Section title="Holidays" hint="Set for the whole fleet in Settings. This car can opt out.">
        {seasonal.holidays.length === 0 ? (
          <EmptyHint>No holiday periods set up.</EmptyHint>
        ) : (
          <List>
            {seasonal.holidays.map((h) => (
              <DataRow
                key={h.id}
                label={h.name}
                sub={`${fmtDate(h.from)} → ${fmtDate(h.to)} · +${h.surchargePercent}%${
                  dailyRate > 0 && !h.excluded ? ` · ${money(lifted(h.surchargePercent))}/day` : ""
                }`}
                right={
                  <div className="flex items-center gap-3">
                    <span className="w-20 text-right">
                      {h.excluded ? <Pill tone="neutral">Opted out</Pill> : <Pill tone="primary">Applies</Pill>}
                    </span>
                    <button
                      type="button"
                      onClick={() =>
                        onSeasonal((s) => ({
                          ...s,
                          holidays: s.holidays.map((x) => (x.id === h.id ? { ...x, excluded: !x.excluded } : x)),
                        }))
                      }
                      className="w-16 cursor-pointer text-right text-xs font-medium text-primary transition-opacity hover:opacity-70"
                    >
                      {h.excluded ? "Apply" : "Opt out"}
                    </button>
                  </div>
                }
              />
            ))}
          </List>
        )}
      </Section>

      <Section title="Individual days" hint="A price here wins over the base rate and both surcharges.">
        {seasonal.dayPrices.length > 0 && (
          <List className="mb-4">
            {seasonal.dayPrices.map((d) => (
              <DataRow
                key={d.id}
                label={fmtDate(d.date)}
                sub={dailyRate > 0 ? `${money(d.price)} instead of ${money(dailyRate)}` : money(d.price)}
                right={
                  <IconButton
                    title="Remove this day"
                    onClick={() => onSeasonal((s) => ({ ...s, dayPrices: s.dayPrices.filter((x) => x.id !== d.id) }))}
                  >
                    <Trash2 className="size-3.5" />
                  </IconButton>
                }
              />
            ))}
          </List>
        )}
        <div className="grid grid-cols-[1fr_1fr_auto] items-end gap-3">
          <AffixInput type="date" value={dayDraft.date} onChange={(v) => setDayDraft((d) => ({ ...d, date: v }))} />
          <AffixInput value={dayDraft.price} onChange={(v) => setDayDraft((d) => ({ ...d, price: v }))} prefix="$" placeholder="Price that day" />
          <ActionButton onClick={addDay} disabled={!dayDraft.date || !dayDraft.price} variant="outline">
            <Plus className="size-4" />
            Add
          </ActionButton>
        </div>
      </Section>
    </Panel>
  );
}
