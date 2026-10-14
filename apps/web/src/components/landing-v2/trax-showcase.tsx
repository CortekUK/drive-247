"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import Image from "next/image";
import { IndigoStage } from "./indigo-stage";
import { Check, FileText, IdCard, LineChart, MessageSquareText, Reply, Tag } from "lucide-react";

/*
 * "Meet Trax": one full-screen, interactive section.
 *
 * Six things Trax does in the product, each with a small live demo. Every
 * capability is real, and the source is named beside it so copy can be checked:
 *   ask        trax-support (reads finance, fleet, payments, availability)
 *   price      trax_price_suggest RPC + trax-price-why (comparables + utilisation)
 *   replies    trax-reply-suggest (friendly / detailed / next step, as the operator)
 *   id         Trax ID: ai-document-ocr + ai-face-match (trax-id-rescan-v2)
 *   agreements trax-agreement-editor (edits the template block by block)
 *   insights   trax-insights-summary (findings and actions from the operator's own numbers)
 * Names, cars and figures in the demos are illustrative.
 *
 * Behaviour: cycles on its own while on screen, stops for good the moment the
 * visitor picks a tab. Trax's words type out like a stream; reduced motion
 * shows them whole and turns the cycling off.
 */

type Key = "ask" | "price" | "replies" | "id" | "agreements" | "insights";

const CAPS: { key: Key; title: string; line: string; icon: typeof Tag }[] = [
  { key: "ask", title: "Ask about your business", line: "Money, cars, bookings, in plain words.", icon: MessageSquareText },
  { key: "price", title: "Prices with a reason", line: "Compared with similar cars on Drive247.", icon: Tag },
  { key: "replies", title: "Replies, ready to send", line: "Three drafts for every renter message.", icon: Reply },
  { key: "id", title: "Trax ID", line: "Licence read and face matched.", icon: IdCard },
  { key: "agreements", title: "Writes your agreements", line: "Ask for a clause. It appears.", icon: FileText },
  { key: "insights", title: "A review of your month", line: "What changed, and what to do next.", icon: LineChart },
];

const CYCLE_MS = 9000;

function usePrefersReducedMotion() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(mq.matches);
    const on = () => setReduced(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return reduced;
}

/** Reveals `text` a few characters at a time, restarting whenever `text` changes. */
function useTyped(text: string, reduced: boolean, speed = 16) {
  const [n, setN] = useState(reduced ? text.length : 0);
  useEffect(() => {
    if (reduced) {
      setN(text.length);
      return;
    }
    setN(0);
    const id = window.setInterval(() => {
      setN((v) => {
        if (v >= text.length) {
          window.clearInterval(id);
          return v;
        }
        return Math.min(text.length, v + 2);
      });
    }, speed);
    return () => window.clearInterval(id);
  }, [text, reduced, speed]);
  return { shown: text.slice(0, n), done: n >= text.length };
}

export function TraxMark({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden className="shrink-0">
      <rect x="3" y="5" width="18" height="15" rx="5" fill="var(--lv-accent)" opacity="0.15" />
      <rect x="3" y="5" width="18" height="15" rx="5" stroke="var(--lv-accent)" strokeWidth="1.5" opacity="0.6" />
      <circle cx="9" cy="12" r="1.8" fill="var(--lv-accent)" />
      <circle cx="9.6" cy="11.3" r="0.6" fill="white" opacity="0.8" />
      <circle cx="15" cy="12" r="1.8" fill="var(--lv-accent)" />
      <circle cx="15.6" cy="11.3" r="0.6" fill="white" opacity="0.8" />
      <line x1="12" y1="5" x2="12" y2="2" stroke="var(--lv-accent)" strokeWidth="1.5" strokeLinecap="round" opacity="0.5" />
      <circle cx="12" cy="1.5" r="1.5" fill="var(--lv-accent)" opacity="0.7" />
      <path d="M9.5 15.5 C10.5 16.8 13.5 16.8 14.5 15.5" stroke="var(--lv-accent)" strokeWidth="1.3" strokeLinecap="round" opacity="0.5" />
    </svg>
  );
}

