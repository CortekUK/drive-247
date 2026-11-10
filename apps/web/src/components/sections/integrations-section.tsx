"use client";

import { useEffect, type CSSProperties } from "react";
import { Globe, IdCard } from "lucide-react";
import { useFadeIn } from "@/hooks/use-fade-in";
import "./integrations-section.css";
import { Accent, SectionHeading } from "./section-heading";

/*
 * What Drive247 connects to: the portal's own Integrations board
 * (apps/portal/.../integrations/integrations-board.tsx), five to a row, all thirteen on one screen.
 * Its pins and status tags are for an operator's account, so they aren't here.
 *
 * Since 2026-11-10 all thirteen of the board's cards are here, in its order and with its lines
 * (Ghulam asked for "the same number, same everything"); each turns over to say a little more.
 *
 * Logos are the originals, from logo.dev as on that page, with its publishable key.
 */
const LOGO_TOKEN = "pk_EmodMTbiSPiHDa2fIPUo3w";
const brandLogo = (domain: string) => `https://img.logo.dev/${domain}?token=${LOGO_TOKEN}&size=256&format=png`;

type Card = {
  name: string;
  /** The board's category, shown on the back. */
  category: string;
  /** The integration's own colour, for the faint tint on its card. */
  tint: string;
  /** The board's line, on the front. */
  text: string;
  /** On the back: a little more about it, in plain words. */
  more: string;
  logo?: string;
  /** Bonzah's logo is a wordmark, with a version for each theme. */
  wordmark?: { light: string; dark: string };
  /** A glyph instead of a logo (Custom Domain, CheckMyDriver), on a tile of this colour. */
  glyph?: "globe" | "id";
  free?: boolean;
  /** The board's tag in the top corner, as Northwind's board shows it. */
  tag?: "Add-on" | "Soon" | "Live";
  beta?: boolean;
};

/*
 * The portal's board, card for card and in its order (Ghulam, 2026-11-10: "exactly like the
 * portal, same number, same everything"), each flipping on hover to say a bit more about itself.
 */
const CARDS: Card[] = [
  { name: "Turo Sync", tag: "Add-on", beta: true, category: "Fleet", tint: "#593cfb", logo: brandLogo("turo.com"), text: "Pull your Turo trips in and stop double-booking.", more: "Your Turo trips land on your Drive247 calendar on their own, through our Chrome extension. A car booked on Turo is never offered twice on your own site." },
  { name: "Stripe Connect", category: "Payments", tint: "#635bff", logo: brandLogo("stripe.com"), text: "Accept booking payments, deposits & payouts.", more: "Renters pay by card on your booking site. Deposits are held and released for you, and payouts land in your own Stripe account." },
  { name: "Square", category: "Payments", tint: "#6b7280", logo: brandLogo("squareup.com"), text: "Take booking payments through your Square account.", more: "Already on Square? Take booking payments through the account you have, and keep your money where it already is." },
  {
    name: "Bonzah",
    category: "Insurance",
    tint: "#d6246e",
    wordmark: { light: "/landing-v3/partners/bonzah-logo.svg", dark: "/landing-v4/site/bonzah-logo-dark.svg" },
    text: "Per-rental insurance coverage at checkout.",
    more: "Renters add cover for their trip as they book. The policy is issued there and then, and its PDF sits on the rental.",
  },
  { name: "Inshur", tag: "Soon", category: "Insurance", tint: "#1f6feb", logo: brandLogo("inshur.com"), text: "Fleet insurance for your vehicles between rentals.", more: "Cover for your cars while they're parked between trips, alongside the per-rental cover your renters buy." },
  { name: "BoldSign", tag: "Live", category: "Documents", tint: "#ff5a1f", logo: brandLogo("boldsign.com"), free: true, text: "E-signature for rental agreements.", more: "Agreements go out to sign as soon as a booking is made, in your branding. The signed PDF is saved on the rental. Included free." },
  { name: "CheckMyDriver", tag: "Soon", category: "Verification", tint: "#0ea5e9", glyph: "id", text: "Verify driver's licenses & identity.", more: "Check a renter's driving licence and identity before they drive away, without them coming to the desk." },
  { name: "Twilio Messages", category: "Messaging", tint: "#f22f46", logo: brandLogo("twilio.com"), text: "SMS notifications, reminders & 2-way chat.", more: "Confirmations, reminders and two-way texts with your renters, from your own number, in the same thread as their chat and email." },
  { name: "Twilio Calling", category: "Calling", tint: "#f22f46", logo: brandLogo("twilio.com"), text: "Call forwarding, voicemail & recordings.", more: "Calls to your business number reach your phone. Missed ones leave a voicemail, and calls are recorded on the renter's record." },
  { name: "Tesla", category: "Fleet", tint: "#e31937", logo: brandLogo("tesla.com"), text: "Supercharging & vehicle data via the Fleet API.", more: "Connect your Teslas and each Supercharging session is matched to the right rental, so charging goes to the right renter." },
  { name: "Custom Domain", category: "Website", tint: "#4f46e5", glyph: "globe", text: "Use your own domain for booking & portal.", more: "Put your booking site and renter portal on your own web address, like book.yourcompany.com, with security set up for you." },
  { name: "Xero", tag: "Live", category: "Accounting", tint: "#13b5ea", logo: brandLogo("xero.com"), text: "Sync invoices & payments to Xero.", more: "Invoices and payments reach Xero as they happen, so your books stay current without typing anything twice." },
  { name: "Zoho", category: "Accounting", tint: "#e09a12", logo: brandLogo("zoho.com"), text: "Sync books & CRM with Zoho.", more: "Keep Zoho Books and Zoho CRM in step with your rentals: invoices, payments and customers sync on their own." },
];

