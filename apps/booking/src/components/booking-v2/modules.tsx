import {
  MOCK_BOOKINGS, MOCK_FLEET, MOCK_PAYMENTS, MOCK_REPORTS, MODULES,
} from "./data";
import { Icon } from "./icons";

/* ========================================================================== */
/* SECTION                                                                    */
/* ========================================================================== */

export function Modules() {
  return (
    <section className="bv2-wrap pb-6">
      <header className="mx-auto max-w-[42rem] pb-14 text-center">
        <p className="bv2-eyebrow">One platform</p>
        <h2 className="bv2-serif bv2-h2 mt-4">Everything in one system.</h2>
        <p className="bv2-body mt-3">Connected modules. Real-time data. Smarter decisions.</p>
      </header>

      <div className="bv2-rule">
        {MODULES.map(m => (
          <div key={m.n}
            className="bv2-rule grid items-center gap-8 border-t-0 py-9
                       lg:grid-cols-[minmax(0,.44fr)_minmax(0,.56fr)] lg:gap-12
                       [&:not(:first-child)]:border-t">
            {/* ------------------------------------------------ label */}
            <div className="flex items-start gap-5">
              <span className="bv2-serif bv2-num pt-1 text-[19px] text-[var(--muted)]">{m.n}</span>
              <div>
                <div className="flex items-center gap-3">
                  <Icon name={m.icon} className="h-[22px] w-[22px] text-[var(--red)]" />
                  <h3 className="bv2-serif bv2-h3">{m.title}</h3>
                </div>
                <p className="bv2-body mt-2.5 max-w-[19rem] text-[13px]">{m.copy}</p>
              </div>
            </div>

            {/* ------------------------------------------------- mock */}
            <Mock kind={m.mock} />
          </div>
        ))}
      </div>
    </section>
  );
}

/* ========================================================================== */
/* PRODUCT SCREENSHOTS                                                        */
/* ========================================================================== */
/* Built as markup rather than images so they stay sharp at any zoom and keep
   the page's own type and colour tokens. */

function Chrome({ title, action, children }: {
  title: string; action?: React.ReactNode; children: React.ReactNode;
}) {
  return (
    <div className="bv2-card shadow-[var(--shadow)]">
      <div className="flex items-center justify-between border-b border-[var(--line-2)] px-4 py-2.5">
        <span className="text-[11px] font-medium text-[var(--ink-2)]">{title}</span>
        <span className="text-[var(--muted)]">{action}</span>
      </div>
      {children}
    </div>
  );
}

