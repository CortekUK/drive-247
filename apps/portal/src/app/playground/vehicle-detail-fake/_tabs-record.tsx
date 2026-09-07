"use client";

/**
 * RECORD — Listing and Money. Both are PRODUCED from the tabs above, which is
 * why they are the last group, and why they are the only ones that can go
 * amber on their own.
 *
 * The Listing carries the whole argument. It keeps a copy of what the record
 * said when it was published, and when the record moves underneath it, it says
 * so itself — with the real before and after, and both ways out. Amber, never
 * red. A rate going up after a listing went live is a Tuesday.
 *
 * Money is the car's whole financial story on one tab: what it has brought in
 * (the rentals), what it cost (purchase and finance), what it costs to keep,
 * and — at the very end — what it fetched when it left. Retirement lives here
 * rather than on a tab of its own because sale proceeds are the last line of
 * the same sum.
 */

import { useState } from "react";
import { Ban, CircleCheck, Globe, RotateCcw, X } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  ActionButton,
  EmptyHint,
  Field,
  OutOfDateBanner,
  Panel,
  Pill,
  Surface,
  type Drift,
  fmtDate,
  fmtDateTime,
  money,
  textareaCls,
} from "@/app/playground/_shared";
import {
  ACQUISITION_TYPES,
  TODAY,
  UTILISATION_WINDOW_DAYS,
  type Finance,
  type ListingSnapshot,
  type Rental,
  type Retirement,
  daysBetween,
} from "./_data";
import { AffixInput, Aside, DataRow, List, NumberInput, Section, Select, Stat, StatDivider } from "./_ui";

/* ══════════════════════════════════════════════════════════════════════════
 * Listing
 * ═════════════════════════════════════════════════════════════════════════ */

