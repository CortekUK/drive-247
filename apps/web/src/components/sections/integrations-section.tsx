"use client";

import type { CSSProperties } from "react";
import { Globe } from "lucide-react";
import { useFadeIn } from "@/hooks/use-fade-in";
import "./integrations-section.css";

/*
 * What Drive247 connects to: the heading on top, tall plain cards running past in an endless marquee.
 *
 * Every card is a panel on the portal's Integrations page, and every line is one that
 * panel can back (apps/portal/.../integrations/_panels/_intros.ts). Turo Sync, Inshur
 * and CheckMyDriver are deliberately not here: they aren't on general release.
 *
 * Logos are the originals, from logo.dev as on that page, with its publishable key.
 */
const LOGO_TOKEN = "pk_EmodMTbiSPiHDa2fIPUo3w";
const brandLogo = (domain: string) => `https://img.logo.dev/${domain}?token=${LOGO_TOKEN}&size=256&format=png`;

type Card = {
  name: string;
  /** The integration's primary colour, for the card's corner wash. */
  brand: string;
  text: string;
  logo: { src: string; dark?: string; wide?: boolean } | null;
};

const CARDS: Card[] = [
  {
    name: "Zoho Books",
    brand: "#f9b21d",
    logo: { src: brandLogo("zoho.com") },
    text: "Invoices and payments go to Zoho Books, so your accounts follow your business without retyping.",
  },
  {
    name: "Square",
    // Square is black: softened, or its wash reads far heavier than the others.
    brand: "color-mix(in srgb, var(--foreground) 45%, transparent)",
    logo: { src: brandLogo("squareup.com") },
    text: "Already run your business on Square? Your booking payments can go through your own account.",
  },
  {
    name: "Twilio",
    brand: "#f22f46",
    logo: { src: brandLogo("twilio.com") },
    text: "Text customers from your own number, and take calls with voicemail and a short summary of each one.",
  },
  {
    name: "Stripe",
    brand: "#635bff",
    logo: { src: brandLogo("stripe.com") },
    text: "Take card payments when customers book, hold deposits on their card, and get paid out to your bank.",
  },
  {
    name: "Xero",
    brand: "#13b5ea",
    logo: { src: brandLogo("xero.com") },
    text: "Invoices and payments go to Xero, against the accounts you choose, so nobody has to retype them.",
  },
  {
    name: "BoldSign",
    brand: "#f05a28",
    logo: { src: brandLogo("boldsign.com") },
    text: "Rental agreements signed online, with the signed copy saved back on the rental.",
  },
  {
    name: "Bonzah",
    brand: "#d90052",
    logo: { src: "/landing-v3/partners/bonzah-logo.svg", dark: "/landing-v4/site/bonzah-logo-dark.svg", wide: true },
    text: "Offer your renters per-rental insurance cover right at checkout.",
  },
  {
    name: "Tesla",
    brand: "#e31937",
    logo: { src: brandLogo("tesla.com") },
    text: "Supercharging sessions matched to the right rental every hour, ready for you to bill or waive.",
  },
  {
    name: "Your own domain",
    brand: "hsl(var(--v2-primary))",
    logo: null,
    text: "Customers book at an address you own. Add two records where you bought it, and you're live.",
  },
];

export function IntegrationsSection() {
  const { ref, visible } = useFadeIn();
  return (
    <section id="integrations" className="ig-section">
      <div ref={ref} className={`ig-inner ${visible ? "fade-in-visible" : "fade-in-hidden"}`}>
        <div className="ig-copy">
          <h2 className="ig-title font-medium tracking-tighter">Integrations</h2>
          <p className="ig-sub">
            The tools you already rely on, connected to your bookings, payments and books.
          </p>
        </div>

        {/* Two identical sets, so the loop has no seam. The second is only for the eye. */}
        <div className="ig-marquee" role="group" aria-label="Integrations">
          <div className="ig-track">
            {[0, 1].map((set) => (
              <div key={set} className="ig-set" aria-hidden={set === 1 || undefined}>
                {CARDS.map((card) => (
                  <article key={card.name} className="ig-card" style={{ "--ig-brand": card.brand } as CSSProperties}>
                    <span className="ig-logo">
                      {card.logo ? (
                        <>
                          {/* Third-party and fixed-size, so these skip the image optimiser. */}
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={card.logo.src}
                            alt=""
                            className={`${card.logo.wide ? "is-wide" : ""}${card.logo.dark ? " dark:hidden" : ""}`}
                          />
                          {card.logo.dark && (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={card.logo.dark} alt="" className="is-wide hidden dark:block" />
                          )}
                        </>
                      ) : (
                        <Globe strokeWidth={1.75} aria-hidden />
                      )}
                    </span>
                    <div className="ig-text">
                      <h3>{card.name}</h3>
                      <p>{card.text}</p>
                    </div>
                  </article>
                ))}
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
