'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { CalendarCheck, CalendarDays, Clock, Loader2, UserX, X } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

import { toast } from '@/components/ui/sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { FilterChip, FilterSearch } from '@/components/admin/filter-primitives';
import { cn } from '@/lib/utils';

import { db, errorText, STATE_STYLE, VIEWS, WHO, type CallRow, type View } from './shared';
import { formatShort } from './time';

const PAGE = 25;

interface Counts {
  today: number;
  week: number;
  needs_marking: number;
  missed_month: number;
}

export interface ListQuery {
  view: View;
  from: string;
  to: string;
  q: string;
}

export function BookingsTab({
  hostTz,
  query,
  onQuery,
  version,
  onOpen,
}: {
  hostTz: string;
  query: ListQuery;
  onQuery: (next: Partial<ListQuery>) => void;
  version: number;
  onOpen: (id: string) => void;
}) {
  const [counts, setCounts] = useState<Counts | null>(null);
  const [rows, setRows] = useState<CallRow[] | null>(null);
  const [total, setTotal] = useState(0);
  const [loadingMore, setLoadingMore] = useState(false);
  const shown = useRef(PAGE);
  const ask = useRef(0);

  const fetchPage = useCallback(
    (offset: number, limit: number) =>
      db.rpc('admin_list_onboarding_calls', {
        p_view: query.view,
        p_from: query.from || null,
        p_to: query.to || null,
        p_search: query.q || null,
        p_limit: limit,
        p_offset: offset,
      }),
    [query.view, query.from, query.to, query.q],
  );

  // Reloads every row already on screen, 100 at a time, so a refresh keeps the page length.
  const reload = useCallback(async () => {
    const mine = ++ask.current;
    const want = Math.max(shown.current, PAGE);
    const out: CallRow[] = [];
    let count = 0;
    for (let offset = 0; offset < want; offset += 100) {
      const { data, error } = await fetchPage(offset, Math.min(100, want - offset));
      if (mine !== ask.current) return;
      if (error) {
        toast.error(errorText(error));
        setRows((r) => r ?? []);
        return;
      }
      const res = data as { rows: CallRow[]; total: number };
      out.push(...res.rows);
      count = Number(res.total);
      if (res.rows.length === 0 || out.length >= count) break;
    }
    setRows(out);
    setTotal(count);
  }, [fetchPage]);

  const loadCounts = useCallback(async () => {
    const { data, error } = await db.rpc('admin_onboarding_call_counts');
    if (error) {
      toast.error(errorText(error));
      return;
    }
    setCounts(data as Counts);
  }, []);

  // A new filter starts again from the first page.
  useEffect(() => {
    shown.current = PAGE;
    setRows(null);
    void reload();
  }, [reload]);

  useEffect(() => {
    void loadCounts();
    if (version > 0) void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version, loadCounts]);

  const loadMore = async () => {
    if (!rows) return;
    setLoadingMore(true);
    const { data, error } = await fetchPage(rows.length, PAGE);
    setLoadingMore(false);
    if (error) {
      toast.error(errorText(error));
      return;
    }
    const res = data as { rows: CallRow[]; total: number };
    const seen = new Set(rows.map((r) => r.id));
    const next = [...rows, ...res.rows.filter((r) => !seen.has(r.id))];
    shown.current = next.length;
    setRows(next);
    setTotal(Number(res.total));
  };

  const filtered = query.view !== 'upcoming' || !!query.from || !!query.to || !!query.q;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Today" value={counts?.today} icon={CalendarDays} tone="primary" active={query.view === 'today'} onClick={() => onQuery({ view: 'today' })} />
        <StatCard label="This week" value={counts?.week} icon={CalendarCheck} tone="primary" />
        <StatCard
          label="Needs marking"
          value={counts?.needs_marking}
          icon={Clock}
          tone="warning"
          active={query.view === 'needs_marking'}
          onClick={() => onQuery({ view: 'needs_marking' })}
        />
        <StatCard label="Missed this month" value={counts?.missed_month} icon={UserX} tone="destructive" active={query.view === 'missed'} onClick={() => onQuery({ view: 'missed' })} />
      </div>

      <div className="space-y-3">
        <FilterSearch
          scopeLabel="Call Calendar"
          value={query.q}
          onChange={(q) => onQuery({ q })}
          placeholder="Search company, person, email or phone"
          debounceMs={300}
        />
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Which calls">
            {VIEWS.map((v) => (
              <FilterChip key={v.id} active={query.view === v.id} onClick={() => onQuery({ view: v.id })}>
                {v.label}
              </FilterChip>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Input type="date" value={query.from} onChange={(e) => onQuery({ from: e.target.value })} className="h-9 w-[150px]" aria-label="From date" />
            <span className="text-sm text-muted-foreground">to</span>
            <Input type="date" value={query.to} onChange={(e) => onQuery({ to: e.target.value })} className="h-9 w-[150px]" aria-label="To date" />
            {filtered && (
              <Button variant="ghost" size="sm" onClick={() => onQuery({ view: 'upcoming', from: '', to: '', q: '' })}>
                <X className="mr-1 h-3.5 w-3.5" />
                Clear
              </Button>
            )}
          </div>
        </div>
      </div>

      <div className="overflow-hidden rounded-4xl bg-card ring-1 ring-foreground/10">
        <Table phoneCards={false} className="min-w-[860px]">
          <TableHeader>
            <TableRow>
              <TableHead>Company</TableHead>
              <TableHead>Person</TableHead>
              <TableHead>Bryan&apos;s time</TableHead>
              <TableHead>Company&apos;s time</TableHead>
              <TableHead>State</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows === null ? (
              Array.from({ length: 4 }).map((_, i) => (
                <TableRow key={i}>
                  <TableCell colSpan={5}>
                    <Skeleton className="h-6 w-full" />
                  </TableCell>
                </TableRow>
              ))
            ) : rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="py-10 text-center text-sm font-normal text-muted-foreground">
                  {filtered ? 'No calls match.' : 'No calls booked right now.'}
                </TableCell>
              </TableRow>
            ) : (
              rows.map((r) => {
                const st = STATE_STYLE[r.state] ?? STATE_STYLE[r.status];
                return (
                  <TableRow
                    key={r.id}
                    className="cursor-pointer"
                    tabIndex={0}
                    onClick={() => onOpen(r.id)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        onOpen(r.id);
                      }
                    }}
                  >
                    <TableCell className="max-w-[220px]">
                      <p className="truncate">{r.company_name || r.slug || 'Unknown company'}</p>
                      {r.booked_via === 'admin' && <p className="text-xs font-normal text-muted-foreground">Booked by Bryan</p>}
                    </TableCell>
                    <TableCell className="max-w-[220px]">
                      <p className="truncate">{r.name}</p>
                      <p className="truncate text-xs font-normal text-muted-foreground">{r.email}</p>
                    </TableCell>
                    <TableCell className="whitespace-nowrap tabular-nums">{formatShort(r.starts_at, hostTz)}</TableCell>
                    <TableCell className="whitespace-nowrap font-normal tabular-nums text-muted-foreground">
                      {r.customer_timezone ? formatShort(r.starts_at, r.customer_timezone) : 'Zone unknown'}
                    </TableCell>
                    <TableCell className="whitespace-nowrap">
                      <p className={cn('text-sm', st.className)}>{st.label}</p>
                      {r.status === 'cancelled' && r.cancelled_by && (
                        <p className="text-xs font-normal text-muted-foreground">Cancelled by {WHO[r.cancelled_by]}</p>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>

      {rows && rows.length > 0 && (
        <div className="flex flex-col items-center gap-2">
          <p className="text-xs text-muted-foreground">
            Showing {rows.length} of {total}
          </p>
          {rows.length < total && (
            <Button variant="outline" size="sm" onClick={() => void loadMore()} disabled={loadingMore}>
              {loadingMore && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Load more
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

function StatCard({
  label,
  value,
  icon: Icon,
  tone,
  active,
  onClick,
}: {
  label: string;
  value: number | undefined;
  icon: LucideIcon;
  tone: 'destructive' | 'warning' | 'primary';
  active?: boolean;
  onClick?: () => void;
}) {
  const toneCls = {
    destructive: { bg: 'bg-destructive/15', text: 'text-destructive', active: 'ring-destructive/40 bg-destructive/5' },
    warning: { bg: 'bg-warning/15', text: 'text-warning', active: 'ring-warning/40 bg-warning/5' },
    primary: { bg: 'bg-primary/15', text: 'text-primary', active: 'ring-primary/40 bg-primary/5' },
  }[tone];
  return (
    <Card
      className={cn('shadow-none', onClick && 'cursor-pointer', active && toneCls.active)}
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={(e) => {
        if (onClick && (e.key === 'Enter' || e.key === ' ')) {
          e.preventDefault();
          onClick();
        }
      }}
    >
      <CardContent className="pt-6 max-md:p-4">
        <div className="flex items-center justify-between gap-2 sm:gap-3">
          <div className="min-w-0">
            <p className="text-sm text-muted-foreground max-md:text-xs">{label}</p>
            {value === undefined ? <Skeleton className="mt-1 h-8 w-12" /> : <p className="text-2xl font-bold tabular-nums">{value}</p>}
          </div>
          <div className={cn('flex h-10 w-10 shrink-0 items-center justify-center rounded-lg max-md:h-8 max-md:w-8', toneCls.bg)}>
            <Icon className={cn('h-5 w-5', toneCls.text)} />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
