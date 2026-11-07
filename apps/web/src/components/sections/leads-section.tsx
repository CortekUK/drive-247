"use client";

import { useState } from "react";
import { ArrowRight, CalendarDays, Car, Check, Globe, MessageSquareText, Phone, Receipt, Sparkles } from "lucide-react";
import { useFadeIn } from "@/hooks/use-fade-in";
import { BrowserChrome } from "./portal-glass";
import "./leads-section.css";
import { Accent, SectionHeading } from "./section-heading";

/*
 * Lead management: every enquiry, from the ads and the booking website, in one pipeline
 * from first message to booking. NOT BUILT YET (Ghulam, 2026-11-07): the section says
 * "Coming soon". The visitor can open a lead and move it along until it becomes a booking.
 * People and figures are demo content.
 */

const STAGES = ["New", "Contacted", "Quoted", "Booked"] as const;
type Stage = (typeof STAGES)[number];
type Source = "meta" | "google" | "website";

type Lead = { id: string; name: string; car: string; dates: string; source: Source; campaign?: string; quote: number; ago: string; stage: Stage };

const START: Lead[] = [
  { id: "l1", name: "Priya Shah", car: "SUV", dates: "Nov 14 – 18", source: "meta", campaign: "Weekend SUVs", quote: 612, ago: "12 min ago", stage: "New" },
  { id: "l2", name: "Marcus Hill", car: "Tesla Model 3", dates: "1 week", source: "google", campaign: "Airport pickup", quote: 840, ago: "40 min ago", stage: "New" },
  { id: "l3", name: "Elena Rossi", car: "Any car", dates: "Dec 2 – 5", source: "website", quote: 236, ago: "1 h ago", stage: "New" },
  { id: "l4", name: "Daniel Kim", car: "Minivan", dates: "Nov 20 – 27", source: "meta", campaign: "Holiday road trips", quote: 714, ago: "3 h ago", stage: "Contacted" },
  { id: "l5", name: "Grace Okafor", car: "Sedan", dates: "3 days", source: "google", campaign: "Rent a car near me", quote: 177, ago: "5 h ago", stage: "Contacted" },
  { id: "l6", name: "Tom Becker", car: "Genesis GV80", dates: "Nov 10 – 13", source: "website", quote: 387, ago: "Yesterday", stage: "Quoted" },
  { id: "l7", name: "Jordan Lee", car: "Hyundai Sonata", dates: "Nov 7 – 10", source: "meta", campaign: "Weekend SUVs", quote: 177, ago: "Yesterday", stage: "Booked" },
];

const SOURCE: Record<Source, { label: string; logo?: string }> = {
  meta: { label: "Meta ad", logo: "meta.com" },
  google: { label: "Google ad", logo: "google.com" },
  website: { label: "Your website" },
};
const LOGO_TOKEN = "pk_EmodMTbiSPiHDa2fIPUo3w";
const brandLogo = (domain: string) => `https://img.logo.dev/${domain}?token=${LOGO_TOKEN}&size=64&format=png`;

/* What moving a lead on means, said on the button that does it. */
const NEXT: Record<Stage, string | null> = { New: "Mark as contacted", Contacted: "Send a quote", Quoted: "Turn into a booking", Booked: null };

const FEATURES = [
  { icon: Globe, title: "Every enquiry in one place", text: "Leads from your Meta and Google ads and your own website arrive in one list, each with the ad it came from." },
  { icon: MessageSquareText, title: "Follow up fast", text: "Text or call from the lead, and see every message in its history." },
  { icon: Receipt, title: "Quote and book", text: "Send a quote from your real prices, and turn it into a booking when they say yes." },
  { icon: Sparkles, title: "Nothing goes cold", text: "Trax tells you which leads are waiting on you, so none are forgotten." },
];

