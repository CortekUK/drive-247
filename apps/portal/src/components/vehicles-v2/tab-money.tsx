"use client";

/**
 * RECORD — Money.
 *
 * The car's whole financial story on one tab: what it has brought in, what it
 * cost, what it costs to keep, and — at the very end — what it fetched when it
 * left. Retirement lives here rather than on a tab of its own because sale
 * proceeds are the last line of the same sum.
 *
 * The headline figures come from `pnl_entries`, the ledger the rest of the
 * product posts to (rentals, servicing, fines, acquisition, disposal). Adding
 * up the fields this screen happens to show would produce a second, quietly
 * different answer to "is this car ahead?", and the operator would have no way
 * to tell which one the accountant is looking at.
 */

import { useState } from "react";
import { Ban, RotateCcw } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  ActionButton,
  AffixInput,
  Aside,
  DataRow,
  EmptyHint,
  Field,
  List,
  NumberInput,
  Panel,
  Pill,
  Section,
  Stat,
  StatDivider,
  Surface,
  TextInput,
  daysBetween,
  fmtDate,
  textareaCls,
  todayISO,
  useFmt,
} from "./kit";
import type { VehiclePL, VehicleRecord, VehicleRental } from "./use-vehicle-record";

/** `vehicles_acquisition_type_check` — these four, exactly. */
const ACQUISITION_TYPES = ["Purchase", "Finance", "Lease", "Other"];

const rentalTone = (status: string): "primary" | "success" | "neutral" | "warning" => {
  if (status === "Active") return "primary";
  if (status === "Completed") return "success";
  if (status === "Pending" || status === "Confirmed") return "warning";
  return "neutral";
};

