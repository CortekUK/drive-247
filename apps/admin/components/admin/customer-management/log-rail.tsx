'use client';

/**
 * The log, in a column on the right (Oct 23 2026): a tab that keeps a log of
 * what it sent shows it beside the settings rather than under them, so the
 * newest sends are in view while the timeline is edited.
 *
 * From `xl` the log is a sticky column that scrolls on its own; below that it
 * falls back under the content, full width. A five-column table does not fit
 * a 340px column, so each row is a compact entry: who and the result on top,
 * what was sent under it, then when and any detail.
 */

import type { ReactNode } from 'react';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

export function LogRailLayout({ rail, children }: { rail: ReactNode; children: ReactNode }) {
  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_340px] xl:items-start">
      <div className="min-w-0">{children}</div>
      <aside aria-label="Log" className="min-w-0 xl:sticky xl:top-4">
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
}: {
  who: ReactNode;
  status: ReactNode;
  what?: ReactNode;
  when: ReactNode;
  detail?: ReactNode;
}) {
  return (
    <li className="space-y-1 py-3 first:pt-0">
      <div className="flex items-start justify-between gap-3">
        <span className="min-w-0 truncate text-sm font-medium">{who}</span>
        <span className="shrink-0">{status}</span>
      </div>
      {what ? <div className="min-w-0 truncate text-xs">{what}</div> : null}
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">{when}</div>
      {detail ? <div className="break-words text-xs text-muted-foreground">{detail}</div> : null}
    </li>
  );
}
