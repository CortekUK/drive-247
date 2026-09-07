"use client";

/**
 * Rental control centre — DESIGN SANDBOX. Nothing here is real.
 *
 * No Supabase, no tenant, no auth, no network. Every value is local state over
 * hardcoded demo data, so this route can be opened by anyone and driven hard
 * without touching a single production row.
 *
 * It exists to test one idea: a rental is a living record, not a form you
 * submitted once. There is no Create button. The rental exists from the first
 * click; the stages on the left are decisions you change whenever you like; and
 * anything PRODUCED from those decisions — the agreement, the insurance policy,
 * the damage report — notices when they move underneath it and offers to
 * re-issue itself. The operator never has to remember which document contained
 * which term. The screen remembers for them.
 *
 * This file is the host: the data model, the terms every output is produced
 * from, the drift arithmetic, and the rail. Each stage's panel lives in its own
 * `_*-tab.tsx` beside it.
 */

import { useMemo, useState } from "react";
import { CustomerTab, CUSTOMERS } from "./_customer-tab";
import { VehicleTab, VEHICLES, mileagePlan } from "./_vehicle-tab";
import {
  WhenWhereTab,
  LOCKBOX_FLEET,
  emptyLeg,
  effectiveBack,
  legFee,
  legPlace,
  legSettled,
  rentalSpan,
  type Leg,
} from "./_when-where-tab";
import {
  ExtrasTab,
  EXTRAS,
  extraLineTotal,
  extrasSummary,
  extrasSentence,
  type ExtraSelection,
} from "./_extras-tab";
import { AgreementTab, type AgreementState } from "./_agreement-tab";
import { InsuranceTab, type InsuranceState } from "./_insurance-tab";
import { PaymentsTab } from "./_payments-tab";
import { SEED as LEDGER_SEED, totals as ledgerTotals, type Ledger } from "./_payments-model";
import {
  HandoverTab,
  emptyHandover,
  analyse,
  reportStale,
  type HandoverLeg,
  type DamageReport,
} from "./_handover-tab";
import { RightSidebar } from "./_right-sidebar";
import {
  money,
  fmtDate,
  type Drift,
  StageItem,
  RailHeader,
  HeroChip,
} from "@/app/playground/_shared";

/* ══════════════════════════════════════════════════════════════════════════
   Formatting the host owns
   ══════════════════════════════════════════════════════════════════════════ */

/** "14:30" → "2:30 PM". The stored value stays 24h, as the schema does. */
const fmtTime = (t: string) => {
  if (!t) return "";
  const [h, m] = t.split(":").map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return t;
  const hour = h % 12 === 0 ? 12 : h % 12;
  return `${hour}:${String(m).padStart(2, "0")} ${h >= 12 ? "PM" : "AM"}`;
};

/** "4 Sep" — the rail has 280px and no room for a year. */
const shortDate = (iso: string) =>
  iso ? new Date(`${iso}T00:00:00`).toLocaleDateString("en-US", { day: "numeric", month: "short" }) : "";

const moment = (leg: Leg) => (leg.date ? `${fmtDate(leg.date)}, ${fmtTime(leg.time)}` : "Not set");

/* ══════════════════════════════════════════════════════════════════════════
   Terms — the settings every output is produced from
   ══════════════════════════════════════════════════════════════════════════ */

type Terms = {
  vehicle: string;
  /** Date AND time, as the agreement states them. */
  out: string;
  back: string;
  /**
   * Date only. An insurance policy covers a PERIOD, and moving the pickup from
   * ten to eleven does not invalidate it — so the policy is written against
   * these two and the agreement against the two above. Different documents
   * carry the same fact at different resolutions, and drift has to respect that
   * or the screen cries wolf.
   */
  coverFrom: string;
  coverTo: string;
  outPlace: string;
  backPlace: string;
  keys: string;
  mileage: string;
  extras: string;
  dailyRate: number;
  fees: number;
  deposit: number;
};