export function MoneyTab({
  vehicle,
  patch,
  rentals,
  pl,
  serviceSpend,
  utilisation,
  daysOnHire,
  utilisationWindow,
  hasOpenRental,
  onDispose,
  onUndoDispose,
  isDisposing,
  readOnly,
}: {
  vehicle: VehicleRecord;
  patch: (fields: Partial<VehicleRecord>) => void;
  rentals: VehicleRental[];
  pl: VehiclePL;
  serviceSpend: number;
  utilisation: number;
  daysOnHire: number;
  utilisationWindow: number;
  hasOpenRental: boolean;
  onDispose: (input: {
    disposal_date: string;
    sale_proceeds: number;
    disposal_buyer?: string;
    disposal_notes?: string;
  }) => void;
  onUndoDispose: () => void;
  isDisposing: boolean;
  readOnly: boolean;
}) {
  const fmt = useFmt();
  const ahead = pl.net >= 0;

  const term = Number(vehicle.term_months) || 0;
  const initial = Number(vehicle.initial_payment) || 0;
  const monthly = Number(vehicle.monthly_payment) || 0;
  const balloon = Number(vehicle.balloon) || 0;
  const contractTotal = initial + term * monthly + balloon;

  /** Whole months from the finance start to today, never past the term. */
  const monthsElapsed = (() => {
    if (!vehicle.finance_start_date) return 0;
    const start = new Date(`${String(vehicle.finance_start_date).slice(0, 10)}T00:00:00`);
    const now = new Date(`${todayISO()}T00:00:00`);
    const months =
      (now.getFullYear() - start.getFullYear()) * 12 +
      (now.getMonth() - start.getMonth()) -
      (now.getDate() < start.getDate() ? 1 : 0);
    return Math.max(0, term ? Math.min(months, term) : months);
  })();
  const financePaid = initial + monthsElapsed * monthly;

  return (
    <Panel title="Money" description="What this car has brought in, what it cost, and whether it is ahead.">
      <Surface className="flex gap-8">
        <Stat
          label="Brought in"
          value={fmt.money(pl.revenue)}
          hint={`${utilisation}% used · ${daysOnHire} of the last ${utilisationWindow} days`}
        />
        <StatDivider />
        <Stat
          label="Cost so far"
          value={fmt.money(pl.costs)}
          hint={serviceSpend > 0 ? `${fmt.money(serviceSpend)} of it servicing` : "acquisition, servicing, fines"}
        />
        <StatDivider />
        <Stat label={ahead ? "Ahead by" : "Behind by"} value={fmt.money(Math.abs(pl.net))} hint="from the ledger" />
      </Surface>

      <Section title="Rentals" hint="Every hire this car has been on, newest first.">
        {rentals.length === 0 ? (
          <EmptyHint>This car has not been out yet.</EmptyHint>
        ) : (
          <List>
            {rentals.map((r) => (
              <DataRow
                key={r.id}
                label={r.customer_name}
                sub={`${fmtDate(r.start_date)} → ${fmtDate(r.end_date)} · ${daysBetween(r.start_date, r.end_date)} days`}
                right={
                  <div className="flex items-center gap-4">
                    <span
                      className={cn(
                        "text-sm font-medium tabular-nums",
                        r.status === "Cancelled" && "text-muted-foreground line-through",
                      )}
                    >
                      {fmt.money(r.total)}
                    </span>
                    <span className="w-24 text-right">
                      <Pill tone={rentalTone(r.status)}>{r.status}</Pill>
                    </span>
                  </div>
                }
              />
            ))}
          </List>
        )}
      </Section>

      <Section
        title="What it cost"
        hint={
          contractTotal > 0
            ? `${fmt.money(contractTotal)} over the contract · ${fmt.money(financePaid)} paid so far${
                term ? ` (${monthsElapsed} of ${term} months)` : ""
              }`
            : undefined
        }
      >
        <div className="grid grid-cols-2 gap-5 xl:grid-cols-4">
          <Field label="Acquired">
            <AcquisitionSelect
              value={vehicle.acquisition_type}
              onChange={(v) => patch({ acquisition_type: v || null })}
              disabled={readOnly}
            />
          </Field>
          <Field label="On">
            <TextInput
              type="date"
              value={vehicle.acquisition_date}
              onChange={(v) => patch({ acquisition_date: v || null })}
              disabled={readOnly}
            />
          </Field>
          <Field label="Purchase price">
            <NumberInput
              value={vehicle.purchase_price}
              onChange={(n) => patch({ purchase_price: n || null })}
              prefix={fmt.currencySymbol}
              placeholder="0"
              disabled={readOnly}
            />
          </Field>
          <Field label="Initial payment">
            <NumberInput
              value={vehicle.initial_payment}
              onChange={(n) => patch({ initial_payment: n })}
              prefix={fmt.currencySymbol}
              placeholder="0"
              disabled={readOnly}
            />
          </Field>
          <Field label="Monthly">
            <NumberInput
              value={vehicle.monthly_payment}
              onChange={(n) => patch({ monthly_payment: n || null })}
              prefix={fmt.currencySymbol}
              placeholder="0"
              disabled={readOnly}
            />
          </Field>
          <Field label="Term">
            <NumberInput
              value={vehicle.term_months}
              onChange={(n) => patch({ term_months: n || null })}
              suffix="months"
              placeholder="0"
              disabled={readOnly}
            />
          </Field>
          <Field label="Balloon">
            <NumberInput
              value={vehicle.balloon}
              onChange={(n) => patch({ balloon: n || null })}
              prefix={fmt.currencySymbol}
              placeholder="0"
              disabled={readOnly}
            />
          </Field>
          <Field label="Finance from">
            <TextInput
              type="date"
              value={vehicle.finance_start_date}
              onChange={(v) => patch({ finance_start_date: v || null })}
              disabled={readOnly}
            />
          </Field>
        </div>
      </Section>

      {pl.byCategory.length > 0 && (
        <Section title="Where it came from and went" hint="Straight from this car's P&L ledger.">
          <List>
            {pl.byCategory.map((c) => (
              <DataRow
                key={`${c.side}:${c.category}`}
                label={c.category}
                sub={c.side}
                right={
                  <span
                    className={cn(
                      "text-sm font-medium tabular-nums",
                      c.side === "Revenue" ? "text-success" : "text-muted-foreground",
                    )}
                  >
                    {c.side === "Revenue" ? "+" : "−"}
                    {fmt.money(c.amount)}
                  </span>
                }
              />
            ))}
          </List>
        </Section>
      )}

      <RetirementSection
        vehicle={vehicle}
        totalRevenue={pl.revenue}
        hasOpenRental={hasOpenRental}
        onDispose={onDispose}
        onUndoDispose={onUndoDispose}
        isDisposing={isDisposing}
        readOnly={readOnly}
      />
    </Panel>
  );
}

/**
 * A plain select rather than the kit's, because a stored value outside the
 * four would be rejected by the constraint on the next write — keeping it as
 * an option would offer the operator a choice that cannot be saved.
 */
function AcquisitionSelect({
  value,
  onChange,
  disabled,
}: {
  value: string | null;
  onChange: (v: string) => void;
  disabled: boolean;
}) {
  const options =
    value && !ACQUISITION_TYPES.includes(value) ? [value, ...ACQUISITION_TYPES] : ACQUISITION_TYPES;
  return (
    <select
      value={value ?? ""}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
      className="flex h-9 w-full cursor-pointer appearance-none rounded-3xl border border-transparent bg-input/50 px-3.5 py-1 text-sm outline-none transition-[color,box-shadow,background-color] focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/30 disabled:cursor-not-allowed disabled:opacity-60"
    >
      <option value="">Not set</option>
      {options.map((o) => (
        <option key={o} value={o}>
          {o}
        </option>
      ))}
    </select>
  );
}

/* ── retirement — the last line of the sum ─────────────────────────────── */

