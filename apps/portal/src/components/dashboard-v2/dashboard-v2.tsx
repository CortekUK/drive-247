"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui-v2/button";
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@/components/ui-v2/hover-card";
import { Plus, Pencil } from "lucide-react";

import { useAuth } from "@/stores/auth-store";
import { useTenant } from "@/contexts/TenantContext";
import { useManagerPermissions } from "@/hooks/use-manager-permissions";
import { buildAvailabilitySummary } from "@/hooks/use-working-hours-summary";
// v1 components, imported and not edited. These are operational alerts that
// must survive a visual refresh — see the note above the JSX.
import { LowCreditsBanner } from "@/components/dashboard/low-credits-banner";
import { BonzahStatusBanner } from "@/components/dashboard/bonzah-status-banner";
import { BonzahPendingAlert } from "@/components/dashboard/bonzah-pending-alert";
import { SetupGuide } from "@/components/dashboard-v2/setup-guide";
import { useSetupGuide } from "@/hooks/use-setup-guide";
import { HomeBands } from "@/components/dashboard-v2/home/home-bands";
import { HOME_PALETTE } from "@/components/dashboard-v2/home/ui";

/**
 * The v2 dashboard body.
 *
 * Rendered by `(dashboard)/page.tsx` when `useV2('dashboard')` is true — i.e.
 * for the `northwind` canary only. It is a component rather than a page because
 * the v1 route keeps ownership of the URL, which is what makes the gate a
 * single deletable branch (V2_PLAN §3).
 *
 * The body is three named bands (`HomeBands`) under an editorial hero. The
 * bands run on their own palette, injected as a `<style>` block scoped to `.pv`
 * so those tokens cannot leak into the rest of the portal.
 */

// ─── Greeting ────────────────────────────────────────────────────────────────

function getGreeting(hour: number): { text: string; emoji: string } {
  if (hour < 5) return { text: "Working late", emoji: "🦉" };
  if (hour < 12) return { text: "Good morning", emoji: "☕" };
  if (hour < 17) return { text: "Good afternoon", emoji: "🌤️" };
  if (hour < 21) return { text: "Good evening", emoji: "🌇" };
  return { text: "Good night", emoji: "✨" };
}

// ─── Working hours ───────────────────────────────────────────────────────────

/** JS getDay() order — index 0 is Sunday. */
const DAY_KEYS = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
] as const;

/**
 * The same column set and query key as `useWorkingHoursSummary` / WorkingHoursCard,
 * so all three share one React Query cache entry and this costs no extra fetch.
 */
const WORKING_HOURS_COLUMNS = `
  working_hours_always_open,
  timezone,
  monday_enabled, monday_open, monday_close,
  tuesday_enabled, tuesday_open, tuesday_close,
  wednesday_enabled, wednesday_open, wednesday_close,
  thursday_enabled, thursday_open, thursday_close,
  friday_enabled, friday_open, friday_close,
  saturday_enabled, saturday_open, saturday_close,
  sunday_enabled, sunday_open, sunday_close
`;

/** "HH:mm[:ss]" → minutes past midnight. */
function toMinutes(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + (m || 0);
}

/** "HH:mm[:ss]" → "9:00 AM". Mirrors the formatter in use-working-hours-summary. */
function formatTime12(time: string): string {
  const [h, m] = time.split(":").map(Number);
  const period = h >= 12 ? "PM" : "AM";
  const hour12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return `${hour12}:${String(m || 0).padStart(2, "0")} ${period}`;
}

/**
 * Which weekday is it, and what time, *in the tenant's timezone*?
 *
 * An operator in Denver checking the portal from a phone still on UK time must
 * see their own shop's state, not the browser's. Falls back to browser-local
 * when the tenant has no timezone set.
 */
function zonedNow(timezone: string | null | undefined, tick: Date) {
  if (!timezone) {
    return { day: tick.getDay(), minutes: tick.getHours() * 60 + tick.getMinutes() };
  }
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).formatToParts(tick);
    const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
    const weekdayIndex = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(
      get("weekday")
    );
    const hour = Number(get("hour"));
    return {
      day: weekdayIndex >= 0 ? weekdayIndex : tick.getDay(),
      // Intl gives "24" for midnight under hour12:false in some engines.
      minutes: (hour === 24 ? 0 : hour) * 60 + Number(get("minute")),
    };
  } catch {
    return { day: tick.getDay(), minutes: tick.getHours() * 60 + tick.getMinutes() };
  }
}

/**
 * Today's configured window, using the same defaults as the booking side
 * (Mon–Fri 09:00–17:00 open, Sat/Sun closed) so this agrees with what the
 * customer-facing widget actually enforces.
 */
function scheduleForDay(row: any, dayIndex: number) {
  const key = DAY_KEYS[dayIndex];
  const weekend = key === "saturday" || key === "sunday";
  return {
    enabled: (row?.[`${key}_enabled`] ?? !weekend) as boolean,
    open: (row?.[`${key}_open`] ?? (weekend ? "10:00" : "09:00")) as string,
    close: (row?.[`${key}_close`] ?? (weekend ? "14:00" : "17:00")) as string,
  };
}