const TERM_LABELS: Record<keyof Terms, string> = {
  vehicle: "Vehicle",
  out: "Goes out",
  back: "Comes back",
  coverFrom: "Cover from",
  coverTo: "Cover to",
  outPlace: "Collected from",
  backPlace: "Returned to",
  keys: "Keys",
  mileage: "Mileage",
  extras: "Extras",
  dailyRate: "Daily rate",
  fees: "Delivery & location fees",
  deposit: "Security deposit",
};

/** Which terms actually appear in each document. Drift is only drift if the
 *  document carried the term in the first place. */
const AGREEMENT_TERMS: (keyof Terms)[] = [
  "vehicle",
  "out",
  "back",
  "outPlace",
  "backPlace",
  "keys",
  "mileage",
  "extras",
  "dailyRate",
  "fees",
  "deposit",
];
const INSURANCE_TERMS: (keyof Terms)[] = ["vehicle", "coverFrom", "coverTo"];

function termText(key: keyof Terms, v: Terms[keyof Terms]): string {
  if (key === "coverFrom" || key === "coverTo") return fmtDate(String(v));
  if (key === "dailyRate" || key === "fees" || key === "deposit") return money(Number(v));
  return String(v ?? "—") || "Not set";
}

function driftBetween(snapshot: Terms | null, now: Terms, keys: (keyof Terms)[]): Drift[] {
  if (!snapshot) return [];
  return keys
    .filter((k) => snapshot[k] !== now[k])
    .map((k) => ({ label: TERM_LABELS[k], was: termText(k, snapshot[k]), now: termText(k, now[k]) }));
}

type TabId = "customer" | "vehicle" | "when" | "extras" | "agreement" | "insurance" | "payments" | "handover";

/* ══════════════════════════════════════════════════════════════════════════
   Screen
   ══════════════════════════════════════════════════════════════════════════ */