function RetirementSection({
  vehicle,
  totalRevenue,
  hasOpenRental,
  onDispose,
  onUndoDispose,
  isDisposing,
  readOnly,
}: {
  vehicle: VehicleRecord;
  totalRevenue: number;
  hasOpenRental: boolean;
  onDispose: (input: {
    disposal_date: string;
    sale_proceeds: number;
    disposal_buyer?: string;
    disposal_notes?: string;
  }) => void;
  onUndoDispose: () => void;
  isDisposing: boolean;
  readOnly: boolean;
}) {
  const fmt = useFmt();
  /** Closed until asked for — a sale form is the one thing on this screen that
   *  should not sit open on a car that is still earning. */
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState({ date: todayISO(), buyer: "", proceeds: 0, notes: "" });

  const purchase = Number(vehicle.purchase_price) || 0;
  const lifetime = (proceeds: number) => totalRevenue + proceeds - purchase;

  if (vehicle.is_disposed) {
    const proceeds = Number(vehicle.sale_proceeds) || 0;
    const life = lifetime(proceeds);
    return (
      <Section title="Retired" action={<Pill tone="neutral">Off the fleet</Pill>}>
        <List className="mb-4">
          <DataRow
            label={`Sold ${fmtDate(vehicle.disposal_date)}`}
            sub={vehicle.disposal_buyer || "Buyer not recorded"}
            right={<span className="text-sm font-medium tabular-nums">{fmt.money(proceeds)}</span>}
          />
          <DataRow
            label="Lifetime position"
            sub={`${fmt.money(totalRevenue)} earned + ${fmt.money(proceeds)} sale − ${fmt.money(purchase)} paid`}
            right={
              <span
                className={cn(
                  "text-sm font-semibold tabular-nums",
                  life >= 0 ? "text-success" : "text-warning",
                )}
              >
                {life >= 0 ? "+" : "−"}
                {fmt.money(Math.abs(life))}
              </span>
            }
          />
          {vehicle.disposal_notes && <DataRow label="Notes" sub={vehicle.disposal_notes} />}
        </List>
        {!readOnly && (
          <ActionButton variant="outline" onClick={onUndoDispose}>
            <RotateCcw className="size-4" />
            Undo
          </ActionButton>
        )}
      </Section>
    );
  }

  if (readOnly) return null;

  if (!open) {
    return (
      <div className="flex items-center justify-between gap-4 px-1 pb-2">
        <p className="text-xs text-muted-foreground">
          Sold it? Record the sale and take it off the fleet. Nothing is deleted.
        </p>
        <ActionButton variant="outline" onClick={() => setOpen(true)}>
          <Ban className="size-4" />
          Retire this vehicle
        </ActionButton>
      </div>
    );
  }

  return (
    <Section
      title="Retire this vehicle"
      hint="Takes it off the booking site, stops new bookings and closes the record. Rentals and history are kept."
    >
      {hasOpenRental && (
        <div className="mb-4">
          <Aside tone="warning">Still out on hire — close the open rental first.</Aside>
        </div>
      )}

      <div className="grid grid-cols-2 gap-5">
        <Field label="Sold on">
          <AffixInput
            type="date"
            value={draft.date}
            onChange={(v) => setDraft((d) => ({ ...d, date: v }))}
          />
        </Field>
        <Field
          label="Sale proceeds"
          hint={
            draft.proceeds > 0 && purchase > 0
              ? `Lifetime ${lifetime(draft.proceeds) >= 0 ? "+" : "−"}${fmt.money(Math.abs(lifetime(draft.proceeds)))}`
              : undefined
          }
        >
          <NumberInput
            value={draft.proceeds}
            onChange={(n) => setDraft((d) => ({ ...d, proceeds: n }))}
            prefix={fmt.currencySymbol}
            placeholder="0"
          />
        </Field>
        <Field label="Buyer">
          <AffixInput
            value={draft.buyer}
            onChange={(v) => setDraft((d) => ({ ...d, buyer: v }))}
            placeholder="Front Range Auto Auction"
          />
        </Field>
        <Field label="Notes">
          <textarea
            value={draft.notes}
            onChange={(e) => setDraft((d) => ({ ...d, notes: e.target.value }))}
            rows={1}
            className={textareaCls}
          />
        </Field>
      </div>

      <div className="mt-5 flex gap-2">
        <ActionButton
          variant="outline"
          disabled={hasOpenRental || isDisposing || !draft.date}
          onClick={() =>
            onDispose({
              disposal_date: draft.date,
              sale_proceeds: draft.proceeds,
              disposal_buyer: draft.buyer.trim() || undefined,
              disposal_notes: draft.notes.trim() || undefined,
            })
          }
        >
          <Ban className="size-4" />
          {isDisposing ? "Retiring…" : "Retire"}
        </ActionButton>
        <ActionButton variant="outline" onClick={() => setOpen(false)}>
          Cancel
        </ActionButton>
      </div>
    </Section>
  );
}
