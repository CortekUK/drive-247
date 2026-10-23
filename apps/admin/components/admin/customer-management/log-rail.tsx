'use client';

/**
 * The log, in a column on the right (owner, Oct 23 2026): a tab that keeps a
 * log of what it sent — or any read-only record (used offers, history,
 * registrations, deliveries) — shows it beside the settings rather than under
 * them, so the newest entries are in view while the settings are edited.
 *
 * From `xl` the log is a sticky column that scrolls on its own; below that it
 * falls back under the content, full width. A five-column table does not fit
 * a 340px column, so each row is a compact entry: who and the result on top,
 * what was sent under it, then when and any detail.
 */

import type { ReactNode } from 'react';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

export function LogRailLayout({ rail, label = 'Log', children }: { rail: ReactNode; label?: string; children: ReactNode }) {
  // Nothing to show on the right (no issue chosen yet …): the content keeps the full width.
  if (!rail) return <>{children}</>;
  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_340px] xl:items-start">
      <div className="min-w-0">{children}</div>
      <aside aria-label={label} className="min-w-0 xl:sticky xl:top-4">
        {rail}
      </aside>
    </div>
  );
}

/** The log's card: a title, one line, optional controls under them, and the entries, scrolling inside it. */
export function LogRailCard({
  title,
  description,
  actions,
  children,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <Card className="flex flex-col xl:max-h-[calc(100dvh-8rem)]">
      <CardHeader className="shrink-0 space-y-1 p-5 pb-3">
        <CardTitle className="text-lg">{title}</CardTitle>
        {description ? <CardDescription>{description}</CardDescription> : null}
        {actions ? <div className="flex flex-wrap items-center justify-between gap-3 pt-2">{actions}</div> : null}
      </CardHeader>
      <CardContent className="min-h-0 flex-1 overflow-y-auto p-5 pt-0">{children}</CardContent>
    </Card>
  );
}

export function LogList({ children }: { children: ReactNode }) {
  return <ul className="divide-y">{children}</ul>;
}

export function LogEntry({
  who,
  status,
  what,
  when,
  detail,
  action,
  onOpen,
}: {
  who: ReactNode;
  status?: ReactNode;
  what?: ReactNode;
  when?: ReactNode;
  detail?: ReactNode;
  /** A row's own button (Allow again …), under the rest. */
  action?: ReactNode;
  /** The whole entry opens something (a booking attempt's detail). */
  onOpen?: () => void;
}) {
  const body = (
    <>
      <div className="flex items-start justify-between gap-3">
        <span className="min-w-0 truncate text-sm font-medium">{who}</span>
        {status ? <span className="shrink-0">{status}</span> : null}
      </div>
      {what ? <div className="min-w-0 truncate text-xs">{what}</div> : null}
      {when ? <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">{when}</div> : null}
      {detail ? <div className="break-words text-xs text-muted-foreground">{detail}</div> : null}
      {action ? <div className="pt-1">{action}</div> : null}
    </>
  );
  if (onOpen) {
    return (
      <li className="py-1 first:pt-0">
        <button
          type="button"
          onClick={onOpen}
          className="-mx-2 block w-[calc(100%+1rem)] space-y-1 rounded-lg px-2 py-2 text-left transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {body}
        </button>
      </li>
    );
  }
  return <li className="space-y-1 py-3 first:pt-0">{body}</li>;
}
