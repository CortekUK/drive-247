"use client";

import type { CSSProperties } from "react";
import { Globe } from "lucide-react";
import { useFadeIn } from "@/hooks/use-fade-in";
import "./integrations-section.css";
import { Accent, SectionHeading } from "./section-heading";

/*
 * What Drive247 connects to: the portal's own Integrations board
 * (apps/portal/.../integrations/integrations-board.tsx), three to a row, all nine on one screen.
 * Its pins and status tags are for an operator's account, so they aren't here.
 *
 * The lines are the board's. Turo Sync, Inshur and CheckMyDriver are deliberately left out:
 * they aren't on general release. Tesla and Zoho are narrower than the board's, to what the
 * panels behind them are known to do. The board's two Twilio cards are one here, which also
 * makes the rows come out even.
 *
 * Logos are the originals, from logo.dev as on that page, with its publishable key.
 */
const LOGO_TOKEN = "pk_EmodMTbiSPiHDa2fIPUo3w";
const brandLogo = (domain: string) => `https://img.logo.dev/${domain}?token=${LOGO_TOKEN}&size=256&format=png`;

type Card = {
  name: string;
  /** The integration's own colour, for the faint tint on its card. */
  tint: string;
  text: string;
  logo?: string;
  /** Bonzah's logo is a wordmark, with a version for each theme. */
  wordmark?: { light: string; dark: string };
};

const CARDS: Card[] = [
  { name: "Stripe Connect", tint: "#635bff", logo: brandLogo("stripe.com"), text: "Accept booking payments, deposits & payouts." },
  { name: "Square", tint: "#6b7280", logo: brandLogo("squareup.com"), text: "Take booking payments through your Square account." },
  {
    name: "Bonzah",
    tint: "#d6246e",
    wordmark: { light: "/landing-v3/partners/bonzah-logo.svg", dark: "/landing-v4/site/bonzah-logo-dark.svg" },
    text: "Per-rental insurance coverage at checkout.",
  },
  { name: "BoldSign", tint: "#ff5a1f", logo: brandLogo("boldsign.com"), text: "E-signature for rental agreements." },
  {
    name: "Twilio",
    tint: "#f22f46",
    logo: brandLogo("twilio.com"),
    text: "SMS notifications, reminders & 2-way chat, plus call forwarding, voicemail & recordings.",
  },
  { name: "Tesla", tint: "#e31937", logo: brandLogo("tesla.com"), text: "Supercharging sessions matched to the right rental." },
  { name: "Custom Domain", tint: "#4f46e5", text: "Use your own domain for booking & portal." },
  { name: "Xero", tint: "#13b5ea", logo: brandLogo("xero.com"), text: "Sync invoices & payments to Xero." },
  { name: "Zoho", tint: "#e09a12", logo: brandLogo("zoho.com"), text: "Sync invoices & payments to Zoho Books." },
];

export function IntegrationsSection() {
  const { ref, visible } = useFadeIn();
  return (
    <section id="integrations" className="ig-section">
      <div ref={ref} className={`ig-inner${visible ? " is-in" : ""}`}>
        <div className="ig-copy">
          <SectionHeading
            title={
              <>
                Works with <Accent>the tools you use</Accent>
              </>
            }
            sub={
              <>
                Connect the tools that power payments, documents, messaging and more.
              </>
            }
          />
        </div>

        <ul className="ig-grid" aria-label="Integrations">
          {CARDS.map((card, i) => (
            <li key={card.name} className="ig-card" style={{ "--ig-i": i, "--ig-c": card.tint } as CSSProperties}>
              <div className="ig-mark">
                {card.wordmark ? (
                  <>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={card.wordmark.light} alt="" className="ig-wordmark dark:hidden" />
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={card.wordmark.dark} alt="" className="ig-wordmark hidden dark:block" />
                  </>
                ) : card.logo ? (
                  // Third-party and fixed-size, so these skip the image optimiser.
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={card.logo} alt="" className="ig-logo" />
                ) : (
                  <span className="ig-logo ig-logo-own">
                    <Globe strokeWidth={1.5} aria-hidden />
                  </span>
                )}
              </div>
              <div className="ig-words">
                <h3>{card.name}</h3>
                <p>{card.text}</p>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
