"use client";

import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabaseUntyped } from "@/integrations/supabase/client";
import { useTenant } from "@/contexts/TenantContext";
import { useFakeQuickTourProfile } from "@/lib/fake-quick-tour";
import { DEFAULT_CALL_CALENDAR, type CallCalendar } from "@/lib/onboarding-call-slots";
import { getChosenZone, ZONE_CHANGED_EVENT } from "@/lib/onboarding-call-time";

/**
 * Bryan's booking calendar for the free onboarding call (feat-001 spec 04).
 *
 *   calendar  `get_onboarding_call_calendar()`: his settings, the free times
 *             (worked out on the server, the one place they are), and this
 *             company's own booking
 *   book      `book_onboarding_call(...)`: booking while booked moves the call
 *   cancel    `cancel_my_onboarding_call(reason)`
 *
 * Both writes queue their emails in the database; `flushCallEmails` asks the
 * mailer to send them now (the 5-minute job would send them anyway).
 *
 * On a /fake-quick-tour run nothing is written: book and cancel only pretend,
 * and if the database has no calendar yet the default one is shown.
 */

export interface BookCallInput {
  startsAt: Date;
  name: string;
  email: string;
  phone?: string;
  notes?: string;
  timezone: string;
}

export interface BookedCall {
  id: string;
  starts_at: string;
  ends_at: string;
  meeting_url: string | null;
  ics_token: string | null;
  moved: boolean;
}

/** Ask the mailer to send what an action queued. Never waited on. */
export function flushCallEmails(): void {
  void supabaseUntyped.functions.invoke("onboarding-call-mailer", { body: { flush: true } }).catch(() => undefined);
}

/** The zone times are shown in: the device's, or the one picked with "change". */
export function useCallZone(): string {
  const [zone, setZone] = useState<string>(() => (typeof window === "undefined" ? "UTC" : getChosenZone()));
  useEffect(() => {
    const update = () => setZone(getChosenZone());
    update();
    window.addEventListener(ZONE_CHANGED_EVENT, update);
    window.addEventListener("storage", update);
    return () => {
      window.removeEventListener(ZONE_CHANGED_EVENT, update);
      window.removeEventListener("storage", update);
    };
  }, []);
  return zone;
}

export function useOnboardingCallCalendar({ enabled = true }: { enabled?: boolean } = {}) {
  const { tenant } = useTenant();
  const queryClient = useQueryClient();
  const fake = useFakeQuickTourProfile();
  const key = ["onboarding-call-calendar", tenant?.id];

  const calendar = useQuery({
    queryKey: key,
    enabled: !!tenant?.id && enabled,
    // Slots go stale as people book: read fresh each time the calendar opens.
    staleTime: 0,
    refetchOnMount: "always",
    queryFn: async (): Promise<CallCalendar> => {
      const { data, error } = await supabaseUntyped.rpc("get_onboarding_call_calendar");
      if (error) {
        if (fake) return DEFAULT_CALL_CALENDAR;
        throw error;
      }
      return data as CallCalendar;
    },
  });

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: key });
    queryClient.invalidateQueries({ queryKey: ["onboarding-call", tenant?.id] });
  };

  const book = useMutation({
    mutationFn: async (input: BookCallInput): Promise<BookedCall> => {
      if (fake) {
        const ends = new Date(input.startsAt.getTime() + (calendar.data?.duration_minutes ?? 30) * 60_000);
        return {
          id: "fake",
          starts_at: input.startsAt.toISOString(),
          ends_at: ends.toISOString(),
          meeting_url: null,
          ics_token: null,
          moved: !!calendar.data?.mine,
        };
      }
      const { data, error } = await supabaseUntyped.rpc("book_onboarding_call", {
        p_starts_at: input.startsAt.toISOString(),
        p_name: input.name,
        p_email: input.email,
        p_phone: input.phone || null,
        p_notes: input.notes || null,
        p_timezone: input.timezone,
      });
      if (error) throw new Error(error.message);
      return data as BookedCall;
    },
    onSuccess: () => {
      if (!fake) flushCallEmails();
    },
    onSettled: () => {
      if (!fake) refresh();
    },
  });

  const cancel = useMutation({
    mutationFn: async (reason?: string) => {
      if (fake) return;
      const { error } = await supabaseUntyped.rpc("cancel_my_onboarding_call", { p_reason: reason?.trim() || null });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      if (!fake) flushCallEmails();
    },
    onSettled: () => {
      if (!fake) refresh();
    },
  });

  return { calendar, book, cancel, fake: !!fake };
}
