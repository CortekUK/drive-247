"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { ArrowDown, ArrowUp, ChevronsUpDown } from "lucide-react";

import "@/components/content/content.css";
import "./know-numbers.css";
import { Accent, SectionHeading } from "./section-heading";

/*
 * Know your numbers: the portal's Insights → P&L screen, drawn here with made-up cars
 * (apps/portal/src/app/(dashboard)/insights/_pnl-table.tsx is the real one: one row per
 * car, the same columns, the same sparkline, margin bar and whole-fleet line).
 *
 * The section's one animation: when it comes into view the rows sort themselves by what
 * each car kept, so the best earner rises to the top and the car losing money sinks to
 * the bottom in red. After that every column sorts on click, as it does in the portal.
 *
 * Every figure below adds up the way the real screen's do: kept = money in - spent,
 * margin = kept / money in, out = days out / 30, per day out = money in / days out.
 */

type Car = {
  id: string;
  name: string;
  plate: string;
  /** What the car kept, month by month, oldest first. */
  series: number[];
  moneyIn: number;
  spent: number;
  kept: number;
  change: number | null;
  margin: number;
  out: number;
  daysOut: number;
  perDay: number;
};

const FLEET_MONEY_IN = 16750;

const CARS: Car[] = [
  { id: "malibu", name: "Chevrolet Malibu", plate: "7MLB315", series: [620, 410, 180, -40, -260, -570], moneyIn: 640, spent: 1210, kept: -570, change: -119, margin: -89, out: 20, daysOut: 6, perDay: 107 },
  { id: "explorer", name: "Ford Explorer", plate: "8FXE620", series: [1180, 1010, 940, 980, 880, 720], moneyIn: 1980, spent: 1260, kept: 720, change: -18, margin: 36, out: 50, daysOut: 15, perDay: 132 },
  { id: "civic", name: "Honda Civic", plate: "6CVR457", series: [1120, 1180, 1250, 1320, 1390, 1600], moneyIn: 2140, spent: 540, kept: 1600, change: 15, margin: 75, out: 63, daysOut: 19, perDay: 113 },
  { id: "wrangler", name: "Jeep Wrangler", plate: "9JWD118", series: [1640, 2110, 2380, 2460, 2360, 2220], moneyIn: 3910, spent: 1690, kept: 2220, change: -6, margin: 57, out: 73, daysOut: 22, perDay: 178 },
  { id: "model3", name: "Tesla Model 3", plate: "8KTR214", series: [1900, 2300, 2600, 2800, 2940, 3680], moneyIn: 4820, spent: 1140, kept: 3680, change: 25, margin: 76, out: 87, daysOut: 26, perDay: 185 },
  { id: "camry", name: "Toyota Camry", plate: "7MXP903", series: [2010, 2100, 2180, 2250, 2310, 2540], moneyIn: 3260, spent: 720, kept: 2540, change: 10, margin: 78, out: 80, daysOut: 24, perDay: 136 },
];

const FLEET = {
  series: [8470, 9110, 9530, 9770, 9620, 10190],
  moneyIn: FLEET_MONEY_IN,
  spent: 6560,
  kept: 10190,
  change: 6,
  margin: 61,
  out: 62,
  perDay: 150,
};

type SortKey = "name" | "moneyIn" | "spent" | "kept" | "change" | "margin" | "out" | "perDay";
type Sort = { key: SortKey; dir: 1 | -1 };

const COLUMNS: { key: SortKey; label: string; className?: string }[] = [
  { key: "moneyIn", label: "Money in" },
  { key: "spent", label: "Spent", className: "kn-c-spent" },
  { key: "kept", label: "Kept" },
  { key: "change", label: "vs last month", className: "kn-c-change" },
  { key: "margin", label: "Margin", className: "kn-c-margin" },
  { key: "out", label: "Out", className: "kn-c-out" },
  { key: "perDay", label: "Per day out", className: "kn-c-perday" },
];

const MONEY = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const money = (n: number) => MONEY.format(n);
const signed = (n: number) => (n < 0 ? `−${MONEY.format(Math.abs(n))}` : MONEY.format(n));

function sorted(cars: Car[], { key, dir }: Sort): Car[] {
  return [...cars].sort((a, b) => {
    if (key === "name") return a.name.localeCompare(b.name) * dir;
    const av = a[key] ?? -Infinity;
    const bv = b[key] ?? -Infinity;
    return (av - bv) * dir || a.name.localeCompare(b.name);
  });
}

/** The last six months, ending this one: "Jun – Nov". */
function monthRange(): string {
  const now = new Date();
  const label = (offset: number) =>
    new Date(now.getFullYear(), now.getMonth() - offset, 1).toLocaleString("en-US", { month: "short" });
  return `${label(5)} – ${label(0)}`;
}