export function IntegrationsSection() {
  const { ref, visible } = useFadeIn();
  // The cards fly in from all sides; once they have landed, the page line measures again so
  // it routes round where they are now, not where they started (tour/use-tour-layout.ts).
  useEffect(() => {
    if (!visible) return;
    const t = window.setTimeout(() => window.dispatchEvent(new Event("resize")), 1900);
    return () => window.clearTimeout(t);
  }, [visible]);
  return (
    <section id="integrations" className="ig-section">
      <div ref={ref} className={`ig-inner${visible ? " is-in" : ""}`}>
        <div className="ig-copy">
          <SectionHeading
            align="left"
            titleClassName="ig-title-two"
            title={
              <>
                Integrations <Accent>for the tools you already use</Accent>
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
            <li
              key={card.name}
              className="ig-tile"
              tabIndex={0}
              style={
                {
                  "--ig-i": i,
                  "--ig-c": card.tint,
                  // Where it flies in from: around a wide ring, each from its own side.
                  "--ig-gx": `${Math.round(Math.cos((i / CARDS.length) * Math.PI * 2 + 0.5) * 70)}vw`,
                  "--ig-gy": `${Math.round(Math.sin((i / CARDS.length) * Math.PI * 2 + 0.5) * 60)}vh`,
                  "--ig-gr": `${(i % 2 ? 1 : -1) * (6 + (i % 4) * 4)}deg`,
                } as CSSProperties
              }
            >
              <div className="ig-turn">
                <div className="ig-card ig-front">
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
                      <span className="ig-logo ig-logo-own" style={{ background: card.tint }}>
                        {card.glyph === "id" ? <IdCard strokeWidth={1.5} aria-hidden /> : <Globe strokeWidth={1.5} aria-hidden />}
                      </span>
                    )}
                  </div>
                  <div className="ig-words">
                    <h3>
                      {card.name}
                    </h3>
                    <p>{card.text}</p>
                  </div>
                </div>
                <div className="ig-card ig-back" aria-hidden>
                  <small>
                    {card.category}
                    {card.free ? " · Free" : ""}
                  </small>
                  <b>{card.name}</b>
                  <p>{card.more}</p>
                </div>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
