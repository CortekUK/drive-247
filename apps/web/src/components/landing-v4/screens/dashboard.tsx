import { AlarmClock, ArrowRight, ArrowUpRight, Check, CornerDownRight, GripHorizontal, Info, Maximize2, MoreVertical, Plus, Sparkles } from "lucide-react";
import { Fragment } from "react";
import { PortalShell } from "../screens";
import "./dashboard.css";

/* ===================================================================== *
 * Dashboard — the portal home (/) for a v2 tenant's head_admin, at the
 * 1280 × 800 window, before any scrolling.
 *
 * Mirrors, in apps/portal/src:
 *   app/(dashboard)/page.tsx                      `if (v2) return <DashboardV2 />`
 *   app/(dashboard)/layout.tsx                    <main>: p-4, pt-0 under the bar,
 *                                                 first child -mt-3.5, scrolls
 *   components/dashboard-v2/dashboard-v2.tsx      root (px-2 pb-4, space-y-10 →
 *                                                 the `.pv` column sits 40px down),
 *                                                 no banners in the normal state
 *   components/dashboard-v2/home/home-bands.tsx   first screen = calc(100% − 70px):
 *                                                 revenue row (-mt-15px) then the
 *                                                 three cards (gap 30, -mb-35px);
 *                                                 Insights row 65px below, peeking
 *   components/dashboard-v2/home/revenue-line-card.tsx  ⋮ menu, headline, caption + (i),
 *                                                 running total, ghost, forecast, pulse
 *   components/announcements/feature-announcement-deck.tsx  the feature card,
 *                                                 variant="accent" (ACCENT_UI over
 *                                                 FEATURE_CARD_UI in lib/announcements/contract.ts)
 *   components/dashboard-v2/home/admin-cards.tsx  TraxBriefCard
 *   components/dashboard-v2/home/requests-card.tsx      RequestsCard, RequestRow, Avatar
 *   components/dashboard-v2/home/todo-card.tsx    TodoCard, TodoItem, whenLabel, sort
 *   components/dashboard-v2/home/sortable-cards.tsx     CardGrip
 *   components/dashboard-v2/home/expand-button.tsx      ExpandButton
 *   components/dashboard-v2/home/busy-days-card.tsx     header (the part that peeks in)
 *   components/dashboard-v2/home/booking-sources-card.tsx  header (ditto)
 *   components/dashboard-v2/home/ui.tsx           Eyebrow, HOME_PALETTE (.pv tokens)
 *   components/dashboard-v2/home/mock.ts          buildDemoRequests, buildDemoTodos,
 *                                                 buildDemoBookingSources, FLOW
 *   hooks/use-business-brief.ts                   the Trax brief's sentences, verbatim
 *   hooks/use-dashboard-revenue-series.ts         running total / previous / forecast
 *   components/trax/trax-greeting.tsx             TraxMark xs (static once typed)
 *   components/shared/layout/search-trax-brief.tsx  Emphasis (figures in bold)
 *
 * State shown: the populated dashboard — sample requests, to-dos and insights
 * are ON by default in the portal (mock.ts), the feature card is showing
 * (deskFeature 'deck': the super admin has active features targeted at the
 * tenant, as the live northwind portal does), the brief has finished typing,
 * nothing hovered.
 * "Now" is Tue 20 Oct 2026, 09:14 (mock.ts freezes the clock at 09:14; the
 * date matches the calendar screen). The revenue series has no portal mock,
 * so it is a deterministic demo month run through the hook's arithmetic.
 * ===================================================================== */

/* ── Revenue: useDashboardRevenueSeries('30d'), Mon 21 Sep → Tue 20 Oct ── */

/** Net collected per day — lumpy, the way rental money arrives. Sums to $18,420. */
const DAILY = [420, 0, 1640, 260, 0, 380, 940, 0, 610, 1820, 180, 0, 520, 860, 0, 1980, 240, 390, 0, 720, 1100, 0, 310, 980, 450, 0, 1760, 560, 840, 1460];
/** The 30 days before, re-keyed by position (the dashed ghost). */
const PREV_DAILY = [310, 0, 860, 0, 420, 990, 0, 240, 1150, 0, 380, 620, 0, 1240, 260, 0, 870, 410, 0, 1320, 0, 560, 930, 0, 340, 1090, 0, 620, 480, 1010];
/** Charges on the ledger falling due over the next 7 days (the dotted forecast). */
const DUE_NEXT_7 = [0, 640, 380, 0, 920, 210, 450];

