import { Calculator, ChevronRight, Clock, SlidersHorizontal } from "lucide-react";
import type { ReactNode } from "react";
import { PortalShell } from "../screens";
import "./insights.css";

/* ===================================================================== *
 * Insights — /insights, the v2 home of reports and P&L, on its default
 * "Numbers" view (useInsightsView() starts at 'numbers'; no ?view= param).
 *
 * Mirrors, line for line:
 *   apps/portal/src/app/(dashboard)/insights/page.tsx         (v2-only route)
 *   apps/portal/src/app/(dashboard)/insights/insights-view.tsx (page frame,
 *       header, the Numbers grid: receipt | 420px calculator)
 *   apps/portal/src/app/(dashboard)/insights/_view-switch.tsx (five text tabs)
 *   apps/portal/src/app/(dashboard)/insights/_receipt.tsx     (MoneyReceipt,
 *       EquationRow, CapitalFootnote)
 *   apps/portal/src/app/(dashboard)/insights/_calculator.tsx  (ProfitCalculator,
 *       Key, Knob, BreakEven — same model, same knob geometry)
 *   apps/portal/src/app/(dashboard)/insights/_money-model.ts  (receiptFor, keptShare)
 * Tokens: apps/portal/src/styles/v2-theme.css (.v2-theme) via tailwind.config.ts.
 *
 * Figures are demo data for a 12-car fleet over the default 12-month period,
 * run through the portal's own arithmetic so the receipt and the calculator
 * agree exactly as they do in the product.
 * ===================================================================== */

/** U+2212, as the portal uses for its operators. */
const MINUS = "−";

/* ── Demo business: 12 cars, the default 12-month window (354 days) ── */
const DAYS_PER_MONTH = 365.25 / 12;
const PERIOD_DAYS = 354;
const PERIOD_MONTHS = PERIOD_DAYS / DAYS_PER_MONTH;
const FLEET = 12;
const UTILISATION = 0.7;
const OPERATING_REVENUE = 202_180;
const PASS_THROUGH = 18_640;
const GAVE_BACK = 3_410;
const SPENT = 96_280;
const OWED = 3_860;
const OWED_COUNT = 5;
const CAR_PURCHASES = 38_500;

// receiptFor() in _money-model.ts
const TOOK_IN = OPERATING_REVENUE + PASS_THROUGH;
const KEPT = TOOK_IN - GAVE_BACK - PASS_THROUGH - SPENT;
const KEPT_SHARE = (KEPT / TOOK_IN) * 100;

// baselineFrom() in _calculator.tsx
const RENTED_DAYS = UTILISATION * FLEET * PERIOD_DAYS;
const IN = {
  cars: FLEET,
  days: UTILISATION * DAYS_PER_MONTH,
  price: OPERATING_REVENUE / RENTED_DAYS,
  cost: SPENT / FLEET / PERIOD_MONTHS,
};
const REFUND_RATE = GAVE_BACK / OPERATING_REVENUE;
const NOW = IN.cars * IN.days * IN.price * (1 - REFUND_RATE) - IN.cars * IN.cost;
const MONEY_IN_MONTH = IN.cars * IN.days * IN.price * (1 - REFUND_RATE);
const BREAK_EVEN = IN.cost / (IN.price * (1 - REFUND_RATE));
const DAYS = Math.round(IN.days);
const COVER = Math.min(30, Math.ceil(BREAK_EVEN));
const CARS_MAX = Math.max(20, Math.ceil(IN.cars * 2));
const PRICE_MAX = Math.max(300, Math.ceil((IN.price * 2) / 50) * 50);
const COST_MAX = Math.max(500, Math.ceil((IN.cost * 3) / 50) * 50);