export default function RentalCreateFakePage() {
  const [tab, setTab] = useState<TabId>("customer");

  // ── inputs ──────────────────────────────────────────────────────────────
  const [customerId, setCustomerId] = useState<string | null>(null);
  const [vehicleId, setVehicleId] = useState<string | null>(null);

  const [out, setOut] = useState<Leg>(() => emptyLeg("10:00"));
  const [back, setBack] = useState<Leg>(() => emptyLeg("10:00"));
  const [sameAsPickup, setSameAsPickup] = useState(true);
  const [lockboxCode, setLockboxCode] = useState("");
  const [lockboxInstructions, setLockboxInstructions] = useState("");

  const [unlimitedMileage, setUnlimitedMileage] = useState(false);
  const [extras, setExtras] = useState<ExtraSelection>({});
  const [dailyRate, setDailyRate] = useState(0);
  const [deposit, setDeposit] = useState(200);
  const [notes, setNotes] = useState("");

  // ── outputs ─────────────────────────────────────────────────────────────
  const [agreementState, setAgreementState] = useState<AgreementState>("not_sent");
  const [agreementSnapshot, setAgreementSnapshot] = useState<Terms | null>(null);
  const [agreementSentAt, setAgreementSentAt] = useState<Date | null>(null);
  const [agreementSignedAt, setAgreementSignedAt] = useState<Date | null>(null);

  const [insuranceState, setInsuranceState] = useState<InsuranceState>("none");
  // One ledger for the rail figure and the Payments surface — never two.
  const [ledger, setLedger] = useState<Ledger>(LEDGER_SEED);
  const [insuranceSnapshot, setInsuranceSnapshot] = useState<Terms | null>(null);
  const [insurancePremium, setInsurancePremium] = useState(0);

  const [giving, setGiving] = useState<HandoverLeg>(emptyHandover);
  const [receiving, setReceiving] = useState<HandoverLeg>(emptyHandover);
  const [report, setReport] = useState<DamageReport | null>(null);

  const customer = CUSTOMERS.find((c) => c.id === customerId) ?? null;
  const vehicle = VEHICLES.find((v) => v.id === vehicleId) ?? null;
  const lockbox = vehicleId ? (LOCKBOX_FLEET[vehicleId] ?? null) : null;

  /* ── derived ───────────────────────────────────────────────────────────── */

  const backLeg = useMemo(() => effectiveBack(out, back, sameAsPickup), [out, back, sameAsPickup]);
  const span = useMemo(() => rentalSpan(out, backLeg), [out, backLeg]);
  const days = span.days;

  const plan = useMemo(() => mileagePlan(vehicle, days, unlimitedMileage), [vehicle, days, unlimitedMileage]);

  /** The second leg only costs money when it happens somewhere else. */
  const samePlace =
    out.mode === backLeg.mode && out.locationId === backLeg.locationId && out.address === backLeg.address;
  const outFee = legFee(out);
  const backFee = samePlace ? 0 : legFee(backLeg);
  const fees = outFee + backFee;

  const upgradeCharge = plan?.unlimited ? plan.upgradeAmount : 0;

  const priceLines = useMemo(() => {
    const lines: { label: string; amount: number }[] = [];
    if (days > 0 && dailyRate > 0) {
      lines.push({ label: `${money(dailyRate)} × ${days} day${days === 1 ? "" : "s"}`, amount: dailyRate * days });
    }
    for (const e of EXTRAS) {
      const qty = extras[e.id] ?? 0;
      if (qty === 0) continue;
      const per = e.billing === "per_day" ? ` × ${Math.max(1, days)} day${days === 1 ? "" : "s"}` : "";
      lines.push({
        label: `${e.name}${qty > 1 ? ` ×${qty}` : ""}${per}`,
        amount: extraLineTotal(e, qty, days),
      });
    }
    if (outFee > 0) {
      lines.push({
        label: out.mode === "deliver" ? "Delivery" : `${legPlace(out)} pickup fee`,
        amount: outFee,
      });
    }
    if (backFee > 0) {
      lines.push({
        label: backLeg.mode === "deliver" ? "Collection" : `${legPlace(backLeg)} return fee`,
        amount: backFee,
      });
    }
    if (upgradeCharge > 0 && plan) {
      lines.push({ label: `Unlimited mileage · ${plan.tierLabel}`, amount: upgradeCharge });
    }
    if (insuranceState === "active") {
      lines.push({ label: "Insurance premium", amount: insurancePremium });
    }
    return lines;
  }, [days, dailyRate, extras, outFee, backFee, out.mode, backLeg, upgradeCharge, plan, insuranceState, insurancePremium]);

  const rentalTotal = priceLines.reduce((sum, l) => sum + l.amount, 0);

  const keysSentence =
    out.keys === backLeg.keys
      ? out.keys === "lockbox"
        ? "Lockbox, both ways"
        : "In person, both ways"
      : `${out.keys === "lockbox" ? "Lockbox" : "In person"} out, ${backLeg.keys === "lockbox" ? "lockbox" : "in person"} back`;

  const terms: Terms = useMemo(
    () => ({
      vehicle: vehicle?.reg ?? "Not set",
      out: moment(out),
      back: moment(backLeg),
      coverFrom: out.date,
      coverTo: backLeg.date,
      outPlace: legPlace(out),
      backPlace: legPlace(backLeg),
      keys: keysSentence,
      mileage: plan?.label ?? "Not set",
      extras: extrasSentence(extras),
      dailyRate,
      fees,
      deposit,
    }),
    [vehicle, out, backLeg, keysSentence, plan, extras, dailyRate, fees, deposit]
  );

  const agreementDrift = agreementState === "not_sent" ? [] : driftBetween(agreementSnapshot, terms, AGREEMENT_TERMS);
  const insuranceDrift = insuranceState === "none" ? [] : driftBetween(insuranceSnapshot, terms, INSURANCE_TERMS);
  const reportDrift = report ? reportStale(report, giving, receiving) : false;

  /**
   * The setup threshold. Crossing it is what turns a private draft into a real
   * rental — not a button. Once a rental has a person, a car, and both ends of
   * the journey settled, there is nothing left to decide that would stop it
   * being real.
   */
  const setupComplete =
    !!customer && !!vehicle && legSettled(out) && legSettled(backLeg) && span.ready && !span.invalid;

  const staleCount = [agreementDrift.length > 0, insuranceDrift.length > 0, reportDrift].filter(Boolean).length;

  const status = receiving.at
    ? { label: "Closed", tone: "muted" as const }
    : giving.at
      ? { label: "Active", tone: "success" as const }
      : setupComplete
        ? { label: "Booked", tone: "primary" as const }
        : { label: "Draft", tone: "muted" as const };

  const rentalNumber = setupComplete ? "RNT-2049" : "—";
  const insuranceQuote = Math.max(35, days * 14);

  /* ── actions ───────────────────────────────────────────────────────────── */

  const patchOut = (p: Partial<Leg>) => setOut((prev) => ({ ...prev, ...p }));
  const patchBack = (p: Partial<Leg>) => setBack((prev) => ({ ...prev, ...p }));

  /**
   * Turning the mirror OFF seeds the return from the pickup rather than blanking
   * it. A one-way rental is usually a small edit to the outbound leg, not a
   * fresh decision, and clearing the card would make the switch feel destructive.
   */
  const toggleMirror = (on: boolean) => {
    if (!on) setBack((prev) => ({ ...prev, ...effectiveBack(out, prev, true) }));
    setSameAsPickup(on);
  };

  // Accepts null because the Vehicle tab offers a 'Clear selection' path.
  const pickVehicle = (id: string | null) => {
    setVehicleId(id);
    const v = VEHICLES.find((x) => x.id === id) ?? null;

    // The rate follows the car, but only until the operator overrides it — an
    // edited rate must survive, or changing your mind about the car silently
    // discards a negotiated price.
    if (v && (dailyRate === 0 || VEHICLES.some((x) => x.rate === dailyRate))) setDailyRate(v.rate);

    // An unlimited upgrade the new car does not sell cannot stay selected.
    if (!v || !v.mileage.unlimited_mileage_available) setUnlimitedMileage(false);

    // Nor can a lockbox handover survive a car with no lockbox on it.
    const box = id ? (LOCKBOX_FLEET[id] ?? null) : null;
    if (!box) {
      setOut((prev) => (prev.keys === "lockbox" ? { ...prev, keys: "in_person" } : prev));
      setBack((prev) => (prev.keys === "lockbox" ? { ...prev, keys: "in_person" } : prev));
      setLockboxCode("");
      setLockboxInstructions("");
    } else {
      setLockboxCode(box.code);
      setLockboxInstructions(box.instructions);
    }
  };

  const sendAgreement = () => {
    setAgreementState("sent");
    setAgreementSnapshot(terms);
    setAgreementSentAt(new Date());
    setAgreementSignedAt(null);
  };

  /** Accept the drift: the document that was signed still stands. Re-snapshot
   *  silently so the screen stops nagging about a difference already decided. */
  const acceptAgreementDrift = () => setAgreementSnapshot(terms);

  const buyInsurance = () => {
    setInsurancePremium(insuranceQuote);
    setInsuranceState("active");
    setInsuranceSnapshot(terms);
  };

  const runAnalysis = () => setReport(analyse(giving, receiving));
  const reviewReport = () => setReport((r) => (r ? { ...r, reviewedAt: new Date() } : r));
  const acceptStaleReport = () =>
    setReport((r) => (r ? { ...r, counts: { before: giving.shots.length, after: receiving.shots.length } } : r));

  /* ── rail model ────────────────────────────────────────────────────────── */

  /**
   * The rail as STAGES, in the order an operator actually works: who, then which
   * car, then when and where, then what rides along, then the paperwork, then
   * the day itself.
   *
   * `value` is deliberately thin: the decision and nothing else. Everything that
   * describes the ENTITY rather than the rental — the customer's rating and
   * history, the car's daily rate, the delivery band — belongs to the main
   * panel. The rail has 280px and one job: say what this rental is made of.
   */
  const STAGES: { id: TabId; label: string; value: string | null; prompt: string }[] = [
    { id: "customer", label: "Customer", value: customer?.name ?? null, prompt: "Who is renting?" },
    { id: "vehicle", label: "Vehicle", value: vehicle?.name ?? null, prompt: "Which car goes out?" },
    {
      id: "when",
      label: "When & where",
      value: out.date && backLeg.date ? `${shortDate(out.date)} → ${shortDate(backLeg.date)}` : null,
      prompt: "When and where?",
    },
    { id: "extras", label: "Extras", value: extrasSummary(extras), prompt: "Anything on top?" },
    {
      id: "agreement",
      label: "Agreement",
      value:
        agreementState === "not_sent"
          ? null
          : agreementState === "signed"
            ? "Signed"
            : agreementState === "opened"
              ? "Opened, unsigned"
              : "Awaiting signature",
      prompt: "Send the contract?",
    },
    {
      id: "insurance",
      label: "Insurance",
      value: insuranceState === "active" ? `Covered · ${money(insurancePremium)}` : null,
      prompt: "Add cover?",
    },
    {
      id: "payments",
      label: "Payments",
      value: (() => {
        const t = ledgerTotals(ledger);
        return t.outstanding > 0 ? `${(t.outstanding / 100).toLocaleString("en-US", { style: "currency", currency: "USD" })} owed` : "Settled";
      })(),
      prompt: "What's owed?",
    },
    {
      id: "handover",
      label: "Handover",
      value: receiving.at ? "Back with you" : giving.at ? "With the customer" : null,
      prompt: "Where is the car?",
    },
  ];

  const heroTitle = customer && vehicle ? `${customer.name} · ${vehicle.reg}` : "New rental";
  const heroSubtitle = setupComplete
    ? `${rentalNumber} · visible in the customer's portal`
    : "Draft — not visible to the customer yet";

  return (
    /*
     * No top header bar, on purpose. northwind's v2 chrome deletes that row
     * outright — `app/(dashboard)/layout.tsx` calls it "the single most visible
     * difference between the two designs" — so a bordered full-width strip is
     * the fastest way to make a screen read as v1. The page's identity lives in
     * the scoped sidebar header instead, exactly as it does for Settings.
     */
    <div className="flex h-screen bg-background bg-app-gradient">
      {/* ── rail ─────────────────────────────────────────────────────────── */}
      <aside className="flex w-[280px] shrink-0 flex-col">
        <RailHeader backHref="/playground" title={heroTitle} subtitle={heroSubtitle} />

        <div className="min-h-0 flex-1 overflow-y-auto pb-3">
          <div className="space-y-2 p-3">
            {STAGES.map((st, i) => (
              <StageItem
                key={st.id}
                index={i}
                label={st.label}
                value={st.value}
                prompt={st.prompt}
                active={tab === st.id}
                onClick={() => setTab(st.id)}
              />
            ))}
          </div>
        </div>

        {/* Status lives in the sidebar footer — the same slot the real sidebar
            uses for its billing chip. */}
        <div className="border-t p-3">
          <div className="flex flex-wrap gap-1.5">
            <HeroChip tone={status.tone}>{status.label}</HeroChip>
            {staleCount > 0 && <HeroChip tone="warning">{staleCount} out of date</HeroChip>}
            {rentalTotal > 0 && (
              <HeroChip tone="muted" dot={false}>
                {money(rentalTotal)}
              </HeroChip>
            )}
          </div>
          <p className="mt-2.5 px-0.5 text-[11px] leading-relaxed text-muted-foreground">
            No Create button. This rental already exists — every change applies straight away.
          </p>
        </div>
      </aside>

      {/* Keyed on the stage so the scroll container is a NEW node each time.
          Without it the panel keeps the previous stage's scroll offset and you
          land halfway down a screen you have never seen. */}
      <main key={tab} className="flex min-w-0 flex-1 flex-col overflow-hidden px-10 py-8">
        {tab === "customer" && <CustomerTab selectedId={customerId} onSelect={setCustomerId} />}

        {tab === "vehicle" && (
          <VehicleTab
            selectedId={vehicleId}
            onSelect={pickVehicle}
            days={days}
            unlimitedMileage={unlimitedMileage}
            onUnlimitedMileage={setUnlimitedMileage}
          />
        )}

        {tab === "when" && (
          <WhenWhereTab
            out={out}
            back={back}
            sameAsPickup={sameAsPickup}
            onOut={patchOut}
            onBack={patchBack}
            onSameAsPickup={toggleMirror}
            lockbox={lockbox}
            vehicleReg={vehicle?.reg ?? null}
            lockboxCode={lockboxCode}
            lockboxInstructions={lockboxInstructions}
            onLockboxCode={setLockboxCode}
            onLockboxInstructions={setLockboxInstructions}
          />
        )}

        {tab === "extras" && (
          <ExtrasTab
            selection={extras}
            onSelection={setExtras}
            days={days}
            dailyRate={dailyRate}
            onDailyRate={setDailyRate}
            deposit={deposit}
            onDeposit={setDeposit}
            notes={notes}
            onNotes={setNotes}
            priceLines={priceLines}
            total={rentalTotal}
          />
        )}

        {tab === "agreement" && (
          <AgreementTab
            state={agreementState}
            drift={agreementDrift}
            sentAt={agreementSentAt}
            signedAt={agreementSignedAt}
            rows={AGREEMENT_TERMS.map((k) => ({
              label: TERM_LABELS[k],
              value: termText(k, (agreementSnapshot ?? terms)[k]),
            }))}
            customerName={customer?.name ?? null}
            setupComplete={setupComplete}
            onSend={sendAgreement}
            onAcceptDrift={acceptAgreementDrift}
            onSimulateOpen={() => setAgreementState("opened")}
            onSimulateSign={() => {
              setAgreementState("signed");
              setAgreementSignedAt(new Date());
            }}
          />
        )}

        {tab === "insurance" && (
          <InsuranceTab
            state={insuranceState}
            drift={insuranceDrift}
            premium={insurancePremium}
            quote={insuranceQuote}
            covers={(insuranceSnapshot ?? terms).vehicle}
            from={(insuranceSnapshot ?? terms).coverFrom}
            to={(insuranceSnapshot ?? terms).coverTo}
            days={days}
            hasVehicle={!!vehicle}
            onBuy={buyInsurance}
            onAcceptDrift={() => setInsuranceSnapshot(terms)}
          />
        )}

        {tab === "payments" && <PaymentsTab ledger={ledger} onChange={setLedger} />}

        {tab === "handover" && (
          <HandoverTab
            giving={giving}
            receiving={receiving}
            onGiving={(p) => setGiving((prev) => ({ ...prev, ...p }))}
            onReceiving={(p) => setReceiving((prev) => ({ ...prev, ...p }))}
            report={report}
            onAnalyse={runAnalysis}
            onReview={reviewReport}
            onAcceptStale={acceptStaleReport}
            vehicleLabel={vehicle ? `${vehicle.name} · ${vehicle.reg}` : null}
            keysByLockbox={out.keys === "lockbox"}
            allowance={plan?.allowance ?? null}
            excessRate={plan?.excessRate ?? 0}
            tierLabel={plan?.tierLabel ?? "No tier"}
            setupComplete={setupComplete}
          />
        )}
      </main>

      {/* ── right rail ───────────────────────────────────────────────────
          A matched pair with the left rail — same width, same surface, the
          border flipped to `border-l` so the two frame the content between
          them. */}
      {/* The panel owns its own tab strip and scroll region, so it sits
          directly in the aside's flex column — a wrapping body div here would
          double the side padding and trap the sticky tab strip. */}
      <aside className="flex w-[360px] shrink-0 flex-col border-l border-foreground/10">
        <RightSidebar
          customerName={customer?.name ?? null}
          customerEmail={customer?.email ?? null}
          customerPhone={customer?.phone ?? null}
        />
      </aside>
    </div>
  );
}