export function DashboardV2() {
  const router = useRouter();
  const { appUser } = useAuth();
  const { tenant } = useTenant();
  const { canView, canEdit } = useManagerPermissions();

  // The guide is a call to action, so it only goes to someone who can act on
  // it: `canEdit` is false for viewers and for managers without an editor
  // grant on Settings, and true for every other role.
  const { isVisible: setupGuideIsVisible } = useSetupGuide();
  const setupGuideVisible = setupGuideIsVisible && canEdit("settings.general");

  /** First name only — "Good morning, Michael" reads better than the full name. */
  const firstName = (appUser?.name || "").trim().split(/\s+/)[0];

  // `now` starts null so server and first client render agree, then ticks.
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    setNow(new Date());
    const id = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(id);
  }, []);

  const greeting = getGreeting(now ? now.getHours() : 8);
  const dateStr = now
    ? now.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })
    : "";
  const timeStr = now
    ? now.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })
    : "";

  // ── Booking availability (read-only) ──────────────────────────────────────
  //
  // TENANT ISOLATION: `tenants` is keyed on its own primary key here, so this
  // can only ever return the row for the resolved tenant. `enabled` keeps it
  // from firing before one exists.
  const { data: hoursRow } = useQuery({
    queryKey: ["working-hours", tenant?.id],
    queryFn: async () => {
      if (!tenant?.id) return null;
      const { data, error } = await supabase
        .from("tenants")
        .select(WORKING_HOURS_COLUMNS)
        .eq("id", tenant.id)
        .single();
      if (error) throw error;
      return data;
    },
    enabled: !!tenant?.id,
  });

  const availability = useMemo(() => {
    if (!hoursRow || !now) return null;
    const tz = (hoursRow as any).timezone as string | null;
    const alwaysOpen = ((hoursRow as any).working_hours_always_open ?? true) as boolean;
    const { day, minutes } = zonedNow(tz, now);
    const today = scheduleForDay(hoursRow, day);
    const isOpen = alwaysOpen
      ? true
      : today.enabled &&
        minutes >= toMinutes(today.open) &&
        minutes < toMinutes(today.close);
    return {
      alwaysOpen,
      isOpen,
      today,
      timezone: tz,
      summary: buildAvailabilitySummary(hoursRow as any),
    };
  }, [hoursRow, now]);

  return (
    <div className="mx-auto w-full max-w-[1560px] space-y-10 px-2 pb-4">
      {/*
        Operational alerts stay above the redesign. These are the banners that
        tell a tenant their credits are running out, or that Bonzah has made a
        decision on their onboarding — losing them to a visual refresh would be
        a functional regression, not a style change.
      */}
      <LowCreditsBanner />
      <BonzahStatusBanner />
      <BonzahPendingAlert />

      {/* Editorial hero */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold leading-tight tracking-tight">
            {greeting.text}
            {firstName ? `, ${firstName}` : ""}.{" "}
            <span className="align-middle">{greeting.emoji}</span>
          </h1>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
            <span>
              {dateStr}
              {timeStr && ` · ${timeStr}`}
            </span>
            {availability && (
              <HoverCard openDelay={100} closeDelay={80}>
                <HoverCardTrigger asChild>
                  <span
                    className={`inline-flex cursor-default items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium transition-colors ${
                      availability.isOpen
                        ? "border-success/30 bg-success/10 text-success"
                        : "border-border bg-muted/60 text-muted-foreground"
                    }`}
                  >
                    <span
                      className={`size-1.5 rounded-full ${
                        availability.isOpen ? "bg-success" : "bg-muted-foreground/40"
                      }`}
                    />
                    {availability.isOpen ? "Open" : "Closed"}
                  </span>
                </HoverCardTrigger>
                <HoverCardContent align="start" className="w-72">
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-semibold">Booking availability</span>
                      <span
                        className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium ${
                          availability.isOpen
                            ? "border-success/30 bg-success/10 text-success"
                            : "border-border bg-muted/60 text-muted-foreground"
                        }`}
                      >
                        <span
                          className={`size-1.5 rounded-full ${
                            availability.isOpen ? "bg-success" : "bg-muted-foreground/40"
                          }`}
                        />
                        {availability.isOpen ? "Open now" : "Closed"}
                      </span>
                    </div>

                    <div className="space-y-2 text-xs">
                      <div className="flex items-center justify-between gap-3">
                        <span className="shrink-0 text-muted-foreground">Today</span>
                        <span className="text-right font-medium">
                          {availability.alwaysOpen
                            ? "Open 24 hours"
                            : availability.today.enabled
                              ? `${formatTime12(availability.today.open)} – ${formatTime12(
                                  availability.today.close
                                )}`
                              : "Closed"}
                        </span>
                      </div>
                      {availability.summary && (
                        <div className="flex items-center justify-between gap-3">
                          <span className="shrink-0 text-muted-foreground">Weekly</span>
                          <span className="text-right font-medium">{availability.summary}</span>
                        </div>
                      )}
                      {availability.timezone && (
                        <div className="flex items-center justify-between gap-3">
                          <span className="shrink-0 text-muted-foreground">Timezone</span>
                          <span className="text-right font-medium">{availability.timezone}</span>
                        </div>
                      )}
                    </div>

                    {canEdit("availability") && (
                      <Button
                        variant="outline"
                        size="sm"
                        className="w-full gap-1.5"
                        onClick={() => router.push("/blocked-dates")}
                      >
                        <Pencil className="size-3.5" /> Edit availability
                      </Button>
                    )}
                  </div>
                </HoverCardContent>
              </HoverCard>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {/* One slot, two states. While setup is unfinished the guide holds
              the primary position; the moment the operator finishes it the
              guide disappears and New Rental — the button they'll press every
              day from then on — takes the slot back. */}
          {setupGuideVisible ? (
            <SetupGuide />
          ) : (
            canEdit("rentals") && (
              <Button
                size="lg"
                className="gap-2 rounded-full"
                onClick={() => router.push("/rentals/new")}
              >
                <Plus className="size-4" /> New Rental
              </Button>
            )
          )}
        </div>
      </div>

      {/* Three named bands — Important, Today, Stats — on their own scoped
          palette. `.pv` keeps those tokens off the rest of the portal. */}
      <style>{HOME_PALETTE}</style>
      <div className="pv">
        <HomeBands />
      </div>
    </div>
  );
}
