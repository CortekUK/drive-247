"use client";

import Image from "next/image";
import type { CSSProperties } from "react";
import { useReveal } from "./operations-dashboard";
import "./rental-cards.css";

/* Four cards in one row, each in its own tint: the words on top, a real screen beneath. */
const CARDS: {
  tone: string;
  title: string;
  lead: string;
  points: string[];
  src: string;
  dark: string;
  width: number;
  height: number;
  alt: string;
}[] = [
  {
    tone: "verify",
    title: "ID verification",
    lead: "Know who's driving before you hand over the keys.",
    points: ["Licence, front and back", "Selfie matched to the photo", "Verdict on their record"],
    src: "/v2/rows/card-verification.webp",
    dark: "/v2/rows/card-verification.webp",
    width: 1480,
    height: 1260,
    alt: "A customer's verified ID check, with a 94% face match",
  },
  {
    tone: "insurance",
    title: "Insurance",
    lead: "Keep every rental covered without chasing paperwork.",
    points: ["Per-rental cover through Bonzah", "Or renters upload their own", "Every policy in one list"],
    src: "/v2/rows/card-cover.webp",
    dark: "/v2/rows/card-cover-dark.webp",
    width: 1400,
    height: 869,
    alt: "The insurance list in the portal",
  },
  {
    tone: "agreements",
    title: "Agreements",
    lead: "Stop chasing signatures. Renters sign from their phone.",
    points: ["Your own templates", "Sent for e-signature", "Signed copy kept on the rental"],
    src: "/v2/hero/close-agreements.webp",
    dark: "/v2/hero/close-agreements-dark.webp",
    width: 2400,
    height: 1530,
    alt: "The agreements list with signed and pending statuses",
  },
  {
    tone: "payments",
    title: "Payments",
    lead: "Get paid into your own account, with no commission to us.",
    points: ["Your own Stripe or Square", "Deposits held on their card", "See what you actually kept"],
    src: "/v2/hero/close-insights.webp",
    dark: "/v2/hero/close-insights-dark.webp",
    width: 2076,
    height: 1725,
    alt: "Insights showing where your money went",
  },
];

export function RentalCards() {
  const { ref, visible } = useReveal();

  return (
    <section aria-label="Everything around each rental" className="rc-section">
      <div ref={ref} className={`rc-grid${visible ? " is-in" : ""}`}>
        {CARDS.map((card, i) => (
          <article key={card.tone} className={`rc-card is-${card.tone}`} style={{ "--rc-at": `${i * 80}ms` } as CSSProperties}>
            <div className="rc-copy">
              <h2>{card.title}</h2>
              <p>{card.lead}</p>
              <ul>
                {card.points.map((point) => (
                  <li key={point}>{point}</li>
                ))}
              </ul>
            </div>
            <div className="rc-shot">
              <Image src={card.src} alt={card.alt} width={card.width} height={card.height} sizes="(min-width: 720px) 900px, 700px" className="dark:hidden" />
              <Image src={card.dark} alt={card.alt} width={card.width} height={card.height} sizes="(min-width: 720px) 900px, 700px" className="hidden dark:block" />
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
