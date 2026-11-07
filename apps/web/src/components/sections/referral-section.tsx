"use client";

import { Copy } from "lucide-react";
import type { CSSProperties } from "react";
import { useReveal } from "./operations-dashboard";
import "./referral-section.css";

/*
 * The referral programme, at its live defaults (referral_program_settings and referral_tiers,
 * checked 2026-11-06): the friend gets 20% off for 3 months; the referrer's discount steps up
 * with active referrals, as a level, not a running total.
 */
const TIERS = [
  { refs: "1 referral", off: "10%" },
  { refs: "3 referrals", off: "20%" },
  { refs: "5 referrals", off: "30%" },
];

export function ReferralSection() {
  const { ref, visible } = useReveal();

  return (
    <section id="referrals" aria-labelledby="referrals-heading" className="rf-section">
      <div ref={ref} className={`rf-inner${visible ? " is-in" : ""}`}>
        <div className="rf-copy">
          <p className="rf-kicker">Referral programme</p>
          <h2 id="referrals-heading">Bring another operator. Pay less every month.</h2>
          <p className="rf-lead">
            Share your link with another rental business. When they subscribe, they get <b>20% off for 3 months</b>, and
            you get money off every Drive247 bill for as long as they stay.
          </p>
          <p className="rf-note">Your discount is the level you&apos;re on, not a total, and counts while each operator stays subscribed.</p>
        </div>

        <div className="rf-stage" aria-hidden>
          <div className="rf-link">
            <small>Your referral link</small>
            <span>
              drive-247.com/r/<b>SUMMIT-4821</b>
            </span>
            <i>
              <Copy strokeWidth={2} />
            </i>
          </div>
          <ol className="rf-tiers">
            {TIERS.map((tier, i) => (
              <li key={tier.refs} style={{ "--rf-h": `${46 + i * 27}%`, "--rf-at": `${300 + i * 180}ms` } as CSSProperties}>
                <b>{tier.off}</b>
                <span>off every bill</span>
                <small>{tier.refs}</small>
              </li>
            ))}
          </ol>
          <div className="rf-cursor">
            <svg viewBox="0 0 24 24">
              <path d="M3 2.5 20.5 10l-7.4 2.3-3 7.2Z" />
            </svg>
            <span>
              <b>You</b>
              Sharing my link
            </span>
          </div>
        </div>
      </div>
    </section>
  );
}
