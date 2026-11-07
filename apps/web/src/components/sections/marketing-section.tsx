"use client";

import { useState } from "react";
import { BarChart3, Link2, Megaphone, PenLine, Sparkles } from "lucide-react";
import { useFadeIn } from "@/hooks/use-fade-in";
import { BrowserChrome } from "./portal-glass";
import "./marketing-section.css";
import { Accent, SectionHeading } from "./section-heading";

/*
 * Marketing: Meta and Google Ads connected to the portal, judged by the bookings they bring
 * rather than the clicks. NOT BUILT YET (Ghulam, 2026-11-07): the section says "Coming soon",
 * and writing ads is marked as later still. Campaigns and figures are demo content.
 */

type Platform = "meta" | "google";

const CAMPAIGNS: { name: string; platform: Platform; spend: number; leads: number; bookings: number; revenue: number; live: boolean }[] = [
  { name: "Weekend SUVs", platform: "meta", spend: 640, leads: 58, bookings: 14, revenue: 6720, live: true },
  { name: "Airport pickup", platform: "google", spend: 520, leads: 44, bookings: 11, revenue: 5280, live: true },
  { name: "Tesla for a week", platform: "meta", spend: 410, leads: 39, bookings: 8, revenue: 4160, live: true },
  { name: "Rent a car near me", platform: "google", spend: 380, leads: 31, bookings: 6, revenue: 1980, live: true },
  { name: "Holiday road trips", platform: "meta", spend: 190, leads: 14, bookings: 2, revenue: 780, live: false },
];

const PLATFORMS: Record<Platform, { name: string; logo: string }> = {
  meta: { name: "Meta Ads", logo: "meta.com" },
  google: { name: "Google Ads", logo: "google.com" },
};

/* The originals, from logo.dev, as the Integrations section shows its partners. */
const LOGO_TOKEN = "pk_EmodMTbiSPiHDa2fIPUo3w";
const brandLogo = (domain: string) => `https://img.logo.dev/${domain}?token=${LOGO_TOKEN}&size=128&format=png`;

const FEATURES = [
  { icon: Link2, title: "Connect Meta and Google Ads", text: "Sign in once. Your campaigns, spend and results come in by themselves." },
  { icon: BarChart3, title: "See bookings, not just clicks", text: "Every lead and booking is matched to the ad it came from, so you know what each booking cost." },
  { icon: Megaphone, title: "Manage every campaign", text: "Compare, pause and adjust campaigns side by side, across both platforms." },
  { icon: PenLine, title: "Ads written for you", text: "Trax drafts ads from your own cars, prices and photos.", later: true },
];

const money = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;

export function MarketingSection() {
  const { ref, visible } = useFadeIn();
  const [show, setShow] = useState<"all" | Platform>("all");

  const rows = CAMPAIGNS.filter((c) => show === "all" || c.platform === show);
  const total = rows.reduce(
    (sum, c) => ({ spend: sum.spend + c.spend, leads: sum.leads + c.leads, bookings: sum.bookings + c.bookings, revenue: sum.revenue + c.revenue }),
    { spend: 0, leads: 0, bookings: 0, revenue: 0 },
  );
  // The campaign that books renters for the least, the one Trax points to.
  const best = [...rows].sort((a, b) => a.spend / a.bookings - b.spend / b.bookings)[0];
  const worst = [...rows].sort((a, b) => b.spend / b.bookings - a.spend / a.bookings)[0];
  const top = Math.max(...rows.map((c) => c.revenue / c.spend));

  return (
    <section id="marketing" aria-labelledby="marketing-heading" className="mk-section">
      <div ref={ref} className={`mk-inner ${visible ? "fade-in-visible" : "fade-in-hidden"}`}>
        <div className="mk-head">
          <span className="mk-soon">Coming soon</span>
          <SectionHeading
            id="marketing-heading"
            title={
              <>
                Your ads, <Accent>beside your bookings</Accent>
              </>
            }
            sub={
              <>
                Connect Meta and Google Ads and see which ads bring you renters, what each booking cost, and where to spend next.
              </>
            }
          />
        </div>

        <div className="mk-window">
          <BrowserChrome tab="Marketing · Your portal" url="northwind.portal.drive-247.com/marketing">
            <div className="mk-app">
              <div className="mk-app-head">
                <div>
                  <h3>Marketing</h3>
                  <p>Last 30 days</p>
                </div>
                <div className="mk-connected">
                  {(Object.keys(PLATFORMS) as Platform[]).map((key) => (
                    <span key={key}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={brandLogo(PLATFORMS[key].logo)} alt="" />
                      {PLATFORMS[key].name}
                      <i aria-label="connected" />
                    </span>
                  ))}
                </div>
              </div>

              <div className="mk-filter" role="group" aria-label="Show campaigns from">
                {(["all", "meta", "google"] as const).map((key) => (
                  <button key={key} type="button" aria-pressed={show === key} onClick={() => setShow(key)}>
                    {key === "all" ? "All platforms" : PLATFORMS[key].name}
                  </button>
                ))}
              </div>

              <dl className="mk-kpis">
                <div>
                  <dt>Spend</dt>
                  <dd>{money(total.spend)}</dd>
                </div>
                <div>
                  <dt>Leads</dt>
                  <dd>{total.leads}</dd>
                </div>
                <div>
                  <dt>Bookings</dt>
                  <dd>{total.bookings}</dd>
                </div>
                <div>
                  <dt>Cost per booking</dt>
                  <dd>{money(total.spend / total.bookings)}</dd>
                </div>
                <div className="is-key">
                  <dt>Booked from ads</dt>
                  <dd>{money(total.revenue)}</dd>
                </div>
              </dl>

              <p key={show} className="mk-trax">
                <Sparkles aria-hidden />
                <span>
                  <b>{best.name}</b> books renters for {money(best.spend / best.bookings)} each, your cheapest.{" "}
                  {worst !== best && (
                    <>
                      <b>{worst.name}</b> costs {money(worst.spend / worst.bookings)} a booking.
                    </>
                  )}
                </span>
              </p>

              <div className="mk-table-wrap">
                <table className="mk-table">
                  <thead>
                    <tr>
                      <th>Campaign</th>
                      <th>Spend</th>
                      <th className="mk-opt">Leads</th>
                      <th>Bookings</th>
                      <th className="mk-opt">Cost per booking</th>
                      <th className="mk-opt">Booked</th>
                      <th className="mk-opt">Return</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((c) => (
                      <tr key={c.name} className={c.live ? undefined : "is-paused"}>
                        <td>
                          <span className="mk-camp">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={brandLogo(PLATFORMS[c.platform].logo)} alt={PLATFORMS[c.platform].name} />
                            <span>
                              {c.name}
                              <small>{c.live ? "Active" : "Paused"}</small>
                            </span>
                          </span>
                        </td>
                        <td>{money(c.spend)}</td>
                        <td className="mk-opt">{c.leads}</td>
                        <td>{c.bookings}</td>
                        <td className="mk-opt">{money(c.spend / c.bookings)}</td>
                        <td className="mk-opt">{money(c.revenue)}</td>
                        <td className="mk-opt">
                          <span className="mk-return">
                            <i style={{ width: `${((c.revenue / c.spend) / top) * 100}%` }} />
                            <b>{(c.revenue / c.spend).toFixed(1)}×</b>
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </BrowserChrome>
        </div>

        <ul className="mk-features">
          {FEATURES.map((f) => (
            <li key={f.title}>
              <f.icon aria-hidden />
              <b>
                {f.title}
                {f.later && <span className="mk-later">Later</span>}
              </b>
              <p>{f.text}</p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
