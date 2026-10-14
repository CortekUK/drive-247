import type { ReactNode } from "react";
import { Search } from "lucide-react";

/*
 * A static rendering of the northwind operator dashboard, in its own
 * vocabulary (apps/portal/src/components/dashboard-v2/home/ui.tsx):
 *   - eyebrow card titles, one "lead" item per card set larger
 *   - every row ends in a right-aligned, tabular CLOCK column: rental sells
 *     time, so time is what each row is measured in
 *   - colour is reserved for state (late / waiting / clear), never decoration
 * The names and figures are illustrative.
 */

type Tone = "late" | "wait" | "clear" | "idle";

const INK: Record<Tone, string> = {
  late: "text-[var(--lv-late)]",
  wait: "text-[var(--lv-wait)]",
  clear: "text-[var(--lv-ink-3)]",
  idle: "text-[var(--lv-ink-3)]",
};
const DOT: Record<Tone, string> = {
  late: "bg-[var(--lv-late)]",
  wait: "bg-[var(--lv-wait)]",
  clear: "bg-[var(--lv-clear)]",
  idle: "bg-[var(--lv-line-2)]",
};

export function Eyebrow({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <span className={`text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--lv-ink-3)] ${className}`}>
      {children}
    </span>
  );
}

function Card({ title, count, children }: { title: string; count?: string; children: ReactNode }) {
  return (
    <div className="flex min-h-[292px] flex-col overflow-hidden rounded-2xl border border-[var(--lv-line)] bg-[var(--lv-paper)]">
      <header className="flex items-baseline gap-2 px-5 pb-3 pt-4">
        <Eyebrow>{title}</Eyebrow>
        {count && <span className="text-[11px] font-medium tabular-nums text-[var(--lv-ink-2)]">{count}</span>}
      </header>
      <div className="flex flex-1 flex-col">{children}</div>
    </div>
  );
}

function Lead({ title, meta, clock, amount, tone }: { title: string; meta: string; clock: string; amount?: string; tone: Tone }) {
  return (
    <div className="flex items-center gap-4 border-b border-[var(--lv-line)] px-5 pb-4 pt-1">
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[16px] font-semibold leading-tight tracking-[-0.01em]">{title}</span>
        <span className="mt-1 block truncate text-[12px] text-[var(--lv-ink-3)]">{meta}</span>
      </span>
      {amount && <span className="shrink-0 text-[14px] font-semibold tabular-nums">{amount}</span>}
      <span className={`w-[48px] shrink-0 text-right text-[12px] font-semibold tabular-nums ${INK[tone]}`}>{clock}</span>
    </div>
  );
}

function Row({ label, meta, clock, tone }: { label: string; meta: string; clock: string; tone: Tone }) {
  return (
    <div className="flex items-center gap-3 px-5 py-2.5 transition-colors duration-200 hover:bg-[var(--lv-row-hover)]">
      <span className={`size-1.5 shrink-0 rounded-full ${DOT[tone]}`} />
      <span className="min-w-0 flex-1 truncate text-[13px]">
        {label} <span className="text-[var(--lv-ink-3)]">· {meta}</span>
      </span>
      <span className={`w-[48px] shrink-0 text-right text-[12px] font-medium tabular-nums ${INK[tone]}`}>{clock}</span>
    </div>
  );
}

function Footer({ label }: { label: string }) {
  return (
    <div className="mt-auto flex items-center border-t border-[var(--lv-line)] px-5 py-3 text-[12px] text-[var(--lv-ink-3)]">
      <span className="flex-1">{label}</span>
      <span aria-hidden>→</span>
    </div>
  );
}

const BARS = [38, 52, 44, 61, 57, 72, 66, 80, 74, 88, 83, 96];

export function ProductPreview() {
  return (
    <div className="rounded-[28px] border border-[var(--lv-line)] bg-[color-mix(in_srgb,var(--lv-paper)_70%,transparent)] p-3 backdrop-blur-sm sm:p-5">
      {/* The portal's top bar: the pill search field with its brand tint. */}
      <div className="mb-4 flex items-center gap-3 px-1">
        <div className="flex h-8 w-full max-w-[380px] items-center gap-2 rounded-full border border-[color-mix(in_srgb,var(--lv-accent)_25%,transparent)] bg-[color-mix(in_srgb,var(--lv-accent)_7%,transparent)] px-2.5">
          <Search className="size-4 shrink-0 text-[var(--lv-accent-ink)]" aria-hidden />
          <span className="flex-1 truncate text-[13px] text-[var(--lv-ink-3)]">Search rentals, customers, cars</span>
          <kbd className="rounded-full bg-[color-mix(in_srgb,var(--lv-accent)_15%,transparent)] px-1.5 py-0.5 font-mono text-[10px] font-semibold text-[var(--lv-accent-ink)]">
            ⌘K
          </kbd>
        </div>
        <div className="ml-auto hidden items-center gap-1.5 rounded-full bg-[var(--lv-clear-bg)] px-2.5 py-1 text-[11px] font-semibold text-[var(--lv-clear)] sm:flex">
          <span className="size-1.5 rounded-full bg-[var(--lv-clear)]" />
          Live
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card title="Needs you now" count="3">
          <Lead title="Tesla Model 3 is late back" meta="Jordan Ellis · due 10:00" clock="42m" tone="late" />
          <Row label="Deposit hold expiring" meta="BMW X5" clock="3h" tone="wait" />
          <Row label="Licence to check" meta="Priya Shah" clock="18m" tone="wait" />
          <Footer label="Open the queue" />
        </Card>

        <Card title="On the move today" count="5">
          <Lead title="Pickup · Mercedes C300" meta="Alex Romero · lockbox" clock="09:30" tone="idle" />
          <Row label="Return" meta="Toyota Camry" clock="11:00" tone="clear" />
          <Row label="Pickup" meta="Ford Mustang" clock="13:15" tone="idle" />
          <Row label="Delivery" meta="Tesla Model Y" clock="15:45" tone="idle" />
          <Footer label="See the day" />
        </Card>

        <Card title="Where you stand">
          <div className="flex items-baseline gap-2 px-5 pb-2 pt-1">
            <span className="text-[26px] font-semibold leading-none tracking-[-0.02em] tabular-nums">$18,420</span>
            <span className="text-[11px] text-[var(--lv-ink-3)]">collected this month</span>
          </div>
          <div className="flex h-24 items-end gap-1.5 px-5 pb-3 pt-3">
            {BARS.map((h, i) => (
              <span
                key={i}
                className={`flex-1 rounded-t-[4px] ${i === BARS.length - 1 ? "bg-[var(--lv-accent)]" : "bg-[color-mix(in_srgb,var(--lv-accent)_22%,transparent)]"}`}
                style={{ height: `${h}%` }}
              />
            ))}
          </div>
          <Row label="Fleet on the road" meta="11 of 14" clock="79%" tone="clear" />
          <Footer label="Open insights" />
        </Card>
      </div>
    </div>
  );
}
