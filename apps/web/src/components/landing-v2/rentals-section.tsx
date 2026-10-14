"use client";

import { Check } from "lucide-react";
import { useEffect, useState } from "react";

/*
 * "Every rental, handled": the third section of the rebuilt v2 page
 * (2026-10-08).
 *
 * The sales point: from booking to return, Drive247 runs the steps itself
 * (ID check, agreement to sign, deposit hold, lockbox keys, receipt) and the
 * renter hears about each one automatically, by text and email.
 *   ID check     create-ai-verification-session / Trax ID
 *   agreement    BoldSign e-sign, our own signing email (send-signing-email)
 *   deposit      pre-auth hold (create-preauth-checkout, verify-deposit-hold)
 *   keys         lockbox + notify-lockbox-code (code by SMS/email)
 *   messages     the notify-* functions (AWS SES email, Twilio SMS)
 *
 * Same frame as the sections above: one 100vw x 100vh screen, heading and
 * description on the left, the picture on the right; phones stack them.
 *
 * The one star: the renter's phone, on its lock screen. The operator's
 * messages arrive one at a time at the top, one per step of the rental, and
 * push the earlier ones down. Nothing else moves. The business name, car,
 * amounts and code are illustrative. Reduced motion shows the first four at
 * rest.
 */

type Note = { title: string; body: string; via: "Text" | "Email" };

const NOTES: Note[] = [
  { title: "Booking confirmed", body: "Tesla Model 3, Fri 10 to Mon 13. See you Friday.", via: "Email" },
  { title: "Quick ID check", body: "A photo of your licence and a selfie. Takes a minute.", via: "Text" },
  { title: "Your agreement is ready", body: "Tap to read and sign it on your phone.", via: "Email" },
  { title: "Deposit held", body: "$300 held on your card, released after you return the car.", via: "Email" },
  { title: "Your key code", body: "Lockbox 4821, by the rear left wheel. Enjoy the drive.", via: "Text" },
  { title: "Thanks for driving with us", body: "Your receipt is attached. Hope to see you again.", via: "Email" },
];

const EVERY_MS = 2400;
const SHOWN = 4; // notifications on screen; the oldest fades out below

function useArrivals() {
  const [n, setN] = useState(SHOWN - 1); // the newest notification's running number
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    setReduced(window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  }, []);

  useEffect(() => {
    if (reduced) return;
    const t = window.setInterval(() => setN((v) => v + 1), EVERY_MS);
    return () => window.clearInterval(t);
  }, [reduced]);

  return n;
}

const CARD_H = 98; // one notification plus the gap below it

function Phone() {
  const newest = useArrivals();
  // Running numbers on screen, newest first, plus the one leaving at the bottom.
  const items = Array.from({ length: SHOWN + 1 }, (_, k) => newest - k).filter((v) => v >= 0);

  return (
    <div className="relative h-[600px] max-h-[calc(100vh-96px)] w-[300px] shrink-0 rounded-[48px] bg-[#0b0b1a] p-3 shadow-[0_30px_80px_-20px_rgb(10_6_60/0.7)]">
      <div className="relative h-full w-full overflow-hidden rounded-[38px] bg-[radial-gradient(120%_80%_at_50%_0%,#5b49e6_0%,#2b1c92_45%,#0b0b1a_100%)]">
        {/* the notch */}
        <span className="absolute left-1/2 top-2.5 h-6 w-24 -translate-x-1/2 rounded-full bg-[#0b0b1a]" aria-hidden />

        {/* lock screen clock */}
        <div className="pt-12 text-center text-white">
          <div className="text-[13px] font-semibold text-white/75">Friday 10 October</div>
          <div className="text-[64px] font-semibold leading-none tracking-[-0.03em]">9:41</div>
        </div>

        {/* the notifications */}
        <div className="relative mx-3 mt-5" style={{ height: CARD_H * SHOWN }} aria-live="polite">
          {items.map((num, k) => {
            const note = NOTES[num % NOTES.length];
            const leaving = k === SHOWN;
            return (
              <div
                key={num}
                className={`absolute inset-x-0 top-0 transition-[transform,opacity] duration-300 ease-out ${k === 0 ? "lv2-drop" : ""}`}
                style={{ transform: `translateY(${k * CARD_H}px) scale(${1 - k * 0.02})`, opacity: leaving ? 0 : 1 - k * 0.12 }}
              >
                <div className="flex gap-2.5 rounded-[20px] bg-white/85 p-3 text-[#12141c] backdrop-blur-md">
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-[10px] bg-[#442DD7] text-[13px] font-black text-white">
                    YR
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between text-[11px] text-[#55556a]">
                      <span className="font-semibold">Your Rentals · {note.via}</span>
                      <span>{k === 0 ? "now" : `${k * 2}m ago`}</span>
                    </div>
                    <div className="truncate text-[13px] font-semibold leading-tight">{note.title}</div>
                    <div className="line-clamp-2 text-[12px] leading-snug text-[#3a3a4a]">{note.body}</div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

const STEPS = ["ID checked for you", "Agreements signed on the phone", "Deposits held, not charged", "Keys by lockbox, no meet-up"];

export function RentalsSection() {
  return (
    <section id="rentals" className="h-screen w-full overflow-hidden text-white">
      <div className="mx-auto grid h-full max-w-7xl grid-rows-[auto_1fr] items-stretch gap-8 px-4 py-8 sm:px-6 lg:grid-cols-2 lg:grid-rows-1 lg:gap-16 lg:py-12">
        {/* Left: the pitch */}
        <div className="flex flex-col text-center lg:justify-center lg:text-left">
          <h2 className="text-[48px] font-black leading-[0.95] tracking-[-0.05em] sm:text-[72px] lg:text-[76px] xl:text-[92px]">
            Every rental,
            <br />
            handled.
          </h2>
          <p className="mx-auto mt-6 max-w-xl text-[19px] font-medium leading-[1.45] text-white/85 sm:text-[22px] lg:mx-0 lg:mt-8">
            From booking to return, Drive247 runs every step for you. Your renter is told what to do at each one, by text and
            email, so you&rsquo;re not chasing anyone.
          </p>
          <ul className="mx-auto mt-8 hidden space-y-3 text-[17px] font-semibold lg:mx-0 lg:block">
            {STEPS.map((p) => (
              <li key={p} className="flex items-center gap-3">
                <span className="flex size-6 items-center justify-center rounded-full bg-white text-[#442DD7]">
                  <Check className="size-3.5" strokeWidth={3} aria-hidden />
                </span>
                {p}
              </li>
            ))}
          </ul>
        </div>

        {/* Right: the renter's phone */}
        <div className="flex min-h-0 items-start justify-center lg:items-center lg:justify-end lg:pr-16">
          <Phone />
        </div>
      </div>
    </section>
  );
}
