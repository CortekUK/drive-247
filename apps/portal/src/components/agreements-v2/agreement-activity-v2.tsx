"use client";

/**
 * Agreements v2: the View dialog's activity log. Every event on the way from
 * created to signed, oldest first: created, sent, the signing email, opened,
 * signed, completed, reminders, a send that failed.
 *
 * Read from the `agreements-v2` function's `history` action, which merges our
 * own records with the signing service's audit trail for the document.
 */

import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  Bell,
  CheckCircle2,
  Circle,
  Eye,
  FilePlus2,
  Mail,
  PenLine,
  RefreshCw,
  Send,
  XCircle,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui-v2/button";
import { fetchAgreementHistoryV2, type AgreementEventV2 } from "@/lib/agreements-v2/api-client";
import type { AgreementRowV2 } from "@/lib/agreements-v2/types";
import { cn } from "@/lib/utils";

const EVENT_LOOK: Record<string, { icon: LucideIcon; tone: string }> = {
  created: { icon: FilePlus2, tone: "text-muted-foreground" },
  sent: { icon: Send, tone: "text-primary dark:text-[hsl(var(--v2-link,var(--primary)))]" },
  email_delivered: { icon: Mail, tone: "text-primary dark:text-[hsl(var(--v2-link,var(--primary)))]" },
  delivered: { icon: Mail, tone: "text-primary dark:text-[hsl(var(--v2-link,var(--primary)))]" },
  viewed: { icon: Eye, tone: "text-blue-600 dark:text-blue-400" },
  signed: { icon: PenLine, tone: "text-green-600 dark:text-green-400" },
  completed: { icon: CheckCircle2, tone: "text-green-600 dark:text-green-400" },
  reminder: { icon: Bell, tone: "text-amber-600 dark:text-amber-400" },
  remindersent: { icon: Bell, tone: "text-amber-600 dark:text-amber-400" },
  declined: { icon: XCircle, tone: "text-destructive" },
  revoked: { icon: XCircle, tone: "text-destructive" },
  expired: { icon: XCircle, tone: "text-destructive" },
  send_failed: { icon: AlertTriangle, tone: "text-destructive" },
  email_failed: { icon: AlertTriangle, tone: "text-destructive" },
  deliveryfailed: { icon: AlertTriangle, tone: "text-destructive" },
};

const formatWhen = (iso: string) => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    ...(sameYear ? {} : { year: "numeric" }),
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
};

export function AgreementActivityV2({ row, className }: { row: AgreementRowV2; className?: string }) {
  const query = useQuery({
    queryKey: ["agreement-history-v2", row.kind, row.id],
    queryFn: () => fetchAgreementHistoryV2(row.id, row.kind),
    staleTime: 15_000,
    retry: 1,
  });

  // Opening the document here fetches it from the signing service, which logs
  // that as "Downloaded by <our account>" every time. That is us, not the
  // customer, so it is left out.
  const events: AgreementEventV2[] = (query.data?.events ?? []).filter((e) => e.type !== "downloaded");

  return (
    <aside aria-label="Activity" className={cn("flex min-h-0 flex-col bg-background", className)}>
      <div className="flex items-center justify-between gap-2 px-5 pt-3">
        <p className="text-xs text-muted-foreground">Every step, oldest first</p>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Refresh activity"
          onClick={() => void query.refetch()}
          disabled={query.isFetching}
        >
          <RefreshCw className={cn(query.isFetching && "animate-spin motion-reduce:animate-none")} />
        </Button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-3">
        {query.isLoading ? (
          <ul className="space-y-4" role="status" aria-label="Loading activity">
            {[0, 1, 2].map((i) => (
              <li key={i} className="flex gap-3">
                <div className="size-6 shrink-0 animate-pulse rounded-full bg-muted" />
                <div className="flex-1 space-y-1.5">
                  <div className="h-3 w-3/4 animate-pulse rounded bg-muted" />
                  <div className="h-3 w-1/3 animate-pulse rounded bg-muted" />
                </div>
              </li>
            ))}
          </ul>
        ) : query.isError ? (
          <div className="text-sm" role="alert">
            <p className="font-medium text-foreground">The activity could not be loaded</p>
            <p className="mt-1 text-muted-foreground">
              {query.error instanceof Error ? query.error.message : "Try again in a moment."}
            </p>
          </div>
        ) : events.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nothing has happened to this agreement yet.</p>
        ) : (
          <ol className="relative">
            {events.map((event, i) => {
              const look = EVENT_LOOK[event.type] ?? { icon: Circle, tone: "text-muted-foreground" };
              const Icon = look.icon;
              const last = i === events.length - 1;
              return (
                <li key={`${event.at}-${event.type}-${i}`} className="relative flex gap-3 pb-5 last:pb-0">
                  {!last && <span aria-hidden="true" className="absolute top-7 bottom-0 left-3 w-px bg-border" />}
                  <span className="flex size-6 shrink-0 items-center justify-center rounded-full border border-border bg-background">
                    <Icon className={cn("size-3.5", look.tone)} aria-hidden="true" />
                  </span>
                  <div className="min-w-0 pt-0.5">
                    <p className="text-sm text-foreground">{event.label}</p>
                    {event.detail && <p className="truncate text-xs text-muted-foreground" title={event.detail}>{event.detail}</p>}
                    <p className="text-xs text-muted-foreground tabular-nums">{formatWhen(event.at)}</p>
                  </div>
                </li>
              );
            })}
          </ol>
        )}
        {query.data?.partial && (
          <p className="mt-4 text-xs text-muted-foreground">
            The signing service didn't answer, so opens and signatures may be missing. Refresh to try again.
          </p>
        )}
      </div>
    </aside>
  );
}
