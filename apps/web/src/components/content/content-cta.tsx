import { Instrument_Serif } from "next/font/google";
import { ArrowRight } from "lucide-react";
import "./content-cta.css";

// The cursive face, loaded here so the panel looks the same on every page that ends with it.
const cursive = Instrument_Serif({ subsets: ["latin"], weight: "400", style: "italic", variable: "--font-cursive", display: "swap" });

const POINTS = [
  { title: "No cut of your bookings", text: "You pay your plan and the card processor's standard fees." },
  { title: "Your own booking site", text: "Renters book and pay on your web address, and their details stay with you." },
  { title: "Checked before pickup", text: "ID checks, agreements and deposits, the same way every time." },
] as const;

/** The closing call to action on the blog and customer story pages. */
export function ContentCta() {
  return (
    <section className={`cc ${cursive.variable}`} aria-labelledby="ct-cta-title">
      <div className="cc-main">
        <h2 id="ct-cta-title" className="cc-title">
          Run your rental business <em className="cc-cursive">on Drive247.</em>
        </h2>
        <p className="cc-sub">Start a free trial today and see it run your own bookings.</p>
        <div className="cc-row">
          <a href="/#pricing" className="cc-btn cc-btn-solid">
            Start free trial
            <ArrowRight strokeWidth={2} aria-hidden />
          </a>
        </div>
      </div>
      <ul className="cc-points">
        {POINTS.map((point) => (
          <li key={point.title}>
            <p className="cc-point-title">{point.title}</p>
            <p className="cc-point-text">{point.text}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}
