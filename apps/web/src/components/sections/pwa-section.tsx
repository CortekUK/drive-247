"use client";

import {
  BatteryFull,
  Calendar,
  Camera,
  Cloud,
  Mail,
  Map as MapIcon,
  MessageCircle,
  Music,
  Phone,
  Settings,
  Signal,
  StickyNote,
  Wifi,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useFadeIn } from "@/hooks/use-fade-in";
import "./pwa-section.css";
import { Accent, SectionHeading } from "./section-heading";

/*
 * Both portals install on a phone like apps, straight from the browser.
 *
 * Checked against the apps themselves:
 * - the operator portal has a manifest that names the app "{Company} Ops", opens standalone,
 *   and sends web push (apps/portal/src/app/manifest.webmanifest/route.ts,
 *   settings-v2/notifications-v2/push-install-guide.tsx);
 * - the renter's portal installs from the operator's own site with the operator's app name,
 *   icon and colour, opens on /portal, standalone, with push
 *   (apps/booking/src/app/manifest.webmanifest/route.ts, lib/push.ts).
 * The two app screens are the real ones (public/v2/phone-dashboard, phone-renter). The
 * notifications are examples.
 */

/* Keep in step with the "On a phone" media query in pwa-section.css. */
const PHONE = "(max-width: 759.98px)";

const HOME_APPS = [
  { icon: Calendar, name: "Calendar" },
  { icon: Mail, name: "Mail" },
  { icon: MapIcon, name: "Maps" },
  { icon: Camera, name: "Camera" },
  { icon: Cloud, name: "Weather" },
  { icon: StickyNote, name: "Notes" },
  { icon: Music, name: "Music" },
  { icon: Settings, name: "Settings" },
];


function StatusBar({ light = false }: { light?: boolean }) {
  return (
    <span className={`pw-status${light ? " is-light" : ""}`} aria-hidden>
      <b>9:41</b>
      <span>
        <Signal />
        <Wifi />
        <BatteryFull />
      </span>
    </span>
  );
}

/*
 * Something keeps happening (Ghulam, 2026-11-10): each app's notifications keep arriving, one
 * after another, sliding down, staying a moment and going; each one also lands as a badge on
 * that app's icon on the home screen in the middle. The text changes while the banner is out
 * of sight (at the end of each pass of the animation), so nothing jumps.
 */
const OPS_NOTES = [
  "New booking: Jordan Lee, Hyundai Sonata, Nov 7 – 10.",
  "Priya Shah paid $612.00 for Nov 14 – 18.",
  "Marcus Hill signed his agreement.",
  "Kia Telluride is back. Check it in.",
];
const RENTER_NOTES = [
  "Your agreement is signed. Your car is ready on Friday at 10:00 AM.",
  "Your lockbox code is 4817. Rear left wheel arch.",
  "Your return is tomorrow at 10:00 AM.",
  "Thanks for renting with Northwind. How was your trip?",
];

