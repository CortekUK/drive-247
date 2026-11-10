"use client";

import { useEffect, useState } from "react";
import { ArrowLeft, ArrowRight, Lock, Plus, RotateCw, X } from "lucide-react";
import { useReveal } from "./operations-dashboard";
import "./portal-glass.css";
import "./verify-story.css";

/*
 * The four features under "Everything around each rental", each told on real screens in frames
 * (Ghulam, 2026-11-10), in three steps, each in the words of the person doing that step.
 *
 * Every screen is real and holds demo data only:
 *  - The renter's screens come from apps/booking: the renter portal, the phone capture page,
 *    the documents page and the checkout. They were captured with a made-up renter signed in
 *    only inside the capture browser, with every save and upload stopped before it reached
 *    Supabase. The camera was fed a drawn demo licence and face, the agreement viewer a demo
 *    agreement, and the insurance upload a demo insurance card.
 *  - The operator's screens come from apps/portal's demo pages (/playground/rental-create-fake
 *    and /playground/customer-detail-fake). The DMV row and the CheckMyDriver tab are cut from
 *    the Verification screen, as that check is not on general release.
 * The screens are in public/v2/verify and public/v2/flows.
 *
 * Scroll drives `step` while the section holds; anywhere else it plays through on its own.
 */

export type FlowTone = "verify" | "insurance" | "agreements" | "payments";

type Scene = {
  /** Read out in place of the picture. */
  label: string;
  who: "Your renter" | "You";
  say: string;
  /** One browser window: on its own, or with a phone on its other side. */
  browser?: { url: string; src: string; side: "left" | "right" | "solo" };
  phone?: string;
  /** Phones side by side, each with a caption. */
  phones?: { src: string; label: string }[];
};

const SITE = "northwind.drive-247.com";
const PORTAL = "northwind.portal.drive-247.com";

export const FLOWS: Record<FlowTone, Scene[]> = {
  verify: [
    {
      label: "Your renter opens Verification on your booking site, which shows a QR code, and scans it with their phone.",
      who: "Your renter",
      say: "I open Verification on your site and scan the code with my phone. No app to download.",
      browser: { url: `${SITE}/portal/settings`, src: "/v2/verify/qr.webp", side: "left" },
      phone: "/v2/verify/phone-front.webp",
    },
    {
      label: "On their phone, your renter photographs the front and back of their licence, then takes a selfie.",
      who: "Your renter",
      say: "I photograph my licence, front and back, then take a selfie. About a minute.",
      phones: [
        { src: "/v2/verify/phone-front.webp", label: "Licence, front" },
        { src: "/v2/verify/phone-back.webp", label: "Licence, back" },
        { src: "/v2/verify/phone-selfie.webp", label: "Selfie" },
      ],
    },
    {
      label: "Your renter submits and their phone says Verified. In your portal their record shows Verified, with a 94% face match.",
      who: "You",
      say: "They submit, and I see it on their record: verified, with a 94% face match. Keys are good to go.",
      browser: { url: `${PORTAL}/customers`, src: "/v2/verify/portal.webp", side: "right" },
      phone: "/v2/verify/phone-done.webp",
    },
  ],
  insurance: [
    {
      label: "In your portal's Integrations, Bonzah: policies come out of your Bonzah balance, with Start the application.",
      who: "You",
      say: "I turn Bonzah on from Integrations.",
      browser: { url: `${PORTAL}/integrations`, src: "/v2/flows/insurance-bonzah-start.webp", side: "left" },
      phone: "/v2/flows/phone-bonzah-start.webp",
    },
    {
      label: "The Bonzah application inside your portal, its first page filled in with your business details.",
      who: "You",
      say: "I fill in Bonzah's form without leaving my portal.",
      browser: { url: `${PORTAL}/integrations`, src: "/v2/flows/insurance-bonzah-form.webp", side: "left" },
      phone: "/v2/flows/phone-bonzah-form.webp",
    },
    {
      label: "On the rental in your portal, the Bonzah cover card: Collision Damage Waiver and Rental Car Liability picked, $92 for four days.",
      who: "You",
      say: "I pick the Bonzah cover on the rental. Each cover is priced for the car and the dates.",
      browser: { url: `${PORTAL}/rentals/RNT-2049`, src: "/v2/flows/insurance-bonzah-pick.webp", side: "left" },
      phone: "/v2/flows/phone-bonzah-pick.webp",
    },
    {
      label: "The policy is bought from Bonzah and its certificate of insurance opens on the rental, with the policy number and the cover period.",
      who: "You",
      say: "One click buys it from Bonzah. The certificates sit on the rental.",
      browser: { url: `${PORTAL}/rentals/RNT-2049`, src: "/v2/flows/insurance-bonzah-cert.webp", side: "left" },
      phone: "/v2/flows/phone-bonzah-bought.webp",
    },
    {
      label: "Your renter uploads their own insurance card from their phone, and Trax reads it on the rental.",
      who: "Your renter",
      say: "Already insured? I upload my card, and Trax reads it.",
      browser: { url: `${PORTAL}/rentals/RNT-2049`, src: "/v2/flows/insurance-trax-reading.webp", side: "left" },
      phone: "/v2/flows/phone-insurance-upload.webp",
    },
    {
      label: "Inshur fleet cover in your portal, marked Coming soon: every car in your fleet covered, on hire or on the lot, shown as a preview.",
      who: "You",
      say: "Inshur fleet cover is on the way, for the cars between rentals.",
      browser: { url: `${PORTAL}/integrations`, src: "/v2/flows/insurance-inshur.webp", side: "left" },
      phone: "/v2/flows/phone-inshur.webp",
    },
  ],
  agreements: [
    {
      label: "In your portal, the rental's agreement has been sent for signature, filled in from the booking.",
      who: "You",
      say: "I send the agreement from the rental. It fills itself in from the booking.",
      browser: { url: `${PORTAL}/rentals/RNT-2049`, src: "/v2/flows/agreement-sent.webp", side: "left" },
      phone: "/v2/flows/phone-agreement-open.webp",
    },
    {
      label: "On their phone, your renter opens the agreement in their portal, reads it and signs it.",
      who: "Your renter",
      say: "I read it on my phone and sign it there. No printing, no app.",
      phones: [
        { src: "/v2/flows/phone-agreement-open.webp", label: "I read it" },
        { src: "/v2/flows/phone-agreement-signed.webp", label: "I sign it" },
      ],
    },
    {
      label: "The agreement in your portal shows sent, opened and signed, with what it says, and the renter's copy shows Signed.",
      who: "You",
      say: "It comes back signed. The signed copy stays on the rental, and in their portal too.",
      browser: { url: `${PORTAL}/rentals/RNT-2049`, src: "/v2/flows/agreement-signed.webp", side: "right" },
      phone: "/v2/flows/phone-agreement-signed.webp",
    },
  ],
  payments: [
    {
      label: "Your booking site's checkout shows the car, the dates and the full price before your renter pays.",
      who: "Your renter",
      say: "I see the full price before I pay. Nothing new at the counter.",
      browser: { url: `${SITE}/booking`, src: "/v2/flows/checkout.webp", side: "left" },
      phone: "/v2/flows/phone-checkout.webp",
    },
    {
      label: "On their phone, your renter's payment has gone through, and their rental shows $380.00 paid of $380.00.",
      who: "Your renter",
      say: "I pay by card and it's done. The deposit is only held on my card, not taken.",
      phones: [
        { src: "/v2/flows/phone-paid.webp", label: "My payment goes through" },
        { src: "/v2/flows/phone-price-paid.webp", label: "Paid in full, on my rental" },
      ],
    },
    {
      label: "The rental's Payments in your portal: every charge, every payment, what is outstanding and the deposit held.",
      who: "You",
      say: "It's paid into my own Stripe account. I see every charge and the deposit held, right on the rental.",
      browser: { url: `${PORTAL}/rentals/RNT-2049`, src: "/v2/flows/payments.webp", side: "left" },
      phone: "/v2/flows/phone-finances.webp",
    },
  ],
};