function Caret({ on }: { on: boolean }) {
  return on ? <span className="ml-0.5 inline-block h-[1em] w-[2px] translate-y-[2px] animate-pulse bg-[var(--lv-accent)]" aria-hidden /> : null;
}

function Asks({ children }: { children: ReactNode }) {
  return <p className="ml-auto w-fit max-w-[85%] rounded-2xl rounded-br-md bg-[var(--lv-tint)] px-4 py-2.5 text-[14px]">{children}</p>;
}

function Says({ text, reduced, className = "" }: { text: string; reduced: boolean; className?: string }) {
  const { shown, done } = useTyped(text, reduced);
  return (
    <div className={`flex gap-2.5 ${className}`}>
      <TraxMark size={20} />
      <p className="min-w-0 flex-1 text-[14px] leading-relaxed">
        {shown}
        <Caret on={!done} />
      </p>
    </div>
  );
}

/** Shows children only once `text` has finished typing, so the demo builds in order. */
function After({ text, reduced, children }: { text: string; reduced: boolean; children: ReactNode }) {
  const { done } = useTyped(text, reduced);
  return done ? <div className="lv2-pop">{children}</div> : null;
}

/* ── Demos ─────────────────────────────────────────────────────────────── */

const ASK: { q: string; a: string }[] = [
  {
    q: "Who owes me money?",
    a: "Three renters have a balance. Jordan Ellis owes $240 for his extension, Priya Shah $85 for fuel, and Sam Ortiz $60 for a toll. Jordan's is the oldest, at six days.",
  },
  {
    q: "What's happening today?",
    a: "Five cars move today. Two pickups before noon, the Camry comes back at 11:00, and the Model Y goes out on delivery at 15:45. Nothing is late yet.",
  },
  {
    q: "How did last month go?",
    a: "You collected $18,420, up 12% on the month before. The Model 3 earned the most, and the Mustang sat idle for nine days.",
  },
];

function AskDemo({ reduced }: { reduced: boolean }) {
  const [i, setI] = useState(0);
  return (
    <div className="flex h-full flex-col">
      <div className="flex-1 space-y-4">
        <Asks>{ASK[i].q}</Asks>
        <Says key={i} text={ASK[i].a} reduced={reduced} />
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        {ASK.map((item, j) => (
          <button
            key={item.q}
            type="button"
            onClick={() => setI(j)}
            className={`rounded-full border px-3 py-1.5 text-[12.5px] font-medium transition-colors duration-200 ${
              j === i
                ? "border-transparent bg-[var(--lv-accent)] text-[var(--lv-on-accent)]"
                : "border-[var(--lv-line-2)] text-[var(--lv-ink-2)] hover:bg-[var(--lv-tint)]"
            }`}
          >
            {item.q}
          </button>
        ))}
      </div>
    </div>
  );
}

