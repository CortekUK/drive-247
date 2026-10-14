"use client";

import {
  ArrowRight,
  ArrowUp,
  Check,
  History,
  LifeBuoy,
  Loader2,
  Maximize2,
  Plus,
  ShieldCheck,
  Sparkles,
  SquarePen,
  X,
} from "lucide-react";
import Image from "next/image";
import { useEffect, useRef, useState, type ReactNode } from "react";

/*
 * The Trax panel from the portal (components/trax/trax-panel.tsx), redrawn
 * for the landing page, running a conversation that never stops.
 *
 * Each exchange plays in five beats:
 *   write  the question types itself into the composer, the send button
 *          lights up and swells
 *   send   the composer clears and the question rises into the thread from
 *          the send button, the asker's photo beside it
 *   look   Trax goes to the records ("Looking in Payments…"), a short spinner
 *   type   Trax's one-line answer slides in from the left and types out
 *   show   the data it pulled pops in under the answer as a small card (who
 *          owes what, rows landing one after another; today's schedule, the price, the ID check, the policy
 *          check, the month), ending with a link to where it lives in the app
 * then a pause to read, and the next question.
 *
 * Every answer is a real Trax ability: trax-support (money owed, today),
 * trax_price_suggest + trax-price-why (pricing), Trax ID (ai-document-ocr +
 * ai-face-match), the insurance check (scan-insurance-document +
 * verify-insurance-document) and trax-insights-summary (the month). Names,
 * cars and figures are illustrative; photos are the licensed stock portraits
 * in public/landing-v2/people (CREDITS.md). Reduced motion shows the opening
 * exchanges whole and holds still.
 */

const ACCENT = "#442DD7";
const P = (n: number) => `/landing-v2/people/person-${n}.jpg`;

/* ── The data cards ────────────────────────────────────────────────────── */

function Card({ children, link }: { children: ReactNode; link: string }) {
  return (
    <div className="mt-2 overflow-hidden rounded-2xl border border-[#ececf1] bg-white text-[12.5px]">
      {children}
      <div className="flex items-center gap-1 border-t border-[#f0f0f4] px-3.5 py-2 text-[12px] font-semibold text-[#442DD7]">
        {link}
        <ArrowRight className="size-3.5" aria-hidden />
      </div>
    </div>
  );
}