const runningTotal = (xs: number[]) => xs.reduce<number[]>((acc, v) => [...acc, (acc[acc.length - 1] ?? 0) + v], []);
const TOTAL = runningTotal(DAILY);
const PREVIOUS = runningTotal(PREV_DAILY);
const FORECAST = runningTotal([TOTAL[TOTAL.length - 1], ...DUE_NEXT_7]); // index 29 … 36
const REVENUE = TOTAL[TOTAL.length - 1]; // 18,420
const THIS_MONTH = DAILY.slice(10).reduce((s, v) => s + v, 0); // 1 – 20 Oct

const money = (n: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(n);

/*
 * ResponsiveContainer at what the feature card leaves of the row (976 − 320 −
 * gap 20 = 636px) and the card's leftover height: 240 − header 32 − headline block 66 − pt-1 = 138.
 * ComposedChart margin { top 14, right 8, bottom 0, left 0 }; the XAxis keeps its
 * default 30px band; the hidden YAxis takes no room and its domain is
 * [0, dataMax × 1.08] (a function domain is never "niced" in recharts 2.15).
 * 37 categories on a point scale: 30 actual days + 7 forecast days.
 */
const CW = 636;
const CH = 138;
const PLOT = { left: 0, right: CW - 8, top: 14, bottom: CH - 30 };
const N = 37;
const Y_MAX = Math.max(...TOTAL, ...PREVIOUS, ...FORECAST) * 1.08;
const r2 = (v: number) => Math.round(v * 100) / 100;
const px = (i: number) => r2(PLOT.left + (i / (N - 1)) * (PLOT.right - PLOT.left));
const py = (v: number) => r2(PLOT.top + (1 - v / Y_MAX) * (PLOT.bottom - PLOT.top));

/** Recharts `type="monotone"` is d3's curveMonotoneX; the same maths, as a path. */
function monotoneX(pts: [number, number][]) {
  const n = pts.length;
  const x = pts.map((p) => p[0]);
  const y = pts.map((p) => p[1]);
  const sign = (v: number) => (v < 0 ? -1 : 1);
  const t = new Array<number>(n).fill(0);
  for (let i = 1; i < n - 1; i++) {
    const h0 = x[i] - x[i - 1];
    const h1 = x[i + 1] - x[i];
    const s0 = (y[i] - y[i - 1]) / h0;
    const s1 = (y[i + 1] - y[i]) / h1;
    const p = (s0 * h1 + s1 * h0) / (h0 + h1);
    t[i] = (sign(s0) + sign(s1)) * Math.min(Math.abs(s0), Math.abs(s1), 0.5 * Math.abs(p)) || 0;
  }
  t[0] = (3 * (y[1] - y[0])) / (x[1] - x[0]) / 2 - t[1] / 2;
  t[n - 1] = (3 * (y[n - 1] - y[n - 2])) / (x[n - 1] - x[n - 2]) / 2 - t[n - 2] / 2;
  let d = `M${r2(x[0])},${r2(y[0])}`;
  for (let i = 0; i < n - 1; i++) {
    const dx = (x[i + 1] - x[i]) / 3;
    d += `C${r2(x[i] + dx)},${r2(y[i] + dx * t[i])},${r2(x[i + 1] - dx)},${r2(y[i + 1] - dx * t[i + 1])},${r2(x[i + 1])},${r2(y[i + 1])}`;
  }
  return d;
}

const P_TOTAL = TOTAL.map((v, i) => [px(i), py(v)] as [number, number]);
const PATH_TOTAL = monotoneX(P_TOTAL);
const PATH_AREA = `${PATH_TOTAL}L${px(29)},${py(0)}L${px(0)},${py(0)}Z`;
const PATH_PREVIOUS = monotoneX(PREVIOUS.map((v, i) => [px(i), py(v)]));
const PATH_FORECAST = monotoneX(FORECAST.map((v, k) => [px(29 + k), py(v)]));
const TODAY_PT = P_TOTAL[29];

/*
 * XAxis ticks: "d MMM", minTickGap 48, interval preserveEnd — recharts 2.15's
 * getTicksEnd run over every label's measured width at 10.5px Manrope (24.8 –
 * 33px). It walks back from the last forecast day (27 Oct, nudged left by half
 * its 31px width to sit inside the plot) and keeps each label that clears the
 * one after it by 48px, which leaves these seven.
 */
const DAY0 = Date.UTC(2026, 8, 21); // 21 Sep 2026
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const dayLabel = (i: number) => {
  const d = new Date(DAY0 + i * 86_400_000);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
};
const TICKS = [5, 10, 15, 20, 25, 30, 36];
const LAST_TICK_SHIFT = 15.49; // half the "27 Oct" label

function RevenueLine() {
  return (
    <div className="db-rev">
      <header className="db-rev-head">
        <span aria-hidden="true" />
        <span className="db-rev-menu">
          <MoreVertical strokeWidth={2.25} />
        </span>
      </header>
      <div className="db-rev-figure">
        <span className="db-rev-big">{money(REVENUE)}</span>
        <p className="db-rev-cap">
          last 30 days
          <span className="db-rev-info">
            <Info strokeWidth={2.25} />
          </span>
        </p>
      </div>
      <div className="db-rev-chart">
        <svg width="100%" height={CH} viewBox={`0 0 ${CW} ${CH}`} role="img" aria-label="Revenue, last 30 days">
          <defs>
            <linearGradient id="db-rev-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="currentColor" stopOpacity={0.28} />
              <stop offset="70%" stopColor="currentColor" stopOpacity={0.06} />
              <stop offset="100%" stopColor="currentColor" stopOpacity={0} />
            </linearGradient>
          </defs>
          {TICKS.map((i) => (
            <text key={i} className="db-rev-tick" x={i === N - 1 ? r2(px(i) - LAST_TICK_SHIFT) : px(i)} y={CH - 30 + 12} dy="0.71em" textAnchor="middle">
              {dayLabel(i)}
            </text>
          ))}
          <path d={PATH_PREVIOUS} fill="none" stroke="#737373" strokeOpacity={0.45} strokeWidth={1.5} strokeDasharray="4 4" />
          <path d={PATH_FORECAST} fill="none" stroke="currentColor" strokeOpacity={0.7} strokeWidth={2} strokeDasharray="1 5" strokeLinecap="round" />
          <path d={PATH_AREA} fill="url(#db-rev-fill)" />
          <path className="db-rev-curve" d={PATH_TOTAL} fill="none" stroke="currentColor" strokeWidth={2.25} />
          <circle className="db-rev-ping" cx={TODAY_PT[0]} cy={TODAY_PT[1]} r={7} fill="currentColor" fillOpacity={0.25} />
          <circle cx={TODAY_PT[0]} cy={TODAY_PT[1]} r={4} fill="currentColor" stroke="#fff" strokeWidth={2} />
          <text className="db-rev-pt" x={r2(TODAY_PT[0] - 10)} y={r2(TODAY_PT[1] - 12)} textAnchor="end">
            {money(REVENUE)}
          </text>
        </svg>
      </div>
    </div>
  );
}

/* ── The feature card: FeatureAnnouncementDeck variant="accent" ───────────
 *
 * Its content is not the portal's: it is the super admin's Announcements page,
 * Features tab (`portal_announcements`, kind feature), read through
 * usePortalAnnouncements().features — every active feature targeted at the
 * tenant, in the admin's drag order. Shown as the live northwind portal shows
 * it: three features, the third ("Lockbox handover") on screen. The art is
 * that feature's image_url (a transparent 1280 × 960 PNG in Supabase storage,
 * per ILLUSTRATION_GUIDE.md 4b), redrawn here as SVG: a keypad lockbox, a key
 * whose ring carries the accent dot, and a soft grey shadow.
 */
const DECK_COUNT = 3;
const DECK_ACTIVE = 2;

function LockboxArt() {
  return (
    <svg className="db-feat-art" viewBox="0 0 320 230" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      <ellipse cx="247.5" cy="159.5" rx="49.5" ry="3.4" fill="#111114" fillOpacity={0.07} />
      {/* the key, its shaft running in under the box */}
      <path d="M188.6 112.2 L214 102.4" stroke="#111114" strokeWidth={1.4} strokeLinecap="round" />
      <path d="M203.2 106.6 l1.3 3.6 M206.6 105.3 l1.3 3.6" stroke="#111114" strokeWidth={1.2} strokeLinecap="round" />
      <circle cx="179.7" cy="113.6" r="9.2" fill="#fff" stroke="#111114" strokeWidth={1.4} />
      <circle cx="179.7" cy="113.6" r="2.8" fill="#5b5bd6" />
      {/* shackle, then the box */}
      <path d="M232.6 64 V54.5 a8 8 0 0 1 8 -8 h12 a8 8 0 0 1 8 8 V64" fill="none" stroke="#111114" strokeWidth={4.6} />
      <rect x="210.3" y="62.3" width="74" height="88" rx="8.5" fill="#fff" stroke="#111114" strokeWidth={1.4} />
      <rect x="218.2" y="72" width="57" height="16" rx="3.5" fill="#16161c" />
      {[230.4, 241.4, 252.5].map((cx) => (
        <circle key={cx} cx={cx} cy="80" r="2.2" fill="#5b5bd6" />
      ))}
      <circle cx="263.2" cy="80" r="2.2" fill="#55555c" />
      {[96, 111.4, 126.4].map((y) =>
        [221.8, 240.8, 259.4].map((x) => <rect key={`${x}-${y}`} x={x} y={y} width="12.8" height="9.7" rx="2.6" fill="#e5e5e8" />),
      )}
    </svg>
  );
}

function FeatureCard() {
  return (
    <section className="db-feat" aria-roledescription="carousel" aria-label="What's new">
      <span className="db-feat-slide">
        <LockboxArt />
        <span className="db-feat-body">
          <span className="db-feat-title">
            Lockbox
            <br />
            handover
          </span>
          <span className="db-feat-foot">
            <span className="db-feat-sum">Customers collect the keys with a code.</span>
            <span className="db-feat-more">
              See how it works
              <ArrowRight strokeWidth={2} />
            </span>
          </span>
        </span>
      </span>
      <span className="db-feat-dots">
        {Array.from({ length: DECK_COUNT }, (_, i) => (
          <span key={i} className="db-feat-dotb">
            <span className={i === DECK_ACTIVE ? "on" : undefined} />
          </span>
        ))}
      </span>
    </section>
  );
}

/* ── Shared card parts ─────────────────────────────────────────────────── */

const Eyebrow = ({ children }: { children: string }) => <span className="db-eb">{children}</span>;

/** sortable-cards.tsx CardGrip: size-7, GripHorizontal size-3.5 / 2.25. */
const Grip = () => (
  <span className="db-grip">
    <GripHorizontal strokeWidth={2.25} />
  </span>
);

/** expand-button.tsx: -mr-2 size-7, Maximize2 size-3.5 / 2.25. */
const Expand = () => (
  <span className="db-expand">
    <Maximize2 strokeWidth={2.25} />
  </span>
);

/* ── 1 · Trax: useBusinessBrief, worded exactly as the hook words it ───── */

/*
 * Built from the same demo day as the other two cards: two cars overdue
 * (Camille's Volvo is the to-do at the top of the list), today's FLOW in
 * mock.ts (4 out, 3 back; "Unsigned" and "ID pending" block two pickups),
 * four booking requests in the Requests card, an 18-car fleet (busy-days demo)
 * and October's takings from the chart above.
 */
const BRIEF = {
  headline: "Morning, Maya. 2 cars still haven’t come back, so I’d start there.",
  points: [
    "Camille Duval is the one I’m most worried about, 18 days past the return date now.",
    "Noah Kim is also still out past their date.",
    "Heads up: 2 of today’s pickups aren’t ready to go yet.",
    "We’re still waiting on $1,240 across 1 overdue payment.",
    "4 booking requests have come in and are waiting on your okay.",
    "On the diary today: 4 cars go out and 3 come back.",
    "11 rentals are on the road, so 61% of the fleet is earning right now.",
    `We’ve brought in ${money(THIS_MONTH)} so far this month.`,
  ],
  suggestions: ["Tell me more", "What first?", "Who owes most?"],
};
/** The card shows as many whole points as fit above the chips; the rest are `visibility: hidden`. */
const BRIEF_FITS = 4;

/** search-trax-brief.tsx Emphasis: every figure in bold. */
const FIGURE = /(?<![\w])((?:[£$€])?\d[\d,]*(?:\.\d+)?%?)(?![\w])/g;
const Emphasis = ({ text }: { text: string }) => (
  <>{text.split(FIGURE).map((part, i) => (i % 2 === 1 ? <strong key={i}>{part}</strong> : <Fragment key={i}>{part}</Fragment>))}</>
);

function TraxCard() {
  return (
    <div className="db-card db-trax">
      <span className="db-trax-wash" aria-hidden="true" />
      <header className="db-trax-head">
        {/* TraxMark size="xs", not animated once the verdict has typed out */}
        <span className="trax-dot" aria-hidden="true">
          <span className="lift">
            <span className="cone" />
          </span>
          <Sparkles strokeWidth={2} />
        </span>
        <Eyebrow>Your business today</Eyebrow>
        <span className="db-trax-acts">
          <Grip />
          <ArrowUpRight className="db-trax-go" strokeWidth={2.5} />
        </span>
      </header>
      <div className="db-trax-body">
        <p className="db-trax-hl">{BRIEF.headline}</p>
        <div className="db-trax-fit">
          <ul>
            {BRIEF.points.map((p, i) => (
              <li key={p} style={i < BRIEF_FITS ? undefined : { visibility: "hidden" }}>
                <span className="dot" aria-hidden="true" />
                <span>
                  <Emphasis text={p} />
                </span>
              </li>
            ))}
          </ul>
        </div>
        <div className="db-trax-chips">
          {BRIEF.suggestions.map((s) => (
            <span key={s} className="db-chip">
              <CornerDownRight aria-hidden="true" />
              <span className="t">{s}</span>
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ── 2 · Requests: buildDemoRequests(now), newest first ────────────────── */

type Kind = "booking" | "extension" | "cancellation";
const KIND_LABEL: Record<Kind, string> = { booking: "Booking", extension: "Extension", cancellation: "Cancellation" };

/*
 * The first seven of the twelve (the card shows five and a half; the rest
 * scroll). The portal's demo faces are randomuser.me portraits; these use the
 * landing's own stock portraits, matched one for one. `photo: null` rows get
 * the Google-style initial, coloured by colourFor(customerId) — Priya Nair is
 * demo-customer-5, which hashes to #5b5bd6. Waits are formatDistanceToNowStrict
 * (floored) of 12, 38, 95, 140, 210, 320 and 460 minutes.
 */
const REQUESTS: { name: string; kind: Kind; ask: string; wait: string; photo: string | null; colour?: string }[] = [
  { name: "Sophia Martinez", kind: "booking", ask: "Wants the Tesla Model Y · Thu 22 Oct – Mon 26 Oct", wait: "12m", photo: "/landing-v3/avatars/a1.webp" },
  { name: "James Carter", kind: "extension", ask: "Keep the BMW 3 Series until Sat 24 Oct", wait: "38m", photo: "/landing-v3/avatars/a2.webp" },
  { name: "Aisha Rahman", kind: "cancellation", ask: "Cancel the Audi Q5 · “Flight got cancelled”", wait: "1h", photo: "/landing-v2/people/person-3.jpg" },
  { name: "Daniel Okafor", kind: "booking", ask: "Wants the Jeep Wrangler · Sun 25 Oct – Sun 1 Nov", wait: "2h", photo: "/landing-v3/avatars/a4.webp" },
  { name: "Priya Nair", kind: "extension", ask: "Keep the Honda Civic until Fri 23 Oct", wait: "3h", photo: null, colour: "#5b5bd6" },
  { name: "Lucas Grey", kind: "booking", ask: "Wants the Ford Mustang · Thu 29 Oct – Sat 31 Oct", wait: "5h", photo: "/landing-v3/avatars/a6.webp" },
  { name: "Emma Stone", kind: "cancellation", ask: "Cancel the Mazda CX-5 · “Found a closer pickup”", wait: "7h", photo: "/landing-v3/avatars/a3.webp" },
];

function RequestsCard() {
  return (
    <div className="db-card db-req">
      <header className="db-head">
        <Eyebrow>Requests</Eyebrow>
        <span className="db-acts">
          <Grip />
          <Expand />
        </span>
      </header>
      <div className="db-req-list">
        <ul>
          {REQUESTS.map((r) => (
            <li key={r.name}>
              <span className="db-req-row">
                {r.photo ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img className="db-av" src={r.photo} alt="" />
                ) : (
                  <span className="db-av db-av-ini" style={{ background: r.colour }} aria-hidden="true">
                    {r.name[0]}
                  </span>
                )}
                <span className="db-req-txt">
                  <span className="db-req-top">
                    <span className="nm">{r.name}</span>
                    <span className={`db-kind ${r.kind}`}>{KIND_LABEL[r.kind]}</span>
                  </span>
                  <span className="db-req-ask">{r.ask}</span>
                </span>
                <span className="db-req-wait">{r.wait}</span>
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

/* ── 3 · To do: buildDemoTodos(now), in sortLikeTheHook order ─────────── */

/*
 * whenLabel at 09:14 on Tue 20 Oct: now − 150m and now − 40m have passed (red),
 * now + 75m and now + 210m are later today, then tomorrow 9:30 and Mon 26 Oct
 * 10:00; untimed newest first; the two done items last.
 */
const TODOS: { text: string; when?: string; overdue?: boolean; done?: boolean }[] = [
  { text: "Call Camille about the Volvo, 18 days late", when: "6:44 AM", overdue: true },
  { text: "Chase the $1,240 payment from Marco Rossi", when: "8:34 AM", overdue: true },
  { text: "Check the Tesla Model 3 in for Olivia at 2:30", when: "10:29 AM" },
  { text: "Get the Jeep washed before the weekend booking", when: "12:44 PM" },
  { text: "Renew insurance on the Ford Mustang", when: "Tomorrow 9:30 AM" },
  { text: "Send new-season prices to repeat customers", when: "Mon 26 Oct, 10:00 AM" },
  { text: "Book the Kia Sportage in for a service" },
  { text: "Reply to the Google review from last week" },
  { text: "Order a spare key for the Honda Civic" },
  { text: "Top up the lockbox codes for Friday", done: true },
  { text: "Approve Sophia Martinez’s Tesla booking", done: true },
];

function TodoCard() {
  return (
    <div className="db-card db-todo">
      <header className="db-head">
        <Eyebrow>To do</Eyebrow>
        <span className="db-acts">
          <Grip />
          <Expand />
        </span>
      </header>
      <div className="db-todo-add">
        <span className="db-todo-field">
          <Plus className="p" strokeWidth={2.5} />
          <span className="ph">Add a to-do</span>
          <AlarmClock className="a" strokeWidth={2.25} />
        </span>
      </div>
      <div className="db-todo-list">
        <ul>
          {TODOS.map((t) => (
            <li key={t.text}>
              <span className="db-todo-row">
                <span className={`db-tick${t.done ? " done" : t.overdue ? " late" : ""}`}>
                  <Check strokeWidth={3.5} />
                </span>
                <span className="db-todo-main">
                  <span className={`db-todo-text${t.done ? " done" : ""}`}>
                    <span className="s">{t.text}</span>
                  </span>
                  {t.when && <span className={`db-when${t.overdue ? " late" : ""}`}>{t.when}</span>}
                </span>
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

/* ── Below the fold: the Insights row's top edge peeks in ──────────────── */

const BUSY_SCALE = [0, 0.25, 0.5, 0.75, 1].map((s) => Math.round(6 + s * 88));

function InsightsPeek() {
  return (
    <section className="db-insights" aria-label="Insights">
      <div className="db-card db-busy">
        <div className="db-ins-head">
          <div>
            <Eyebrow>Busy days</Eyebrow>
            <p>How much of the fleet was out, day by day</p>
          </div>
          <div className="db-scale">
            Quiet
            {BUSY_SCALE.map((pct) => (
              <span key={pct} style={{ background: `color-mix(in srgb, #442dd7 ${pct}%, #fff)` }} />
            ))}
            Busy
          </div>
        </div>
      </div>
      <div className="db-card db-src">
        <div className="db-ins-head">
          <div>
            <Eyebrow>Where bookings come from</Eyebrow>
            <p>The last 90 days</p>
          </div>
          <div className="db-src-total">
            <p className="n">95</p>
            <p className="l">bookings</p>
          </div>
        </div>
      </div>
    </section>
  );
}

export function DashboardScreen() {
  return (
    <PortalShell active="Dashboard">
      <div className="scr-dash">
        <div className="db-pv">
          <div className="db-bands">
            <div className="db-first">
              <section className="db-desk" aria-label="On your desk">
                <RevenueLine />
                <FeatureCard />
              </section>
              <section className="db-ops" aria-label="Operations">
                <TraxCard />
                <RequestsCard />
                <TodoCard />
              </section>
            </div>
            <InsightsPeek />
          </div>
        </div>
      </div>
    </PortalShell>
  );
}
