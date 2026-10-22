"use client";

/**
 * The agreement drawer's activity log, shared by both portals (the operator's
 * agreement-activity-v2.tsx wraps it). Every event on the way from created to
 * signed, oldest first: created, sent, the signing email, opened, signed,
 * completed, reminders, a send that failed.
 *
 * Read from the `agreements-v2` function's `history` action, which merges our
 * own records with the signing service's audit trail for the document. Each
 * portal hands in its own call (`fetchHistory`), which carries its own session.
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
  Send,
  XCircle,
  type LucideIcon,
} from "lucide-react";
import { cn } from "../cn";
import { Button } from "../timeline/button";
import type { AgreementKind } from "./list";

export interface AgreementEvent {
  at: string;
  type: string;
  label: string;
  detail?: string;
}

export type FetchAgreementHistory = (id: string, kind: AgreementKind) => Promise<{ events: AgreementEvent[]; partial: boolean }>;

const PRIMARY = "text-v2-primary dark:text-v2-link";

const EVENT_LOOK: Record<string, { icon: LucideIcon; tone: string }> = {
  created: { icon: FilePlus2, tone: "text-v2-muted-fg" },
  sent: { icon: Send, tone: PRIMARY },
  email_delivered: { icon: Mail, tone: PRIMARY },
  delivered: { icon: Mail, tone: PRIMARY },
  viewed: { icon: Eye, tone: "text-blue-600 dark:text-blue-400" },
  signed: { icon: PenLine, tone: "text-green-600 dark:text-green-400" },
  completed: { icon: CheckCircle2, tone: "text-green-600 dark:text-green-400" },
  reminder: { icon: Bell, tone: "text-amber-600 dark:text-amber-400" },
  remindersent: { icon: Bell, tone: "text-amber-600 dark:text-amber-400" },
  declined: { icon: XCircle, tone: "text-v2-destructive" },
  revoked: { icon: XCircle, tone: "text-v2-destructive" },
  expired: { icon: XCircle, tone: "text-v2-destructive" },
  send_failed: { icon: AlertTriangle, tone: "text-v2-destructive" },
  email_failed: { icon: AlertTriangle, tone: "text-v2-destructive" },
  deliveryfailed: { icon: AlertTriangle, tone: "text-v2-destructive" },
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

export function AgreementActivity({
  row,
  fetchHistory,
  className,
}: {
  row: { id: string; kind: AgreementKind };
  fetchHistory: FetchAgreementHistory;
  className?: string;
}) {
  const query = useQuery({
    queryKey: ["agreement-history-v2", row.kind, row.id],
    queryFn: () => fetchHistory(row.id, row.kind),
    staleTime: 15_000,
    retry: 1,
  });

  // Opening the document fetches it from the signing service, which logs that
  // as "Downloaded by <our account>" every time. That is the portal, not the
  // signer, so it is left out.
  const events: AgreementEvent[] = (query.data?.events ?? []).filter((e) => e.type !== "downloaded");

  return (
    <aside aria-label="Activity" className={cn("flex min-h-0 flex-col bg-v2-bg", className)}>
      <div className="flex items-center justify-between gap-2 px-5 pt-3">
        <p className="text-xs text-v2-muted-fg">Every step, oldest first</p>
        {/* Words, not the circular-arrows icon (owner, Oct 22 2026). */}
        <Button
          variant="ghost"
          size="sm"
          aria-label="Refresh activity"
          onClick={() => void query.refetch()}
          disabled={query.isFetching}
        >
          {query.isFetching ? "Refreshing…" : "Refresh"}
        </Button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-3">
        {query.isLoading ? (
          <ul className="space-y-4" role="status" aria-label="Loading activity">
            {[0, 1, 2].map((i) => (
              <li key={i} className="flex gap-3">
                <div className="size-6 shrink-0 animate-pulse rounded-full bg-v2-muted" />
                <div className="flex-1 space-y-1.5">
                  <div className="h-3 w-3/4 animate-pulse rounded bg-v2-muted" />
                  <div className="h-3 w-1/3 animate-pulse rounded bg-v2-muted" />
                </div>
              </li>
            ))}
          </ul>
        ) : query.isError ? (
          <div className="text-sm" role="alert">
            <p className="font-medium text-v2-fg">The activity could not be loaded</p>
            <p className="mt-1 text-v2-muted-fg">
              {query.error instanceof Error ? query.error.message : "Try again in a moment."}
            </p>
          </div>
        ) : events.length === 0 ? (
          <p className="text-sm text-v2-muted-fg">Nothing has happened to this agreement yet.</p>
        ) : (
          <ol className="relative">
            {events.map((event, i) => {
              const look = EVENT_LOOK[event.type] ?? { icon: Circle, tone: "text-v2-muted-fg" };
              const Icon = look.icon;
              const last = i === events.length - 1;
              return (
                <li key={`${event.at}-${event.type}-${i}`} className="relative flex gap-3 pb-5 last:pb-0">
                  {!last && <span aria-hidden="true" className="absolute top-7 bottom-0 left-3 w-px bg-v2-border" />}
                  <span className="flex size-6 shrink-0 items-center justify-center rounded-full border border-v2-border bg-v2-bg">
                    <Icon className={cn("size-3.5", look.tone)} aria-hidden="true" />
                  </span>
                  <div className="min-w-0 pt-0.5">
                    <p className="text-sm text-v2-fg">{event.label}</p>
                    {event.detail && <p className="truncate text-xs text-v2-muted-fg" title={event.detail}>{event.detail}</p>}
                    <p className="text-xs text-v2-muted-fg tabular-nums">{formatWhen(event.at)}</p>
                  </div>
                </li>
              );
            })}
          </ol>
        )}
        {query.data?.partial && (
          <p className="mt-4 text-xs text-v2-muted-fg">
            The signing service didn't answer, so opens and signatures may be missing. Refresh to try again.
          </p>
        )}
      </div>
    </aside>
  );
}
