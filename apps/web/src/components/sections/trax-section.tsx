"use client";

import { useEffect, useRef, useState, type ComponentType } from "react";
import {
  ArrowUp,
  CalendarClock,
  Car,
  Check,
  CircleDollarSign,
  History,
  KeyRound,
  LifeBuoy,
  ListChecks,
  Maximize2,
  MessageCircle,
  Plus,
  Search,
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
import { TraxMark } from "@/components/shared/trax-mark";
import { LINE_MEDIA } from "./launch-section";
import "./trax-section.css";
import { Accent, SectionHeading } from "./section-heading";

/*
 * A question goes in at the middle, and Trax goes out along the branches to the parts
 * of the business that hold the answer, then comes back with it.
 *
 * Every branch is a dataset trax-support really reads (support/business-catalog*.ts):
 * vehicles, rentals, customers, maintenance, payments, invoices, deposits, expenses.
 * The names and amounts are demo content.
 *
 * The four questions are the everyday ones an operator asks, each one a thing Trax really
 * answers today (support/model-tools.ts):
 * - today's priorities: rentals by start and end date, customers' identity verification,
 *   unpaid invoices (list_business_records, query_business_data);
 * - who owes money: query_customer_balances, from the account's own ledger;
 * - how the cars are doing: revenue and costs grouped by vehicle (profit_and_loss, expenses);
 * - returns due: rentals by end date, the basis the catalog names for "returns due".
 * It reads and answers; it doesn't act on its own, and nothing here says it does.
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
  /** The button that asks it. */
  topic: string;
  icon: typeof Search;
  ask: string;
  /** The branches Trax takes, in order, and what it finds at the end of each. */
  path: { id: NodeId; found: string }[];
  answer: {
    text: string;
    /** Drawn as the portal's AnswerChart: one measure, every bar direct-labelled. */
    chart?: { label: string; value: number; display: string }[];
    /** Records, one to a line: what the answer is made of. */
    list?: { label: string; value: string }[];
  };
};

