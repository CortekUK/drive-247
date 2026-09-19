"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Icon } from "./icons";
import { CBP } from "./use-site-content";

/* ========================================================================== *
 * Cookie consent, in this site's design.
 *
 * The behaviour is the existing banner's, unchanged: the same `gdpr-consent`
 * key, the same three choices, the same stored shape, so a visitor who has
 * already answered on either site is not asked again.
 *
 * What differs is presentation. The shared banner is painted from the app
 * theme — for a tenant whose brand is gold, a gold banner — and this site's
 * palette is fixed purple for every tenant. It also sits in the root layout,
 * outside `.cbp`, so it has to carry the namespace class and mirror the mode
 * itself; the observer below keeps it in step when the visitor flips the
 * header's light/dark switch while the banner is still open.
 * ========================================================================== */

export const CONSENT_KEY = "gdpr-consent";

export interface ConsentChoice {
  necessary: true;
  analytics: boolean;
  marketing: boolean;
}

/** Reads the mode off the site root and stays subscribed to it. */
function useRootMode() {
  const [mode, setMode] = useState<string | undefined>();

  useEffect(() => {
    const root = document.querySelector(".cbp-root");
    if (!root) return;
    const read = () => setMode(root.getAttribute("data-theme") ?? undefined);
    read();
    const observer = new MutationObserver(read);
    observer.observe(root, { attributes: true, attributeFilter: ["data-theme"] });
    return () => observer.disconnect();
  }, []);

  return mode;
}

export function CbpCookieConsent({
  onDecide,
}: {
  /** Persists the choice and dismisses. Owned by the shared banner. */
  onDecide: (choice: ConsentChoice) => void;
}) {
  const mode = useRootMode();
  const [analytics, setAnalytics] = useState(false);
  const [marketing, setMarketing] = useState(false);

  return (
    <div className={"cbp cbp-cookie"} data-theme={mode}>
      <section className="cbp-cookie-card" role="region" aria-label="Cookie consent">
        <div className="flex items-start gap-3">
          <span className="cbp-cookie-mark" aria-hidden="true">
            <Icon name="shield" className="h-[18px] w-[18px]" />
          </span>
          <div className="min-w-0">
            <h2 className="cbp-h3">Cookie Consent</h2>
            <p className="mt-1.5 text-[13px] leading-relaxed text-[var(--body)]">
              We use cookies to enhance your browsing experience, serve personalised content and
              analyse our traffic. Choose what you are happy with — you can accept everything, keep
              only what the site needs, or pick individually. Read our{" "}
              <Link href={`${CBP}/privacy`} className="cbp-cookie-link">Privacy Policy</Link>{" "}
              for more information.
            </p>
          </div>
        </div>

        <div className="mt-4 grid gap-x-6 gap-y-0.5 sm:grid-cols-2 lg:grid-cols-3">
          <Toggle checked disabled label="Necessary cookies" hint="always required" />
          <Toggle
            checked={analytics}
            onChange={setAnalytics}
            label="Analytics cookies"
            hint="help us improve our service"
          />
          <Toggle
            checked={marketing}
            onChange={setMarketing}
            label="Marketing cookies"
            hint="personalised content"
          />
        </div>

        <div className="mt-5 flex flex-wrap gap-2.5">
          <button
            type="button"
            className="cbp-btn cbp-btn-primary"
            onClick={() => onDecide({ necessary: true, analytics: true, marketing: true })}
          >
            Accept all
          </button>
          <button
            type="button"
            className="cbp-btn cbp-btn-ghost"
            onClick={() => onDecide({ necessary: true, analytics, marketing })}
          >
            Save preferences
          </button>
          <button
            type="button"
            className="cbp-cookie-plain"
            onClick={() => onDecide({ necessary: true, analytics: false, marketing: false })}
          >
            Reject all
          </button>
        </div>
      </section>
    </div>
  );
}

/**
 * A real `<input type="checkbox">` under a drawn box: the browser gives the
 * keyboard behaviour, the label association and the screen-reader role for
 * free, and the visible state is painted in CSS from the input's own
 * `:checked` and `:focus-visible`.
 */
function Toggle({
  checked, onChange, label, hint, disabled = false,
}: {
  checked: boolean;
  onChange?: (v: boolean) => void;
  label: string;
  hint: string;
  disabled?: boolean;
}) {
  return (
    <label className={`cbp-check${disabled ? " cbp-check--locked" : ""}`}>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={e => onChange?.(e.target.checked)}
      />
      <span className="cbp-check-box" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3.2}
             strokeLinecap="round" strokeLinejoin="round">
          <path d="m5 12.5 4.4 4.4L19 7" />
        </svg>
      </span>
      <span className="cbp-check-text">
        {label} <span className="cbp-check-hint">({hint})</span>
      </span>
    </label>
  );
}
