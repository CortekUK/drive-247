import {
  DASH_NAV, DASH_STATS, DASH_TOP_VEHICLES, DASH_TREND, FLEET_SHOWCASE, OUTCOMES,
} from "./data";
import { Icon, Wordmark } from "./icons";

/* ========================================================================== */
/* DASHBOARD SHOWCASE                                                         */
/* ========================================================================== */

export function DashboardShowcase() {
  return (
    <section className="bv2-wrap bv2-rule py-14">
      <div className="grid items-center gap-10 lg:grid-cols-[minmax(0,.34fr)_minmax(0,.66fr)] lg:gap-14">
        <div>
          <p className="bv2-eyebrow">Real-time control</p>
          <h2 className="bv2-serif bv2-h2 mt-4">Your operation,<br />at a glance.</h2>
          <p className="bv2-body mt-4 max-w-[17rem]">
            A modern dashboard that brings your business into focus.
          </p>
          <a href="#top" className="bv2-link mt-6">
            Explore dashboard <Icon name="arrow" className="h-3.5 w-3.5" />
          </a>
        </div>

        <DashboardMock />
      </div>
    </section>
  );
}

function DashboardMock() {
  const max = Math.max(...DASH_TREND);
  /* One polyline across a 100x40 viewBox, scaled to the series' own peak. */
  const points = DASH_TREND
    .map((v, i) => `${(i / (DASH_TREND.length - 1)) * 100},${40 - (v / max) * 34}`)
    .join(" ");

  return (
    <div className="bv2-card overflow-hidden shadow-[var(--shadow)]">
      <div className="grid grid-cols-[110px_minmax(0,1fr)] sm:grid-cols-[132px_minmax(0,1fr)]">
        {/* ---------------------------------------------------- sidebar */}
        <aside className="border-r border-[var(--line-2)] p-3.5">
          <Wordmark className="text-[10.5px]" />
          <nav className="mt-5 flex flex-col gap-0.5">
            {DASH_NAV.map((item, i) => (
              <span key={item}
                className={`flex items-center gap-2 px-2 py-1.5 text-[9.5px] ${
                  i === 0 ? "bg-[var(--wash)] font-medium text-[var(--ink)]" : "text-[var(--muted)]"}`}>
                <Icon
                  name={["chart", "calendar", "car", "users", "card", "doc", "settings"][i] ?? "grid"}
                  className={`h-3 w-3 ${i === 0 ? "text-[var(--red)]" : ""}`} />
                {item}
              </span>
            ))}
          </nav>
        </aside>

        {/* ------------------------------------------------------- main */}
        <div className="min-w-0 p-3.5">
          <div className="flex items-center justify-between gap-3">
            <span className="text-[11px] font-medium">Dashboard</span>
            <span className="flex items-center gap-2">
              <span className="bv2-num flex items-center gap-1.5 border border-[var(--line)] px-2 py-1 text-[8.5px] text-[var(--body)]">
                May 18 – May 24, 2024 <Icon name="chevron" className="h-2.5 w-2.5" />
              </span>
              <span className="flex items-center gap-1.5 border border-[var(--line)] px-2 py-1 text-[8.5px] text-[var(--body)]">
                <Icon name="filter" className="h-2.5 w-2.5" /> Filter
              </span>
            </span>
          </div>

          {/* stat row */}
          <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
            {DASH_STATS.map(s => (
              <div key={s.label} className="border border-[var(--line-2)] px-2.5 py-2">
                <span className="bv2-label block text-[8px]">{s.label}</span>
                <span className="bv2-num mt-1 block text-[12px] font-medium">{s.value}</span>
                <span className="bv2-num block text-[8px] text-[var(--ok)]">{s.delta}</span>
              </div>
            ))}
          </div>

          {/* chart + top vehicles */}
          <div className="mt-2.5 grid gap-2.5 sm:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)]">
            <div className="border border-[var(--line-2)] p-2.5">
              <span className="text-[9px] font-medium text-[var(--ink-2)]">Bookings trend</span>
              <svg viewBox="0 0 100 40" preserveAspectRatio="none" className="mt-2 h-20 w-full" aria-hidden="true">
                {[10, 20, 30].map(y => (
                  <line key={y} x1="0" y1={y} x2="100" y2={y} stroke="var(--line-2)" strokeWidth=".4" />
                ))}
                <polyline points={points} fill="none" stroke="#7c9cc4" strokeWidth="1" vectorEffect="non-scaling-stroke" />
              </svg>
            </div>

            <div className="border border-[var(--line-2)] p-2.5">
              <span className="text-[9px] font-medium text-[var(--ink-2)]">Top Vehicles</span>
              <ul className="mt-2 flex flex-col gap-1.5">
                {DASH_TOP_VEHICLES.map(v => (
                  <li key={v.name} className="flex items-center justify-between text-[8.5px]">
                    <span className="truncate text-[var(--body)]">{v.name}</span>
                    <span className="bv2-num font-medium">{v.share}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ========================================================================== */
/* FLEET SHOWCASE                                                             */
/* ========================================================================== */

export function FleetShowcase() {
  return (
    <section className="bv2-wrap bv2-rule py-14">
      <div className="grid gap-10 lg:grid-cols-[minmax(0,.3fr)_minmax(0,.7fr)] lg:gap-14">
        <div>
          <p className="bv2-eyebrow">Built for flexibility</p>
          <h2 className="bv2-serif bv2-h2 mt-4">A fleet for<br />every need.</h2>
          <p className="bv2-body mt-4 max-w-[16rem]">
            From compact city cars to people movers. You stay in control.
          </p>
          <a href="#top" className="bv2-link mt-6">
            View all vehicles <Icon name="arrow" className="h-3.5 w-3.5" />
          </a>
        </div>

        <div className="grid grid-cols-2 gap-x-6 gap-y-8 sm:grid-cols-4 lg:border-l lg:border-[var(--line)] lg:pl-12">
          {FLEET_SHOWCASE.map(v => (
            <figure key={v.name}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={v.img} alt={v.name}
                className="bv2-thumb-mask w-full object-cover"
                style={{ aspectRatio: "4 / 3" }} loading="lazy" decoding="async" />
              <figcaption className="mt-2">
                <span className="block text-[11.5px] font-medium">{v.name}</span>
                <span className="block text-[10px] text-[var(--muted)]">{v.type}</span>
              </figcaption>
            </figure>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ========================================================================== */
/* OUTCOMES                                                                   */
/* ========================================================================== */

export function Outcomes() {
  return (
    <section className="bv2-wrap bv2-rule py-14">
      <header className="mx-auto max-w-[38rem] text-center">
        <p className="bv2-eyebrow">Customer outcomes</p>
        <h2 className="bv2-serif bv2-h2 mt-4">Better operations.<br />Stronger business.</h2>
      </header>

      <div className="mt-12 grid gap-x-8 gap-y-10 sm:grid-cols-2 lg:grid-cols-4 lg:divide-x lg:divide-[var(--line)]">
        {OUTCOMES.map(o => (
          <div key={o.title} className="flex items-start gap-4 lg:px-6 lg:first:pl-0 lg:last:pr-0">
            <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full border border-[var(--line)] text-[var(--ink-2)]">
              <Icon name={o.icon} className="h-[18px] w-[18px]" />
            </span>
            <span>
              <span className="block text-[12.5px] font-medium">{o.title}</span>
              <span className="bv2-body mt-1 block text-[12px]">{o.copy}</span>
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}

/* ========================================================================== */
/* CTA + FOOTER                                                               */
/* ========================================================================== */

export function CtaBar() {
  return (
    <section className="bv2-wrap pb-14 pt-4">
      <div className="grid items-center gap-6 bg-[var(--wash)] px-7 py-8 sm:px-10
                      lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] lg:gap-10">
        <h2 className="bv2-serif text-[clamp(1.4rem,2.4vw,1.9rem)] leading-[1.15]">
          Ready to move<br />better?
        </h2>
        <p className="bv2-body text-[13px]">
          See how Drive247 can transform your rental operations.
        </p>
        <a href="#demo" className="bv2-btn-red shrink-0">
          Book a demo <Icon name="arrow" className="h-3.5 w-3.5" />
        </a>
      </div>
    </section>
  );
}

export function Footer() {
  return (
    <footer className="bv2-rule">
      <div className="bv2-wrap flex flex-wrap items-center justify-between gap-5 py-7">
        <Wordmark className="text-[13px]" />
        <nav className="flex flex-wrap gap-7">
          {["Product", "Solutions", "Resources", "Pricing", "About"].map(l => (
            <a key={l} href="#top" className="text-[12px] text-[var(--body)] transition-colors hover:text-[var(--ink)]">{l}</a>
          ))}
        </nav>
        <p className="text-[11px] text-[var(--muted)]">
          © {new Date().getFullYear()} Drive247. All rights reserved.
        </p>
      </div>
    </footer>
  );
}
