import { createLucideIcon, CalendarDays, ChevronLeft, ChevronRight, CircleSlash, Filter, List, ListFilter, Search, User } from "lucide-react";
import "./calendar.css";

/* ===================================================================== *
 * Bookings calendar — /rentals?view=calendar for a v2 tenant.
 *
 * Mirrors, in the portal:
 *   app/(dashboard)/layout.tsx           — `isRentalsCalendarV2`: this view is
 *                                          FULL SCREEN, no app sidebar and no
 *                                          top bar (so no <PortalShell> here)
 *   components/rentals-v2/rentals-list-v2.tsx — page header hidden from md up,
 *                                          renders <ConnectedTimeline fill onExit>
 *   components/timeline-v2/connected-timeline.tsx — "Pricing & tools" + "List
 *                                          view" actions, edge-to-edge fill box
 *   components/timeline-v2/timeline-board.tsx, date-grid.tsx, model.ts
 *   components/timeline-v2/timeline.css  — incl. the `.tl-fill` toolbar grid
 *   components/ui-v2/button.tsx          — outline / ghost, sm and icon-sm
 *   components/ui/steering-wheel.tsx     — the Vehicle perspective icon
 *   lib/calendar-utils.ts getStatusColor — endpoint dot colours (*-700)
 *   styles/v2-theme.css                  — tokens (#442DD7 primary, Manrope)
 *
 * The window is the board's default: today − 2 for 14 days ("2 weeks").
 * Rows come back ordered by rental id, and rental numbers are 'R-' + the first
 * six hex digits of that id, so the rows read in rental-number order, not by
 * date. Bookings are demo data in the real formats.
 * ===================================================================== */

const SteeringWheel = createLucideIcon("SteeringWheel", [
  ["circle", { cx: "12", cy: "12", r: "10", key: "rim" }],
  ["circle", { cx: "12", cy: "12", r: "2.5", key: "hub" }],
  ["path", { d: "M12 14.5V22M9.5 12H2M14.5 12H22", key: "spokes" }],
]);

/** Sun 18 Oct 2026 → Sat 31 Oct 2026; today is Tue 20 Oct. */
const START = 18;
const DAYS = 14;
const TODAY = 2;
const WD = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** getStatusColor(status).text — tailwind *-700. */
const DOT = { Active: "#047857", Upcoming: "#0e7490", Pending: "#b45309", Completed: "#6d28d9", Cancelled: "#be123c" } as const;
type Status = keyof typeof DOT;

/** [rental number, status, start (Oct day, fraction = pickup time), end (Oct day, fraction = return time)]. */
const BOOKINGS: [string, Status, number, number][] = [
  ["R-0b4e17", "Active", 15 + 10 / 24, 22 + 10 / 24],
  ["R-1f93a2", "Upcoming", 23 + 9 / 24, 27 + 18 / 24],
  ["R-2c07d9", "Completed", 16 + 9 / 24, 19 + 17 / 24],
  ["R-3a61f0", "Pending", 22 + 12 / 24, 25 + 12 / 24],
  ["R-4d28b5", "Active", 19 + 8.5 / 24, 24 + 8.5 / 24],
  ["R-5e9c43", "Upcoming", 28 + 10 / 24, 35 + 10 / 24],
  ["R-7b15e8", "Cancelled", 24, 27],
  ["R-8f40c6", "Active", 17 + 14 / 24, 21 + 14 / 24],
  ["R-a3d7e2", "Upcoming", 21 + 16 / 24, 23 + 10 / 24],
  ["R-c6e0b1", "Pending", 26 + 9 / 24, 29 + 9 / 24],
  ["R-e2f84d", "Upcoming", 30 + 11 / 24, 33 + 11 / 24],
];

/** A vehicle's blocked dates: whole days, Oct 27 – Oct 29. */
const BLOCK = { label: "Toyota Camry", from: 27 - START, to: 29 + 1 - START };

const days = Array.from({ length: DAYS }, (_, i) => ({ wd: WD[i % 7], n: START + i, we: i % 7 === 0 || i % 7 === 6 }));

