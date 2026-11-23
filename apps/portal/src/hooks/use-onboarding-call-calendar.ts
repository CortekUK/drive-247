"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabaseUntyped } from "@/integrations/supabase/client";
import { useTenant } from "@/contexts/TenantContext";
import { useFakeQuickTourProfile } from "@/lib/fake-quick-tour";
import { DEFAULT_CALL_CALENDAR, type CallCalendar } from "@/lib/onboarding-call-slots";

/**
 * Bryan's booking calendar for the free onboarding call (23 Nov 2026): our
 * own, in place of the GoHighLevel widget.
 *
 *   calendar  `get_onboarding_call_calendar()`: his settings, the busy
 *             times, and this company's own booking
 *   book      `book_onboarding_call(...)`: checked again on the server, and
 *             booking while booked moves the call
 *   cancel    `cancel_my_onboarding_call()`
 *
 * Both writes also update the company's onboarding-call row, so the sidebar
 * card and the "book your call" emails follow without anything else.
 *
 * On a /fake-quick-tour run nothing is written: book and cancel only pretend,
 * and if the database has no calendar yet the default one is shown, so the
 * screens can still be looked at.
 */

export interface BookCallInput {
  startsAt: Date;
  name: string;
  email: string;
  phone?: string;
  notes?: string;
}

export interface BookedCall {
  id: string;
  starts_at: string;
  ends_at: string;
  meeting_url: string | null;
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
        return { id: "fake", starts_at: input.startsAt.toISOString(), ends_at: ends.toISOString(), meeting_url: null };
      }
      const { data, error } = await supabaseUntyped.rpc("book_onboarding_call", {
        p_starts_at: input.startsAt.toISOString(),
        p_name: input.name,
        p_email: input.email,
        p_phone: input.phone || null,
        p_notes: input.notes || null,
      });
      if (error) throw new Error(error.message);
      return data as BookedCall;
    },
    onSettled: () => {
      if (!fake) refresh();
    },
  });

  const cancel = useMutation({
    mutationFn: async () => {
      if (fake) return;
      const { error } = await supabaseUntyped.rpc("cancel_my_onboarding_call");
      if (error) throw new Error(error.message);
    },
    onSettled: () => {
      if (!fake) refresh();
    },
  });

  return { calendar, book, cancel, fake: !!fake };
}
