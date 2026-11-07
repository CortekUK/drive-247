"use client";

import { useEffect, useState } from "react";
import { Bell, CalendarCheck, Check, Clock, FileSignature, Monitor, MousePointerClick, Smartphone, Wallet } from "lucide-react";
import { useFadeIn } from "@/hooks/use-fade-in";
import { TraxMark } from "@/components/shared/trax-mark";
import { Accent, SectionHeading } from "./section-heading";
import "./trax-widget-section.css";

/*
 * Trax as a widget: a small Trax that comes with the installed app, stays on screen, tells the
 * operator what needs them and does the next step when they say so (Ghulam, 2026-11-07).
 *
 * NOT BUILT YET, so the heading says "Coming soon" and the note under the points says what
 * Trax does today. What it shows is what an installed web app can really do:
 * - on a computer, Chrome and Edge let a web app keep a small window on top of everything
 *   else (Document Picture-in-Picture), so Trax can float over the operator's other apps;
 * - on a phone a web app can't float over other apps, so there Trax is inside the Drive247
 *   app and in its notifications. Nothing here says otherwise.
 *
 * The section's one animation is the desktop widget's feed: a note arrives, its button is
 * pressed, the next one arrives. People, cars and amounts are demo content.
 */

type Item = { icon: typeof Bell; title: string; text: string; action?: string; done?: string };

const FEED: Item[] = [
  { icon: CalendarCheck, title: "New booking", text: "Jordan Lee booked the Tesla Model 3, Fri to Sun. $486 paid.", action: "Open rental", done: "Opened" },
  { icon: Clock, title: "Running late", text: "Mia Chen is 20 minutes late returning the Kia Telluride.", action: "Text Mia", done: "Texted Mia" },
  { icon: FileSignature, title: "Ready to send", text: "Priya Shah's agreement is ready for Friday's pickup.", action: "Send it", done: "Sent to Priya" },
  { icon: Wallet, title: "Deposit held", text: "Marcus Hill's $250 deposit is held on his card." },
];

const POINTS = [
  { icon: Monitor, title: "On your desktop", text: "A small window that stays on top of your other apps, so I'm there while you work in your email or spreadsheets." },
  { icon: Smartphone, title: "On your phone", text: "I float over every screen of your Drive247 app, and reach you through notifications when it's closed." },
  { icon: Bell, title: "Tells you first", text: "New bookings, messages, late returns and payments, the moment they happen." },
  { icon: MousePointerClick, title: "Acts when you say so", text: "Text a renter, send an agreement or share a lockbox code. You confirm, and I do it." },
];

const ARRIVE_MS = 4200;
const PRESS_MS = 1900;

function useFeed(running: boolean) {
  const [at, setAt] = useState(0);
  const [pressed, setPressed] = useState(false);

  useEffect(() => {
    if (!running) return;
    let press = 0;
    let next = 0;
    const show = (i: number) => {
      setAt(i);
      setPressed(false);
      if (FEED[i].action) press = window.setTimeout(() => setPressed(true), PRESS_MS);
      next = window.setTimeout(() => show((i + 1) % FEED.length), ARRIVE_MS);
    };
    show(0);
    return () => {
      window.clearTimeout(press);
      window.clearTimeout(next);
    };
  }, [running]);

  return { at, pressed };
}

function Note({ item, pressed, className }: { item: Item; pressed: boolean; className: string }) {
  return (
    <li className={`wg-card ${className}`}>
      <span className="wg-card-icon">
        <item.icon strokeWidth={2} />
      </span>
      <span className="wg-card-body">
        <b>{item.title}</b>
        <span>{item.text}</span>
        {item.action && (
          <em className={pressed ? "is-done" : undefined}>
            {pressed ? (
              <>
                <Check strokeWidth={2.5} />
                {item.done}
              </>
            ) : (
              item.action
            )}
          </em>
        )}
      </span>
    </li>
  );
}

export function TraxWidgetSection() {
  const { ref, visible } = useFadeIn();
  const [reduced, setReduced] = useState(false);
  useEffect(() => setReduced(matchMedia("(prefers-reduced-motion: reduce)").matches), []);
  const { at, pressed } = useFeed(visible && !reduced);
  const before = (at + FEED.length - 1) % FEED.length;

  return (
    <section id="trax-widget" aria-labelledby="trax-widget-heading" className="wg-section">
      <div ref={ref} className={`wg-inner${visible ? " is-in" : ""}`}>
        <SectionHeading
          id="trax-widget-heading"
          label="Coming soon"
          title={
            <>
              Install Drive247, and <Accent>I come with it.</Accent>
            </>
          }
          sub="A small Trax that stays on your desktop and lives in your phone. I tell you the moment something needs you, and I do the next step when you say so."
        />

        <div className="wg-stage" aria-hidden>
          {/* A computer, with other apps open and Trax floating over them. */}
          <div className="wg-desk">
            <div className="wg-menubar">
              <span>Fri 9:41 AM</span>
            </div>

            <div className="wg-win is-mail">
              <div className="wg-win-bar">
                <span className="wg-lights">
                  <i />
                  <i />
                  <i />
                </span>
                <b>Inbox</b>
              </div>
              <ul className="wg-rows">
                {[72, 56, 64, 48, 60].map((width, i) => (
                  <li key={i}>
                    <i className="wg-dot" />
                    <span className="wg-bar" style={{ width: `${width}%` }} />
                    <span className="wg-bar is-short" />
                  </li>
                ))}
              </ul>
            </div>

            <div className="wg-win is-sheet">
              <div className="wg-win-bar">
                <span className="wg-lights">
                  <i />
                  <i />
                  <i />
                </span>
                <b>Q4 costs</b>
              </div>
              <div className="wg-cells">
                {Array.from({ length: 24 }, (_, i) => (
                  <span key={i} className={i < 4 ? "is-head" : undefined} />
                ))}
              </div>
            </div>

            <div className="wg-widget">
              <ol className="wg-feed">
                {reduced ? (
                  <>
                    <Note item={FEED[0]} pressed className="is-back" />
                    <Note item={FEED[1]} pressed={false} className="is-front" />
                  </>
                ) : (
                  <>
                    <Note key={`b-${before}`} item={FEED[before]} pressed className="is-back" />
                    <Note key={`f-${at}`} item={FEED[at]} pressed={pressed} className="is-front is-new" />
                  </>
                )}
              </ol>
              <span className="wg-orb">
                <TraxMark size="md" animated={!reduced} />
              </span>
            </div>
          </div>

          {/* The phone: Trax inside the app, over whatever screen is open. */}
          <div className="wg-phone">
            <div className="wg-screen">
              <span className="wg-status">
                <b>9:41</b>
              </span>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/v2/phone-dashboard.png" alt="" className="wg-shot dark:hidden" loading="lazy" />
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/v2/phone-dashboard-dark.png" alt="" className="wg-shot hidden dark:block" loading="lazy" />
              <div className="wg-phone-note">
                <span className="wg-phone-text">
                  <b>Trax</b>
                  Mia Chen is 20 minutes late with the Kia Telluride.
                </span>
                <em>Text Mia</em>
              </div>
              <span className="wg-phone-orb">
                <TraxMark size="sm" />
              </span>
            </div>
          </div>
        </div>

        <ul className="wg-points">
          {POINTS.map((point) => (
            <li key={point.title}>
              <point.icon strokeWidth={1.75} aria-hidden />
              <b>{point.title}</b>
              <p>{point.text}</p>
            </li>
          ))}
        </ul>

        <p className="wg-note">Coming soon. Today, I answer your questions inside your portal.</p>
      </div>
    </section>
  );
}