function Cells() {
  return (
    <div className="cells">
      {days.map((d) => (
        <div key={d.n} className={`cell${d.we ? " we" : ""}`} />
      ))}
    </div>
  );
}

export function CalendarScreen() {
  return (
    <section className="scr-cal">
      <div className="tb">
        <h3>Booking calendar</h3>
        <div className="acts">
          <span className="btn ghost">Pricing &amp; tools</span>
          <span className="btn">
            <List />
            List view
          </span>
        </div>
        <div className="persp">
          <span className="on">
            <ListFilter />
            Rental
          </span>
          <span>
            <SteeringWheel />
            Vehicle
          </span>
          <span>
            <User />
            Customer
          </span>
        </div>
        <label className="srch">
          <Search />
          <span>Search rentals…</span>
        </label>
        <span className="btn filters">
          <Filter />
          Filters
        </span>
        <span className="btn block">
          <CircleSlash />
          Block dates
        </span>
        <div className="pnav">
          <span className="btn sq">
            <ChevronLeft />
          </span>
          <span className="btn">Today</span>
          <span className="btn sq">
            <ChevronRight />
          </span>
        </div>
        <span className="range">
          Oct 18 <span>—</span> Oct 31, 2026
          <CalendarDays />
        </span>
        <div className="periods">
          <span>Week</span>
          <span className="on">2 weeks</span>
          <span>Month</span>
        </div>
      </div>

      <div className="meta">
        <span>
          <i />
          {BOOKINGS.length} bookings in view
        </span>
        <span>America/New_York</span>
      </div>

      <div className="scroll">
        <div className="gh">
          <div className="idn idh">
            Rental<small>Oct 2026</small>
          </div>
          <div className="dates">
            {days.map((d, i) => (
              <div key={d.n} className={`date${d.we ? " we" : ""}${i === TODAY ? " today" : ""}`}>
                <span>{i === TODAY ? "Today" : d.wd}</span>
                <strong>{d.n}</strong>
              </div>
            ))}
          </div>
        </div>
        <div className="gb">
          {BOOKINGS.map(([num, status, s, e]) => {
            const from = Math.max(s - START, 0),
              to = Math.min(e - START, DAYS);
            const before = s - START < 0,
              after = e - START > DAYS;
            return (
              <div key={num} className="row">
                <div className="idn">
                  <div>
                    <strong>{num}</strong>
                    <small>{status}</small>
                  </div>
                </div>
                <div className="rd">
                  <Cells />
                  <span
                    className={`bk${status === "Cancelled" ? " dash" : ""}`}
                    style={{ left: `calc(100% / ${DAYS} * ${from})`, width: `calc(100% / ${DAYS} * ${to - from})`, ["--dot" as string]: DOT[status] }}
                  >
                    <span className="stroke" />
                    {before ? <ChevronLeft className="ep s cont" /> : <span className="ep s dot" />}
                    {after ? <ChevronRight className="ep e cont" /> : <span className="ep e dot" />}
                  </span>
                </div>
              </div>
            );
          })}
          <div className="row">
            <div className="idn">
              <div>
                <strong>{BLOCK.label}</strong>
                <small>Blocked dates</small>
              </div>
            </div>
            <div className="rd">
              <Cells />
              <span className="blk" style={{ left: `calc(100% / ${DAYS} * ${BLOCK.from})`, width: `calc(100% / ${DAYS} * ${BLOCK.to - BLOCK.from})` }}>
                <span>
                  <CircleSlash />
                </span>
              </span>
            </div>
          </div>
          <div className="row filler">
            <div className="idn" />
            <div className="rd">
              <Cells />
            </div>
          </div>
          <div className="track">
            <div className="now" style={{ left: `calc(100% / ${DAYS} * ${TODAY + 0.5})` }} />
          </div>
        </div>
      </div>

      <div className="foot">
        <span>
          <i className="ln" />
          Booking
          <i className="bx" />
          Blocked
        </span>
        <span>Select a date for its bookings · Select a line for details</span>
      </div>
    </section>
  );
}