function PriceDemo({ reduced }: { reduced: boolean }) {
  const [applied, setApplied] = useState(false);
  const why =
    "Eight similar Model 3s on Drive247 rent for a median of $99 a day, and yours was booked on 71% of the last 90 days. You have room to charge more.";
  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-[var(--lv-line)] p-4">
        <div className="flex items-center justify-between text-[12px] text-[var(--lv-ink-3)]">
          <span>2022 Tesla Model 3 · daily rate</span>
          <span className="rounded-full bg-[var(--lv-clear-bg)] px-2 py-0.5 font-semibold text-[var(--lv-clear)]">High confidence</span>
        </div>
        <div className="mt-3 flex items-baseline gap-3">
          <span className="text-[18px] tabular-nums text-[var(--lv-ink-3)] line-through">$89</span>
          <span className="text-[34px] font-semibold leading-none tracking-[-0.02em] tabular-nums">$99</span>
          <span className="text-[13px] font-semibold text-[var(--lv-clear)]">+11%</span>
        </div>
        <div className="mt-4 grid grid-cols-3 gap-2 text-[11.5px]">
          {[
            ["Similar cars", "8"],
            ["Their median", "$99"],
            ["Booked, 90 days", "71%"],
          ].map(([k, v]) => (
            <div key={k} className="rounded-xl bg-[var(--lv-row-hover)] px-3 py-2">
              <div className="text-[var(--lv-ink-3)]">{k}</div>
              <div className="mt-0.5 text-[14px] font-semibold tabular-nums">{v}</div>
            </div>
          ))}
        </div>
      </div>
      <Says text={why} reduced={reduced} />
      <After text={why} reduced={reduced}>
        <button
          type="button"
          onClick={() => setApplied((a) => !a)}
          className={`inline-flex h-9 items-center gap-1.5 rounded-full px-4 text-[13px] font-semibold transition-opacity duration-200 hover:opacity-90 ${
            applied ? "bg-[var(--lv-clear-bg)] text-[var(--lv-clear)]" : "bg-[var(--lv-accent)] text-[var(--lv-on-accent)]"
          }`}
        >
          {applied ? (
            <>
              <Check className="size-3.5" aria-hidden /> New price applied
            </>
          ) : (
            "Apply $99 a day"
          )}
        </button>
      </After>
    </div>
  );
}

const REPLIES = [
  { style: "Friendly", text: "Hi Maya! Yes, an hour early works. See you Friday at 9:00." },
  {
    style: "Detailed",
    text: "Hi Maya, yes. The car will be ready at 9:00 on Friday. Bring your licence and the card you booked with, and the lockbox code will reach you by text before pickup.",
  },
  { style: "Next step", text: "Done. Your pickup is now 9:00 on Friday." },
];

function RepliesDemo({ reduced }: { reduced: boolean }) {
  const [pick, setPick] = useState<number | null>(null);
  const intro = "Maya is booked for 10:00 on Friday and the car is free from 8:00. Three ways to answer:";
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-start gap-2.5">
        <Image src="/landing-v2/people/person-5.jpg" alt="" width={28} height={28} className="size-7 rounded-full object-cover" />
        <p className="w-fit max-w-[85%] rounded-2xl rounded-tl-md border border-[var(--lv-line)] px-4 py-2.5 text-[14px]">
          Hi! Any chance I can pick up an hour early on Friday?
        </p>
      </div>
      <Says text={intro} reduced={reduced} className="mt-4" />
      <After text={intro} reduced={reduced}>
        <div className="mt-3 grid gap-2">
          {REPLIES.map((r, i) => (
            <button
              key={r.style}
              type="button"
              onClick={() => setPick(i)}
              className={`rounded-xl border px-3.5 py-2.5 text-left text-[13px] leading-snug transition-colors duration-200 ${
                pick === i ? "border-[var(--lv-accent)] bg-[var(--lv-tint)]" : "border-[var(--lv-line)] hover:bg-[var(--lv-row-hover)]"
              }`}
            >
              <span className="mb-0.5 block text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--lv-accent-ink)]">{r.style}</span>
              {r.text}
            </button>
          ))}
        </div>
      </After>
      <div className="mt-auto pt-4">
        <div className="flex items-center gap-2 rounded-full border border-[var(--lv-line-2)] py-1 pl-4 pr-1 text-[13px]">
          <span className={`min-w-0 flex-1 truncate ${pick === null ? "text-[var(--lv-ink-3)]" : ""}`}>
            {pick === null ? "Pick a reply to drop it in here" : REPLIES[pick].text}
          </span>
          <span
            className={`rounded-full px-3.5 py-1.5 text-[12px] font-semibold ${
              pick === null ? "bg-[var(--lv-row-hover)] text-[var(--lv-ink-3)]" : "bg-[var(--lv-accent)] text-[var(--lv-on-accent)]"
            }`}
          >
            Send
          </span>
        </div>
      </div>
    </div>
  );
}

const ID_STEPS = ["Licence read: name, number, date of birth", "In date until March 2029", "Face matches the selfie", "Cleared to drive"];