/** The portal's sparkline: accent line over a soft fill, a dashed zero line when it crosses, the last month as a dot. */
function Spark({ values, strong, id }: { values: number[]; strong?: boolean; id: string }) {
  const W = 168;
  const H = 36;
  const P = 3;
  const min = Math.min(0, ...values);
  const max = Math.max(0, ...values);
  const span = max - min || 1;
  const x = (i: number) => P + (i * (W - P * 2)) / Math.max(1, values.length - 1);
  const y = (v: number) => P + (1 - (v - min) / span) * (H - P * 2);
  const pts = values.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`);
  const line = `M${pts.join(" L")}`;
  const area = `${line} L${x(values.length - 1).toFixed(1)},${y(min).toFixed(1)} L${x(0).toFixed(1)},${y(min).toFixed(1)} Z`;
  const last = values[values.length - 1] ?? 0;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} className="kn-spark" aria-hidden>
      <defs>
        <linearGradient id={`kn-${id}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="currentColor" stopOpacity={strong ? 0.3 : 0.2} />
          <stop offset="100%" stopColor="currentColor" stopOpacity={0} />
        </linearGradient>
      </defs>
      {min < 0 && max > 0 && (
        <line x1={P} x2={W - P} y1={y(0)} y2={y(0)} stroke="currentColor" strokeOpacity={0.35} strokeDasharray="3 3" />
      )}
      <path d={area} fill={`url(#kn-${id})`} />
      <path d={line} fill="none" stroke="currentColor" strokeWidth={strong ? 2 : 1.5} strokeLinejoin="round" />
      <circle cx={x(values.length - 1)} cy={y(last)} r={strong ? 3 : 2.5} fill={last < 0 ? "hsl(var(--v2-destructive))" : "currentColor"} />
    </svg>
  );
}

function Change({ value }: { value: number | null }) {
  if (value == null) return <span className="kn-muted">&mdash;</span>;
  const up = value >= 0;
  return (
    <span className={`kn-change${up ? " is-up" : ""}`}>
      {up ? <ArrowUp aria-hidden /> : <ArrowDown aria-hidden />}
      {Math.abs(value)}%
    </span>
  );
}

function Margin({ value }: { value: number }) {
  return (
    <span className="kn-margin">
      <span className={value < 0 ? "is-negative" : undefined}>{value}%</span>
      <span className="kn-margin-bar">
        <span style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
      </span>
    </span>
  );
}

const POINTS = [
  { title: "Every car on one row", text: "Money in, what it cost you and what you kept, side by side." },
  { title: "Spot the car that costs you", text: "A car losing money shows in red, before it costs you another month." },
  { title: "Find your next move", text: "Days out and earnings per day show which car to push, reprice or let go." },
];