const money = (n: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(n);

const VIEWS = ["Numbers", "P&L", "Analytics", "Reports", "Trax summary"];

/* ── _receipt.tsx: EquationRow ── */
function EquationRow({
  op,
  owed,
  label,
  sub,
  amount,
}: {
  op: "+" | "−" | ReactNode;
  owed?: boolean;
  label: string;
  sub: string;
  amount: number;
}) {
  const plus = op === "+";
  return (
    <div className={`eq${owed ? " owed" : ""}`}>
      <span className={`op${owed ? " owed" : plus ? " plus" : ""}`}>{op}</span>
      <span className="lb">
        <b>{label}</b>
        <small>{sub}</small>
      </span>
      <span className={`amt${!plus && !owed ? " less" : ""}`}>{money(amount)}</span>
      <span className="chev">
        <ChevronRight />
      </span>
    </div>
  );
}

/* ── _calculator.tsx: Knob (270° sweep from 7:30, 64-unit viewBox) ── */
const SWEEP = 270;
const START = 135;
function polar(cx: number, cy: number, r: number, deg: number) {
  const a = (deg * Math.PI) / 180;
  // rounded: server and browser trig differ in the last digits, which breaks hydration
  return [Math.round((cx + r * Math.cos(a)) * 100) / 100, Math.round((cy + r * Math.sin(a)) * 100) / 100] as const;
}
function arc(cx: number, cy: number, r: number, from: number, to: number) {
  const [x1, y1] = polar(cx, cy, r, from);
  const [x2, y2] = polar(cx, cy, r, to);
  const large = to - from > 180 ? 1 : 0;
  return `M${x1.toFixed(2)} ${y1.toFixed(2)} A${r} ${r} 0 ${large} 1 ${x2.toFixed(2)} ${y2.toFixed(2)}`;
}

function Knob({ value, max }: { value: number; max: number }) {
  const t = Math.min(1, Math.max(0, value / max));
  const angle = START + t * SWEEP;
  const c = 32;
  const [px, py] = polar(c, c, 13, angle);
  return (
    <svg viewBox="0 0 64 64" className="knob" aria-hidden>
      {Array.from({ length: 11 }, (_, i) => {
        const a = START + (i / 10) * SWEEP;
        const [x1, y1] = polar(c, c, 30.5, a);
        const [x2, y2] = polar(c, c, 28, a);
        return <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} className={i / 10 <= t + 1e-6 ? "tk on" : "tk"} strokeWidth={1.4} strokeLinecap="round" />;
      })}
      <path d={arc(c, c, 24, START, START + SWEEP)} className="trk" strokeWidth={4} strokeLinecap="round" />
      <path d={arc(c, c, 24, START, angle)} className="val" strokeWidth={4} strokeLinecap="round" />
      <circle cx={c} cy={c} r={18} strokeWidth={1.2} className="cap" />
      <circle cx={c} cy={c} r={15} className="face" />
      <line x1={c} y1={c} x2={px} y2={py} className="ptr" strokeWidth={3} strokeLinecap="round" />
      <circle cx={c} cy={c} r={2.4} className="dot" />
    </svg>
  );
}

function Key({ label, hint, value, prefix, suffix, max }: { label: string; hint: string; value: number; prefix?: string; suffix?: string; max: number }) {
  return (
    <div className="key">
      <div className="kl">
        <div className="kt">
          <p>{label}</p>
          <small>{hint}</small>
        </div>
        <span className="kv">
          {prefix ? <i>{prefix}</i> : null}
          <b>{Math.round(value)}</b>
          {suffix ? <em>{suffix}</em> : null}
        </span>
      </div>
      <Knob value={value} max={max} />
    </div>
  );
}

