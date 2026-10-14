"use client";

import {
  BookOpen,
  Calculator,
  Car,
  CreditCard,
  Globe,
  IdCard,
  MessageSquare,
  PenLine,
  ShieldCheck,
  SquareStack,
  Umbrella,
  Zap,
} from "lucide-react";
import { useEffect, useState } from "react";

/*
 * "Works with what you use": the fourth section of the rebuilt v2 page
 * (2026-10-08).
 *
 * Every integration named here is one the portal's Integrations page has a
 * panel for (apps/portal/.../integrations/_panels, claims per _intros.ts).
 * Turo Sync is still canary-only and Inshur and CheckMyDriver are previews
 * in the portal, so all three carry "Soon" and are never the lit one.
 * Names only, no third-party logos.
 *
 * Same frame as the sections above: heading and description on the left,
 * the picture on the right; phones stack them.
 *
 * The one star: Drive247 in the middle, the integrations in a ring around
 * it. One connection at a time lights up: its line carries a moving dash,
 * its tile turns white, and the middle says what it does. Nothing else
 * moves. Reduced motion holds the first one lit.
 */

type Tool = { name: string; does: string; icon: typeof CreditCard; soon?: boolean };

const TOOLS: Tool[] = [
  { name: "Stripe", does: "Payments and deposit holds", icon: CreditCard },
  { name: "Bonzah", does: "Insurance sold at checkout", icon: ShieldCheck },
  { name: "BoldSign", does: "Agreements signed online", icon: PenLine },
  { name: "Xero", does: "Every booking in your books", icon: Calculator },
  { name: "Twilio", does: "Text and call your customers", icon: MessageSquare },
  { name: "Turo", does: "Turo trips in one calendar", icon: Car, soon: true },
  { name: "Your domain", does: "Your site on your own address", icon: Globe },
  { name: "Square", does: "Take payments through Square", icon: SquareStack },
  { name: "Zoho Books", does: "Every booking in your books", icon: BookOpen },
  { name: "Inshur", does: "Cover between rentals", icon: Umbrella, soon: true },
  { name: "Tesla", does: "Supercharging billed for you", icon: Zap },
  { name: "CheckMyDriver", does: "Licence checks", icon: IdCard, soon: true },
];

const LIVE = TOOLS.map((t, i) => (t.soon ? -1 : i)).filter((i) => i >= 0);
const EVERY_MS = 2000;
const RADIUS = 40; // percent of the ring box, from the centre to each tile

function useLit() {
  const [k, setK] = useState(0);
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    setReduced(window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  }, []);
  useEffect(() => {
    if (reduced) return;
    const t = window.setInterval(() => setK((v) => (v + 1) % LIVE.length), EVERY_MS);
    return () => window.clearInterval(t);
  }, [reduced]);
  return LIVE[k];
}

/** Where tile i sits on the ring, in percent of the box. Starts at the top, goes clockwise. */
function spot(i: number) {
  const a = ((i / TOOLS.length) * 360 - 90) * (Math.PI / 180);
  // Rounded so the server and the browser print the same numbers (no hydration mismatch).
  const r = (v: number) => Math.round(v * 100) / 100;
  return { x: r(50 + RADIUS * Math.cos(a)), y: r(50 + RADIUS * Math.sin(a)) };
}

function Ring() {
  const lit = useLit();
  const tool = TOOLS[lit];
  return (
    <div className="relative aspect-square w-full max-w-[560px]">
      {/* the lines */}
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0 h-full w-full" aria-hidden>
        {TOOLS.map((t, i) => {
          const { x, y } = spot(i);
          const on = i === lit;
          return (
            <line
              key={t.name}
              x1="50"
              y1="50"
              x2={x}
              y2={y}
              stroke="#ffffff"
              strokeOpacity={on ? 1 : 0.16}
              strokeWidth={on ? 2 : 1}
              strokeDasharray={on ? "6 6" : t.soon ? "2 5" : undefined}
              strokeLinecap="round"
              vectorEffect="non-scaling-stroke"
              className={on ? "lv2-flow" : undefined}
            />
          );
        })}
      </svg>

      {/* the tiles */}
      {TOOLS.map((t, i) => {
        const { x, y } = spot(i);
        const on = i === lit;
        const Icon = t.icon;
        return (
          <div
            key={t.name}
            className={`absolute flex -translate-x-1/2 -translate-y-1/2 items-center gap-2 whitespace-nowrap rounded-2xl px-3 py-2 text-[13px] font-semibold transition-colors duration-200 ${
              on
                ? "bg-white text-[#442DD7] shadow-[0_12px_30px_-10px_rgb(10_6_60/0.6)]"
                : t.soon
                  ? "border border-dashed border-white/30 text-white/55"
                  : "bg-white/12 text-white"
            }`}
            style={{ left: `${x}%`, top: `${y}%` }}
          >
            <Icon className="size-4 shrink-0" aria-hidden />
            {t.name}
            {t.soon && <span className="rounded-full bg-white/15 px-1.5 py-px text-[10px] font-semibold text-white/80">Soon</span>}
          </div>
        );
      })}

      {/* the middle: Drive247, and what the lit one does */}
      <div className="absolute left-1/2 top-1/2 flex w-[220px] -translate-x-1/2 -translate-y-1/2 flex-col items-center text-center">
        <div className="flex size-[104px] items-center justify-center rounded-[30px] bg-white text-[22px] font-black tracking-[-0.04em] text-[#442DD7] shadow-[0_20px_50px_-16px_rgb(10_6_60/0.7)]">
          247
        </div>
        <div className="mt-3 rounded-xl bg-[#442DD7] px-3 py-1.5" aria-live="polite">
          <p className="text-[15px] font-bold text-white">{tool.name}</p>
          <p className="mt-0.5 text-[13px] font-medium text-white/75">{tool.does}</p>
        </div>
      </div>
    </div>
  );
}

export function IntegrationsSection() {
  return (
    <section id="integrations" className="h-screen w-full overflow-hidden text-white">
      <div className="mx-auto grid h-full max-w-7xl grid-rows-[auto_1fr] items-stretch gap-8 px-4 py-8 sm:px-6 lg:grid-cols-2 lg:grid-rows-1 lg:gap-16 lg:py-12">
        {/* Left: the pitch */}
        <div className="flex flex-col text-center lg:justify-center lg:text-left">
          <h2 className="text-[48px] font-black leading-[0.95] tracking-[-0.05em] sm:text-[72px] lg:text-[76px] xl:text-[92px]">
            Works with
            <br />
            what you use.
          </h2>
          <p className="mx-auto mt-6 max-w-xl text-[19px] font-medium leading-[1.45] text-white/85 sm:text-[22px] lg:mx-0 lg:mt-8">
            Payments, insurance, e-signatures, accounting, texting. Drive247 connects to the tools you already use, and you switch
            each one on from a single page.
          </p>
        </div>

        {/* Right: the ring */}
        <div className="flex min-h-0 items-center justify-center lg:justify-end">
          <Ring />
        </div>
      </div>
    </section>
  );
}