function Pill({ tone, children }: { tone: "late" | "wait" | "ok" | "plain"; children: ReactNode }) {
  const tones = {
    late: "bg-[#fdeceb] text-[#d93025]",
    wait: "bg-[#fdf3e7] text-[#b45309]",
    ok: "bg-[#e4f6f3] text-[#12a594]",
    plain: "bg-[#f1f1f5] text-[#55556a]",
  };
  return <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${tones[tone]}`}>{children}</span>;
}

export function OwedCard() {
  const rows = [
    { img: P(1), name: "Jordan Ellis", why: "Extension", amount: "$240", age: "6 days", tone: "late" as const },
    { img: P(2), name: "Priya Shah", why: "Fuel", amount: "$85", age: "3 days", tone: "wait" as const },
    { img: P(4), name: "Sam Ortiz", why: "Toll", amount: "$60", age: "1 day", tone: "plain" as const },
  ];
  return (
    <Card link="Open Payments">
      <ul className="lv2-stagger divide-y divide-[#f0f0f4]">
        {rows.map((r) => (
          <li key={r.name} className="flex items-center gap-2.5 px-3.5 py-2">
            <Image src={r.img} alt="" width={26} height={26} className="size-[26px] rounded-full object-cover" />
            <span className="min-w-0 flex-1">
              <span className="block font-semibold leading-tight">{r.name}</span>
              <span className="text-[11px] text-[#7a7a88]">{r.why}</span>
            </span>
            <Pill tone={r.tone}>{r.age}</Pill>
            <span className="w-11 text-right font-semibold tabular-nums">{r.amount}</span>
          </li>
        ))}
      </ul>
      <div className="px-3.5 pb-2.5">
        <span className="inline-flex h-8 w-full items-center justify-center rounded-full bg-[#442DD7] text-[12px] font-semibold text-white">
          Send 3 reminders
        </span>
      </div>
    </Card>
  );
}

export function TodayCard() {
  const rows = [
    { time: "09:30", what: "Pickup", car: "Camry", who: "Priya", tone: "ok" as const, status: "Ready" },
    { time: "11:00", what: "Return", car: "Model 3", who: "Sam", tone: "wait" as const, status: "Due" },
    { time: "15:45", what: "Delivery", car: "Model Y", who: "Leo", tone: "plain" as const, status: "Booked" },
  ];
  return (
    <Card link="Open Calendar">
      <ul className="lv2-stagger divide-y divide-[#f0f0f4]">
        {rows.map((r) => (
          <li key={r.time} className="flex items-center gap-3 px-3.5 py-2">
            <span className="w-10 font-semibold tabular-nums text-[#442DD7]">{r.time}</span>
            <span className="min-w-0 flex-1">
              <span className="block font-semibold leading-tight">{r.what}</span>
              <span className="text-[11px] text-[#7a7a88]">
                {r.car} · {r.who}
              </span>
            </span>
            <Pill tone={r.tone}>{r.status}</Pill>
          </li>
        ))}
      </ul>
    </Card>
  );
}

export function PriceCard() {
  return (
    <Card link="Open Model 3">
      <div className="px-3.5 pt-3">
        <div className="flex items-center justify-between text-[11px] text-[#7a7a88]">
          <span>2022 Tesla Model 3 · daily rate</span>
          <Pill tone="ok">High confidence</Pill>
        </div>
        <div className="mt-2 flex items-baseline gap-2.5">
          <span className="text-[15px] tabular-nums text-[#9a9aa8] line-through">$89</span>
          <span className="text-[26px] font-bold leading-none tracking-[-0.02em] tabular-nums">$99</span>
          <span className="text-[12px] font-semibold text-[#12a594]">+11%</span>
        </div>
        <div className="lv2-stagger mt-3 grid grid-cols-3 gap-1.5">
          {[
            ["Similar cars", "8"],
            ["Their median", "$99"],
            ["Booked", "71%"],
          ].map(([k, v]) => (
            <div key={k} className="rounded-lg bg-[#f5f4fe] px-2 py-1.5">
              <div className="text-[10.5px] text-[#7a7a88]">{k}</div>
              <div className="font-semibold tabular-nums">{v}</div>
            </div>
          ))}
        </div>
      </div>
      <div className="px-3.5 pb-2.5 pt-2.5">
        <span className="inline-flex h-8 w-full items-center justify-center rounded-full bg-[#442DD7] text-[12px] font-semibold text-white">
          Apply $99 a day
        </span>
      </div>
    </Card>
  );
}

function Checks({ items }: { items: string[] }) {
  return (
    <ul className="lv2-stagger space-y-1.5">
      {items.map((s) => (
        <li key={s} className="flex items-center gap-2">
          <span className="flex size-4 items-center justify-center rounded-full bg-[#e4f6f3] text-[#12a594]">
            <Check className="size-2.5" strokeWidth={3} aria-hidden />
          </span>
          {s}
        </li>
      ))}
    </ul>
  );
}

function IdCheckCard() {
  return (
    <Card link="Open Maya's profile">
      <div className="flex items-center gap-3 px-3.5 pt-3">
        {/* the licence */}
        <div className="flex h-[58px] flex-1 items-center gap-2 rounded-lg border border-[#ececf1] bg-[#f5f4fe] px-2">
          <Image src={P(3)} alt="" width={30} height={38} className="h-[38px] w-[30px] rounded object-cover" />
          <div className="flex-1 space-y-1">
            <div className="h-1.5 w-4/5 rounded-full bg-[#d5d8ea]" />
            <div className="h-1.5 w-3/5 rounded-full bg-[#d5d8ea]" />
            <div className="h-1.5 w-2/3 rounded-full bg-[#d5d8ea]" />
          </div>
        </div>
        {/* the selfie, matched */}
        <div className="relative">
          <Image src={P(3)} alt="" width={50} height={50} className="size-[50px] rounded-full object-cover ring-2 ring-white" />
          <span className="absolute -bottom-0.5 -right-0.5 flex size-5 items-center justify-center rounded-full bg-[#12a594] text-white ring-2 ring-white">
            <Check className="size-3" strokeWidth={3} aria-hidden />
          </span>
        </div>
      </div>
      <div className="px-3.5 py-3">
        <Checks items={["Licence read: name, number, date of birth", "In date until March 2029", "Face matches the selfie"]} />
      </div>
    </Card>
  );
}

function InsuranceCard() {
  return (
    <Card link="Open Leo's rental">
      <div className="flex items-center gap-2.5 px-3.5 pt-3">
        <span className="flex size-8 items-center justify-center rounded-lg bg-[#f5f4fe] text-[#442DD7]">
          <ShieldCheck className="size-[18px]" aria-hidden />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block font-semibold leading-tight">Insurance certificate</span>
          <span className="text-[11px] text-[#7a7a88]">Leo Grant · uploaded today</span>
        </span>
        <Pill tone="ok">Verified</Pill>
      </div>
      <div className="px-3.5 py-3">
        <Checks items={["Covers rental vehicles", "Valid until 14 March", "Name matches the licence"]} />
      </div>
    </Card>
  );
}

function MonthCard() {
  const bars = [52, 61, 58, 70, 66, 78];
  return (
    <Card link="Open Insights">
      <div className="flex items-end justify-between gap-3 px-3.5 pt-3">
        <div>
          <div className="text-[10.5px] font-semibold uppercase tracking-[0.12em] text-[#7a7a88]">Collected</div>
          <div className="mt-0.5 flex items-baseline gap-1.5">
            <span className="text-[24px] font-bold leading-none tracking-[-0.02em] tabular-nums">$18,420</span>
            <span className="text-[12px] font-semibold text-[#12a594]">+12%</span>
          </div>
        </div>
        <div className="flex h-10 items-end gap-1" aria-hidden>
          {bars.map((h, i) => (
            <span
              key={i}
              className="w-2.5 rounded-sm"
              style={{ height: `${h}%`, backgroundColor: i === bars.length - 1 ? ACCENT : "#dcd8fb" }}
            />
          ))}
        </div>
      </div>
      <ul className="lv2-stagger space-y-1.5 px-3.5 py-3">
        <li className="flex items-center gap-2">
          <span className="size-1.5 rounded-full bg-[#12a594]" />
          Model 3 earned the most
        </li>
        <li className="flex items-center gap-2">
          <span className="size-1.5 rounded-full bg-[#b45309]" />
          Mustang sat idle for 9 days
        </li>
      </ul>
    </Card>
  );
}

/* ── The conversation ──────────────────────────────────────────────────── */

const PAIRS: { q: string; source: string; a: string; Card: () => ReactNode }[] = [
  { q: "Who owes me money?", source: "Payments", a: "Three renters have a balance. Jordan's is the oldest.", Card: OwedCard },
  { q: "What's happening today?", source: "Calendar", a: "Three cars move today. Nothing is late.", Card: TodayCard },
  { q: "What should I charge for the Model 3?", source: "similar cars", a: "$99 a day. You have room to charge more.", Card: PriceCard },
  { q: "Is Maya cleared to drive?", source: "Maya's documents", a: "Yes. I checked her licence and her selfie.", Card: IdCheckCard },
  { q: "Did Leo's insurance check out?", source: "Leo's upload", a: "Yes. I read his policy and it covers the rental.", Card: InsuranceCard },
  { q: "How did September go?", source: "your numbers", a: "A good month. Here's the short version.", Card: MonthCard },
];
const AVATARS = [2, 5, 1, 3, 4].map(P);
const START_MINUTES = 9 * 60 + 12; // 09:12 AM

/** The nth exchange of the endless conversation. */
function exchange(n: number) {
  const m = START_MINUTES + n * 2;
  const h = Math.floor(m / 60) % 24;
  const time = `${String(((h + 11) % 12) + 1).padStart(2, "0")}:${String(m % 60).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
  return { n, ...PAIRS[n % PAIRS.length], avatar: AVATARS[n % AVATARS.length], time };
}

type Stage = "wait" | "compose" | "look" | "type" | "show";

const FIRST_MS = 600;
const COMPOSE_MS = 38; // per character typed into the composer
const SEND_MS = 450; // the full question sits in the composer this long before sending
const LOOK_MS = 1100;
const TYPE_MS = 24;
const READ_MS = 3200;
const KEEP = 3; // exchanges kept in the list; older ones have scrolled away

/** Runs forever: compose the question → send → look → type → show → read → next. */
function useConversation() {
  const [n, setN] = useState(0);
  const [stage, setStage] = useState<Stage>("wait");
  const [typed, setTyped] = useState(0);
  const [drafted, setDrafted] = useState(0); // characters of the question in the composer
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) setReduced(true);
  }, []);

  useEffect(() => {
    if (reduced) return;
    const { q, a: answer } = exchange(n);
    let t: number;
    if (stage === "wait") t = window.setTimeout(() => setStage("compose"), n === 0 ? FIRST_MS : 0);
    else if (stage === "compose") {
      if (drafted >= q.length) t = window.setTimeout(() => setStage("look"), SEND_MS);
      else t = window.setTimeout(() => setDrafted((v) => v + 1), COMPOSE_MS);
    }
    else if (stage === "look") t = window.setTimeout(() => setStage("type"), LOOK_MS);
    else if (stage === "type") {
      if (typed >= answer.length) t = window.setTimeout(() => setStage("show"), 150);
      else t = window.setTimeout(() => setTyped((v) => Math.min(answer.length, v + 2)), TYPE_MS);
    } else
      t = window.setTimeout(() => {
        setN((v) => v + 1);
        setTyped(0);
        setDrafted(0);
        setStage("compose");
      }, READ_MS);
    return () => window.clearTimeout(t);
  }, [reduced, n, stage, typed, drafted]);

  if (reduced) return { n: 1, stage: "show" as Stage, typed: Infinity, drafted: 0 };
  return { n, stage, typed, drafted };
}

