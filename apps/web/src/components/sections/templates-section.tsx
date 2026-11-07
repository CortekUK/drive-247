"use client";

import { Check, Pencil } from "lucide-react";
import { useState, type CSSProperties } from "react";
import { useReveal } from "./operations-dashboard";
import "./templates-section.css";
import { Accent, SectionHeading } from "./section-heading";

/*
 * Booking-site templates, and the editor that changes them. The template names and looks
 * are placeholders for now (mock data, at Ghulam's request), drawn as mini sites.
 */
const TEMPLATES = [
  { id: "summit", name: "Summit", feel: "Bold and modern", brand: "Summit Rentals", accent: "#4f44d8", ground: "#f4f2ff", dark: false },
  { id: "coast", name: "Coast", feel: "Light and airy", brand: "Coastline Cars", accent: "#0e7490", ground: "#ecfeff", dark: false },
  { id: "metro", name: "Metro", feel: "Dark and premium", brand: "Metro Drive", accent: "#f59e0b", ground: "#111118", dark: true },
  { id: "canyon", name: "Canyon", feel: "Warm and friendly", brand: "Canyon Auto", accent: "#c2410c", ground: "#fff7ed", dark: false },
  { id: "fleet", name: "Fleet", feel: "Clean and corporate", brand: "Fleetline", accent: "#1d4ed8", ground: "#f8fafc", dark: false },
  { id: "drift", name: "Drift", feel: "Sporty and bright", brand: "Drift Rentals", accent: "#db2777", ground: "#fdf2f8", dark: false },
];

const EDITS = [
  ["Your words", "Change any heading, line or button."],
  ["Your photos", "Swap in your own cars and your own place."],
  ["Your colours and logo", "Match the site to your brand in a click."],
  ["Publish when ready", "See every change as you make it, then go live."],
];

function MiniSite({ t }: { t: (typeof TEMPLATES)[number] }) {
  return (
    <div className={`tp-site${t.dark ? " is-dark" : ""}`} style={{ "--tp-acc": t.accent, "--tp-ground": t.ground } as CSSProperties}>
      <div className="tp-nav">
        <b>{t.brand}</b>
        <span>
          <i />
          <i />
          <i />
        </span>
        <u>Book</u>
      </div>
      <div className="tp-hero">
        <div>
          <strong>Your next drive starts here.</strong>
          <i />
          <i />
          <u>Find a car</u>
        </div>
        <span className="tp-photo" />
      </div>
      <div className="tp-cars">
        {[0, 1, 2].map((n) => (
          <span key={n}>
            <i />
            <b />
            <em />
          </span>
        ))}
      </div>
    </div>
  );
}

export function TemplatesSection() {
  const { ref, visible } = useReveal();
  const [picked, setPicked] = useState(0);
  const t = TEMPLATES[picked];

  return (
    <section id="templates" aria-labelledby="templates-heading" className="tp-section">
      <div ref={ref} className={`tp-inner${visible ? " is-in" : ""}`}>
        <SectionHeading
          id="templates-heading"
          title={
            <>
              Pick a template. <Accent>Make it yours.</Accent>
            </>
          }
          sub={
            <>
              Start your booking site from a ready-made template, then change the words, photos and colours yourself in the editor. No designer, no developer.
            </>
          }
        />

        <div className="tp-stage">
          {/* The chosen template, open in the editor */}
          <div className="tp-editor">
            <div className="tp-bar">
              <span className="tp-lights">
                <i />
                <i />
                <i />
              </span>
              <span className="tp-url">{t.brand.toLowerCase().replace(/\s+/g, "")}.com</span>
              <span className="tp-mode">
                <Pencil strokeWidth={2.2} />
                Editing
              </span>
            </div>
            <div className="tp-canvas" key={t.id}>
              <MiniSite t={t} />
              <span className="tp-select" aria-hidden />
              <div className="tp-cursor" aria-hidden>
                <svg viewBox="0 0 24 24">
                  <path d="M3 2.5 20.5 10l-7.4 2.3-3 7.2Z" />
                </svg>
                <span>
                  <b>You</b>
                  Changing my headline
                </span>
              </div>
            </div>
          </div>

          {/* The templates to choose from */}
          <div className="tp-pick" role="radiogroup" aria-label="Templates">
            {TEMPLATES.map((item, i) => (
              <button
                key={item.id}
                type="button"
                role="radio"
                aria-checked={i === picked}
                className={i === picked ? "is-on" : ""}
                onClick={() => setPicked(i)}
              >
                <span className="tp-thumb">
                  <MiniSite t={item} />
                </span>
                <span className="tp-name">
                  <b>{item.name}</b>
                  {item.feel}
                </span>
                {i === picked && (
                  <span className="tp-tick">
                    <Check strokeWidth={3} />
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>

        <dl className="tp-edits">
          {EDITS.map(([title, body]) => (
            <div key={title}>
              <dt>{title}</dt>
              <dd>{body}</dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  );
}
