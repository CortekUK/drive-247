"use client";

import {
  BatteryFull,
  Bell,
  Calendar,
  Camera,
  Cloud,
  Download,
  Mail,
  Map as MapIcon,
  MessageCircle,
  Music,
  Phone,
  Settings,
  Signal,
  Smartphone,
  StickyNote,
  Wifi,
} from "lucide-react";
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

const POINTS = [
  { icon: Download, title: "Installs in a tap", text: "From the browser: Add to Home Screen on iPhone, Install app on Android. No app store, nothing to download." },
  { icon: Smartphone, title: "Your name and your icon", text: "Your renters' app carries your business name, icon and colour. Ours stays out of the way." },
  { icon: Bell, title: "Notifications that matter", text: "A new booking or a message reaches your phone the moment it happens, and renters hear about their trip." },
  { icon: Phone, title: "Built for the phone first", text: "Full screen with no browser bars, and a tab bar under your thumb on every screen." },
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

function AppPhone({
  src,
  alt,
  app,
  note,
  delay,
}: {
  src: string;
  alt: string;
  app: { name: string; mark: string };
  note: string;
  delay: number;
}) {
  return (
    <div className="pw-phone">
      <div className="pw-screen">
        <StatusBar />
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={`${src}.png`} alt={alt} className="pw-shot dark:hidden" loading="lazy" />
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={`${src}-dark.png`} alt={alt} className="pw-shot hidden dark:block" loading="lazy" />
        <div className="pw-note" style={{ animationDelay: `${delay}ms` }} aria-hidden>
          <i className="pw-note-icon">{app.mark}</i>
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
  return (
    <section id="mobile" aria-labelledby="mobile-heading" className="pw-section">
      <div ref={ref} className={`pw-inner${visible ? " is-in" : ""}`}>
        <div className="pw-head">
          <SectionHeading
            id="mobile-heading"
            title={
              <>
                Your business, <Accent>installed on every phone</Accent>
              </>
            }
            sub={
              <>
                Your portal and your renters&apos; portal install like apps, straight from the browser. Full screen, in your brand, with notifications.
              </>
            }
          />
        </div>

        <div className="pw-stage">
          <figure className="pw-col is-ops">
            <AppPhone
              src="/v2/phone-dashboard"
              alt="The Drive247 portal on a phone: today's takings, and Trax listing what needs attention."
              app={{ name: "Northwind Ops", mark: "N" }}
              note="New booking: Jordan Lee, Hyundai Sonata, Nov 7 – 10."
              delay={500}
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
                    <i>N</i>
                    {/* The home-screen name is the short one: the company name (the portal's manifest short_name). */}
                    <small>Northwind</small>
                  </span>
                  <span className="pw-app is-ours is-renter">
                    <i>
                      <b className="pw-badge">1</b>Y
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
              note="Your agreement is signed. Your car is ready on Friday at 10:00 AM."
              delay={900}
            />
            <figcaption>
              <b>Your renters&apos; app, in your brand</b>
              <span>Their bookings, insurance, agreements and payments, a tap away.</span>
            </figcaption>
          </figure>
        </div>

        <ul className="pw-points">
          {POINTS.map((p) => (
            <li key={p.title}>
              <p.icon aria-hidden />
              <b>{p.title}</b>
              <p>{p.text}</p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