function IdDemo({ reduced }: { reduced: boolean }) {
  const [run, setRun] = useState(0);
  const [done, setDone] = useState(reduced ? ID_STEPS.length : 0);
  useEffect(() => {
    if (reduced) {
      setDone(ID_STEPS.length);
      return;
    }
    setDone(0);
    const timers = ID_STEPS.map((_, i) => window.setTimeout(() => setDone(i + 1), 700 + i * 650));
    return () => timers.forEach(window.clearTimeout);
  }, [run, reduced]);

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-4">
        {/* The licence, drawn. */}
        <div className="relative h-[118px] flex-1 overflow-hidden rounded-xl border border-[var(--lv-line)] bg-[color-mix(in_srgb,var(--lv-accent)_8%,var(--lv-paper))] p-3">
          <div className="text-[9px] font-bold uppercase tracking-[0.16em] text-[var(--lv-accent-ink)]">Driver licence</div>
          <div className="mt-2 flex gap-3">
            <Image src="/landing-v2/people/person-3.jpg" alt="" width={56} height={68} className="h-[68px] w-[56px] rounded-md object-cover" />
            <div className="flex-1 space-y-1.5 pt-1">
              <div className="h-2 w-3/4 rounded-full bg-[var(--lv-line-2)]" />
              <div className="h-2 w-1/2 rounded-full bg-[var(--lv-line-2)]" />
              <div className="h-2 w-2/3 rounded-full bg-[var(--lv-line-2)]" />
              <div className="h-2 w-1/3 rounded-full bg-[var(--lv-line-2)]" />
            </div>
          </div>
          {done < ID_STEPS.length && !reduced && (
            <div className="lv2-scan pointer-events-none absolute inset-x-0 top-0 h-8 bg-gradient-to-b from-transparent via-[color-mix(in_srgb,var(--lv-accent)_30%,transparent)] to-transparent" />
          )}
        </div>
        {/* The selfie. */}
        <div className="relative">
          <Image src="/landing-v2/people/person-3.jpg" alt="" width={84} height={84} className="size-[84px] rounded-full border-2 border-[var(--lv-paper)] object-cover outline outline-1 outline-[var(--lv-line)]" />
          {done >= 3 && (
            <span className="lv2-pop absolute -bottom-1 -right-1 flex size-7 items-center justify-center rounded-full bg-[var(--lv-clear)] text-white">
              <Check className="size-4" aria-hidden />
            </span>
          )}
        </div>
      </div>

      <ul className="space-y-2">
        {ID_STEPS.map((s, i) => (
          <li
            key={s}
            className={`flex items-center gap-2.5 text-[13.5px] transition-opacity duration-200 ${i < done ? "opacity-100" : "opacity-35"}`}
          >
            <span
              className={`flex size-5 items-center justify-center rounded-full ${
                i < done ? "bg-[var(--lv-clear-bg)] text-[var(--lv-clear)]" : "bg-[var(--lv-row-hover)] text-transparent"
              }`}
            >
              <Check className="size-3" aria-hidden />
            </span>
            <span className={i === ID_STEPS.length - 1 && i < done ? "font-semibold" : ""}>{s}</span>
          </li>
        ))}
      </ul>

      <button
        type="button"
        onClick={() => setRun((r) => r + 1)}
        className="text-[12.5px] font-medium text-[var(--lv-accent-ink)] transition-opacity duration-200 hover:opacity-70"
      >
        Run the check again
      </button>
    </div>
  );
}

