"use client";

/**
 * Notifications v2: the in-app (bell) preview (transcript §3.2, 17:52 "the bell
 * icon in the portal, and customers can receive in-app notifications too").
 *
 * Two looks, each copied from the screen the notification really lands on:
 *   - team: a row of this portal's notification centre
 *     (components/notifications/notification-sheet.tsx `Row`): the bold title
 *     with the unread dot, the grey message clamped to two lines, the category
 *     tag and the relative time, under the sheet's "Notifications" header and
 *     "Today" bucket. It uses the portal's theme tokens, so it matches the
 *     operator's own bell in light and dark.
 *   - customer: a row of the booking site's bell popover
 *     (apps/booking/src/components/customer-portal/CustomerPortalHeader.tsx
 *     `CustomerNotificationBell`): "Notifications" with "1 unread", the General
 *     and Messages tabs, the row, and "View all notifications". The booking
 *     site is the customer's screen, so it keeps light colours in both themes.
 *
 * Both real UIs print a new row's time with date-fns `formatDistanceToNow`,
 * which says "less than a minute ago", so the preview says that too.
 *
 * v2 only: rendered by the v2 Notifications page (northwind canary).
 */

import { Bell, BellRing, MessageSquare } from "lucide-react";
import {
  CATEGORY_LABEL,
  CATEGORY_TONE,
  type NotificationCategory as BellCategory,
} from "@/components/notifications/taxonomy";
import { cn } from "@/lib/utils";

export type InAppAudience = "team" | "customer";

/** What both bells print for a notification that has just arrived. */
export const IN_APP_TIME_LABEL = "less than a minute ago";

export const IN_APP_CAPTIONS: Record<InAppAudience, string> = {
  team: "How it shows in the bell in this portal, for your team.",
  customer: "How it shows in the bell on your booking site, for customers who are signed in.",
};

export interface InAppPreviewProps {
  /** Title with variables already filled. */
  title: string;
  /** Message with variables already filled. */
  body: string;
  audience: InAppAudience;
  /** Shown in the booking site's header above the customer's bell. */
  companyName?: string | null;
  /** Where a click on the row goes (already filled), shown under the mockup. */
  link?: string | null;
  /** The bell's own category tag on the team row (Payment, Rental, Customer, System). */
  bellCategory?: BellCategory | null;
  /** The booking site's accent colour (unread dot, active tab). Defaults to the portal's primary. */
  accentColor?: string | null;
  className?: string;
}

/** The portal notification centre, one unread row (notification-sheet.tsx). */
function TeamBell({ title, body, bellCategory }: { title: string; body: string; bellCategory?: BellCategory | null }) {
  return (
    <div
      role="img"
      aria-label={`Preview of your team's bell: ${title}. ${body}`}
      data-inapp-mockup="team"
      className="w-full max-w-[420px] overflow-hidden rounded-xl border bg-card text-left text-foreground"
    >
      <div className="border-b px-5 py-4">
        <p className="flex items-center text-[15px] font-semibold tracking-tight">
          Notifications
          <span className="ml-2 inline-flex h-5 items-center rounded-full bg-primary/10 px-2 text-[11px] font-semibold text-primary dark:text-[hsl(var(--v2-link,var(--primary)))]">
            1
          </span>
        </p>
      </div>
      <p className="px-5 py-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Today</p>
      <div className="relative w-full bg-primary/[0.03] px-5 py-3.5">
        <div className="flex items-start justify-between gap-3">
          <p className="line-clamp-2 text-[13px] font-semibold leading-snug text-foreground [overflow-wrap:anywhere]">
            {title}
          </p>
          <span data-inapp-unread="" className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-primary" />
        </div>
        {body && (
          <p className="mt-1 line-clamp-2 text-[12px] leading-relaxed text-muted-foreground [overflow-wrap:anywhere]">{body}</p>
        )}
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {bellCategory && CATEGORY_LABEL[bellCategory] && (
            <span
              className={cn(
                "inline-flex h-5 items-center rounded-full px-2 text-[10px] font-medium",
                CATEGORY_TONE[bellCategory],
              )}
            >
              {CATEGORY_LABEL[bellCategory]}
            </span>
          )}
          <span className="text-[11px] text-muted-foreground/70">{IN_APP_TIME_LABEL}</span>
        </div>
      </div>
    </div>
  );
}