export function ListingTab({
  live,
  publishedAt,
  drift,
  snapshot,
  current,
  photoCount,
  canPublish,
  acknowledged,
  suspendedReason,
  onPublish,
  onAcceptDrift,
  onUnlist,
}: {
  live: boolean;
  publishedAt: Date | null;
  drift: Drift[];
  snapshot: ListingSnapshot | null;
  current: ListingSnapshot;
  photoCount: number;
  canPublish: boolean;
  /** Drift was looked at and the published page kept. It is NOT in sync. */
  acknowledged: boolean;
  suspendedReason: string | null;
  onPublish: () => void;
  onAcceptDrift: () => void;
  onUnlist: () => void;
}) {
  /** What customers are ACTUALLY seeing — the snapshot, not the live record. */
  const shown = live && snapshot ? snapshot : current;

  return (
    <Panel title="Listing" description="The public page on the booking site, built from Vehicle, Rates and Extras.">
      {live && drift.length > 0 && (
        <OutOfDateBanner
          title="Published from details that have since changed"
          meta={publishedAt ? `Published ${fmtDateTime(publishedAt)} — customers still see the left-hand column.` : undefined}
          drift={drift}
          primaryLabel="Republish"
          onPrimary={onPublish}
          secondaryLabel="Keep the published one"
          onSecondary={onAcceptDrift}
        />
      )}

      {live && suspendedReason && (
        <Aside tone="warning">
          <span className="font-semibold">Live but suspended</span> — {suspendedReason}
        </Aside>
      )}

      <Section
        title={live ? "On the booking site" : "Not listed"}
        hint={live && publishedAt ? `Since ${fmtDateTime(publishedAt)}` : undefined}
        action={
          !live ? undefined : drift.length > 0 ? (
            <Pill tone="warning">{drift.length} behind</Pill>
          ) : acknowledged ? (
            <Pill tone="neutral">Kept as published</Pill>
          ) : (
            <Pill tone="success">
              <CircleCheck className="size-3" />
              In sync
            </Pill>
          )
        }
      >
        {!live && !canPublish ? (
          <EmptyHint>Needs a make, model, year, plate, daily rate and deposit first.</EmptyHint>
        ) : (
          <>
            <List>
              <DataRow label={shown.name} sub={`${shown.registration} · ${shown.colour || "colour not set"}`} />
              <DataRow label={`${money(shown.daily)} per day`} sub={`${money(shown.deposit)} deposit · ${shown.durations}`} />
              <DataRow label="Mileage" sub={shown.allowance} />
              <DataRow label="Extras" sub={shown.extras || "None"} />
              <DataRow
                label="Photos"
                sub={shown.photos ? shown.photos.split(" › ").join(" · ") : "None"}
                right={!live && photoCount === 0 ? <Pill tone="warning">None</Pill> : undefined}
              />
            </List>

            {live && acknowledged && (
              <p className="mt-3 text-xs text-muted-foreground">
                The record has moved on since this was published. You chose to keep this version.
              </p>
            )}

            <div className="mt-5 flex flex-wrap gap-2">
              {!live ? (
                <ActionButton onClick={onPublish}>
                  <Globe className="size-4" />
                  Publish
                </ActionButton>
              ) : (
                <>
                  {acknowledged && (
                    <ActionButton onClick={onPublish} variant="outline">
                      <Globe className="size-4" />
                      Republish
                    </ActionButton>
                  )}
                  <ActionButton onClick={onUnlist} variant="outline">
                    <X className="size-4" />
                    Unlist
                  </ActionButton>
                </>
              )}
            </div>
          </>
        )}
      </Section>
    </Panel>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
 * Money
 * ═════════════════════════════════════════════════════════════════════════ */

export function MoneyTab({
  rentals,
  totalRevenue,
  daysOnHire,
  utilisation,
  finance,
  onFinance,
  serviceSpend,
  financePaid,
  contractTotal,
  monthsElapsed,
  net,
  retirement,
  onRetirement,
  hasActiveRental,
}: {
  rentals: Rental[];
  totalRevenue: number;
  daysOnHire: number;
  utilisation: number;
  finance: Finance;
  onFinance: (fn: (f: Finance) => Finance) => void;
  serviceSpend: number;
  financePaid: number;
  contractTotal: number;
  monthsElapsed: number;
  net: number;
  retirement: Retirement;
  onRetirement: (fn: (r: Retirement) => Retirement) => void;
  hasActiveRental: boolean;
}) {
  const setNum = (k: keyof Finance) => (n: number) => onFinance((f) => ({ ...f, [k]: n }));
  const setStr = (k: keyof Finance) => (v: string) => onFinance((f) => ({ ...f, [k]: v }));
  const ahead = net >= 0;

  const tone = (s: Rental["status"]): "primary" | "success" | "neutral" =>
    s === "Active" ? "primary" : s === "Completed" ? "success" : "neutral";

  return (
    <Panel title="Money" description="What this car has brought in, what it cost, and whether it is ahead.">
      <Surface className="flex gap-8">
        <Stat label="Brought in" value={money(totalRevenue)} hint={`${utilisation}% utilisation · ${daysOnHire} of ${UTILISATION_WINDOW_DAYS} days`} />
        <StatDivider />
        <Stat label="Cost to keep" value={money(financePaid + serviceSpend)} hint={`${money(financePaid)} finance · ${money(serviceSpend)} servicing`} />
        <StatDivider />
        <Stat label={ahead ? "Ahead by" : "Behind by"} value={money(Math.abs(net))} hint={`as of ${fmtDate(TODAY)}`} />
      </Surface>

      <Section title="Rentals">
        {rentals.length === 0 ? (
          <EmptyHint>This car has not been out yet.</EmptyHint>
        ) : (
          <List>
            {rentals.map((r) => (
              <DataRow
                key={r.id}
                label={r.customer}
                sub={`${fmtDate(r.from)} → ${fmtDate(r.to)} · ${daysBetween(r.from, r.to)} days`}
                right={
                  <div className="flex items-center gap-4">
                    <span className={cn("text-sm font-medium tabular-nums", r.status === "Cancelled" && "text-muted-foreground")}>{money(r.revenue)}</span>
                    <span className="w-20 text-right">
                      <Pill tone={tone(r.status)}>{r.status}</Pill>
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
            ? `${money(contractTotal)} over the contract · ${money(financePaid)} paid so far (${monthsElapsed} of ${finance.termMonths} months)`
            : undefined
        }
      >
        <div className="grid grid-cols-2 gap-5 xl:grid-cols-4">
          <Field label="Acquired">
            <Select value={finance.acquisitionType} onChange={setStr("acquisitionType")} options={ACQUISITION_TYPES} placeholder="Not set" />
          </Field>
          <Field label="On">
            <AffixInput type="date" value={finance.acquisitionDate} onChange={setStr("acquisitionDate")} />
          </Field>
          <Field label="Purchase price">
            <NumberInput value={finance.purchasePrice} onChange={setNum("purchasePrice")} prefix="$" placeholder="0" />
          </Field>
          <Field label="Initial payment">
            <NumberInput value={finance.initialPayment} onChange={setNum("initialPayment")} prefix="$" placeholder="0" />
          </Field>
          <Field label="Monthly">
            <NumberInput value={finance.monthlyPayment} onChange={setNum("monthlyPayment")} prefix="$" placeholder="0" />
          </Field>
          <Field label="Term">
            <NumberInput value={finance.termMonths} onChange={setNum("termMonths")} suffix="months" placeholder="0" />
          </Field>
          <Field label="Balloon">
            <NumberInput value={finance.balloon} onChange={setNum("balloon")} prefix="$" placeholder="0" />
          </Field>
          <Field label="Finance from">
            <AffixInput type="date" value={finance.startDate} onChange={setStr("startDate")} />
          </Field>
        </div>
      </Section>

      <RetirementSection
        retirement={retirement}
        onChange={onRetirement}
        purchasePrice={finance.purchasePrice}
        totalRevenue={totalRevenue}
        hasActiveRental={hasActiveRental}
      />
    </Panel>
  );
}

/* ── retirement — the last line of the sum ─────────────────────────────── */

function RetirementSection({
  retirement,
  onChange,
  purchasePrice,
  totalRevenue,
  hasActiveRental,
}: {
  retirement: Retirement;
  onChange: (fn: (r: Retirement) => Retirement) => void;
  purchasePrice: number;
  totalRevenue: number;
  hasActiveRental: boolean;
}) {
  /** Closed until asked for — a sale form is the one thing on this screen that
   *  should not be sitting open on a car that is still earning. */
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState({ date: TODAY, buyer: "", proceeds: 0, notes: "" });

  const lifetime = (proceeds: number) => totalRevenue + proceeds - purchasePrice;

  if (retirement.disposed) {
    return (
      <Section title="Retired" action={<Pill tone="neutral">Off the fleet</Pill>}>
        <List className="mb-4">
          <DataRow label={`Sold ${fmtDate(retirement.date)}`} sub={retirement.buyer || "Buyer not recorded"} right={<span className="text-sm font-medium tabular-nums">{money(retirement.proceeds)}</span>} />
          <DataRow
            label="Lifetime position"
            sub={`${money(totalRevenue)} earned + ${money(retirement.proceeds)} sale − ${money(purchasePrice)} paid`}
            right={
              <span className={cn("text-sm font-semibold tabular-nums", lifetime(retirement.proceeds) >= 0 ? "text-success" : "text-warning")}>
                {lifetime(retirement.proceeds) >= 0 ? "+" : "−"}
                {money(Math.abs(lifetime(retirement.proceeds)))}
              </span>
            }
          />
          {retirement.notes && <DataRow label="Notes" sub={retirement.notes} />}
        </List>
        <ActionButton variant="outline" onClick={() => onChange(() => ({ disposed: false, date: "", buyer: "", proceeds: 0, notes: "" }))}>
          <RotateCcw className="size-4" />
          Undo
        </ActionButton>
      </Section>
    );
  }

  if (!open) {
    return (
      <div className="flex items-center justify-between gap-4 px-1">
        <p className="text-xs text-muted-foreground">Sold it? Record the sale and take it off the fleet. Nothing is deleted.</p>
        <ActionButton variant="outline" onClick={() => setOpen(true)}>
          <Ban className="size-4" />
          Retire this vehicle
        </ActionButton>
      </div>
    );
  }

  return (
    <Section title="Retire this vehicle" hint="Unlists it, stops new bookings and closes the record. Rentals and history are kept.">
      {hasActiveRental && <Aside tone="warning">Out on hire — close the open rental first.</Aside>}

      <div className={cn("grid grid-cols-2 gap-5", hasActiveRental && "mt-4")}>
        <Field label="Sold on">
          <AffixInput type="date" value={draft.date} onChange={(v) => setDraft((d) => ({ ...d, date: v }))} />
        </Field>
        <Field label="Sale proceeds" hint={draft.proceeds > 0 && purchasePrice > 0 ? `Lifetime ${lifetime(draft.proceeds) >= 0 ? "+" : "−"}${money(Math.abs(lifetime(draft.proceeds)))}` : undefined}>
          <NumberInput value={draft.proceeds} onChange={(n) => setDraft((d) => ({ ...d, proceeds: n }))} prefix="$" placeholder="0" />
        </Field>
        <Field label="Buyer">
          <AffixInput value={draft.buyer} onChange={(v) => setDraft((d) => ({ ...d, buyer: v }))} placeholder="Front Range Auto Auction" />
        </Field>
        <Field label="Notes">
          <textarea value={draft.notes} onChange={(e) => setDraft((d) => ({ ...d, notes: e.target.value }))} rows={1} className={textareaCls} />
        </Field>
      </div>

      <div className="mt-5 flex gap-2">
        <ActionButton variant="outline" disabled={hasActiveRental} onClick={() => onChange(() => ({ disposed: true, ...draft }))}>
          <Ban className="size-4" />
          Retire
        </ActionButton>
        <ActionButton variant="outline" onClick={() => setOpen(false)}>
          Cancel
        </ActionButton>
      </div>
    </Section>
  );
}