/* ── The panel ─────────────────────────────────────────────────────────── */

export function TraxPanel() {
  const { n, stage, typed, drafted } = useConversation();
  const draft = stage === "compose" ? exchange(n).q.slice(0, drafted) : "";
  const ready = stage === "compose" && drafted >= exchange(n).q.length;
  const listRef = useRef<HTMLDivElement>(null);

  // Keep the newest message in view as the conversation grows.
  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [n, stage, typed]);

  const shownExchanges = Array.from({ length: Math.min(KEEP, n + 1) }, (_, k) => exchange(Math.max(0, n + 1 - KEEP) + k));

  return (
    <div className="flex h-full max-h-[640px] w-full max-w-[460px] flex-col overflow-hidden rounded-[28px] bg-[linear-gradient(180deg,#d9d4f7_0%,#ebe8fb_35%,#ffffff_70%)] text-[#0a0a0f] shadow-[0_30px_80px_-20px_rgb(10_6_60/0.55)] lg:h-[640px]">
      {/* Header */}
      <header className="flex h-16 shrink-0 items-center gap-2.5 pl-4 pr-3">
        <TraxSpark size="lg" />
        <div className="min-w-0">
          <p className="text-[15px] font-semibold leading-tight tracking-tight">Trax</p>
          <p className="text-[12px] leading-tight text-[#6b6b78]">Assistant · reads your records</p>
        </div>
        <div className="ml-auto flex items-center gap-0.5 text-[#55556a]" aria-hidden>
          {[History, SquarePen, LifeBuoy, Maximize2, X].map((Icon, i) => (
            <span key={i} className="flex size-8 items-center justify-center">
              <Icon className="size-[17px]" strokeWidth={1.8} />
            </span>
          ))}
        </div>
      </header>

      {/* Messages */}
      <div ref={listRef} className="min-h-0 flex-1 space-y-5 overflow-hidden px-4 pb-4 pt-3" aria-live="polite">
        {shownExchanges.map((p) => {
          const current = p.n === n;
          const st: Stage = current ? stage : "show";
          if (st === "wait" || st === "compose") return null;
          const shown = st === "type" ? p.a.slice(0, typed) : p.a;
          const Data = p.Card;
          return (
            <div key={p.n} className="space-y-4">
              {/* The person asking */}
              <div className="lv2-send flex flex-col items-end">
                <div className="flex items-start gap-2.5">
                  <p className="max-w-[260px] rounded-[18px] bg-[#442DD7] px-4 py-2.5 text-[14.5px] leading-snug text-white">{p.q}</p>
                  <Image src={p.avatar} alt="" width={36} height={36} className="size-9 shrink-0 rounded-full object-cover ring-2 ring-white" />
                </div>
                <span className="mr-[46px] mt-1.5 text-[11px] text-[#7a7a88]">{p.time}</span>
              </div>

              {/* Trax */}
              <div className="lv2-reply flex items-start gap-2.5">
                <TraxSpark />
                <div className="min-w-0 flex-1">
                  {st === "look" ? (
                    <p className="flex h-9 items-center gap-2 text-[13px] font-medium">
                      <Loader2 className="size-3.5 animate-spin text-[#442DD7]" aria-hidden />
                      <span className="lv2-shimmer">Looking in {p.source}…</span>
                    </p>
                  ) : (
                    <>
                      <p className="lv2-reply w-fit rounded-[16px] border border-[#ececf1] bg-[#f6f6f8] px-4 py-2.5 text-[14.5px] leading-relaxed">
                        {shown}
                        {st === "type" && (
                          <span className="ml-0.5 inline-block h-[1em] w-[2px] translate-y-[2px] animate-pulse bg-[#442DD7]" />
                        )}
                      </p>
                      {st === "show" && (
                        <div className="lv2-pop">
                          <Data />
                          <p className="mt-1.5 text-[11px] text-[#7a7a88]">
                            <span className="mr-1 text-[9px]">▶</span>AI answer · Live records checked · {p.time}
                          </p>
                        </div>
                      )}
                    </>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Composer */}
      <div className="shrink-0 px-4 pb-4">
        <div className="rounded-[22px] border-[1.5px] border-[#442DD7] bg-white px-4 pb-2.5 pt-3 shadow-[0_0_28px_rgb(68_45_215/0.22)]">
          <p className="truncate text-[15px]">
            {draft ? (
              <>
                {draft}
                <span className="ml-px inline-block h-[1.05em] w-[1.5px] translate-y-[3px] animate-pulse bg-[#442DD7]" />
              </>
            ) : (
              <span className="text-[#9a9aa8]">Ask Trax anything…</span>
            )}
          </p>
          <div className="mt-3 flex items-center justify-between text-[#9a9aa8]">
            <Plus className="size-5" aria-hidden />
            <span
              className={`flex size-9 items-center justify-center rounded-full transition-[background-color,color,transform] duration-200 ease-out ${
                draft ? "bg-[#442DD7] text-white" : "bg-[#f1f1f4] text-[#55556a]"
              } ${ready ? "scale-110" : ""}`}
            >
              <ArrowUp className="size-4" aria-hidden />
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Trax's mark: the sparkle on the indigo disc, as in the panel header. */
export function TraxSpark({ size = "md" }: { size?: "md" | "lg" }) {
  return (
    <span
      className={`flex shrink-0 items-center justify-center rounded-full bg-[radial-gradient(circle_at_30%_25%,#7c6cf0,#442DD7_60%,#2b1c92)] text-white ${
        size === "lg" ? "size-10" : "size-9"
      }`}
      aria-hidden
    >
      <Sparkles className={size === "lg" ? "size-[18px]" : "size-4"} />
    </span>
  );
}