/** The booking site's bell popover, one unread row (CustomerPortalHeader.tsx). */
function CustomerBell({
  title,
  body,
  companyName,
  accent,
}: {
  title: string;
  body: string;
  companyName: string;
  accent: string;
}) {
  const muted = "#64748b";
  const line = "#e5e7eb";
  return (
    <div
      role="img"
      aria-label={`Preview of the customer's bell on your booking site: ${title}. ${body}`}
      data-inapp-mockup="customer"
      className="w-full max-w-[320px] overflow-hidden rounded-xl text-left"
      style={{ background: "#ffffff", color: "#0f172a", border: `1px solid ${line}` }}
    >
      <div className="flex items-center justify-between gap-3 px-4 py-2.5" style={{ borderBottom: `1px solid ${line}` }}>
        <span className="min-w-0 truncate text-sm font-semibold">{companyName}</span>
        <span className="relative inline-flex h-8 w-8 shrink-0 items-center justify-center" aria-hidden="true">
          <Bell className="h-5 w-5" />
          <span
            className="absolute -right-0.5 -top-0.5 flex h-4 w-4 items-center justify-center rounded-full text-[10px] font-medium text-white"
            style={{ background: "#ef4444" }}
          >
            1
          </span>
        </span>
      </div>
      <div className="flex items-center justify-between p-4" style={{ borderBottom: `1px solid ${line}` }}>
        <p className="text-base font-semibold">Notifications</p>
        <span className="text-xs" style={{ color: muted }}>
          1 unread
        </span>
      </div>
      <div className="flex" style={{ borderBottom: `1px solid ${line}` }}>
        <span
          className="flex flex-1 items-center justify-center gap-1.5 px-3 py-2 text-sm font-medium"
          style={{ borderBottom: `2px solid ${accent}` }}
        >
          <BellRing className="h-3.5 w-3.5" aria-hidden="true" />
          General
          <span
            className="inline-flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-semibold text-white"
            style={{ background: "#ef4444" }}
          >
            1
          </span>
        </span>
        <span className="flex flex-1 items-center justify-center gap-1.5 px-3 py-2 text-sm font-medium" style={{ color: muted }}>
          <MessageSquare className="h-3.5 w-3.5" aria-hidden="true" />
          Messages
        </span>
      </div>
      <div className="p-3" style={{ background: "#f8fafc" }}>
        <div className="flex items-start justify-between gap-2">
          <p className="text-sm font-medium [overflow-wrap:anywhere]">{title}</p>
          <span data-inapp-unread="" className="mt-1.5 h-2 w-2 shrink-0 rounded-full" style={{ background: accent }} />
        </div>
        {body && (
          <p className="line-clamp-2 text-xs [overflow-wrap:anywhere]" style={{ color: muted }}>
            {body}
          </p>
        )}
        <p className="mt-1 text-xs" style={{ color: muted }}>
          {IN_APP_TIME_LABEL}
        </p>
      </div>
      <div className="p-2" style={{ borderTop: `1px solid ${line}` }}>
        <span className="flex h-8 w-full items-center justify-center text-sm font-medium">View all notifications</span>
      </div>
    </div>
  );
}

export function InAppPreview({
  title,
  body,
  audience,
  companyName,
  link,
  bellCategory,
  accentColor,
  className,
}: InAppPreviewProps) {
  const text = String(body ?? "");
  const rawTitle = String(title ?? "");
  const opens = String(link ?? "").trim();
  return (
    <div className={cn("min-w-0 space-y-2", className)} data-audience={audience}>
      {audience === "team" ? (
        // The portal prints "Notification" for a row without a title.
        <TeamBell title={rawTitle.trim() || "Notification"} body={text} bellCategory={bellCategory} />
      ) : (
        <CustomerBell
          title={rawTitle}
          body={text}
          companyName={String(companyName ?? "").trim() || "Your company"}
          accent={String(accentColor ?? "").trim() || "hsl(var(--primary))"}
        />
      )}
      <p className="text-xs text-muted-foreground">{IN_APP_CAPTIONS[audience]}</p>
      {opens && (
        <p className="text-xs text-muted-foreground">
          Opens <span className="font-mono text-foreground [overflow-wrap:anywhere]">{opens}</span> when clicked.
        </p>
      )}
    </div>
  );
}
