"use client";

import { useEffect, useRef, useState, type ComponentType } from "react";
import {
  ArrowUp,
  CalendarClock,
  History,
  KeyRound,
  LifeBuoy,
  Maximize2,
  Plus,
  Sparkles,
  SquarePen,
  X,
} from "lucide-react";
import {
  CustomersArt,
  DepositsArt,
  ExpensesArt,
  FleetArt,
  InvoicesArt,
  MaintenanceArt,
  PaymentsArt,
  RentalsArt,
} from "./trax-art";
import "./trax-section.css";

/*
 * A question goes in at the middle, and Trax goes out along the branches to the parts
 * of the business that hold the answer, then comes back with it.
 *
 * Every branch is a dataset trax-support really reads (support/business-catalog*.ts):
 * vehicles, rentals, customers, maintenance, payments, invoices, deposits, expenses.
 * The names and amounts are demo content.
 */

type NodeId = "rentals" | "customers" | "fleet" | "maintenance" | "payments" | "invoices" | "deposits" | "expenses";

const NODES: Record<NodeId, { label: string; idle: string; art: ComponentType }> = {
  rentals: { label: "Rentals", idle: "Who's out, who's due", art: RentalsArt },
  customers: { label: "Customers", idle: "Balances and history", art: CustomersArt },
  fleet: { label: "Fleet", idle: "Every car and its status", art: FleetArt },
  maintenance: { label: "Maintenance", idle: "Jobs in the shop", art: MaintenanceArt },
  payments: { label: "Payments", idle: "What came in", art: PaymentsArt },
  invoices: { label: "Invoices", idle: "Billed and unpaid", art: InvoicesArt },
  deposits: { label: "Deposits", idle: "Holds on your cards", art: DepositsArt },
  expenses: { label: "Expenses", idle: "What went out", art: ExpensesArt },
};

const LEFT: NodeId[] = ["rentals", "customers", "fleet", "maintenance"];
const RIGHT: NodeId[] = ["payments", "invoices", "deposits", "expenses"];

type Query = {
  ask: string;
  /** The branches Trax takes, in order, and what it finds at the end of each. */
  path: { id: NodeId; found: string }[];
  answer: {
    text: string;
    /** Drawn as the portal's AnswerChart: one measure, every bar direct-labelled. */
    chart?: { label: string; value: number; display: string }[];
    after?: string;
  };
};

const QUERIES: Query[] = [
  {
    ask: "Who owes me the most right now?",
    path: [
      { id: "customers", found: "10 with a balance" },
      { id: "invoices", found: "14 still unpaid" },
      { id: "payments", found: "31 payments matched" },
    ],
    answer: {
      text: "Larkspur Freight Co owes the most. That's 10 customers and $5,791.67 in total.",
      chart: [
        { label: "Larkspur Freight", value: 2238.5, display: "$2,238.50" },
        { label: "Nina Kowalski", value: 750.5, display: "$750.50" },
        { label: "Rosalind Achebe", value: 746.9, display: "$746.90" },
      ],
    },
  },
  {
    ask: "Which cars can I rent out this weekend?",
    path: [
      { id: "fleet", found: "10 cars" },
      { id: "rentals", found: "6 out on Saturday" },
      { id: "maintenance", found: "1 in the shop" },
    ],
    answer: {
      text: "Three cars are free all weekend: the Kia Telluride, the Ford Explorer and the Nissan Versa.",
    },
  },
  {
    ask: "How did I do last month?",
    path: [
      { id: "payments", found: "$42,480 came in" },
      { id: "expenses", found: "$24,240 went out" },
      { id: "deposits", found: "Kept apart from income" },
      { id: "rentals", found: "53 rentals" },
    ],
    answer: {
      text: "A good month. You kept $18,240 across 53 rentals, with deposits left out.",
      chart: [
        { label: "Took in", value: 42480, display: "$42,480" },
        { label: "Spent", value: 24240, display: "$24,240" },
        { label: "Kept", value: 18240, display: "$18,240" },
      ],
    },
  },
  {
    ask: "Is Sophia's deposit still held?",
    path: [
      { id: "customers", found: "Sophia Martinez" },
      { id: "rentals", found: "Tesla, back on Sunday" },
      { id: "deposits", found: "$500 held" },
    ],
    answer: { text: "Yes. $500 is held on Sophia's Tesla rental, and the car is due back on Sunday." },
  },
];