function AgreementsDemo({ reduced }: { reduced: boolean }) {
  const say = "Added as clause 7, right after fuel. Nothing else in your agreement changed.";
  return (
    <div className="space-y-4">
      <Asks>Add a no-smoking rule with a $250 cleaning fee.</Asks>
      <Says text={say} reduced={reduced} />
      <div className="rounded-2xl border border-[var(--lv-line)] p-4 text-[12.5px] leading-relaxed">
        <div className="mb-3 text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--lv-ink-3)]">Rental agreement</div>
        <p className="text-[var(--lv-ink-3)]">
          <span className="font-semibold text-[var(--lv-ink-2)]">6. Fuel.</span> The vehicle must be returned with the same fuel or charge level
          as at pickup.
        </p>
        <After text={say} reduced={reduced}>
          <p className="my-2.5 rounded-lg border-l-2 border-[var(--lv-accent)] bg-[var(--lv-tint)] px-3 py-2">
            <span className="font-semibold">7. Smoking.</span> Smoking or vaping in the vehicle is not permitted. A $250 cleaning fee applies if
            evidence of smoking is found at return.
          </p>
        </After>
        <p className="text-[var(--lv-ink-3)]">
          <span className="font-semibold text-[var(--lv-ink-2)]">8. Tolls and fines.</span> Any tolls or fines during the rental are the
          renter&rsquo;s responsibility.
        </p>
      </div>
    </div>
  );
}

function InsightsDemo({ reduced }: { reduced: boolean }) {
  const lead = "Here is your October so far.";
  const findings = [
    { tone: "clear", text: "Revenue is up 12% on September." },
    { tone: "wait", text: "The Mustang has sat idle for 9 days. A weekend rate could move it." },
    { tone: "late", text: "$385 is still owed across three renters." },
  ] as const;
  const dot = { clear: "bg-[var(--lv-clear)]", wait: "bg-[var(--lv-wait)]", late: "bg-[var(--lv-late)]" };
  return (
    <div className="space-y-4">
      <Says text={lead} reduced={reduced} />
      <After text={lead} reduced={reduced}>
        <div className="rounded-2xl border border-[var(--lv-line)] p-4">
          <div className="flex items-baseline justify-between">
            <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--lv-ink-3)]">Collected</span>
            <span className="text-[11px] text-[var(--lv-ink-3)]">vs September</span>
          </div>
          <div className="mt-1 flex items-baseline gap-2">
            <span className="text-[30px] font-semibold leading-none tracking-[-0.02em] tabular-nums">$18,420</span>
            <span className="text-[13px] font-semibold text-[var(--lv-clear)]">+12%</span>
          </div>
          <ul className="mt-4 space-y-2.5">
            {findings.map((f) => (
              <li key={f.text} className="flex gap-2.5 text-[13.5px] leading-snug">
                <span className={`mt-1.5 size-1.5 shrink-0 rounded-full ${dot[f.tone]}`} />
                {f.text}
              </li>
            ))}
          </ul>
          <div className="mt-4 flex flex-wrap gap-2 border-t border-[var(--lv-line)] pt-3 text-[12px] font-medium text-[var(--lv-accent-ink)]">
            <span className="rounded-full bg-[var(--lv-tint)] px-3 py-1">Remind the three renters</span>
            <span className="rounded-full bg-[var(--lv-tint)] px-3 py-1">Review the Mustang&rsquo;s price</span>
          </div>
        </div>
      </After>
    </div>
  );
}

/* ── Section ───────────────────────────────────────────────────────────── */

