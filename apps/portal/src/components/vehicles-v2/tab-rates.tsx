"use client";

/**
 * PRICING, part one — Rates & mileage.
 *
 * The price sheet: what a day costs, what mileage that buys, what going over
 * costs, and which hire lengths are on offer. v1 spreads the same content over
 * four cards on two screens; here it is one tab with one question, and nothing
 * on it explains itself — the inputs are the explanation.
 */

import {
  Aside,
  Field,
  List,
  NumberInput,
  Panel,
  Section,
  SwitchRow,
  useFmt,
} from "./kit";
import type { VehicleRecord } from "./use-vehicle-record";

export function RatesTab({
  vehicle,
  patch,
  patchNow,
  depositMode,
  globalDeposit,
  monthlyTierDays,
  readOnly,
}: {
  vehicle: VehicleRecord;
  patch: (fields: Partial<VehicleRecord>) => void;
  patchNow: (fields: Partial<VehicleRecord>) => void;
  /** `global` means the tenant charges one deposit for every car. */
  depositMode: "global" | "per_vehicle" | null;
  globalDeposit: number | null;
  /** Where the monthly tier starts, from the tenant's rental settings. */
  monthlyTierDays: number;
  readOnly: boolean;
}) {
  const fmt = useFmt();
  const daily = Number(vehicle.daily_rent) || 0;

  /** The per-day figure an operator works out in their head for every long rate. */
  const perDay = (total: number | null, days: number) => {
    const t = Number(total) || 0;
    if (!t || !daily) return undefined;
    const off = Math.round((1 - t / days / daily) * 100);
    return `${fmt.money(Math.round(t / days))}/day${off > 0 ? ` · ${off}% off` : ""}`;
  };

  const noneOn = !vehicle.available_daily && !vehicle.available_weekly && !vehicle.available_monthly;
  const depositIsGlobal = depositMode === "global";

  return (
    <Panel title="Rates & mileage" description="What a hire costs and what it includes.">
      <Section title="Rates">
        <div className="grid grid-cols-2 gap-5 xl:grid-cols-4">
          <Field label="Daily">
            <NumberInput
              value={vehicle.daily_rent}
              onChange={(n) => patch({ daily_rent: n })}
              prefix={fmt.currencySymbol}
              suffix="/day"
              placeholder="0"
              disabled={readOnly}
            />
          </Field>
          <Field label="Weekly" hint={perDay(vehicle.weekly_rent, 7)}>
            <NumberInput
              value={vehicle.weekly_rent}
              onChange={(n) => patch({ weekly_rent: n })}
              prefix={fmt.currencySymbol}
              suffix="/week"
              placeholder="0"
              disabled={readOnly}
            />
          </Field>
          <Field label="Monthly" hint={perDay(vehicle.monthly_rent, monthlyTierDays)}>
            <NumberInput
              value={vehicle.monthly_rent}
              onChange={(n) => patch({ monthly_rent: n })}
              prefix={fmt.currencySymbol}
              suffix="/month"
              placeholder="0"
              disabled={readOnly}
            />
          </Field>
          <Field
            label="Deposit"
            hint={
              depositIsGlobal
                ? `Set for every car in Settings — ${fmt.money(globalDeposit)}.`
                : "Held, not charged."
            }
          >
            <NumberInput
              value={depositIsGlobal ? globalDeposit : vehicle.security_deposit}
              onChange={(n) => patch({ security_deposit: n })}
              prefix={fmt.currencySymbol}
              placeholder="0"
              disabled={readOnly || depositIsGlobal}
            />
          </Field>
        </div>

        <div data-tour="vehicle-hire-lengths" className="mt-5">
          <List>
            <SwitchRow
              checked={vehicle.available_daily}
              onChange={(v) => patchNow({ available_daily: v })}
              label="Daily hire"
              hint="Under 7 days"
              disabled={readOnly}
            />
            <SwitchRow
              checked={vehicle.available_weekly}
              onChange={(v) => patchNow({ available_weekly: v })}
              label="Weekly hire"
              hint={`7 to ${monthlyTierDays - 1} days`}
              disabled={readOnly}
            />
            <SwitchRow
              checked={vehicle.available_monthly}
              onChange={(v) => patchNow({ available_monthly: v })}
              label="Monthly hire"
              hint={`${monthlyTierDays} days and over`}
              disabled={readOnly}
            />
          </List>
          {noneOn && (
            <div className="mt-3">
              <Aside tone="warning">
                Nothing is switched on, so this car is off the booking site entirely — nobody can be
                quoted for it.
              </Aside>
            </div>
          )}
        </div>
      </Section>

      <Section title="Mileage" hint="Included per hire length, and what going over costs.">
        <div className="grid grid-cols-2 gap-5 xl:grid-cols-4">
          <Field label="Daily">
            <NumberInput
              value={vehicle.daily_mileage}
              onChange={(n) => patch({ daily_mileage: n || null })}
              suffix={fmt.distUnit}
              placeholder="Unlimited"
              disabled={readOnly}
            />
          </Field>
          <Field label="Weekly">
            <NumberInput
              value={vehicle.weekly_mileage}
              onChange={(n) => patch({ weekly_mileage: n || null })}
              suffix={fmt.distUnit}
              placeholder="Unlimited"
              disabled={readOnly}
            />
          </Field>
          <Field label="Monthly">
            <NumberInput
              value={vehicle.monthly_mileage}
              onChange={(n) => patch({ monthly_mileage: n || null })}
              suffix={fmt.distUnit}
              placeholder="Unlimited"
              disabled={readOnly}
            />
          </Field>
          <Field label="Over the limit">
            <NumberInput
              value={vehicle.excess_mileage_rate}
              onChange={(n) => patch({ excess_mileage_rate: n || null })}
              prefix={fmt.currencySymbol}
              suffix={`/${fmt.distUnit}`}
              placeholder="0.00"
              disabled={readOnly}
            />
          </Field>
        </div>

        <div className="mt-5">
          <List>
            <SwitchRow
              checked={vehicle.unlimited_mileage_available}
              onChange={(v) => patchNow({ unlimited_mileage_available: v })}
              label="Offer unlimited mileage"
              hint="A paid upgrade the customer picks at checkout"
              disabled={readOnly}
            />
          </List>
          {vehicle.unlimited_mileage_available && (
            <div className="mt-3 grid grid-cols-3 gap-5 rounded-3xl bg-primary-light/50 p-5 ring-1 ring-primary/20">
              <Field label="Per daily hire">
                <NumberInput
                  value={vehicle.unlimited_mileage_price_daily}
                  onChange={(n) => patch({ unlimited_mileage_price_daily: n || null })}
                  prefix={fmt.currencySymbol}
                  placeholder="0"
                  disabled={readOnly}
                />
              </Field>
              <Field label="Per weekly hire">
                <NumberInput
                  value={vehicle.unlimited_mileage_price_weekly}
                  onChange={(n) => patch({ unlimited_mileage_price_weekly: n || null })}
                  prefix={fmt.currencySymbol}
                  placeholder="0"
                  disabled={readOnly}
                />
              </Field>
              <Field label="Per monthly hire">
                <NumberInput
                  value={vehicle.unlimited_mileage_price_monthly}
                  onChange={(n) => patch({ unlimited_mileage_price_monthly: n || null })}
                  prefix={fmt.currencySymbol}
                  placeholder="0"
                  disabled={readOnly}
                />
              </Field>
            </div>
          )}
        </div>
      </Section>
    </Panel>
  );
}
