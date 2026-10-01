"use client";

import { useEffect, useRef, useState } from "react";
import type React from "react";
import { Download } from "lucide-react";
import type { TenantSubscriptionInvoice } from "@/hooks/use-tenant-subscription";
import { BILLING_STATUS_LABEL, billingDocumentsOf, billingStatusOf, type BillingDocStatus } from "@/lib/billing-documents";
import { formatBillDate, formatMoney } from "@/lib/integration-billing/catalog";
import { LIST_TONES, type ListTone } from "@/components/shared/list-table-v2";

/**
 * Payments on v2 Billing, newest first — the next bill, then every bill before
 * it. Not a table: no box, no column headings, quiet rows on hairlines.
 * Status is coloured TEXT in the v2 list tones; money reads right and bold.
 *
 * All of them, not a "See all", in their OWN scroller about three rows tall:
 * rows arrive a page at a time as the operator scrolls it (a sentinel under
 * the last row, watched against that scroller).
 *
 * Each bill row carries View receipt (the paper receipt dialog) and a
 * download of Stripe's invoice PDF; an unpaid one also carries Pay now.
 */

const TONE: Record<BillingDocStatus, ListTone> = {
  paid: "success",
  refunded: "info",
  due: "warning",
  overdue: "danger",
  failed: "danger",
  void: "muted",
};

const PAGE = 10;

const LINK =
  "text-sm text-primary transition-opacity duration-200 ease-out hover:opacity-70 motion-reduce:transition-none";

interface Row {
  key: string;
  date: string;
  title: string;
  status: string;
  tone: ListTone;
  amount: string;
  actions: React.ReactNode;
  /** The next bill: drawn as the row that matters, not as a status. */
  featured?: boolean;
  note?: string | null;
}

/** "in 18 days", "tomorrow", "today" — null when it has passed or can't be read. */
function daysUntil(iso: string | null): string | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return null;
  const days = Math.ceil((t - Date.now()) / 86_400_000);
  if (days < 0) return null;
  return days === 0 ? "today" : days === 1 ? "tomorrow" : `in ${days} days`;
}

/** "Sep 19 – Oct 19": short enough to never be cut off. The year only shows
 *  when it isn't this year (the date column carries the full date). */
function shortDate(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleDateString("en-US", sameYear ? { month: "short", day: "numeric" } : { month: "short", day: "numeric", year: "numeric" });
}

function period(inv: TenantSubscriptionInvoice): string {
  const a = shortDate(inv.period_start);
  const b = shortDate(inv.period_end);
  return a && b ? `${a} – ${b}` : a ?? b ?? "—";
}