/* The robot from the portal's chat, apps/portal/src/components/chat/TraxIcon.tsx. */
function TraxIcon() {
  const c = "currentColor";
  return (
    <svg width={18} height={18} viewBox="0 0 24 24" fill="none" aria-hidden>
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

/* The mark from trax-greeting.tsx: an iridescent conic fill that turns, and a halo. */
function TraxMark({ size, animated = false }: { size: "xs" | "md"; animated?: boolean }) {
  return (
    <span className={`tm-mark is-${size}`} data-animated={animated} aria-hidden>
      {animated && <i className="tm-mark-halo" />}
      <span className="tm-mark-clip"><i className="tm-mark-fill" /></span>
      <Sparkles strokeWidth={2} />
    </span>
  );
}

/* The answer arrives word by word, the way a model writes. */
function Stream({ text, still }: { text: string; still: boolean }) {
  if (still) return <>{text}</>;
  return (
    <>
      {text.split(" ").map((word, i) => (
        <span key={i} className="tm-word" style={{ animationDelay: `${i * 34}ms` }}>{word} </span>
      ))}
    </>
  );
}

function Spark({ className }: { className: string }) {
  return (
    <svg viewBox="-10 -10 20 20" className={`tm-spark ${className}`} aria-hidden>
      <path d="M0 -10 Q1.8 -1.8 10 0 Q1.8 1.8 0 10 Q-1.8 1.8 -10 0 Q-1.8 -1.8 0 -10 Z" fill="currentColor" />
    </svg>
  );
}

type Phase = "typing" | "search" | "answer";

/* How far a branch runs underneath the screen. */
const TUCK = 30;

export function TraxSection() {
  const section = useRef<HTMLElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const wheel = useRef<HTMLElement>(null);
  const nodeEls = useRef<Partial<Record<NodeId, HTMLDivElement | null>>>({});

  const [seen, setSeen] = useState(false);
  const [running, setRunning] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [reduced, setReduced] = useState(false);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [paths, setPaths] = useState<Partial<Record<NodeId, string>>>({});

  // At rest the section shows a finished exchange, so it is never empty.
  const [q, setQ] = useState(0);
  const [phase, setPhase] = useState<Phase>("answer");
  const [typed, setTyped] = useState(0);
  const [hit, setHit] = useState(QUERIES[0].path.length);

  const query = QUERIES[q];
  const visited = query.path.slice(0, hit);

  useEffect(() => {
    setReduced(window.matchMedia("(prefers-reduced-motion: reduce)").matches);
    const el = section.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        setRunning(entry.isIntersecting);
        if (entry.isIntersecting) setSeen(true);
      },
      { threshold: 0.35 },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // The first time it comes on screen, the opening question plays from the start.
  const started = useRef(false);
  useEffect(() => {
    if (!running || reduced || started.current) return;
    started.current = true;
    setPhase("typing");
    setTyped(0);
    setHit(0);
  }, [running, reduced]);

  useEffect(() => {
    if (!running) return;
    let wait: number;
    let then: () => void;

    if (phase === "typing") {
      if (typed < query.ask.length) {
        // A beat on the greeting first, then the question types itself.
        wait = typed === 0 ? 450 : 20;
        then = () => setTyped(typed + 1);
      } else {
        wait = 240;
        then = () => {
          setPhase("search");
          setHit(0);
        };
      }
    } else if (phase === "search") {
      if (hit < query.path.length) {
        wait = hit === 0 ? 260 : 480;
        then = () => setHit(hit + 1);
      } else {
        wait = 520;
        then = () => setPhase("answer");
      }
    } else {
      if (hovered) return;
      wait = reduced ? 9000 : 3600;
      then = () => {
        const next = (q + 1) % QUERIES.length;
        setQ(next);
        if (reduced) {
          setHit(QUERIES[next].path.length);
        } else {
          setPhase("typing");
          setTyped(0);
          setHit(0);
        }
      };
    }

    const timer = setTimeout(then, wait);
    return () => clearTimeout(timer);
  }, [running, hovered, reduced, q, phase, typed, hit, query]);

  // Faster while searching, changing the rate of the running roll so it never jumps.
  useEffect(() => {
    wheel.current?.getAnimations().forEach((roll) => roll.updatePlaybackRate(phase === "search" ? 5 : 1));
  }, [phase, seen]);

  // The branches are drawn from where the boxes really are, at any screen size.
  useEffect(() => {
    const root = stage.current;
    if (!root) return;

    const measure = () => {
      const box = root.getBoundingClientRect();
      const screen = panel.current?.getBoundingClientRect();
      if (!screen) return;
      setSize({ width: box.width, height: box.height });

      const next: Partial<Record<NodeId, string>> = {};
      const route = (ids: NodeId[], side: "left" | "right") => {
        ids.forEach((id, i) => {
          const el = nodeEls.current[id]?.getBoundingClientRect();
          if (!el) return;
          // Out of the screen close together, like a trunk, then spreading to each box.
          const share = (i + 0.5) / ids.length - 0.5;
          const beside = side === "left" ? el.right <= screen.left : el.left >= screen.right;
          if (beside) {
            // One end runs under the solid screen; the other stops on the edge of the glass box,
            // because a line would show through it.
            const under = side === "left" ? 1 : -1;
            const sx = (side === "left" ? screen.left : screen.right) - box.left + under * TUCK;
            const sy = screen.top + screen.height / 2 + share * screen.height * 0.34 - box.top;
            const ex = (side === "left" ? el.right : el.left) - box.left - under;
            const ey = el.top + el.height / 2 - box.top;
            const mx = (sx + ex) / 2;
            next[id] = `M${sx} ${sy} C${mx} ${sy} ${mx} ${ey} ${ex} ${ey}`;
          } else {
            const above = el.bottom <= screen.top;
            const sx = screen.left + screen.width / 2 + share * screen.width * 0.6 - box.left;
            const sy = (above ? screen.top + TUCK : screen.bottom - TUCK) - box.top;
            const ex = el.left + el.width / 2 - box.left;
            const ey = (above ? el.bottom - 1 : el.top + 1) - box.top;
            const my = (sy + ey) / 2;
            next[id] = `M${sx} ${sy} C${sx} ${my} ${ex} ${my} ${ex} ${ey}`;
          }
        });
      };
      route(LEFT, "left");
      route(RIGHT, "right");
      setPaths(next);
    };

    measure();
    // The boxes and the screen as well as the stage: either can change size or move
    // inside it (a late font, a narrower column) with the stage itself staying put.
    const observer = new ResizeObserver(measure);
    observer.observe(root);
    if (panel.current) observer.observe(panel.current);
    Object.values(nodeEls.current).forEach((el) => el && observer.observe(el));
    document.fonts?.ready.then(measure);
    return () => observer.disconnect();
  }, []);

  const renderNode = (id: NodeId) => {
    const node = NODES[id];
    const Art = node.art;
    const found = visited.find((v) => v.id === id);
    return (
      <div
        key={id}
        ref={(el) => {
          nodeEls.current[id] = el;
        }}
        className="tm-node"
        data-lit={!!found}
      >
        <span className="tm-art">
          <Art />
          {found && !reduced && (
            <>
              <Spark className="is-big" />
              <Spark className="is-small" />
            </>
          )}
        </span>
        <span className="tm-node-text">
          <b>{node.label}</b>
          <small>{found ? found.found : node.idle}</small>
        </span>
      </div>
    );
  };

  const thinking = phase === "search";
  const empty = phase === "typing";
  const hasDraft = empty && typed > 0;

  return (
    <section ref={section} id="trax" className="tm-section" data-seen={seen}>
      <div className="tm-lines" aria-hidden />

      <div className="tm-copy">
        <h2 className="tm-title font-medium tracking-tighter">I&apos;m Trax.</h2>
        <p className="tm-sub text-base leading-relaxed sm:text-lg">
          Ask me one question and I go through your whole business to answer it.
        </p>
      </div>

      <div
        ref={stage}
        className="tm-stage"
        role="img"
        aria-label="A question goes into Trax, which checks rentals, customers, fleet, maintenance, payments, invoices, deposits and expenses, then answers from what it finds."
      >
        {/*
          * A rental business turns on its wheels: Trax is the hub, the business is on the
          * spokes. It rolls all the time and speeds up while Trax is searching.
          */}
        <i ref={wheel} className="tm-wheel" data-running={running} aria-hidden />

        <svg className="tm-wires" width={size.width} height={size.height} viewBox={`0 0 ${size.width || 1} ${size.height || 1}`} aria-hidden>
          <defs>
            <linearGradient id="tm-iris" gradientUnits="userSpaceOnUse" x1={0} y1={0} x2={size.width} y2={0}>
              <stop offset="0" className="tm-iris-a" />
              <stop offset="0.5" className="tm-iris-b" />
              <stop offset="1" className="tm-iris-a" />
            </linearGradient>
          </defs>
          {(Object.keys(paths) as NodeId[]).map((id) => (
            <path key={id} d={paths[id]} className="tm-wire" />
          ))}
          {visited.map(({ id }) => (
            <path key={`${q}-${id}`} d={paths[id]} pathLength={1} className="tm-wire-lit" stroke="url(#tm-iris)" />
          ))}
          {/* Data coming home along every branch that has been reached. */}
          {thinking && !reduced &&
            visited.map(({ id }) => (
              <path key={`${q}-${id}-flow`} d={paths[id]} pathLength={1} className="tm-wire-flow" />
            ))}
          {phase === "answer" && !reduced &&
            visited.map(({ id }) => (
              <path key={`${q}-${id}-back`} d={paths[id]} pathLength={1} className="tm-wire-back" />
            ))}
        </svg>

        <div className="tm-col is-left">{LEFT.map(renderNode)}</div>

        <div
          ref={panel}
          className="tm-screen"
          data-thinking={thinking}
          onMouseEnter={() => setHovered(true)}
          onMouseLeave={() => setHovered(false)}
        >
          <i className="tm-screen-halo" aria-hidden />

          {/* The portal's panel, trax-panel.tsx: drawn in place so it stays sharp. */}
          <div className="tm-panel">
            <header className="tm-head">
              <span className="tm-switch">
                <span className="tm-tab is-on"><TraxMark size="xs" animated={thinking && !reduced} />Trax</span>
                <span className="tm-tab"><LifeBuoy />Support</span>
              </span>
              <span className="tm-actions">
                <History /><SquarePen /><Maximize2 /><X />
              </span>
            </header>

            <div key={`${q}-${empty}`} className="tm-body" data-empty={empty}>
              {empty ? (
                <div className="tm-greeting tm-in">
                  <TraxMark size="md" animated={!reduced} />
                  <h3>Good morning, Alex</h3>
                  <p>Ask about your fleet, rentals and bookings. TRAX checks your own records before it answers.</p>
                </div>
              ) : (
                <div className="tm-thread">
                  <div className={`tm-msg is-user${reduced ? "" : " tm-in"}`}>
                    <span className="tm-avatar is-user">AR</span>
                    <div className="tm-msg-col">
                      <div className="tm-bubble is-user">{query.ask}</div>
                      <span className="tm-time">9:12 AM</span>
                    </div>
                  </div>

                  {thinking && (
                    <>
                      <p className="tm-status">Checking guidance and authorized records…</p>
                      {/* The record check, filling in as each branch comes back. */}
                      {visited.length > 0 && (
                        <div className="tm-evidence is-live">
                          <p>Record check</p>
                          <ul>
                            {visited.map(({ id, found }) => (
                              <li key={id} className="tm-in"><b>{NODES[id].label}</b> {found}</li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </>
                  )}

                  {phase === "answer" && (
                    <div className={`tm-msg${reduced ? "" : " tm-in"}`}>
                      <span className="tm-avatar"><TraxIcon /></span>
                      <div className="tm-msg-col">
                        <div className="tm-bubble">
                          <Stream text={query.answer.text} still={reduced} />
                          {query.answer.chart && (
                            <div className="tm-chart">
                              {query.answer.chart.map((row, i) => (
                                <div key={row.label} className="tm-chart-row">
                                  <span>{row.label}</span>
                                  <span className="tm-chart-track">
                                    <i
                                      style={{
                                        width: `${(row.value / Math.max(...query.answer.chart!.map((r) => r.value))) * 100}%`,
                                        animationDelay: `${500 + i * 90}ms`,
                                      }}
                                    />
                                  </span>
                                  <b>{row.display}</b>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                        <span className="tm-prov">AI answer · Live records checked</span>
                        <div className="tm-evidence">
                          <p>Record check · Nov 4, 9:12 AM</p>
                          <ul>
                            {query.path.map(({ id, found }) => (
                              <li key={id}><b>{NODES[id].label}</b> {found}</li>
                            ))}
                          </ul>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )}

              <div className="tm-composer-wrap">
                <div className="tm-composer" data-active={empty}>
                  <i className="tm-composer-glow" aria-hidden />
                  <i className="tm-composer-ring" aria-hidden />
                  <div className="tm-composer-card">
                    <div className="tm-draft">
                      {hasDraft ? (
                        <>
                          {query.ask.slice(0, typed)}
                          <i className="tm-caret" />
                        </>
                      ) : (
                        <span>Ask Trax anything…</span>
                      )}
                    </div>
                    <div className="tm-composer-row">
                      <Plus />
                      <i className="tm-send" data-ready={hasDraft}><ArrowUp strokeWidth={2.25} /></i>
                    </div>
                  </div>
                </div>
              </div>

              {empty && (
                <div className="tm-suggest tm-in">
                  <span><KeyRound />Vehicles out now</span>
                  <span><CalendarClock />Today&apos;s pickups and returns</span>
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="tm-col is-right">{RIGHT.map(renderNode)}</div>
      </div>
    </section>
  );
}
