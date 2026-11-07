"use client";

import { Check, Pencil } from "lucide-react";
import type { CSSProperties } from "react";
import { SITE_COLOURS, SITE_TEMPLATES, setSiteColour, setSiteTemplate, useSitePreview } from "@/lib/site-preview";
import { SiteHome } from "./site-home";
import { useReveal } from "./operations-dashboard";
import "./templates-section.css";
import { Accent, SectionHeading } from "./section-heading";

/*
 * Pick your colour: the booking site in the editor takes it at once, under the name typed
 * in the next section. The demo after that shows all three of your sites in the same colour.
 */
const EDITS = [
  ["Your words", "Change any heading, line or button."],
  ["Your photos", "Swap in your own cars and your own place."],
  ["Your logo", "Add it once and it shows on every page."],
  ["Publish when ready", "See every change as you make it, then go live."],
];

export function TemplatesSection() {
  const { ref, visible } = useReveal();
  const { colour, template, name, slug, initial } = useSitePreview();

  return (
    <section id="templates" aria-labelledby="templates-heading" className="tp-section">
      <div ref={ref} className={`tp-inner${visible ? " is-in" : ""}`}>
        <SectionHeading
          id="templates-heading"
          title={
            <>
              Pick a template and a colour. <Accent>Make it yours.</Accent>
            </>
          }
          sub={
            <>
              Choose how your booking site looks and the colour it wears, and your renters&apos; portal and your own portal wear it too. Then change the words and photos yourself in the editor. No designer, no developer.
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
              <span className="tp-url">{slug}.drive-247.com</span>
              <span className="tp-mode">
                <Pencil strokeWidth={2.2} />
                Editing
              </span>
            </div>
            <div className="tp-canvas">
              <SiteHome template={template} accent={colour.hex} name={name} initial={initial} />
              <div className="tp-cursor" aria-hidden>
                <svg viewBox="0 0 24 24">
                  <path d="M3 2.5 20.5 10l-7.4 2.3-3 7.2Z" />
                </svg>
                <span>
                  <b>You</b>
                  Trying my look
                </span>
              </div>
            </div>
          </div>

          {/* The colours to choose from */}
          <div className="tp-pick">
            <p className="tp-pick-title">Your template</p>
            <div className="tp-temps" role="radiogroup" aria-label="Your site's template">
              {SITE_TEMPLATES.map((t) => {
                const on = t.id === template;
                return (
                  <button key={t.id} type="button" role="radio" aria-checked={on} className={on ? "is-on" : ""} onClick={() => setSiteTemplate(t.id)}>
                    <span className="tp-temp-thumb" aria-hidden>
                      <SiteHome template={t.id} accent={colour.hex} name={name} initial={initial} />
                    </span>
                    <span className="tp-temp-name">
                      <b>{t.name}</b>
                      {t.feel}
                    </span>
                    {on && (
                      <span className="tp-tick">
                        <Check strokeWidth={3} />
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
            <p className="tp-pick-title is-next">Your colour</p>
            <div className="tp-swatches" role="radiogroup" aria-label="Your site's colour">
              {SITE_COLOURS.map((c) => {
                const on = c.id === colour.id;
                return (
                  <button
                    key={c.id}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    className={on ? "is-on" : ""}
                    style={{ "--sw": c.hex } as CSSProperties}
                    onClick={() => setSiteColour(c.id)}
                  >
                    <span className="tp-dot">{on && <Check strokeWidth={3} aria-hidden />}</span>
                    {c.name}
                  </button>
                );
              })}
            </div>
            <p className="tp-pick-note">
              Next, type your company&apos;s name. Then try your booking site, your renters&apos; portal and your own portal below, in{" "}
              <b style={{ color: colour.hex }}>{colour.name}</b>.
            </p>
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
