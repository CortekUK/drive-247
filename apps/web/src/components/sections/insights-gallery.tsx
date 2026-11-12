"use client";

import { useCallback, useState, type CSSProperties, type ReactNode } from "react";
import { Maximize2, Minus, Plus } from "lucide-react";
import { TrackLabel } from "./track-label";
import { InsightsMap, type MapPlace } from "./insights-map";
import "./insights-gallery.css";

/*
 * Insights → Analytics on the landing's sliding track, laid out as the portal's own Analytics
 * view (apps/portal/src/app/(dashboard)/insights/_analytics-gallery.tsx; Ghulam, 2026-11-10:
 * "the same as this but with mock data"): the money wave on top, the fleet pulse under it, and
 * where the renters go, full height, on the right. A made-up fleet; the map is drawn here (no
 * map tiles), with an Earth / Map switch as in the portal.
 */

const MONTHS = ["Dec 25", "Jan 26", "Feb 26", "Mar 26", "Apr 26", "May 26", "Jun 26", "Jul 26", "Aug 26", "Sep 26", "Oct 26", "Nov 26"];
const MONEY_IN = [1180, 1420, 1650, 2010, 2780, 3240, 4920, 3610, 4380, 11480, 8240, 5210];
const KEPT = MONEY_IN.map((v) => Math.round(v * 0.58));
const PEAK = MONEY_IN.indexOf(Math.max(...MONEY_IN));
const TOTAL = MONEY_IN.reduce((a, b) => a + b, 0);

const CARS = [
  { name: "Tesla Model 3", out: 26 },
  { name: "Toyota Camry", out: 24 },
  { name: "Jeep Wrangler", out: 22 },
  { name: "Honda Civic", out: 19 },
  { name: "Ford Explorer", out: 15 },
  { name: "Chevrolet Malibu", out: 0 },
];

/* Places on the drawn map, in % of the map, and how many rentals started or ended there. */
const HUB = { label: "National Airport", n: 31, x: 52, y: 66, side: "left" };
const PLACES = [
  { label: "Bethesda", n: 11, x: 31, y: 18, pickup: false, side: "right" },
  { label: "Georgetown", n: 14, x: 43, y: 44, pickup: false, side: "left" },
  { label: "Union Station", n: 22, x: 66, y: 48, pickup: true, side: "right" },
  { label: "Arlington", n: 17, x: 34, y: 54, pickup: true, side: "left" },
  { label: "Navy Yard", n: 9, x: 67, y: 57, pickup: false, side: "right" },
  { label: "Alexandria", n: 8, x: 50, y: 85, pickup: false, side: "right" },
];

/* The same places with their real coordinates, for the Google map. */
const GEO: MapPlace[] = [
  { label: "National Airport", n: 31, lat: 38.8512, lng: -77.0402, live: true },
  { label: "Union Station", n: 22, lat: 38.8973, lng: -77.0063, live: true },
  { label: "Arlington", n: 17, lat: 38.8816, lng: -77.091, live: true },
  { label: "Georgetown", n: 14, lat: 38.9097, lng: -77.0654 },
  { label: "Bethesda", n: 11, lat: 38.9847, lng: -77.0947 },
  { label: "Navy Yard", n: 9, lat: 38.8764, lng: -76.9951 },
  { label: "Alexandria", n: 8, lat: 38.8048, lng: -77.0469 },
];

const money = (n: number) => "$" + n.toLocaleString("en-US");

/** A car's 30 days: the days out spread through the month, the same on every render. */
const days = (out: number, seed: number) => Array.from({ length: 30 }, (_, d) => (d * 7 + seed * 5) % 30 < out);

function Wave() {
  const W = 1000;
  const H = 220;
  const max = 13000;
  const at = (vals: number[]) => vals.map((v, i) => [(i / (vals.length - 1)) * W, H - (v / max) * H] as const);
  const curve = (q: ReturnType<typeof at>) => q.map(([x, y], i) => (i === 0 ? `M${x} ${y}` : `C${q[i - 1][0] + W / 30} ${q[i - 1][1]} ${x - W / 30} ${y} ${x} ${y}`)).join("");
  const p = at(MONEY_IN);
  const line = curve(p);
  const kept = curve(at(KEPT));
  const [px, py] = p[PEAK];
  return (
    <div className="ia-wave">
      <div className="ia-wave-plot">
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden>
          <defs>
            <linearGradient id="ia-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#4f44d8" stopOpacity="0.5" />
              <stop offset="1" stopColor="#4f44d8" stopOpacity="0.02" />
            </linearGradient>
          </defs>
          <path d={`${line}L${W} ${H}L0 ${H}Z`} fill="url(#ia-fill)" />
          <path d={line} fill="none" stroke="#4f44d8" strokeWidth="3" vectorEffect="non-scaling-stroke" />
          {/* The deeper wave: what was kept. */}
          <path d={`${kept}L${W} ${H}L0 ${H}Z`} fill="#4f44d8" fillOpacity="0.28" />
        </svg>
        <span className="ia-peak" style={{ left: `${(px / W) * 100}%`, top: `${(py / H) * 100}%` }}>
          <b>{money(MONEY_IN[PEAK])}</b>
          <i />
          <TrackLabel n={1} way="down-left">
            Every payment, counted for you
          </TrackLabel>
        </span>
      </div>
      <div className="ia-axis">
        {MONTHS.map((m) => (
          <span key={m}>{m}</span>
        ))}
      </div>
    </div>
  );
}

