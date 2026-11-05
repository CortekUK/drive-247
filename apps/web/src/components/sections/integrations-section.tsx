"use client";

import type { CSSProperties } from "react";
import { Globe } from "lucide-react";
import { useFadeIn } from "@/hooks/use-fade-in";
import "./integrations-section.css";

/*
 * What Drive247 connects to, all in one view: the words on the left, a bubble for each
 * integration on the right, each with its logo and what it does for the business.
 *
 * Every bubble is a panel on the portal's Integrations page, and every line is one that
 * panel can back (apps/portal/.../integrations/_panels/_intros.ts). Turo Sync, Inshur
 * and CheckMyDriver are deliberately not here: they aren't on general release.
 *
 * Logos are the originals, from logo.dev as on that page, with its publishable key.
 */
const LOGO_TOKEN = "pk_EmodMTbiSPiHDa2fIPUo3w";
const brandLogo = (domain: string) => `https://img.logo.dev/${domain}?token=${LOGO_TOKEN}&size=256&format=png`;

type Bubble = {
  name: string;
  /** The integration's primary colour, for the bubble's wash. */
  brand: string;
  text: string;
  logo: { src: string; dark?: string; wide?: boolean } | null;
};

/* In reading order across the three staggered rows. Similar colours are kept apart. */
const BUBBLES: Bubble[] = [
  {
    name: "Stripe",
    brand: "#635bff",
    logo: { src: brandLogo("stripe.com") },
    text: "Card payments, deposits and payouts to your bank.",
  },
  {
    name: "Zoho Books",
    brand: "#f9b21d",
    logo: { src: brandLogo("zoho.com") },
    text: "Invoices and payments, with no retyping.",
  },
  {
    name: "Twilio",
    brand: "#f22f46",
    logo: { src: brandLogo("twilio.com") },
    text: "Texts from your number, and calls with voicemail.",
  },
  {
    name: "Xero",
    brand: "#13b5ea",
    logo: { src: brandLogo("xero.com") },
    text: "Invoices and payments, against your own accounts.",
  },
  {
    name: "Bonzah",
    brand: "#d90052",
    logo: { src: "/landing-v3/partners/bonzah-logo.svg", dark: "/landing-v4/site/bonzah-logo-dark.svg", wide: true },
    text: "Per-rental insurance cover, right at checkout.",
  },
  {
    name: "Square",
    // Square is black: softened, or its wash reads far heavier than the others.
    brand: "color-mix(in srgb, var(--foreground) 45%, transparent)",
    logo: { src: brandLogo("squareup.com") },
    text: "Booking payments through your own account.",
  },
  {
    name: "BoldSign",
    brand: "#f05a28",
    logo: { src: brandLogo("boldsign.com") },
    text: "Agreements signed online, saved on the rental.",
  },
  {
    name: "Your own domain",
    brand: "hsl(var(--v2-primary))",
    logo: null,
    text: "Customers book at an address you own.",
  },
  {
    name: "Tesla",
    brand: "#e31937",
    logo: { src: brandLogo("tesla.com") },
    text: "Supercharging matched to the right rental.",
  },
];

export function IntegrationsSection() {
  const { ref, visible } = useFadeIn();
  return (
    <section id="integrations" className="ig-section">
      <div ref={ref} className={`ig-inner${visible ? " is-in" : ""}`}>
        <div className="ig-copy">
          <h2 className="ig-title font-medium tracking-tighter">Works with the tools you already use.</h2>
          <p className="ig-sub">Payments, accounts, messages, signatures and insurance, all connected to your bookings.</p>
        </div>

        <ul className="ig-bubbles" aria-label="Integrations">
          {BUBBLES.map((bubble, i) => (
            <li key={bubble.name} className="ig-slot" style={{ "--ig-i": i } as CSSProperties}>
              <article className="ig-bubble" style={{ "--ig-brand": bubble.brand } as CSSProperties}>
                <span className="ig-logo">
                  {bubble.logo ? (
                    <>
                      {/* Third-party and fixed-size, so these skip the image optimiser. */}
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={bubble.logo.src}
                        alt=""
                        className={`${bubble.logo.wide ? "is-wide" : ""}${bubble.logo.dark ? " dark:hidden" : ""}`}
                      />
                      {bubble.logo.dark && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={bubble.logo.dark} alt="" className="is-wide hidden dark:block" />
                      )}
                    </>
                  ) : (
                    <Globe strokeWidth={1.75} aria-hidden />
                  )}
                </span>
                <h3>{bubble.name}</h3>
                <p>{bubble.text}</p>
              </article>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