export function KnowNumbers() {
  const sectionRef = useRef<HTMLElement>(null);
  const bodyRef = useRef<HTMLTableSectionElement>(null);
  const tops = useRef(new Map<string, number>());
  const [sort, setSort] = useState<Sort>({ key: "name", dir: 1 });
  const [months, setMonths] = useState("");
  const rows = sorted(CARS, sort);

  useEffect(() => setMonths(monthRange()), []);

  // The arrival: sort by what each car kept, once, as the table comes into view.
  useEffect(() => {
    const el = sectionRef.current;
    if (!el) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setSort({ key: "kept", dir: -1 });
      return;
    }
    let timer = 0;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return;
        observer.disconnect();
        timer = window.setTimeout(() => setSort((current) => (current.key === "name" ? { key: "kept", dir: -1 } : current)), 700);
      },
      { threshold: 0.45 },
    );
    observer.observe(el.querySelector(".kn-window") ?? el);
    return () => {
      observer.disconnect();
      window.clearTimeout(timer);
    };
  }, []);

  // Rows glide from where they were to where the sort put them (first, last, invert, play).
  useLayoutEffect(() => {
    const body = bodyRef.current;
    if (!body) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const next = new Map<string, number>();
    body.querySelectorAll<HTMLTableRowElement>("tr[data-id]").forEach((tr) => {
      next.set(tr.dataset.id!, tr.getBoundingClientRect().top);
    });
    if (!reduced && tops.current.size) {
      body.querySelectorAll<HTMLTableRowElement>("tr[data-id]").forEach((tr) => {
        const before = tops.current.get(tr.dataset.id!);
        const after = next.get(tr.dataset.id!);
        if (before == null || after == null || before === after) return;
        tr.style.transition = "none";
        tr.style.transform = `translateY(${before - after}px)`;
        requestAnimationFrame(() => {
          tr.style.transition = "transform 700ms cubic-bezier(0.16, 1, 0.3, 1)";
          tr.style.transform = "";
        });
      });
    }
    tops.current = next;
  }, [sort]);

  const press = (key: SortKey) =>
    setSort((current) => ({ key, dir: current.key === key ? (current.dir === 1 ? -1 : 1) : key === "name" ? 1 : -1 }));

  const head = (key: SortKey, label: string, className?: string, left?: boolean) => {
    const active = sort.key === key;
    return (
      <th key={key} className={`${left ? "kn-left" : ""} ${className ?? ""}`} aria-sort={active ? (sort.dir === -1 ? "descending" : "ascending") : "none"}>
        <button type="button" onClick={() => press(key)} className={active ? "is-active" : undefined}>
          {label}
          {active ? sort.dir === -1 ? <ArrowDown aria-hidden /> : <ArrowUp aria-hidden /> : <ChevronsUpDown aria-hidden className="kn-idle" />}
        </button>
      </th>
    );
  };

  return (
    <section ref={sectionRef} id="know-your-numbers" className="kn" aria-labelledby="kn-title">
      <div className="ct-inner">
        <SectionHeading
          id="kn-title"
          title={
            <>
              Know your <Accent>numbers</Accent>
            </>
          }
          sub={
            <>
              See which cars make you money, which ones cost you money, and where your next opportunity is.
            </>
          }
        />
        <ul className="kn-points">
          {POINTS.map((point) => (
            <li key={point.title}>
              <strong>{point.title}</strong>
              <span>{point.text}</span>
            </li>
          ))}
        </ul>

        <div className="kn-window">
          <div className="kn-bar">
            <p className="kn-page">Insights</p>
            <div className="kn-views" aria-hidden>
              {["Numbers", "P&L", "Analytics", "Reports", "Trax summary"].map((view) => (
                <span key={view} className={view === "P&L" ? "is-on" : undefined}>
                  {view}
                </span>
              ))}
            </div>
            <p className="kn-period">Last 30 days</p>
          </div>

          <div className="kn-scroll">
            <table className="kn-table">
              <caption className="sr-only">Profit and loss by car, an example</caption>
              <thead>
                <tr>
                  {head("name", "Car", undefined, true)}
                  <th className="kn-left kn-c-spark">
                    Kept, month by month <span className="kn-range" suppressHydrationWarning>{months}</span>
                  </th>
                  {COLUMNS.map((column) => head(column.key, column.label, column.className))}
                </tr>
              </thead>
              <tbody ref={bodyRef}>
                {rows.map((car) => (
                  <tr key={car.id} data-id={car.id}>
                    <td className="kn-left">
                      <p className="kn-car">{car.name}</p>
                      <p className="kn-plate">
                        {car.plate} &middot; {Math.round((car.moneyIn / FLEET_MONEY_IN) * 100)}% of fleet
                      </p>
                    </td>
                    <td className="kn-left kn-c-spark">
                      <Spark values={car.series} id={car.id} />
                    </td>
                    <td>{money(car.moneyIn)}</td>
                    <td className="kn-muted kn-c-spent">{money(car.spent)}</td>
                    <td className={`kn-kept${car.kept < 0 ? " is-negative" : ""}`}>{signed(car.kept)}</td>
                    <td className="kn-c-change">
                      <Change value={car.change} />
                    </td>
                    <td className="kn-c-margin">
                      <Margin value={car.margin} />
                    </td>
                    <td className="kn-c-out">
                      {car.out}% <span className="kn-muted kn-days">{car.daysOut}d</span>
                    </td>
                    <td className="kn-c-perday">{money(car.perDay)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td className="kn-left">
                    <p className="kn-fleet">Whole fleet</p>
                    <p className="kn-plate">{CARS.length} cars</p>
                  </td>
                  <td className="kn-left kn-c-spark">
                    <Spark values={FLEET.series} strong id="fleet" />
                  </td>
                  <td className="kn-strong">{money(FLEET.moneyIn)}</td>
                  <td className="kn-muted kn-c-spent">{money(FLEET.spent)}</td>
                  <td className="kn-fleet-kept">{signed(FLEET.kept)}</td>
                  <td className="kn-c-change">
                    <Change value={FLEET.change} />
                  </td>
                  <td className="kn-c-margin">
                    <Margin value={FLEET.margin} />
                  </td>
                  <td className="kn-c-out kn-strong">{FLEET.out}%</td>
                  <td className="kn-strong kn-c-perday">{money(FLEET.perDay)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
        <p className="kn-note">An example fleet. Your own cars, costs and categories fill this in as you rent.</p>
      </div>
    </section>
  );
}