function AppPhone({
  src,
  alt,
  app,
  notes,
  delay,
  onArrive,
}: {
  src: string;
  alt: string;
  app: { name: string; mark: string };
  notes: string[];
  delay: number;
  onArrive: () => void;
}) {
  const [i, setI] = useState(0);
  const note = notes[i % notes.length];
  return (
    <div className="pw-phone">
      <div className="pw-screen">
        <StatusBar />
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={`${src}.png`} alt={alt} className="pw-shot dark:hidden" loading="lazy" />
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={`${src}-dark.png`} alt={alt} className="pw-shot hidden dark:block" loading="lazy" />
        <div
          className="pw-note"
          style={{ animationDelay: `${delay}ms` }}
          aria-hidden
          onAnimationIteration={() => {
            setI((n) => n + 1);
            onArrive();
          }}
        >
          {/* The Drive247 mark (Ghulam, 2026-11-10: "use the Drive favicon in the notifications and app icons"). */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className="pw-note-icon" src="/apple-touch-icon.png" alt="" />
          <span>
            <span className="pw-note-top">
              <b>{app.name}</b>
              <small>now</small>
            </span>
            {note}
          </span>
        </div>
      </div>
    </div>
  );
}

export function PwaSection() {
  const { ref, visible } = useFadeIn();
  // Unread on each app's home-screen icon: one more with every notification that arrives.
  const [unread, setUnread] = useState({ ops: 1, renter: 1 });
  // Plays only while on screen: off screen the notifications pause and nothing re-renders.
  const [live, setLive] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => setLive(e.isIntersecting));
    io.observe(el);
    return () => io.disconnect();
  }, [ref]);

  /*
   * On a phone the three phones are a row to swipe through, one full size at a time with its
   * neighbours peeking in (pwa-section.css, "On a phone"). It opens on the home screen in the
   * middle, and the dots under it follow the swipe and jump to a phone when tapped.
   */
  const stage = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState(1);
  useEffect(() => {
    const row = stage.current;
    if (!row) return;
    const phone = window.matchMedia(PHONE);
    const centre = (i: number, smooth = false) => {
      const col = row.children[i] as HTMLElement | undefined;
      if (!col) return;
      row.scrollTo({ left: col.offsetLeft - (row.clientWidth - col.offsetWidth) / 2, behavior: smooth ? "smooth" : "auto" });
    };
    const start = () => {
      if (phone.matches) centre(1);
    };
    start();
    let frame = 0;
    const onScroll = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const mid = row.scrollLeft + row.clientWidth / 2;
        let best = 0;
        let bestGap = Infinity;
        Array.from(row.children).forEach((c, i) => {
          const el = c as HTMLElement;
          const gap = Math.abs(el.offsetLeft + el.offsetWidth / 2 - mid);
          if (gap < bestGap) {
            bestGap = gap;
            best = i;
          }
        });
        setShown(best);
      });
    };
    row.addEventListener("scroll", onScroll, { passive: true });
    phone.addEventListener("change", start);
    goTo.current = (i: number) => centre(i, !window.matchMedia("(prefers-reduced-motion: reduce)").matches);
    return () => {
      row.removeEventListener("scroll", onScroll);
      phone.removeEventListener("change", start);
      cancelAnimationFrame(frame);
    };
  }, []);
  const goTo = useRef<(i: number) => void>(() => {});
  return (
    // data-line-lane: the page line keeps to the left here, not down between the phones (tour-layout.ts).
    <section id="mobile" data-line-lane="left" aria-labelledby="mobile-heading" className="pw-section">
      <div ref={ref} className={`pw-inner${visible ? " is-in" : ""}${live ? " pw-live" : ""}`}>
        <div className="pw-head">
          <SectionHeading
            id="mobile-heading"
            title={
              <>
                <span className="pw-nowrap">Your business,</span> <Accent>installed on every phone</Accent>
              </>
            }
            sub={
              <>
                Your portal and your renters&apos; portal install like apps, straight from the browser. Full screen, in your brand, with notifications. No app store, nothing to download.
              </>
            }
          />
        </div>

        <div ref={stage} className="pw-stage">
          <figure className="pw-col is-ops">
            <AppPhone
              src="/v2/phone-dashboard"
              alt="The Drive247 portal on a phone: today's takings, and Trax listing what needs attention."
              app={{ name: "Northwind Ops", mark: "N" }}
              notes={OPS_NOTES}
              delay={500}
              onArrive={() => setUnread((u) => ({ ...u, ops: u.ops >= 9 ? 1 : u.ops + 1 }))}
            />
            <figcaption>
              <b>Your portal, as an app</b>
              <span>Installs as Northwind Ops. Bookings, returns and payments, wherever you are.</span>
            </figcaption>
          </figure>

          {/* The home screen both apps end up on. */}
          <figure className="pw-col is-home" aria-hidden>
            <div className="pw-phone is-home">
              <div className="pw-screen pw-home">
                <StatusBar light />
                <div className="pw-grid">
                  {HOME_APPS.map((a) => (
                    <span key={a.name} className="pw-app">
                      <i>
                        <a.icon />
                      </i>
                      <small>{a.name}</small>
                    </span>
                  ))}
                  <span className="pw-app is-ours is-ops">
                    <i>
                      <b key={unread.ops} className="pw-badge">
                        {unread.ops}
                      </b>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src="/apple-touch-icon.png" alt="" />
                    </i>
                    {/* The home-screen name is the short one: the company name (the portal's manifest short_name). */}
                    <small>Northwind</small>
                  </span>
                  <span className="pw-app is-ours is-renter">
                    <i>
                      <b key={unread.renter} className="pw-badge">
                        {unread.renter}
                      </b>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src="/apple-touch-icon.png" alt="" />
                    </i>
                    <small>Your Rentals</small>
                  </span>
                </div>
                <div className="pw-dock">
                  <i>
                    <Phone />
                  </i>
                  <i>
                    <MessageCircle />
                  </i>
                  <i>
                    <Mail />
                  </i>
                  <i>
                    <Camera />
                  </i>
                </div>
              </div>
            </div>
            <figcaption>
              <b>On the home screen</b>
              <span>Next to every other app on the phone.</span>
            </figcaption>
          </figure>

          <figure className="pw-col is-renter">
            <AppPhone
              src="/v2/phone-renter"
              alt="The renter's portal on a phone: their rentals, insurance, agreements and payments."
              app={{ name: "Your Rentals", mark: "Y" }}
              notes={RENTER_NOTES}
              delay={2600}
              onArrive={() => setUnread((u) => ({ ...u, renter: u.renter >= 9 ? 1 : u.renter + 1 }))}
            />
            <figcaption>
              <b>Your renters&apos; app, in your brand</b>
              <span>Their bookings, insurance, agreements and payments, a tap away.</span>
            </figcaption>
          </figure>
        </div>

        {/* On a phone: which of the three is in view, and a tap to the others. */}
        <div className="pw-dots" role="group" aria-label="Phones">
          {["Your portal", "Home screen", "Your renters' app"].map((label, i) => (
            <button key={label} type="button" aria-label={label} aria-pressed={shown === i} className={shown === i ? "is-on" : undefined} onClick={() => goTo.current(i)} />
          ))}
        </div>

        {/* The four points (POINTS) were here; removed (Ghulam, 2026-11-10). */}
      </div>
    </section>
  );
}