export function InsightsScreen() {
  return (
    <PortalShell active="Insights" search={{ scopeLabel: "Insights", placeholder: "Search entries, cars, customers, amounts…", filters: true }}>
      <div className="scr-ins">
        {/* insights-view.tsx — the title row with the view switch beside it */}
        <div className="top">
          <header>
            <div className="ttl">
              <h1>Insights</h1>
              <p>What the business earned, what it cost to run, and what is still owed.</p>
            </div>
            <div role="tablist" className="vs">
              {VIEWS.map((v, i) => (
                <span key={v} className={i === 0 ? "on" : undefined}>
                  {v}
                </span>
              ))}
            </div>
          </header>
          {/* OverviewFlip's empty front (filters live behind the top bar) */}
          <div className="flip" />
        </div>

        <div className="cols">
          {/* ── _receipt.tsx: MoneyReceipt ── */}
          <div className="rcpt">
            <header>
              <h2>Where your money went</h2>
              <span className="wcw">
                <SlidersHorizontal />
                What counts where
              </span>
            </header>
            <div className="body">
              <section className="sum">
                <div className="lines">
                  <EquationRow op="+" label="Money you took in" sub="rentals, extras, delivery, insurance" amount={TOOK_IN} />
                  <EquationRow op="−" label="Money you gave back" sub="refunds to customers" amount={GAVE_BACK} />
                  <EquationRow op="−" label="Money that was never yours" sub="sales tax and refundable deposits" amount={PASS_THROUGH} />
                  <EquationRow op="−" label="Money you spent" sub="servicing, repairs, running the cars" amount={SPENT} />
                </div>
                <div className="dbl" />
                <div className="kept">
                  <span className="op">=</span>
                  <span className="lb">
                    <b>Money you kept</b>
                    <small>{`${KEPT_SHARE.toFixed(0)}% of what you took in`}</small>
                  </span>
                  <span className="amt">{money(KEPT)}</span>
                  <span />
                </div>
                <EquationRow
                  op={<Clock />}
                  owed
                  label="Still owed to you"
                  sub={`${OWED_COUNT} customers · as of today · not in the sum`}
                  amount={OWED}
                />
              </section>
              {/* CapitalFootnote — only when the period booked a car purchase */}
              <div className="foot">
                <span>
                  Car purchases this period: <b>{money(CAR_PURCHASES)}</b> — not counted above
                </span>
                <ChevronRight />
              </div>
            </div>
          </div>

          {/* ── _calculator.tsx: ProfitCalculator ── */}
          <section className="calc">
            <div className="disp">
              <svg aria-hidden className="rings" viewBox="0 0 200 200">
                {[30, 52, 74, 96].map((r) => (
                  <circle key={r} cx="100" cy="100" r={r} fill="none" stroke="currentColor" strokeWidth="1.5" />
                ))}
              </svg>
              <span className="lbl">
                <Calculator /> What if…
              </span>
              <p className="ans">{money(NOW)}</p>
              <p className="sub">
                {`what you keep a month today · ${Math.round((NOW / MONEY_IN_MONTH) * 100)}% of what comes in`}
              </p>
            </div>

            <div className="keys">
              <Key label="Cars" hint="on the fleet" value={IN.cars} max={CARS_MAX} />
              <Key label="Days rented" hint="per car, a month" value={IN.days} suffix="/ 30" max={30} />
              <Key label="Price" hint="per rental day" value={IN.price} prefix="$" max={PRICE_MAX} />
              <Key label="Running cost" hint="per car, a month" value={IN.cost} prefix="$" max={COST_MAX} />
            </div>

            <div className="fns">
              {["+1 car", "+2 days", "+10% price", `${MINUS}10% costs`].map((f) => (
                <span key={f}>{f}</span>
              ))}
            </div>

            <div className="be">
              <div className="bars" aria-hidden>
                {Array.from({ length: 30 }, (_, i) => {
                  const rented = i < DAYS;
                  const paysCar = i < COVER;
                  const cls = rented ? (paysCar ? "pay" : "keep") : paysCar ? "idlepay" : undefined;
                  return <i key={i} className={cls} />;
                })}
              </div>
              <p>
                Each car pays for itself after <b>{COVER} days</b> — the <em>{DAYS - COVER} after</em> are money you keep.
              </p>
            </div>
          </section>
        </div>
      </div>
    </PortalShell>
  );
}
