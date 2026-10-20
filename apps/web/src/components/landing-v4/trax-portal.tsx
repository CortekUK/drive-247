"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  ArrowUp,
  CalendarClock,
  CreditCard,
  History,
  KeyRound,
  LifeBuoy,
  Loader2,
  Maximize2,
  Plus,
  Sparkles,
  SquarePen,
  User,
  X,
} from "lucide-react";

/*
 * Trax, drawn exactly as the operator portal's live panel draws it, so the
 * landing page and the product show the same assistant:
 *
 *   panel      apps/portal/src/components/trax/trax-panel.tsx
 *   greeting   …/trax/trax-greeting.tsx (TraxMark), trax-greeting-utils.ts
 *   thread     …/trax/support/TraxSupportThread.tsx (density "sheet")
 *   messages   …/trax/support/ChatMessage.tsx, PaymentEvidence.tsx
 *   avatar     apps/portal/src/components/chat/TraxIcon.tsx
 *   composer   …/trax/trax-composer.tsx
 *
 * Copy (starter prompts, status lines, the provenance note, the placeholder)
 * is the portal's, verbatim. The answers are a scripted demo.
 */

/** The portal's starter prompts (TraxSupportThread), label → what is sent. */
const PROMPTS = [
  { Icon: KeyRound, label: "Vehicles out now", q: "Which vehicles are out on rent right now?" },
  { Icon: CalendarClock, label: "Today's pickups and returns", q: "What pickups and returns are scheduled for today?" },
  { Icon: CreditCard, label: "Check a rental's payments", q: "I want to check the payments for a rental." },
];

/** components/chat/TraxIcon.tsx — the robot beside every Trax reply. */
function TraxIcon() {
  const c = "currentColor";
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" aria-hidden="true">
      <rect x="3" y="5" width="18" height="15" rx="5" fill={c} opacity="0.15" />
      <rect x="3" y="5" width="18" height="15" rx="5" stroke={c} strokeWidth="1.5" opacity="0.6" />
      <circle cx="9" cy="12" r="1.8" fill={c} />
      <circle cx="9.6" cy="11.3" r="0.6" fill="white" opacity="0.8" />
      <circle cx="15" cy="12" r="1.8" fill={c} />
      <circle cx="15.6" cy="11.3" r="0.6" fill="white" opacity="0.8" />
      <line x1="12" y1="5" x2="12" y2="2" stroke={c} strokeWidth="1.5" strokeLinecap="round" opacity="0.5" />
      <circle cx="12" cy="1.5" r="1.5" fill={c} opacity="0.7" />
      <path d="M9.5 15.5 C10.5 16.8 13.5 16.8 14.5 15.5" stroke={c} strokeWidth="1.3" strokeLinecap="round" fill="none" opacity="0.5" />
    </svg>
  );
}

/** trax-greeting.tsx — the conic sparkle disc. */
function TraxMark({ size, animated }: { size: "xs" | "md"; animated?: boolean }) {
  return (
    <span className={`l4-tx-mark ${size}${animated ? " anim" : ""}`} aria-hidden="true">
      {animated ? <span className="halo" /> : null}
      <span className="disc">
        <span className="cone" />
      </span>
      <Sparkles className="ic" strokeWidth={2} />
    </span>
  );
}

type Answer = { status: string; body: ReactNode; evidence: ReactNode; nav: string[] };

const ANSWERS: Answer[] = [
  {
    status: "Checking guidance and authorized records…",
    body: (
      <>
        <p>
          <strong>6 vehicles are out on rent right now.</strong> Two are due back today:
        </p>
        <ul>
          <li>
            <strong>BMW X5</strong> · Priya Shah · back at 10:00
          </li>
          <li>
            <strong>Audi Q5</strong> · Leo Kim · back at 17:30
          </li>
        </ul>
        <p>The other four are out until Friday or later.</p>
      </>
    ),
    evidence: (
      <div className="l4-tx-card">
        <b>Record check · 10/21/2026, 9:41:07 AM</b>
        <ul>
          <li>6 active rentals found across 8 vehicles.</li>
          <li>2 returns scheduled for today; none overdue.</li>
        </ul>
        <p>No blocker found in the evaluated checks.</p>
      </div>
    ),
    nav: ["Open rentals"],
  },
  {
    status: "Checking guidance and authorized records…",
    body: (
      <>
        <p>
          <strong>Today you have 5 pickups and 3 returns.</strong> The busiest hour is 11:00–12:00, with two pickups.
        </p>
        <p>
          <em>Aisha Bello’s ID check is still running</em> — her pickup is at 16:45.
        </p>
      </>
    ),
    evidence: (
      <div className="l4-tx-card">
        <span className="cap">Pickups and returns by hour</span>
        {[
          ["09:00", 1],
          ["11:00", 2],
          ["13:00", 1],
          ["16:00", 2],
          ["18:00", 2],
        ].map(([h, n]) => (
          <div key={h} className="bar">
            <span>{h}</span>
            <i style={{ width: `${(Number(n) / 2) * 100}%` }} />
            <span>{n}</span>
          </div>
        ))}
      </div>
    ),
    nav: ["Open calendar"],
  },
  {
    status: "Checking rental payments… Verifying with Stripe…",
    body: (
      <>
        <p>
          <strong>Rental R-1042 is paid in full.</strong> The $300 deposit is held on Daniel Reyes’ card and will release
          automatically after the return.
        </p>
      </>
    ),
    evidence: (
      <div className="l4-tx-pay">
        <div className="h">
          <b>Payment R-1042</b>
          <span className="pill">Verified in Stripe</span>
        </div>
        <dl>
          <dt>Amount</dt>
          <dd>$596.00</dd>
          <dt>Date</dt>
          <dd>Oct 18, 2026</dd>
          <dt>Drive247</dt>
          <dd>Paid</dd>
          <dt>Stripe</dt>
          <dd>Succeeded</dd>
          <dt>Stripe ref</dt>
          <dd className="mono">pi_3Q8x…7Tz2</dd>
        </dl>
      </div>
    ),
    nav: ["Open rental"],
  },
];