const QUERIES: Query[] = [
  {
    topic: "Today's priorities",
    icon: ListChecks,
    ask: "What needs my attention today?",
    path: [
      { id: "rentals", found: "3 pickups, 2 returns today" },
      { id: "customers", found: "1 licence not verified" },
      { id: "invoices", found: "4 unpaid, $1,240" },
      { id: "maintenance", found: "1 job booked for Friday" },
    ],
    answer: {
      text: "Three things today, most urgent first:",
      list: [
        { label: "Verify", value: "Jordan Lee picks up today and hasn't verified their licence yet." },
        { label: "Returns", value: "The Kia Telluride and the Ford Explorer are due back today." },
        { label: "Unpaid", value: "4 invoices are still open, $1,240 in total." },
      ],
    },
  },
  {
    topic: "Who owes me",
    icon: CircleDollarSign,
    ask: "Who still owes me money?",
    path: [
      { id: "customers", found: "10 with a balance" },
      { id: "invoices", found: "14 still unpaid" },
      { id: "payments", found: "31 payments matched" },
    ],
    answer: {
      text: "10 customers owe you $5,791.67. Larkspur Freight Co owes the most.",
      chart: [
        { label: "Larkspur Freight", value: 2238.5, display: "$2,238.50" },
        { label: "Nina Kowalski", value: 750.5, display: "$750.50" },
        { label: "Rosalind Achebe", value: 746.9, display: "$746.90" },
      ],
    },
  },
  {
    topic: "Best-earning cars",
    icon: Car,
    ask: "Which cars earned the most last month?",
    path: [
      { id: "fleet", found: "12 cars" },
      { id: "rentals", found: "53 rentals" },
      { id: "payments", found: "$42,480 came in" },
      { id: "expenses", found: "$6,180 spent on cars" },
    ],
    answer: {
      text: "Your Tesla Model 3 earned the most: $6,420 from 9 rentals. The Nissan Versa earned the least, after $1,150 in repairs.",
      chart: [
        { label: "Tesla Model 3", value: 6420, display: "$6,420" },
        { label: "Kia Telluride", value: 5310, display: "$5,310" },
        { label: "Ford Explorer", value: 4880, display: "$4,880" },
      ],
    },
  },
  {
    topic: "Returns this week",
    icon: CalendarClock,
    ask: "Which cars are due back this week?",
    path: [
      { id: "rentals", found: "5 ending this week" },
      { id: "customers", found: "5 renters" },
      { id: "deposits", found: "$1,500 held on them" },
    ],
    answer: {
      text: "Five cars are due back this week, two of them tomorrow.",
      list: [
        { label: "Tomorrow", value: "Kia Telluride, Liam Foster" },
        { label: "Tomorrow", value: "Ford Explorer, Mia Chen" },
        { label: "Thursday", value: "Tesla Model 3, Sophia Martinez" },
        { label: "Friday", value: "Nissan Versa and Hyundai Sonata" },
      ],
    },
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

/* What the visitor is watching, said out loud, one for each phase. */
const STAGES: { phase: Phase; label: string; icon: typeof Search }[] = [
  { phase: "typing", label: "You ask", icon: MessageCircle },
  { phase: "search", label: "I check your records", icon: Search },
  { phase: "answer", label: "You get the answer", icon: Sparkles },
];

/* How far a branch runs underneath the screen. */
const TUCK = 30;

/*
 * On a desktop screen the section holds still and the scroll plays it, start to finish:
 * the thread reaches the screen, the question types, the branches run out to the business
 * and come back, the answer arrives, and the thread leaves from the bottom of the screen.
 * The one exception is the wheel: the thread reaching the screen starts it, then it turns by itself.
 * These are the points along that scroll, 0 to 1. Elsewhere it loops on its own timers.
 */
const SCROLL_QUERY = 0;
/* The thread touches the screen as the section lands; a moment later the question starts. */
const LINE_IN_END = 0.015;
const TYPE_START = 0.04;
const TYPE_END = 0.2;
const SEARCH_START = 0.24;
const SEARCH_END = 0.66;
const ANSWER_AT = 0.72;
const ANSWER_READ = 0.88;
const LINE_OUT_START = 0.9;

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

/*
 * Phones and tablets (Ghulam's brief, 2026-11-10: the tracks lighting up as you scroll must
 * come across on a phone, so the visitor sees Trax reach into every part of the business).
 * Below the desktop layout the stage (boxes above, Trax in the middle, boxes below) is sized to
 * exactly one screen and pinned, and the same scroll script plays: the question types, the
 * branches light one by one out to the boxes, the answer arrives. The words above it scroll
 * away first. Too short a screen to hold the stage, or reduced motion: it loops on its timers.
 */
const PHONE_PIN = "(max-width: 1099.98px) and (min-height: 560px) and (prefers-reduced-motion: no-preference)";

export function TraxSection() {
  const section = useRef<HTMLDivElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const wheel = useRef<HTMLElement>(null);
  const nodeEls = useRef<Partial<Record<NodeId, HTMLDivElement | null>>>({});
  const track = useRef<HTMLDivElement>(null);
  const pin = useRef<HTMLDivElement>(null);
  const root = useRef<HTMLElement>(null);
  const lineLead = useRef<SVGPathElement>(null);
  const leadTip = useRef<SVGCircleElement>(null);
  const lineIn = useRef<SVGPathElement>(null);
  const lineOut = useRef<SVGPathElement>(null);
  const lineTip = useRef<SVGCircleElement>(null);
  const litEls = useRef<Partial<Record<NodeId, SVGPathElement | null>>>({});
  const stageBars = useRef<(HTMLElement | null)[]>([]);

  const [seen, setSeen] = useState(false);
  const [running, setRunning] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [reduced, setReduced] = useState(false);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [paths, setPaths] = useState<Partial<Record<NodeId, string>>>({});
  const [thread, setThread] = useState<{ lead: string; into: string; out: string } | null>(null);
  const [scrolled, setScrolled] = useState(false);
  // The screen glows from when the thread touches it until the answer arrives.
  const [touched, setTouched] = useState(false);
  const [wheelOn, setWheelOn] = useState(false);
  // Once the visitor asks a question of their own, they drive: the scroll stops playing the
  // opening one, and nothing moves on to another question until they ask it.
  const [picked, setPicked] = useState(false);
  const pickedRef = useRef(false);
  const driven = scrolled && !picked;

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
        // A phone on its side can never show 35% of this section, so half the viewport also counts.
        const inView = entry.intersectionRatio >= 0.35 || entry.intersectionRect.height >= window.innerHeight * 0.5;
        setRunning(inView);
        if (inView) setSeen(true);
      },
      // Every 5%, because the half-a-viewport test can come true at any ratio.
      { threshold: Array.from({ length: 21 }, (_, i) => i / 20) },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // The first time it comes on screen, the opening question plays from the start.
  const started = useRef(false);

  useEffect(() => {
    const media = matchMedia(`${LINE_MEDIA} and (prefers-reduced-motion: no-preference), ${PHONE_PIN}`);
    const apply = () => {
      setScrolled(media.matches);
      if (!media.matches) return;
      started.current = true;
      setQ(SCROLL_QUERY);
      setPhase("typing");
      setTyped(0);
      setHit(0);
    };
    apply();
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, []);

  // Coming in (Ghulam, 2026-11-10: "a transition, not so sharp"): as the section rises into
  // view its indigo opens from a rounded card in the middle to the full width, and the words
  // rise in. --tm-open runs 0 to 1 over the first screen of the section.
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    let frame = 0;
    const set = () => {
      frame = 0;
      const top = el.getBoundingClientRect().top;
      const open = Math.min(1, Math.max(0, (innerHeight - top) / (innerHeight * 0.85)));
      el.style.setProperty("--tm-open", open.toFixed(3));
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(set);
    };
    set();
    addEventListener("scroll", onScroll, { passive: true });
    addEventListener("resize", onScroll);
    return () => {
      removeEventListener("scroll", onScroll);
      removeEventListener("resize", onScroll);
      cancelAnimationFrame(frame);
    };
  }, []);

  // The thread: down beside the words and sliding in under them, on down behind the stages to the
  // top middle of the screen, then out of the bottom. Two parts, as the section holds and the words don't.
  useEffect(() => {
    const holder = pin.current;
    const whole = root.current;
    if (!holder || !whole) return;
    const media = matchMedia(LINE_MEDIA);
    const measure = () => {
      // The words and screen rise in on a translate (--tm-open); measure them where they come to rest,
      // or the thread is drawn 72px too low and runs across the top of the screen.
      const rising = holder.querySelector<HTMLElement>(":scope > .tm-section");
      const was = rising?.style.translate ?? "";
      if (rising) rising.style.translate = "0 0";
      const screen = panel.current?.getBoundingClientRect();
      const title = whole.querySelector(".tm-title")?.getBoundingClientRect();
      const sub = whole.querySelector(".tm-sub")?.getBoundingClientRect();
      const tail = holder.parentElement?.nextElementSibling as HTMLElement | null;
      if (!media.matches || !screen || !title || !sub) {
        if (rising) rising.style.translate = was;
        setThread(null);
        delete whole.dataset.lineIn;
        delete whole.dataset.lineOut;
        return;
      }
      const outer = whole.getBoundingClientRect();
      const box = holder.getBoundingClientRect();
      if (rising) rising.style.translate = was;
      // Well clear of both the heading and its line, so the thread never brushes the words (Ghulam, 2026-11-10).
      const lane = Math.max(title.right, sub.right) + 96 - outer.left;
      // The page line (components/tour/page-line.tsx) brings the thread to this lane and
      // picks it up again under the screen; these tell it where, in page pixels.
      const startX = lane;
      const midX = screen.left + screen.width / 2 - box.left;
      whole.dataset.lineIn = String(Math.round(outer.left + lane));
      whole.dataset.lineOut = String(Math.round(box.left + midX));
      const textTop = title.top - outer.top;
      const textEnd = sub.bottom - outer.top;
      const pinTop = holder.parentElement!.getBoundingClientRect().top - outer.top;
      const gap = pinTop - textEnd;
      // The words now ride inside the pinned screen (above the stage), so the thread comes down
      // beside them inside the pin and turns under them to the screen's top middle.
      const inPin = holder.contains(whole.querySelector(".tm-title"));
      const screenTop = screen.top - box.top;
      const rightX = screen.right - box.left;
      const plugY = screenTop + 44;
      const elbow = Math.max(8, Math.min(56, (lane - rightX) / 2));
      setThread({
        lead: inPin
          ? `M${startX} 0V${Math.max(1, pinTop)}`
          : `M${startX} 0C${startX} ${textTop * 0.8} ${lane} ${textTop * 0.3} ${lane} ${textTop}V${textEnd}C${lane} ${textEnd + gap * 0.85} ${midX} ${pinTop - gap * 0.85} ${midX} ${pinTop}`,
        into: inPin
          ? // Down past the words, then one rounded elbow into the screen's right side at its header.
            `M${lane} 0V${plugY - elbow}Q${lane} ${plugY} ${lane - elbow} ${plugY}H${rightX}`
          : `M${midX} 0V${screenTop}`,
        out: `M${midX} ${screen.bottom - box.top}V${box.height + (tail?.offsetHeight ?? 0)}`,
      });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(whole);
    if (panel.current) observer.observe(panel.current);
    document.fonts?.ready.then(measure);
    media.addEventListener("change", measure);
    return () => {
      observer.disconnect();
      media.removeEventListener("change", measure);
    };
  }, []);

  // The scroll plays it. What moves continuously goes straight to the page; only steps go through state.
  useEffect(() => {
    const lead = lineLead.current;
    const leadDot = leadTip.current;
    const into = lineIn.current;
    const out = lineOut.current;
    const tip = lineTip.current;

    if (!scrolled) {
      pin.current?.style.removeProperty("top");
      if (lead) lead.style.strokeDashoffset = "0";
      if (leadDot) leadDot.style.visibility = "hidden";
      if (into) into.style.strokeDashoffset = "0";
      if (out) out.style.strokeDashoffset = "0";
      if (tip) tip.style.visibility = "hidden";
      stageBars.current.forEach((bar) => bar?.style.removeProperty("transform"));
      setTouched(false);
      setWheelOn(true);
      return;
    }

    const script = QUERIES[SCROLL_QUERY];
    const slice = (SEARCH_END - SEARCH_START) / script.path.length;
    let frame = 0;
    const paint = () => {
      frame = 0;
      const rail = track.current;
      const holder = pin.current;
      if (!rail || !holder) return;
      const top = rail.getBoundingClientRect().top;
      // On a phone the pin is the words plus one screen: it sticks once the words have
      // scrolled off, its top that far above the screen's (desktop: exactly one screen, 0).
      const over = Math.max(0, holder.offsetHeight - innerHeight);
      const stick = `${-over}px`;
      if (holder.style.top !== stick) holder.style.top = over ? stick : "";
      const p = clamp01((-top - over) / (rail.offsetHeight - holder.offsetHeight));

      // A question the visitor asked themselves plays on its own; the scroll still draws the thread.
      if (!pickedRef.current) {
        [
          (p - TYPE_START) / (SEARCH_START - TYPE_START),
          (p - SEARCH_START) / (ANSWER_AT - SEARCH_START),
          (p - ANSWER_AT) / (ANSWER_READ - ANSWER_AT),
        ].forEach((share, i) => {
          const bar = stageBars.current[i];
          if (bar) bar.style.transform = `translateX(${(clamp01(share) - 1) * 100}%)`;
        });

        let reached = 0;
        script.path.forEach(({ id }, i) => {
          const done = clamp01((p - SEARCH_START - i * slice) / (slice * 1.2));
          const el = litEls.current[id];
          if (el) el.style.strokeDashoffset = String(1 - done);
          if (done >= 1) reached += 1;
        });

        setTouched(p >= LINE_IN_END && p < ANSWER_AT);
        setWheelOn(p >= LINE_IN_END);
        setPhase(p < SEARCH_START ? "typing" : p < ANSWER_AT ? "search" : "answer");
        setTyped(Math.round(script.ask.length * clamp01((p - TYPE_START) / (TYPE_END - TYPE_START))));
        setHit(reached);
      }

      if (!lead || !leadDot || !into || !out || !tip) return;
      // Tip at 70% of the screen, as the launch section's line left it, until the section lands.
      const tipAt = innerHeight * 0.7;
      const whole = root.current!.getBoundingClientRect();
      const leadShare = clamp01((tipAt - whole.top) / (top - whole.top));
      const inShare = clamp01((tipAt - top) / tipAt);
      const outShare = clamp01((p - LINE_OUT_START) / (1 - LINE_OUT_START));
      lead.style.strokeDashoffset = String(1 - leadShare);
      into.style.strokeDashoffset = String(1 - inShare);
      out.style.strokeDashoffset = String(1 - outShare);

      const leadAt = lead.getPointAtLength(lead.getTotalLength() * leadShare);
      leadDot.setAttribute("cx", String(leadAt.x));
      leadDot.setAttribute("cy", String(leadAt.y));
      leadDot.style.visibility = leadShare > 0 && leadShare < 1 ? "visible" : "hidden";

      const at = outShare > 0 ? out.getPointAtLength(out.getTotalLength() * outShare) : into.getPointAtLength(into.getTotalLength() * inShare);
      tip.setAttribute("cx", String(at.x));
      tip.setAttribute("cy", String(at.y));
      // Once the line is out of the bottom, the page line's tip carries on, so this one goes.
      tip.style.visibility = outShare > 0 && outShare < 1 ? "visible" : "hidden";
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(paint);
    };
    paint();
    addEventListener("scroll", onScroll, { passive: true });
    addEventListener("resize", onScroll);
    return () => {
      removeEventListener("scroll", onScroll);
      removeEventListener("resize", onScroll);
      cancelAnimationFrame(frame);
    };
  }, [scrolled, thread]);

  useEffect(() => {
    if (!running || reduced || started.current) return;
    started.current = true;
    setPhase("typing");
    setTyped(0);
    setHit(0);
  }, [running, reduced]);

  useEffect(() => {
    if (!running || driven) return;
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
      if (hovered || picked) return;
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
  }, [running, driven, picked, hovered, reduced, q, phase, typed, hit, query]);

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
      // Whether one box sits in the way of another on the way to the screen.
      const isBetween = (other: NodeId, id: NodeId, screen: DOMRect) => {
        const a = nodeEls.current[other]?.getBoundingClientRect();
        const b = nodeEls.current[id]?.getBoundingClientRect();
        if (!a || !b || other === id) return false;
        return b.bottom <= screen.top ? a.top >= b.bottom : b.top >= screen.bottom && a.bottom <= b.top;
      };
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
          } else if (ids.some((other) => isBetween(other, id, screen))) {
            // Two rows on this side: a straight run up the gutter, then out to the box's inner
            // edge, so it never shows through the glass box in front.
            const above = el.bottom <= screen.top;
            const mid = screen.left + screen.width / 2;
            const sx = mid - box.left;
            const sy = (above ? screen.top + TUCK : screen.bottom - TUCK) - box.top;
            const ex = (el.right <= mid ? el.right : el.left) - box.left;
            const ey = el.top + el.height / 2 - box.top;
            const bend = Math.abs(ex - sx) * (above ? 1 : -1);
            next[id] = `M${sx} ${sy} L${sx} ${ey + bend} Q${sx} ${ey} ${ex} ${ey}`;
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
    <section ref={root} id="trax" className="tm-root">
    {thread && (
      <svg className="tm-way" fill="none" aria-hidden>
        {/* The line into Trax is not drawn (Ghulam, 2026-11-10): the page line stops above the section and starts again under the screen. */}
        <path ref={lineLead} className="pg-thread-live tm-unseen" pathLength={1} d={thread.lead} />
        <circle ref={leadTip} className="pg-thread-tip tm-unseen" r="5" />
      </svg>
    )}


    <div ref={track} className="tm-track" data-scroll={driven}>
    <div ref={pin} className="tm-pin">
    {/* The words ride in the pinned screen, so heading and stage share one view (Ghulam, 2026-11-10). */}
    <div className="tm-copy">
      <SectionHeading
        titleClassName="tm-title"
        subClassName="tm-sub"
        title={
          <>
            I&apos;m Trax. <Accent>Just ask.</Accent>
          </>
        }
        sub={
          <>
            I&apos;m built into Drive247. I check your rentals, payments and fleet, then answer from your own records.
          </>
        }
      />
    </div>
    {/* The "You ask / I check your records / You get the answer" step bar was here; removed (Ghulam, 2026-11-10). */}

    <div ref={section} className="tm-section" data-seen={seen}>
      <div
        ref={stage}
        className="tm-stage"
        data-phase={phase}
        role="img"
        aria-label="A question goes into Trax, which checks rentals, customers, fleet, maintenance, payments, invoices, deposits and expenses, then answers from what it finds."
      >
        {/*
          * A rental business turns on its wheels: Trax is the hub, the business is on the
          * spokes. It rolls all the time and speeds up while Trax is searching.
          */}
        <i ref={wheel} className="tm-wheel" data-running={running && wheelOn} aria-hidden />

        <svg className="tm-wires" data-scroll={driven} data-idle={driven && phase === "typing"} width={size.width} height={size.height} viewBox={`0 0 ${size.width || 1} ${size.height || 1}`} aria-hidden>
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
          {(driven ? query.path : visited).map(({ id }) => (
            <path
              key={`${q}-${id}`}
              ref={(el) => {
                litEls.current[id] = el;
              }}
              d={paths[id]}
              pathLength={1}
              className="tm-wire-lit"
              stroke="url(#tm-iris)"
            />
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
          data-thinking={thinking || touched}
          // A mouse only: on touch a tap would count as a hover and stop the loop until the next tap elsewhere.
          onPointerEnter={(e) => e.pointerType === "mouse" && setHovered(true)}
          onPointerLeave={() => setHovered(false)}
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
                          {query.answer.list && (
                            <ul className="tm-list">
                              {query.answer.list.map((row, i) => (
                                <li key={`${row.label}-${i}`} className={reduced ? undefined : "tm-in"} style={{ animationDelay: `${400 + i * 90}ms` }}>
                                  <b>{row.label}</b>
                                  <span>{row.value}</span>
                                </li>
                              ))}
                            </ul>
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

      {/* The "Ask Trax about" topic bar was here; removed (Ghulam, 2026-11-10). */}
    </div>

    {thread && (
      <svg className="tm-way" fill="none" aria-hidden>
        <path ref={lineIn} className="pg-thread-live tm-unseen" pathLength={1} d={thread.into} />
        <path className="pg-thread-rest" d={thread.out} />
        <path ref={lineOut} className="pg-thread-live" pathLength={1} d={thread.out} />
        <circle ref={lineTip} className="pg-thread-tip" r="5" />
      </svg>
    )}
    </div>
    {/* Phones: the scrolling the pinned stage plays over (trax-section.css). */}
    <div className="tm-run" aria-hidden />
    </div>
    <div className="tm-tail" aria-hidden />
    </section>
  );
}