const STEP_MS = 4200;

function Browser({ url, src, side }: { url: string; src: string; side: string }) {
  return (
    // The browser, open on a tablet: the page's own device (portal-glass.css).
    <div className={`pg-tablet vs-tablet is-${side}`}>
      <i className="pg-tablet-camera" />
      <div className="pg-browser vs-browser">
      <div className="pg-tabs">
        <span className="pg-lights">
          <i />
          <i />
          <i />
        </span>
        <span className="pg-tab">
          <span className="vs-favicon">N</span>
          <span className="pg-tab-label">Northwind</span>
          <X strokeWidth={2} />
        </span>
        <Plus strokeWidth={2} className="pg-newtab" />
      </div>
      <div className="pg-address">
        <ArrowLeft strokeWidth={2} />
        <ArrowRight strokeWidth={2} className="pg-off" />
        <RotateCw strokeWidth={2} />
        <span className="pg-url">
          <Lock strokeWidth={2} />
          <span className="pg-url-label">{url}</span>
        </span>
      </div>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img className="vs-shot" src={src} alt="" draggable={false} />
      </div>
    </div>
  );
}

function Phone({ src, label, className = "" }: { src: string; label?: string; className?: string }) {
  return (
    <figure className={`vs-phone ${className}`}>
      <span className="vs-phone-body">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img className="vs-shot" src={src} alt="" draggable={false} />
      </span>
      {label ? <figcaption>{label}</figcaption> : null}
    </figure>
  );
}

function SceneBody({ scene }: { scene: Scene }) {
  return (
    <>
      {scene.browser ? <Browser {...scene.browser} /> : null}
      {scene.phone ? <Phone className={scene.browser?.side === "right" ? "is-left" : "is-right"} src={scene.phone} /> : null}
      {scene.phones ? (
        <div className={`vs-row is-${scene.phones.length}`}>
          {scene.phones.map((phone) => (
            <Phone key={phone.src} src={phone.src} label={phone.label} />
          ))}
        </div>
      ) : null}
    </>
  );
}

export function FlowStory({ tone, active, step }: { tone: FlowTone; active: boolean; step?: number }) {
  const scenes = FLOWS[tone];
  const { ref, visible } = useReveal();
  const [auto, setAuto] = useState(0);

  // Off the held screen it plays through by itself, while it is in view.
  useEffect(() => {
    if (step !== undefined || !visible || !active || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let n = 0;
    setAuto(0);
    const timer = window.setInterval(() => {
      n = (n + 1) % scenes.length;
      setAuto(n);
    }, STEP_MS);
    return () => window.clearInterval(timer);
  }, [step, visible, active, scenes.length]);

  const now = Math.min(step ?? auto, scenes.length - 1);

  return (
    <div ref={ref} className="vs is-in" role="img" aria-label={scenes[now].label}>
      {scenes.map((scene, i) => (
        <div key={i} className={`vs-scene${i === now ? " is-on" : ""}`} aria-hidden>
          <SceneBody scene={scene} />
        </div>
      ))}
    </div>
  );
}
