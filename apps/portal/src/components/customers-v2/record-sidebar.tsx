"use client";

/* ─────────────────────────────────────────────────────────────────────────────
 * Customer record v2 — the record's own navigation.
 *
 * This is the app's own scoped-sidebar pattern, not an invention. Its
 * measurements are lifted from `shared/layout/app-sidebar-v2.tsx` in its
 * Settings mode — the one place in the product that already solves "a sidebar
 * scoped to one record":
 *
 *   title    px-4 pt-4 pb-1 — 14px semibold, 11px muted under it
 *   group    label 10px uppercase tracking-widest at /50, px-2.5 pt-0.5 pb-1
 *   divider  mx-2.5 mb-1.5 border-t, between groups only
 *   item     h-8, rounded-lg, gap-2.5, size-4 icon, 13px label
 *   idle     text-sidebar-foreground/70, icon at /60
 *   active   bg-primary/10 + text-primary + font-medium
 *
 * ── What it deliberately does NOT do ─────────────────────────────────────
 *
 * It carries no state. No value beside the label, no tick, no count, no tint
 * that varies with how complete something is. An earlier pass borrowed the
 * rental screen's rail, where each item shows the decision made inside it —
 * right for a rental being assembled from nothing, wrong here. A customer
 * record already exists; there are no decisions to echo, and eleven rows each
 * reporting their own status turns navigation into a second, worse summary
 * competing with the real one on the right.
 *
 * ── Why it is narrower than the app sidebar ──────────────────────────────
 *
 * 240px against the app sidebar's 256. Two sidebars of identical width read as
 * two applications side by side; a visibly subordinate one reads as what it is,
 * navigation WITHIN the screen the app sidebar took you to.
 * ────────────────────────────────────────────────────────────────────────── */

import Link from "next/link";
import {
  ArrowLeft,
  Car,
  Clock,
  CreditCard,
  FileText,
  Gavel,
  IdCard,
  MessageSquare,
  ShieldCheck,
  Star,
  User,
  UserCog,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { TabId } from "./types";

type NavItem = { id: TabId; label: string; icon: React.ComponentType<{ className?: string }> };

/**
 * The three groups are the shape of the record, and they hold whether or not
 * anything is filled in: what the person told us, what has been decided about
 * them, and what they have actually done.
 */
const GROUPS: { label: string; items: NavItem[] }[] = [
  {
    label: "The person",
    items: [
      { id: "identity", label: "Identity", icon: User },
      { id: "licence", label: "Licence & driving", icon: IdCard },
      { id: "documents", label: "Documents", icon: FileText },
    ],
  },
  {
    label: "Standing",
    items: [
      { id: "verification", label: "Verification", icon: ShieldCheck },
      { id: "account", label: "Account", icon: UserCog },
      { id: "consent", label: "Consent", icon: MessageSquare },
    ],
  },
  {
    label: "History",
    items: [
      { id: "rentals", label: "Rentals", icon: Car },
      { id: "money", label: "Money", icon: CreditCard },
      { id: "fines", label: "Fines", icon: Gavel },
      { id: "reviews", label: "Reviews", icon: Star },
      { id: "activity", label: "Activity", icon: Clock },
    ],
  },
];

export function RecordSidebar({
  title,
  subtitle,
  active,
  onSelect,
  footer,
}: {
  title: string;
  subtitle: string;
  active: TabId;
  onSelect: (t: TabId) => void;
  footer?: React.ReactNode;
}) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-12 shrink-0 items-center px-2">
        <Link
          href="/customers"
          className="flex h-8 items-center gap-2 rounded-md px-1 text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
        >
          <ArrowLeft className="size-4 shrink-0" />
          <span className="text-[13px]">All customers</span>
        </Link>
      </div>

      {/* Which record you have open. A page title, not a status — the status
          has a column of its own on the far side of the screen. */}
      <div className="px-4 pb-1 pt-2">
        <h2 className="truncate text-sm font-semibold text-foreground">{title}</h2>
        <p className="mt-0.5 truncate text-[11px] text-muted-foreground">{subtitle}</p>
      </div>

      <nav className="min-h-0 flex-1 overflow-y-auto pb-3 pt-2">
        {GROUPS.map((group, gi) => (
          <div key={group.label} className="px-1.5">
            {gi > 0 && <div className="mx-2.5 mb-1.5 border-t" />}
            <p className="px-2.5 pb-1 pt-0.5 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/50">
              {group.label}
            </p>
            <div className="space-y-0.5">
              {group.items.map((item) => {
                const on = active === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => onSelect(item.id)}
                    aria-current={on ? "page" : undefined}
                    className={cn(
                      "flex h-8 w-full cursor-pointer items-center gap-2.5 overflow-hidden rounded-lg px-3 text-left transition-colors",
                      on
                        ? "bg-primary/10 font-medium text-primary"
                        : "text-sidebar-foreground/70 hover:bg-primary/10 hover:text-primary"
                    )}
                  >
                    <item.icon
                      className={cn(
                        "size-4 shrink-0 transition-colors",
                        on ? "text-primary" : "text-sidebar-foreground/60"
                      )}
                    />
                    <span className="truncate text-[13px]">{item.label}</span>
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      {footer && <div className="shrink-0 border-t p-3">{footer}</div>}
    </div>
  );
}
