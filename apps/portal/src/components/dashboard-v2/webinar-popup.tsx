"use client";

/**
 * The webinar invitation popup on the v2 home.
 *
 * Super admins publish webinars (admin → Customer management → Webinars);
 * `get_my_webinars()` returns the ones this tenant is invited to that haven't
 * ended. The popup shows the soonest one the tenant hasn't registered for, with
 * a one-click Register (`webinar-register`, which also emails the
 * confirmation). "Not now" hides that webinar in this browser for a day.
 */

import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarDays, CheckCircle2, Clock, ExternalLink, Loader2, Video } from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui-v2/dialog";
import { Button } from "@/components/ui-v2/button";
import { supabase, supabaseUntyped } from "@/integrations/supabase/client";
import { useTenant } from "@/contexts/TenantContext";

interface Webinar {
  id: string;
  title: string;
  description: string | null;
  starts_at: string;
  duration_minutes: number;
  timezone: string;
  registered: boolean;
}

const SNOOZE_KEY = (id: string) => `d247:webinar-snooze:${id}`;
const SNOOZE_MS = 24 * 60 * 60 * 1000;

function snoozed(id: string): boolean {
  try {
    const at = Number(window.localStorage.getItem(SNOOZE_KEY(id)));
    return Number.isFinite(at) && at > 0 && Date.now() - at < SNOOZE_MS;
  } catch {
    return false;
  }
}

function snooze(id: string) {
  try {
    window.localStorage.setItem(SNOOZE_KEY(id), String(Date.now()));
  } catch {
    /* it will just show again next visit */
  }
}

function validTz(tz: string | null | undefined): string | undefined {
  if (!tz) return undefined;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return tz;
  } catch {
    return undefined;
  }
}

const calStamp = (d: Date) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");

export function WebinarPopup() {
  const { tenant } = useTenant();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [done, setDone] = useState<{ email: string | null; emailStatus: string; meetUrl: string } | null>(null);

  const { data } = useQuery({
    queryKey: ["my-webinars", tenant?.id],
    enabled: !!tenant?.id,
    staleTime: 5 * 60 * 1000,
    queryFn: async (): Promise<Webinar[]> => {
      const { data, error } = await supabaseUntyped.rpc("get_my_webinars");
      if (error) throw error;
      return Array.isArray(data) ? (data as Webinar[]) : [];
    },
  });

  const webinar = useMemo(() => (data ?? []).find((w) => !w.registered && !snoozed(w.id)) ?? null, [data]);

  useEffect(() => {
    if (webinar) {
      setDone(null);
      setOpen(true);
    }
  }, [webinar?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const register = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke("webinar-register", { body: { webinarId: webinar!.id } });
      if (error) {
        let message = error.message;
        try {
          const body = await (error as { context?: Response }).context?.json();
          if (body?.error) message = body.error;
        } catch {
          /* keep the generic message */
        }
        throw new Error(message);
      }
      return data as { email: string | null; emailStatus: string; meetUrl: string };
    },
    onSuccess: (res) => setDone(res),
    onError: (e: Error) => toast.error("We couldn't register you", { description: e.message }),
  });

  if (!webinar) return null;

  const tz = validTz(tenant?.timezone) ?? validTz(webinar.timezone);
  const start = new Date(webinar.starts_at);
  const end = new Date(start.getTime() + webinar.duration_minutes * 60_000);
  const date = start.toLocaleDateString("en-US", { timeZone: tz, weekday: "long", month: "long", day: "numeric" });
  const time = start.toLocaleTimeString("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit", timeZoneName: "short" });

  const close = (next: boolean) => {
    if (next) return;
    if (!done) snooze(webinar.id);
    setOpen(false);
    if (done) void queryClient.invalidateQueries({ queryKey: ["my-webinars", tenant?.id] });
  };

  const calendarUrl = done
    ? `https://calendar.google.com/calendar/render?${new URLSearchParams({
        action: "TEMPLATE",
        text: webinar.title,
        dates: `${calStamp(start)}/${calStamp(end)}`,
        details: `${webinar.description ? `${webinar.description}\n\n` : ""}Join: ${done.meetUrl}`,
        location: done.meetUrl,
      }).toString()}`
    : "";

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="gap-0 p-0 sm:max-w-lg">
        <div className="px-8 pb-6 pt-8">
          <DialogHeader className="text-left">
            <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.18em] text-primary">
              <Video className="h-3.5 w-3.5" />
              {done ? "You're registered" : "Live webinar"}
            </p>
            <DialogTitle className="text-2xl font-semibold tracking-tight">{webinar.title}</DialogTitle>
            {!done && webinar.description && (
              <DialogDescription className="whitespace-pre-line">{webinar.description}</DialogDescription>
            )}
            {done && (
              <DialogDescription>
                {done.emailStatus === "sent" && done.email
                  ? `We've sent the details and the meeting link to ${done.email}.`
                  : "Your place is saved. Here's the link — keep it handy."}
              </DialogDescription>
            )}
          </DialogHeader>

          <div className="mt-5 space-y-2.5 rounded-2xl bg-muted/50 px-5 py-4 text-sm">
            <p className="flex items-center gap-2.5">
              <CalendarDays className="h-4 w-4 text-muted-foreground" />
              {date}
            </p>
            <p className="flex items-center gap-2.5">
              <Clock className="h-4 w-4 text-muted-foreground" />
              {time} · {webinar.duration_minutes} minutes
            </p>
            {done && (
              <a
                href={done.meetUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2.5 text-primary underline-offset-4 hover:underline"
              >
                <ExternalLink className="h-4 w-4" />
                Join the meeting
              </a>
            )}
          </div>
        </div>

        <div className="flex items-center justify-end gap-3 border-t px-8 py-4">
          {done ? (
            <>
              <a
                href={calendarUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm text-muted-foreground underline-offset-4 transition-colors hover:text-foreground hover:underline"
              >
                Add to Google Calendar
              </a>
              <Button onClick={() => close(false)} className="h-9 gap-1.5 rounded-xl px-5">
                <CheckCircle2 className="h-4 w-4" />
                Done
              </Button>
            </>
          ) : (
            <>
              <button
                type="button"
                onClick={() => close(false)}
                className="text-sm text-muted-foreground underline-offset-4 transition-colors hover:text-foreground hover:underline"
              >
                Not now
              </button>
              <Button onClick={() => register.mutate()} disabled={register.isPending} className="h-9 rounded-xl px-5">
                {register.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Register — one click"}
              </Button>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