function Places() {
  const [mode, setMode] = useState<"earth" | "map">("earth");
  const [google, setGoogle] = useState(true);
  const [zoom, setZoom] = useState<{ dir: 1 | -1; at: number } | null>(null);
  const fail = useCallback(() => setGoogle(false), []);
  return (
    <section className={`ia-panel ia-places is-${mode}${google ? " has-google" : ""}`} aria-label="Where your renters go">
      {google && <InsightsMap places={GEO} earth={mode === "earth"} zoom={zoom} onFail={fail} />}
      <span className="ia-map-anchor is-google">
        <TrackLabel n={3} way="down">
          See where renters go
        </TrackLabel>
      </span>
      <div className="ia-map" aria-hidden>
        {/* The river, the parks and the main roads, drawn. */}
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="ia-land">
          <path className="ia-park" d="M8 6 C18 10 22 22 18 34 C14 44 6 46 2 40 Z" />
          <path className="ia-park" d="M78 8 C90 12 96 26 92 36 C84 34 76 22 78 8 Z" />
          <path className="ia-park" d="M70 74 C82 70 92 80 88 92 C78 96 70 88 70 74 Z" />
          <path className="ia-road" d="M0 30 L100 22 M0 62 L100 52 M28 0 L40 100 M70 0 L62 100 M0 88 L100 78" />
          <path className="ia-road is-minor" d="M0 14 L100 8 M0 46 L100 38 M14 0 L22 100 M86 0 L80 100 M0 74 L100 66 M50 0 L54 100" />
          <path className="ia-river" d="M20 36 C30 42 40 46 46 52 C52 58 56 64 56 72 C56 82 52 90 54 100" />
          <path className="ia-river is-arm" d="M56 66 C62 62 70 60 80 62" />
        </svg>
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="ia-routes">
          {PLACES.map((p) => (
            <line key={p.label} x1={p.x} y1={p.y} x2={HUB.x} y2={HUB.y} />
          ))}
        </svg>
        {/* Phones put each place's count inside its dot and its name to the side that stays
            clear of its neighbours (`side`); desktop keeps "Name · n" under the dot. */}
        {[...PLACES, { ...HUB, pickup: true }].map((p) => (
          <span
            key={p.label}
            className={`ia-pin${p.pickup ? " is-pickup" : ""}${p.label === HUB.label ? " is-hub" : ""}`}
            data-side={p.side}
            style={{ left: `${p.x}%`, top: `${p.y}%` } as CSSProperties}
          >
            <i>
              <b className="ia-pin-n">{p.n}</b>
            </i>
            <small>
              {p.label}
              <span className="ia-pin-count"> · {p.n}</span>
            </small>
          </span>
        ))}
        <span className="ia-map-anchor">
          <TrackLabel n={3} way="down">
            See where renters go
          </TrackLabel>
        </span>
      </div>
      <button type="button" className="ia-map-btn is-expand" tabIndex={-1} aria-hidden>
        <Maximize2 />
      </button>
      <div className="ia-mode" role="radiogroup" aria-label="Map style">
        {(["earth", "map"] as const).map((m) => (
          <button key={m} type="button" role="radio" aria-checked={mode === m} className={mode === m ? "is-on" : ""} onClick={() => setMode(m)}>
            {m === "earth" ? "Earth" : "Map"}
          </button>
        ))}
      </div>
      <div className="ia-zoom">
        <button type="button" aria-label="Zoom in" onClick={() => setZoom({ dir: 1, at: Date.now() })}>
          <Plus />
        </button>
        <button type="button" aria-label="Zoom out" onClick={() => setZoom({ dir: -1, at: Date.now() })}>
          <Minus />
        </button>
      </div>
    </section>
  );
}

function Panel({ title, figure, caption, className = "", children }: { title: string; figure: string; caption: string; className?: string; children: ReactNode }) {
  return (
    <section className={`ia-panel ${className}`}>
      <header>
        <div>
          <h3>{title}</h3>
          <p className="ia-figure">{figure}</p>
        </div>
        <p className="ia-caption">{caption}</p>
      </header>
      <div className="ia-body">{children}</div>
    </section>
  );
}

export function InsightsGallery() {
  const outNow = CARS.filter((c) => c.out > 0).length;
  const idle = CARS.length - outNow;
  return (
    <section id="know-your-numbers" className="ia" aria-label="Insights">
      <div className="ia-window">
        <div className="ia-bar">
          <div>
            <p className="ia-page">Insights</p>
            <p className="ia-lede">What the business earned, what it cost to run, and what is still owed.</p>
          </div>
          <div className="ia-views" aria-hidden>
            {["Numbers", "P&L", "Analytics", "Reports", "Trax summary"].map((v) => (
              <span key={v} className={v === "Analytics" ? "is-on" : ""}>
                {v}
              </span>
            ))}
          </div>
        </div>

        <div className="ia-grid">
          <Panel title="Money in, month by month" figure={money(TOTAL)} caption="the wave is money in · the deeper wave is kept" className="is-wave">
            <Wave />
          </Panel>

          <Places />

          <Panel title="Fleet pulse · last 30 days" figure={`${outNow} of ${CARS.length} out`} caption={`${idle} ${idle === 1 ? "car" : "cars"} idle all month`} className="is-pulse">
            <ul className="ia-pulse">
              {CARS.map((c, i) => (
                <li key={c.name}>
                  <small>{c.name}</small>
                  <span>
                    {days(c.out, i).map((on, d) => (
                      <i key={d} className={on ? "is-on" : ""} />
                    ))}
                  </span>
                  <b>{Math.round((c.out / 30) * 100)}%</b>
                </li>
              ))}
            </ul>
            <span className="ia-pulse-anchor">
              <TrackLabel n={2} way="right">
                Spot the cars sitting idle
              </TrackLabel>
            </span>
          </Panel>
        </div>
      </div>
    </section>
  );
}
