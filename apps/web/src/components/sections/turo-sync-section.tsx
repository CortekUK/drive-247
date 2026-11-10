"use client";

import { ArrowRight, Check, RefreshCw } from "lucide-react";
import type { CSSProperties } from "react";

/* The Chrome mark, drawn: the four colours and the blue centre. */
function ChromeMark() {
  return (
    <svg className="tx-chrome" viewBox="0 0 48 48" aria-hidden>
      <circle cx="24" cy="24" r="22" fill="#db4437" />
      <path d="M24 24 43.05 13A22 22 0 0 1 24 46Z" fill="#fbbc05" />
      <path d="M24 24 24 46A22 22 0 0 1 4.95 13Z" fill="#0f9d58" />
      <path d="M24 24 4.95 13A22 22 0 0 1 43.05 13Z" fill="#db4437" />
      <circle cx="24" cy="24" r="10.5" fill="#fff" />
      <circle cx="24" cy="24" r="8.2" fill="#4285f4" />
    </svg>
  );
}
import { useReveal } from "./operations-dashboard";
import { Chapter } from "./turo-story";
import "./turo-story.css";
import "./turo-sync-section.css";

/*
 * Turo Sync: the Chrome extension that reads an operator's own Turo host calendar into
 * Drive247. Every claim here comes from the extension's manifest and the portal screen.
 * It is not on general release yet, so the page says early access, not "included".
 */
const POINTS = [
  ["Your Turo trips, in Drive247", "Every trip lands on the same calendar as your direct bookings."],
  ["No more double-booking", "A car out on Turo shows as taken everywhere else."],
  ["Each Turo car matched", "Link your Turo listings to the cars in your fleet once."],
  ["Hands off your Turo account", "It never asks for your Turo password, and never changes anything on Turo."],
];

/* A made-up week of trips, read from Turo. */
const TRIPS = [
  { car: "Kia Telluride", when: "Nov 8 to Nov 11" },
  { car: "Tesla Model Y", when: "Nov 9 to Nov 14" },
  { car: "Ford Mustang", when: "Nov 12 to Nov 13" },
];

export function TuroSyncSection() {
  const { ref, visible } = useReveal();

  return (
    <section id="turo-sync" aria-labelledby="turo-sync-heading" className="tx-section">
      <div ref={ref} className={`tx-inner${visible ? " is-in" : ""}`}>
        <div className="tx-copy">
          <Chapter n={3} title="The first step" align="left" />
          <p className="tx-kicker">
            <span>Turo Sync</span>
            <em>Early access</em>
          </p>
          <h2 id="turo-sync-heading">Already on Turo? Bring your trips with you.</h2>
          <p className="tx-lead">
            Turo Sync is a Chrome extension. It reads your Turo host calendar and pulls your trips into Drive247, so
            every booking, from Turo or your own site, sits in one place.
          </p>
          <dl className="tx-points">
            {POINTS.map(([title, body]) => (
              <div key={title}>
                <dt>
                  <Check strokeWidth={3} />
                  {title}
                </dt>
                <dd>{body}</dd>
              </div>
            ))}
          </dl>
          <div className="tx-actions">
            {/* Placeholder until the listing is live: it does nothing yet. Do not ship before it does. */}
            <button type="button" className="tx-chrome-btn">
              <ChromeMark />
              Add to Chrome
            </button>
            <a href="/strategy-call" className="tx-link">
              Ask for early access
              <ArrowRight strokeWidth={2} />
            </a>
          </div>
          <p className="tx-store">
            <ChromeMark />
            Available in the Chrome Web Store
          </p>
        </div>

        {/* The extension at work, over the browser it lives in. Rebuilt from the real popup. */}
        <div className="tx-stage" aria-hidden>
          <div className="tx-browser">
            <div className="tx-bar">
              <span className="tx-lights">
                <i />
                <i />
                <i />
              </span>
              <span className="tx-url">Your Turo host calendar</span>
              <span className="tx-chrome-ext" title="Extensions">
                <ChromeMark />
              </span>
              <span className="tx-ext">
                <RefreshCw strokeWidth={2.4} />
              </span>
            </div>
            <div className="tx-page">
              {Array.from({ length: 5 }, (_, row) => (
                <span key={row} className="tx-row">
                  <i style={{ "--tx-x": `${(row * 17) % 40}%`, "--tx-w": `${30 + ((row * 23) % 35)}%` } as CSSProperties} />
                </span>
              ))}
            </div>
          </div>

          <div className="tx-popup">
            <div className="tx-pop-head">
              <span className="tx-mark">
                <ArrowRight strokeWidth={2.4} />
              </span>
              <span>
                <b>Turo Sync</b>
                <small>DRIVE247</small>
              </span>
              <em className="tx-live">Connected</em>
            </div>
            <div className="tx-pop-status">
              <b>Read your Turo calendar</b>
              <span>47 trips read</span>
              <i>
                <u />
              </i>
            </div>
            <ul className="tx-trips">
              {TRIPS.map((trip, i) => (
                <li key={trip.car} style={{ "--tx-at": `${900 + i * 280}ms` } as CSSProperties}>
                  <span>
                    <b>{trip.car}</b>
                    <small>{trip.when}</small>
                  </span>
                  <em>
                    <Check strokeWidth={3} />
                    In Drive247
                  </em>
                </li>
              ))}
            </ul>
          </div>

          <div className="tx-cursor">
            <svg viewBox="0 0 24 24">
              <path d="M3 2.5 20.5 10l-7.4 2.3-3 7.2Z" />
            </svg>
            <span>
              <b>You</b>
              Syncing my Turo trips
            </span>
          </div>
        </div>
      </div>
      {/* The close of the Turo story: one call to action. */}
      <div className="ts-close">
        <h3>
          Keep Turo. <em>Add a business of your own.</em>
        </h3>
        <a href="#pricing">
          Start free trial
          <ArrowRight strokeWidth={2} />
        </a>
      </div>
    </section>
  );
}