export function LeadsSection() {
  const { ref, visible } = useFadeIn();
  const [leads, setLeads] = useState(START);
  const [openId, setOpenId] = useState("l1");
  const open = leads.find((l) => l.id === openId) ?? leads[0];
  const step = STAGES.indexOf(open.stage);

  const advance = () => {
    const next = STAGES[step + 1];
    if (!next) return;
    setLeads((all) => all.map((l) => (l.id === open.id ? { ...l, stage: next, ago: "Just now" } : l)));
  };
  const waiting = leads.filter((l) => l.stage === "New").length;

  // The lead's history, as far as it has got.
  const history = [
    { at: 0, icon: Globe, text: `Came in from ${open.campaign ? `your ${SOURCE[open.source].label}, ${open.campaign}` : "your website"}` },
    { at: 1, icon: MessageSquareText, text: "You texted them back" },
    { at: 2, icon: Receipt, text: `Quote sent: $${open.quote}` },
    { at: 3, icon: Check, text: "Booked, and in your Rentals" },
  ].filter((h) => h.at <= step);

  return (
    <section id="leads" aria-labelledby="leads-heading" className="ld-section">
      <div ref={ref} className={`ld-inner ${visible ? "fade-in-visible" : "fade-in-hidden"}`}>
        <div className="ld-head">
          <span className="ld-soon">Coming soon</span>
          <SectionHeading
            id="leads-heading"
            title={
              <>
                Turn every enquiry <Accent>into a booking</Accent>
              </>
            }
            sub={
              <>
                Leads from your ads and your website land in one pipeline. Follow up, quote and book, and see exactly where every renter is.
              </>
            }
          />
        </div>

        <p className="ld-tip">Open any lead, then move it along until it&apos;s a booking.</p>

        <div className="ld-window">
          <BrowserChrome tab="Leads · Your portal" url="northwind.portal.drive-247.com/leads">
            <div className="ld-app">
              <div className="ld-app-head">
                <div>
                  <h3>Leads</h3>
                  <p>{leads.length} open this week</p>
                </div>
                <p className="ld-trax">
                  <Sparkles aria-hidden />
                  {waiting > 0 ? (
                    <span>
                      {waiting} new {waiting === 1 ? "lead is" : "leads are"} waiting on you. The oldest came in{" "}
                      {leads.filter((l) => l.stage === "New").slice(-1)[0].ago}.
                    </span>
                  ) : (
                    <span>No one is waiting on you. Every new lead has had a reply.</span>
                  )}
                </p>
              </div>

              <div className="ld-body">
                <div className="ld-board">
                  {STAGES.map((stage) => {
                    const here = leads.filter((l) => l.stage === stage);
                    return (
                      <section key={stage} className="ld-col" aria-label={`${stage}, ${here.length}`}>
                        <header>
                          <b>{stage}</b>
                          <span>{here.length}</span>
                        </header>
                        <ul>
                          {here.map((l) => (
                            <li key={l.id}>
                              <button
                                type="button"
                                className={`ld-card${l.id === open.id ? " is-open" : ""}`}
                                aria-pressed={l.id === open.id}
                                onClick={() => setOpenId(l.id)}
                              >
                                <span className="ld-card-top">
                                  <b>{l.name}</b>
                                  <small>{l.ago}</small>
                                </span>
                                <span className="ld-card-want">
                                  {l.car} · {l.dates}
                                </span>
                                <span className="ld-card-foot">
                                  <Source source={l.source} />
                                  <span>${l.quote}</span>
                                </span>
                              </button>
                            </li>
                          ))}
                        </ul>
                      </section>
                    );
                  })}
                </div>

                <aside key={open.id} className="ld-detail" aria-label={`Lead: ${open.name}`}>
                  <div className="ld-detail-head">
                    <span className="ld-avatar">
                      {open.name
                        .split(" ")
                        .map((p) => p[0])
                        .join("")}
                    </span>
                    <span>
                      <b>{open.name}</b>
                      <small>{open.stage}</small>
                    </span>
                  </div>
                  <dl className="ld-facts">
                    <div>
                      <dt>
                        <Car aria-hidden />
                        Wants
                      </dt>
                      <dd>{open.car}</dd>
                    </div>
                    <div>
                      <dt>
                        <CalendarDays aria-hidden />
                        Dates
                      </dt>
                      <dd>{open.dates}</dd>
                    </div>
                    <div>
                      <dt>
                        <Phone aria-hidden />
                        Phone
                      </dt>
                      <dd>(555) 01•-••••</dd>
                    </div>
                  </dl>
                  <ol className="ld-history">
                    {history.map((h) => (
                      <li key={h.at}>
                        <h.icon aria-hidden />
                        {h.text}
                      </li>
                    ))}
                  </ol>
                  {NEXT[open.stage] ? (
                    <button type="button" className="ld-go" onClick={advance}>
                      {NEXT[open.stage]}
                      <ArrowRight aria-hidden />
                    </button>
                  ) : (
                    <p className="ld-done">
                      <Check aria-hidden />
                      Booked. It&apos;s in your Rentals with the ad it came from.
                    </p>
                  )}
                </aside>
              </div>
            </div>
          </BrowserChrome>
        </div>

        <ul className="ld-features">
          {FEATURES.map((f) => (
            <li key={f.title}>
              <f.icon aria-hidden />
              <b>{f.title}</b>
              <p>{f.text}</p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

function Source({ source }: { source: Source }) {
  const s = SOURCE[source];
  return (
    <span className="ld-source">
      {s.logo ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={brandLogo(s.logo)} alt="" />
      ) : (
        <Globe aria-hidden />
      )}
      {s.label}
    </span>
  );
}
