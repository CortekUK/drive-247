"use client";

import { Sparkles } from "lucide-react";
import type { CSSProperties } from "react";
import { useReveal } from "./operations-dashboard";
import "./profit-section.css";

/*
 * Profitability, as its own selling point. Drawn after the portal's Insights page ("Profit
 * by car", "Days rented", "Money you kept"), with a made-up month and Trax's read of it.
 */
const CARS = [
  { car: "Kia Telluride", days: 27, profit: 1840 },
  { car: "Tesla Model Y", days: 22, profit: 1215 },
  { car: "Jeep Wrangler", days: 16, profit: 410 },
  { car: "Honda Civic", days: 9, profit: -340 },
];
const MAX = 2000;
const money = (n: number) => `${n < 0 ? "-" : ""}$${Math.abs(n).toLocaleString("en-US")}`;

const POINTS = [
  ["Money you kept", "What came in, minus refunds, costs and money that was never yours."],
  ["Profit by car", "Each car's earnings against what it costs to run."],
  ["Days rented", "How hard every car works, so idle ones stand out."],
  ["Still owed", "Who owes you what, and for how long."],
];

export function ProfitSection() {
  const { ref, visible } = useReveal();

  return (
    <section id="profit" aria-labelledby="profit-heading" className="pf-section">
      <div ref={ref} className={`pf-inner${visible ? " is-in" : ""}`}>
        <div className="pf-copy">
          <p className="pf-kicker">Insights</p>
          <h2 id="profit-heading">Know which cars make you money.</h2>
          <p className="pf-lead">
            And which ones cost you money, and where your next opportunity is. Not a generic dashboard: your own
            numbers, car by car, so every fleet decision starts from what actually happened.
          </p>
          <dl className="pf-points">
            {POINTS.map(([title, body]) => (
              <div key={title}>
                <dt>{title}</dt>
                <dd>{body}</dd>
              </div>
            ))}
          </dl>
        </div>

        <div className="pf-stage" aria-hidden>
          <div className="pf-board">
            <div className="pf-head">
              <span>
                <small>Money you kept · October</small>
                <b>$3,125</b>
              </span>
              <em>Profit by car</em>
            </div>
            <div className="pf-cols">
              <span>Car</span>
              <span>Days rented</span>
              <span>Profit</span>
            </div>
            <ul>
              {CARS.map((row, i) => (
                <li
                  key={row.car}
                  className={row.profit < 0 ? "is-loss" : ""}
                  style={{ "--pf-at": `${250 + i * 140}ms`, "--pf-days": row.days / 30, "--pf-w": Math.abs(row.profit) / MAX } as CSSProperties}
                >
                  <b>{row.car}</b>
                  <span className="pf-days">
                    <i />
                    {row.days} of 30
                  </span>
                  <span className="pf-profit">
                    <i />
                    {money(row.profit)}
                  </span>
                </li>
              ))}
            </ul>
          </div>

          <div className="pf-trax">
            <span className="pf-trax-mark">
              <Sparkles strokeWidth={2} />
            </span>
            <p>
              <b>Trax</b>
              The Civic lost you $340 and sat idle 21 days. The Telluride was out 27 of 30 days, so another one like it
              is your best bet.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