export function TraxShowcase() {
  const reduced = usePrefersReducedMotion();
  const [active, setActive] = useState<Key>("ask");
  const [userPicked, setUserPicked] = useState(false);
  const [inView, setInView] = useState(false);
  const sectionRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const el = sectionRef.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => setInView(e.isIntersecting), { threshold: 0.35 });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const cycling = inView && !userPicked && !reduced;
  useEffect(() => {
    if (!cycling) return;
    const id = window.setTimeout(() => {
      const i = CAPS.findIndex((c) => c.key === active);
      setActive(CAPS[(i + 1) % CAPS.length].key);
    }, CYCLE_MS);
    return () => window.clearTimeout(id);
  }, [cycling, active]);

  const pick = (k: Key) => {
    setUserPicked(true);
    setActive(k);
  };

  const demo: Record<Key, ReactNode> = {
    ask: <AskDemo reduced={reduced} />,
    price: <PriceDemo reduced={reduced} />,
    replies: <RepliesDemo reduced={reduced} />,
    id: <IdDemo reduced={reduced} />,
    agreements: <AgreementsDemo reduced={reduced} />,
    insights: <InsightsDemo reduced={reduced} />,
  };

  return (
    <div ref={sectionRef}>
    <IndigoStage id="trax" className="flex min-h-[100svh] scroll-mt-16 items-center py-20">
      <div className="mx-auto grid w-full max-w-6xl items-center gap-12 px-4 sm:px-6 lg:grid-cols-[1fr_1fr] lg:gap-14">
        <div>
          <span className="inline-flex items-center gap-2 rounded-full bg-white/12 py-1 pl-1.5 pr-3 text-[12px] font-semibold text-white ring-1 ring-white/25 backdrop-blur-sm">
            <span className="flex size-6 items-center justify-center rounded-full bg-white">
              <TraxMark size={16} />
            </span>
            The AI inside Drive247
          </span>
          <h2 className="mt-6 text-[72px] font-extrabold leading-[0.9] tracking-[-0.055em] sm:text-[104px] lg:text-[120px]">
            Meet
            <br />
            Trax.
          </h2>
          <p className="mt-6 max-w-[30rem] text-balance text-[22px] font-bold leading-[1.2] tracking-[-0.02em] sm:text-[26px]">
            The sharpest person on your team. Never clocks off.
          </p>
          <p className="mt-4 max-w-[30rem] text-[15px] leading-relaxed text-white/75">
            Trax reads your bookings, payments and fleet, then does the thinking. Pick one and watch.
          </p>

          <div role="tablist" aria-label="What Trax does" className="mt-8 grid gap-1.5 sm:grid-cols-2">
            {CAPS.map((c) => {
              const on = c.key === active;
              const Icon = c.icon;
              return (
                <button
                  key={c.key}
                  role="tab"
                  type="button"
                  aria-selected={on}
                  onClick={() => pick(c.key)}
                  className={`group relative flex items-center gap-3 overflow-hidden rounded-xl px-3 py-2.5 text-left transition-colors duration-200 ${
                    on ? "bg-white text-[hsl(248_68%_40%)]" : "text-white hover:bg-white/10"
                  }`}
                >
                  <span
                    className={`flex size-8 shrink-0 items-center justify-center rounded-lg ${
                      on ? "bg-[hsl(248_68%_51%)] text-white" : "bg-white/12 text-white"
                    }`}
                  >
                    <Icon className="size-4" aria-hidden />
                  </span>
                  <span className="min-w-0 truncate text-[14px] font-bold">{c.title}</span>
                  {/* Time until the next tab, while cycling. */}
                  {on && cycling && (
                    <span
                      key={`${c.key}-bar`}
                      className="lv2-progress absolute inset-x-0 bottom-0 h-[3px] origin-left bg-[hsl(248_68%_51%)]"
                      style={{ animationDuration: `${CYCLE_MS}ms` }}
                    />
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* The Trax panel, as it looks in the portal. */}
        <div className="relative isolate overflow-hidden rounded-[28px] bg-[var(--lv-paper)] text-[var(--lv-ink)] ring-1 ring-white/30">
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(36rem_20rem_at_100%_0%,color-mix(in_srgb,var(--lv-wash)_12%,transparent),transparent_70%)]"
          />
          <div className="flex items-center gap-2.5 border-b border-[var(--lv-line)] px-5 py-3.5">
            <TraxMark />
            <span className="text-[14px] font-semibold">Trax</span>
            <span className="ml-1 flex items-center gap-1.5 text-[11.5px] text-[var(--lv-ink-3)]">
              <span className="size-1.5 rounded-full bg-[var(--lv-clear)]" />
              Online
            </span>
            <span className="ml-auto text-[11.5px] text-[var(--lv-ink-3)]">{CAPS.find((c) => c.key === active)?.title}</span>
          </div>
          <div key={active} role="tabpanel" className="lv2-pop h-[480px] overflow-hidden p-5 sm:h-[440px]">
            {demo[active]}
          </div>
        </div>
      </div>
    </IndigoStage>
    </div>
  );
}