type Turn = { k: number; phase: "asking" | "answered" };

export function TraxPortal() {
  const ref = useRef<HTMLElement>(null);
  const [visible, setVisible] = useState(false);
  const [turn, setTurn] = useState<Turn | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => setVisible(e.isIntersecting), { threshold: 0.3 });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  // Greeting first; once on screen the first starter prompt is asked. Each
  // answer arrives after the portal's status line, and the next question
  // follows while the section stays in view.
  useEffect(() => {
    if (!visible) return;
    const timers: ReturnType<typeof setTimeout>[] = [];
    if (!turn) timers.push(setTimeout(() => setTurn({ k: 0, phase: "asking" }), 1800));
    else if (turn.phase === "asking") timers.push(setTimeout(() => setTurn({ ...turn, phase: "answered" }), 1500));
    else timers.push(setTimeout(() => setTurn({ k: (turn.k + 1) % ANSWERS.length, phase: "asking" }), 7000));
    return () => timers.forEach(clearTimeout);
  }, [visible, turn]);

  const ask = (k: number) => setTurn({ k, phase: "asking" });
  const a = turn ? ANSWERS[turn.k] : null;

  return (
    <section ref={ref} className="l4-sec l4-trax2" id="x-trax">
      <div className="tg-mesh" aria-hidden="true" />
      <div className="tg-grain" aria-hidden="true" />
      <div className="l4-wrap grid">
        <div className="l4-rv">
          <span className="l4-kick">Trax AI</span>
          <h2 className="l4-h2">Ask your business anything</h2>
          <p className="l4-lead">
            Trax lives in your portal. It checks your own records before it answers, and links you straight to the rental,
            payment or car it found.
          </p>
          <div className="asks">
            {PROMPTS.map(({ Icon, label }, k) => (
              <button key={label} className={turn?.k === k ? "on" : undefined} onClick={() => ask(k)}>
                <Icon />
                {label}
              </button>
            ))}
          </div>
        </div>

        <aside className="l4-tx l4-rv" aria-label="Trax, as it appears in the Drive247 portal">
          <header>
            <div className="switch">
              <span className="on">
                <TraxMark size="xs" />
                Trax
              </span>
              <span>
                <LifeBuoy />
                Support
              </span>
            </div>
            <div className="acts">
              <History />
              <SquarePen />
              <Maximize2 />
              <X />
            </div>
          </header>

          {!turn ? (
            <div className="greet">
              <div className="hello">
                <TraxMark size="md" animated />
                <h3>Good morning, Maya</h3>
                <p>Ask about your fleet, rentals and bookings. TRAX checks your own records before it answers.</p>
              </div>
              <Composer busy={false} />
              <div className="starters">
                {PROMPTS.map(({ Icon, label }, k) => (
                  <button key={label} onClick={() => ask(k)}>
                    <Icon />
                    {label}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <>
              <div className="thread" aria-live="polite">
                <div key={`u${turn.k}`} className="msg me">
                  <span className="av">
                    <User />
                  </span>
                  <div className="col">
                    <div className="bubble">{PROMPTS[turn.k].q}</div>
                    <time>09:41 AM</time>
                  </div>
                </div>
                {turn.phase === "asking" ? (
                  <p className="status" role="status">
                    {a!.status}
                  </p>
                ) : (
                  <div key={`t${turn.k}`} className="msg">
                    <span className="av">
                      <TraxIcon />
                    </span>
                    <div className="col">
                      <div className="bubble md">{a!.body}</div>
                      <details className="prov">
                        <summary>AI answer · Live records checked</summary>
                      </details>
                      {a!.evidence}
                      <div className="nav">
                        {a!.nav.map((n) => (
                          <span key={n}>{n}</span>
                        ))}
                      </div>
                      <time>09:41 AM</time>
                    </div>
                  </div>
                )}
              </div>
              <Composer busy={turn.phase === "asking"} />
            </>
          )}
        </aside>
      </div>
    </section>
  );
}

function Composer({ busy }: { busy: boolean }) {
  return (
    <div className="composer">
      <div className="box">
        <span className="ph">Ask Trax anything…</span>
        <div className="row">
          <span className="att">
            <Plus />
          </span>
          <span className="send">{busy ? <Loader2 className="spin" /> : <ArrowUp strokeWidth={2.25} />}</span>
        </div>
      </div>
    </div>
  );
}