export function RecentPaymentsV2({
  invoices,
  upcoming,
  onViewInvoice,
  payDisabled,
  onExplainPrice,
}: {
  invoices: TenantSubscriptionInvoice[];
  upcoming: { date: string | null; amount: number | null; currency: string } | null;
  onViewInvoice: (inv: TenantSubscriptionInvoice) => void;
  payDisabled: boolean;
  /** Opens the price breakdown — shown at the end of the next-bill row. */
  onExplainPrice?: () => void;
}) {
  const rows: Row[] = [];

  if (upcoming && upcoming.date && upcoming.amount != null) {
    rows.push({
      key: "next",
      date: formatBillDate(upcoming.date) ?? "—",
      title: "Next bill",
      status: "",
      tone: "muted",
      featured: true,
      note: daysUntil(upcoming.date),
      amount: formatMoney(upcoming.amount, upcoming.currency),
      actions: onExplainPrice ? (
        <button
          type="button"
          onClick={onExplainPrice}
          className="mr-7 whitespace-nowrap text-sm font-medium text-primary underline decoration-dotted underline-offset-4 transition-opacity duration-200 ease-out hover:opacity-70 motion-reduce:transition-none dark:text-[hsl(var(--v2-link,var(--primary)))]"
        >
          Breakdown
        </button>
      ) : null,
    });
  }

  const newestFirst = [...invoices]
    .filter((inv) => billingStatusOf(inv) !== "void")
    .sort((a, b) => (b.period_start ?? b.created_at ?? "").localeCompare(a.period_start ?? a.created_at ?? ""));

  for (const inv of newestFirst) {
    const st = billingStatusOf(inv);
    const docs = billingDocumentsOf(inv);
    const paidish = st === "paid" || st === "refunded";
    const canPay = !paidish && !!docs.invoiceView && !payDisabled;
    rows.push({
      key: inv.id,
      date: formatBillDate(paidish ? inv.paid_at ?? inv.period_start : inv.due_date ?? inv.period_start) ?? "—",
      title: period(inv),
      status: BILLING_STATUS_LABEL[st],
      tone: TONE[st],
      amount: formatMoney(paidish ? inv.amount_paid : inv.amount_due, inv.currency),
      actions: (
        <>
          {canPay && (
            <a href={docs.invoiceView!} target="_blank" rel="noopener noreferrer" className={LINK}>
              Pay now
            </a>
          )}
          <button type="button" onClick={() => onViewInvoice(inv)} className={LINK}>
            {paidish ? "View receipt" : "View invoice"}
          </button>
          {docs.invoiceDownload ? (
            <a
              href={docs.invoiceDownload}
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Download invoice PDF"
              title="Download invoice PDF"
              className="text-muted-foreground transition-colors duration-200 ease-out hover:text-foreground motion-reduce:transition-none"
            >
              <Download className="h-4 w-4" />
            </a>
          ) : (
            <span aria-hidden className="w-4" />
          )}
        </>
      ),
    });
  }

  // Infinite scroll: a page of rows, and the next one when the sentinel under
  // the last row comes into view.
  const [shown, setShown] = useState(PAGE);
  const sentinel = useRef<HTMLDivElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const hasMore = shown < rows.length;
  useEffect(() => {
    const el = sentinel.current;
    if (!el || !hasMore) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) setShown((n) => n + PAGE);
      },
      { root: scroller.current, rootMargin: "120px 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [hasMore, shown]);

  // Which edges have more beyond them: drives the fades.
  const [edges, setEdges] = useState({ above: false, below: false });
  const measure = () => {
    const el = scroller.current;
    if (!el) return;
    const above = el.scrollTop > 2;
    const below = el.scrollTop + el.clientHeight < el.scrollHeight - 2;
    setEdges((e) => (e.above === above && e.below === below ? e : { above, below }));
  };
  useEffect(() => {
    measure();
    const el = scroller.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }); // every render: rows arriving change the height
  const fade =
    edges.above || edges.below
      ? `linear-gradient(to bottom, ${edges.above ? "transparent, #000 2.5rem" : "#000"}, ${
          edges.below ? "#000 calc(100% - 3.5rem), transparent" : "#000"
        })`
      : undefined;

  if (rows.length === 0) return null;

  return (
    /* Its own scroller, filling the rest of the screen down to its bottom
       edge (the summary gives it `flex-1`), so there's no gap under it. The
       scrollbar is hidden; instead a fade appears at the foot while there is
       more below, and at the head once scrolled — so it reads as a list that
       continues, not one that ends. `overscroll-contain`: reaching the end
       doesn't hand the wheel to the page. Phones: a plain 20rem box. */
    <div
      ref={scroller}
      onScroll={measure}
      className="max-h-[20rem] min-h-0 overflow-y-auto overscroll-contain [scrollbar-width:none] md:max-h-none md:flex-1 [&::-webkit-scrollbar]:hidden"
      style={fade ? { WebkitMaskImage: fade, maskImage: fade } : undefined}
    >
      <ul className="divide-y divide-border/60 [&>li:first-child]:border-b-0 [&>li:nth-child(2)]:border-t-0">
        {rows.slice(0, shown).map((r) => (
          <li
            key={r.key}
            className={`grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-4 sm:grid-cols-[minmax(8rem,1fr)_5.5rem_5.5rem_11rem] ${
              r.featured
                ? "mb-1 rounded-xl border border-primary/20 bg-primary/[0.06] px-4 py-3 text-foreground"
                : "px-4 py-2.5"
            }`}
          >
            <span className="min-w-0 whitespace-nowrap text-sm">
              <span className={r.featured ? "font-semibold" : "font-medium"}>{r.title}</span>
              {r.note && <span className={`ml-2 ${r.featured ? "opacity-70" : "text-muted-foreground"}`}>{r.note}</span>}
              {/* Below xl the date column is hidden; the next bill still says when. */}
              {r.featured && <span className="ml-2 opacity-70">· {r.date}</span>}
            </span>
            <span className={`hidden text-sm font-medium sm:block ${LIST_TONES[r.tone]}`}>{r.status}</span>
            <span className={`text-right tabular-nums ${r.featured ? "text-base font-bold" : "text-sm font-semibold"}`}>{r.amount}</span>
            {/* Right-aligned on every row: "Price breakdown", "View receipt" and
                "View invoice" all END at the same point, just before the
                download icon. */}
            <span className="hidden items-center justify-end gap-3 self-center sm:flex">{r.actions}</span>
          </li>
        ))}
      </ul>
      {hasMore && (
        <div ref={sentinel} className="flex justify-center py-3" aria-hidden>
          <span className="text-xs text-muted-foreground">Loading more…</span>
        </div>
      )}
    </div>
  );
}
