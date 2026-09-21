"use client";

import { Icon } from "./icons";

/* ========================================================================== *
 * The booking page's progress bar — /custom-booking-page/book.
 *
 * Presentation only. The reservation engine owns which step is current and
 * which have been reached; this draws them in the custom site's language and
 * hands clicks back. A step can be revisited once reached, never skipped to.
 * ========================================================================== */

export interface CbpBookStep {
  /** The engine's own step number (insurance-exempt tenants skip 3). */
  step: number;
  label: string;
}

export function CbpBookStepper({
  steps, current, highest, onGo,
}: {
  steps: CbpBookStep[];
  current: number;
  highest: number;
  onGo: (step: number) => void;
}) {
  return (
    <nav aria-label="Booking progress" className="cbp-bk-steps">
      <ol style={{ gridTemplateColumns: `repeat(${steps.length}, minmax(0, 1fr))` }}>
        {steps.map((s, i) => {
          const done = current > s.step;
          const on = current === s.step;
          const clickable = !on && s.step <= highest;
          return (
            <li key={s.step} data-done={done} data-on={on}>
              {i < steps.length - 1 && <span className="cbp-bk-steps__line" data-done={done} aria-hidden="true" />}
              <button
                type="button"
                disabled={!clickable}
                onClick={() => onGo(s.step)}
                aria-current={on ? "step" : undefined}
                aria-label={`Step ${i + 1} of ${steps.length}: ${s.label}${done ? " (done)" : ""}`}
              >
                <span className="cbp-bk-steps__dot">
                  {done ? <Icon name="check" className="h-3 w-3" /> : i + 1}
                </span>
                <span className="cbp-bk-steps__label">{s.label}</span>
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