function Mock({ kind }: { kind: string }) {
  if (kind === "bookings") {
    return (
      <Chrome title="Bookings" action={<Icon name="user" className="h-3.5 w-3.5" />}>
        <div className="flex gap-4 border-b border-[var(--line-2)] px-4 py-2 text-[9.5px]">
          {["All", "Upcoming", "Ongoing", "Completed", "Cancelled"].map((t, i) => (
            <span key={t} className={i === 0 ? "font-medium text-[var(--ink)]" : "text-[var(--muted)]"}>{t}</span>
          ))}
        </div>
        <div className="grid grid-cols-[auto_1fr_1fr_1fr_1fr_auto] items-center gap-3 px-4 py-2 text-[8.5px] text-[var(--muted)]">
          <span>No.</span><span>Booking</span><span>Customer</span><span>Vehicle</span><span>Start</span><span>Status</span>
        </div>
        {MOCK_BOOKINGS.map((b, i) => (
          <div key={b.ref}
            className="grid grid-cols-[auto_1fr_1fr_1fr_1fr_auto] items-center gap-3 border-t border-[var(--line-2)] px-4 py-3 text-[10px]">
            <span className="bv2-num text-[var(--muted)]">{i + 1}</span>
            <span className="bv2-num font-medium">{b.ref}</span>
            <span className="text-[var(--body)]">{b.customer}</span>
            <span className="text-[var(--body)]">{b.vehicle}</span>
            <span className="bv2-num text-[var(--body)]">{b.from}</span>
            <span className="bv2-pill bv2-pill-ok">{b.status}</span>
          </div>
        ))}
      </Chrome>
    );
  }

  if (kind === "fleet") {
    return (
      <Chrome title="Fleet" action={<Icon name="grid" className="h-3.5 w-3.5" />}>
        {MOCK_FLEET.map((v, i) => (
          <div key={v.name}
            className={`flex items-center gap-3 px-4 py-3 ${i ? "border-t border-[var(--line-2)]" : ""}`}>
            <span className="h-3 w-3 shrink-0 border border-[var(--line)]" />
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={v.img} alt="" className="h-8 w-14 shrink-0 object-cover" loading="lazy" decoding="async" />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[10.5px] font-medium">{v.name}</span>
              <span className="bv2-num block truncate text-[9px] text-[var(--muted)]">{v.spec}</span>
            </span>
            <span className={`bv2-pill bv2-pill-${v.tone}`}>{v.status}</span>
          </div>
        ))}
      </Chrome>
    );
  }

  if (kind === "customers") {
    return (
      <Chrome title="Customers" action={<Icon name="grid" className="h-3.5 w-3.5" />}>
        <div className="grid grid-cols-[auto_1fr_auto_auto] items-center gap-4 px-4 py-4">
          <span className="grid h-8 w-8 place-items-center rounded-full bg-[var(--wash)] text-[9.5px] font-medium text-[var(--body)]">JL</span>
          <span className="min-w-0">
            <span className="block truncate text-[10.5px] font-medium">Jessica Lee</span>
            <span className="block truncate text-[9px] text-[var(--muted)]">jessica@lee.com &nbsp;·&nbsp; +65 9123 4567</span>
          </span>
          <span className="text-right">
            <span className="bv2-label block">Total bookings</span>
            <span className="bv2-num block text-[11px] font-medium">12</span>
          </span>
          <span className="text-right">
            <span className="bv2-label block">Customer since</span>
            <span className="bv2-num block text-[11px] font-medium">Mar 2023</span>
          </span>
        </div>
      </Chrome>
    );
  }

  if (kind === "payments") {
    return (
      <Chrome title="Payments" action={<Icon name="grid" className="h-3.5 w-3.5" />}>
        {MOCK_PAYMENTS.map((p, i) => (
          <div key={p.inv}
            className={`grid grid-cols-[auto_1fr_1fr_auto_auto] items-center gap-3 px-4 py-3 text-[10px] ${i ? "border-t border-[var(--line-2)]" : ""}`}>
            <Icon name="doc" className="h-3.5 w-3.5 text-[var(--muted)]" />
            <span className="bv2-num font-medium">{p.inv}</span>
            <span className="text-[var(--body)]">{p.customer}</span>
            <span className="bv2-num text-[var(--body)]">{p.amount}</span>
            <span className={`bv2-pill bv2-pill-${p.tone}`}>{p.status}</span>
          </div>
        ))}
      </Chrome>
    );
  }

  /* reports */
  return (
    <Chrome title="Reports overview">
      <div className="grid grid-cols-2 sm:grid-cols-4">
        {MOCK_REPORTS.map((r, i) => (
          <div key={r.label}
            className={`px-4 py-4 ${i % 4 ? "sm:border-l sm:border-[var(--line-2)]" : ""} ${i > 1 ? "border-t border-[var(--line-2)] sm:border-t-0" : ""}`}>
            <span className="bv2-label block">{r.label}</span>
            <span className="bv2-num mt-1.5 block text-[15px] font-medium">{r.value}</span>
            <span className="bv2-num mt-0.5 block text-[9px] text-[var(--ok)]">{r.delta}</span>
          </div>
        ))}
      </div>
    </Chrome>
  );
}
