"use client";

/* ─────────────────────────────────────────────────────────────────────────────
 * Left sidebar — ORDINARY NAVIGATION. DESIGN SANDBOX, nothing is real.
 *
 * This is the app's own scoped-sidebar pattern, not an invention and not the
 * rental screen's rail. Its measurements are lifted from
 * `shared/layout/app-sidebar-v2.tsx` in its Settings mode — the one place in
 * the product that already solves "a sidebar scoped to one record":
 *
 *   header   h-16, a Back link at h-8 px-1, 13px label, hover:bg-muted/50
 *   title    px-4 pt-4 pb-1 — 14px semibold, 11px muted under it
 *   group    label 10px uppercase tracking-widest at /50, px-2.5 pt-0.5 pb-1
 *   divider  mx-2.5 mb-1.5 border-t, between groups only
 *   item     h-8, rounded-lg, gap-2.5, size-4 icon, 13px label
 *   idle     text-sidebar-foreground/70, icon at /60
 *   active   bg-primary/10 + text-primary + font-medium, icon to primary
 *
 * ── What it deliberately does NOT do ─────────────────────────────────────
 *
 * It carries no state. No value beside the label, no tick, no count, no tint
 * that varies with how complete something is. An earlier pass of this screen
 * borrowed the rental sandbox's rail, where each item shows the decision made
 * inside it — right for a rental being assembled from nothing, wrong here. A
 * customer record already exists; there are no decisions to echo, and eleven
 * rows each reporting their own status turns navigation into a second, worse
 * summary competing with the real one.
 *
 * The summary has a column of its own on the right. This side answers only
 * "where am I, and where can I go".
 * ────────────────────────────────────────────────────────────────────────── */

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
  UserCog,
  User,
} from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import type { TabId } from "./_data";

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

export function CustomerSidebar({
  title,
  subtitle,
  active,
  onSelect,
}: {
  title: string;
  subtitle: string;
  active: TabId;
  onSelect: (t: TabId) => void;
}) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* h-16, matching the real sidebar's header rather than the rental
          sandbox's h-11 — this is app chrome, and app chrome is the same height
          everywhere or it reads as a different application. */}
      <div className="flex h-16 shrink-0 items-center px-2">
        <Link
          href="/playground"
          className="flex h-8 items-center gap-2 rounded-md px-1 text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
        >
          <ArrowLeft className="size-4 shrink-0" />
          <span className="text-[13px]">Back</span>
        </Link>
      </div>

      {/* The record's identity, the way Settings names itself. This is a page
          title, not a status: it says which customer you have open. */}
      <div className="px-4 pb-1 pt-4">
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

      <div className="border-t p-3">
        <p className="px-0.5 text-[11px] leading-relaxed text-muted-foreground">
          Nothing here is real. Every edit applies immediately — there is no Save.
        </p>
      </div>
    </div>
  );
}
