'use client';

/**
 * Call Calendar: Bryan's own calendar for the free onboarding call (spec 10,
 * docs/application/feat-001-call-booking/specs/10-admin-call-calendar.md).
 *
 *   Bookings      counts, the list with filters, one call's details and actions
 *   Week          Monday to Sunday in his zone
 *   Availability  his hours, blocked times and the rest of his settings
 *
 * Every read and write goes through the functions in
 * supabase/migrations/20261128100000_onboarding_call_booking_v2.sql.
 */

import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { AlertTriangle, Plus, RefreshCw } from 'lucide-react';

import { supabase } from '@/lib/supabase';
import { toast } from '@/components/ui/sonner';
import { Button } from '@/components/ui/button';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { PAGE_DESCRIPTION } from '@/components/admin/header-buttons';
import { cn } from '@/lib/utils';

import { db, errorText, VIEWS, type Block, type Settings, type Tab, type View } from './shared';
import { zoneLabel } from './time';
import { BookingsTab, type ListQuery } from './bookings-tab';
import { WeekTab } from './week-tab';
import { AvailabilityTab } from './availability-tab';
import { BookingDialog } from './booking-dialog';
import { BookForCompanyDialog } from './book-for-company-dialog';

const TABS: { id: Tab; label: string }[] = [
  { id: 'bookings', label: 'Bookings' },
  { id: 'week', label: 'Week' },
  { id: 'availability', label: 'Availability' },
];
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export function CallCalendarPage() {
  return (
    <Suspense fallback={<Skeleton className="h-64 w-full" />}>
      <CallCalendar />
    </Suspense>
  );
}

function CallCalendar() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  const tabParam = params.get('tab');
  const tab: Tab = TABS.some((t) => t.id === tabParam) ? (tabParam as Tab) : 'bookings';
  const viewParam = params.get('view');
  const query: ListQuery = {
    view: VIEWS.some((v) => v.id === viewParam) ? (viewParam as View) : 'upcoming',
    from: DATE.test(params.get('from') ?? '') ? params.get('from')! : '',
    to: DATE.test(params.get('to') ?? '') ? params.get('to')! : '',
    q: params.get('q') ?? '',
  };
  const week = params.get('week') ?? '';

  // Tab, view, dates, search and week live in the address so a refresh keeps them.
  const setParams = useCallback(
    (patch: Record<string, string>) => {
      const next = new URLSearchParams(params.toString());
      for (const [k, v] of Object.entries(patch)) {
        const isDefault = !v || (k === 'tab' && v === 'bookings') || (k === 'view' && v === 'upcoming');
        if (isDefault) next.delete(k);
        else next.set(k, v);
      }
      const qs = next.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [params, pathname, router],
  );

  const [settings, setSettings] = useState<Settings | null>(null);
  const [blocks, setBlocks] = useState<Block[]>([]);
  const [missing, setMissing] = useState(false);
  const [version, setVersion] = useState(0);
  const [openId, setOpenId] = useState<string | null>(null);
  const [booking, setBooking] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const loadSettings = useCallback(async () => {
    const [s, b] = await Promise.all([
      db.from('onboarding_call_settings').select('*').eq('id', true).maybeSingle(),
      db.from('onboarding_call_blocks').select('starts_at, ends_at, label').order('starts_at'),
    ]);
    const error = s.error ?? b.error;
    if (error) {
      if (/does not exist|schema cache/i.test(error.message ?? '')) {
        setMissing(true);
        return;
      }
      toast.error('The calendar could not be loaded', { description: errorText(error) });
      return;
    }
    if (!s.data) {
      setMissing(true);
      return;
    }
    setMissing(false);
    setSettings(s.data as Settings);
    setBlocks((b.data ?? []) as Block[]);
  }, []);

  useEffect(() => {
    void loadSettings();
  }, [loadSettings]);

  // Several changes in a row become one refetch.
  const bump = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setVersion((v) => v + 1), 300);
  }, []);

  // Realtime first, a 30 second poll behind it, and a refetch when the tab gets focus (spec 10.8).
  useEffect(() => {
    const channel = supabase
      .channel('admin-call-calendar')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'onboarding_call_bookings' }, () => bump())
      .subscribe();
    const poll = setInterval(bump, 30_000);
    const onFocus = () => bump();
    window.addEventListener('focus', onFocus);
    return () => {
      void supabase.removeChannel(channel);
      clearInterval(poll);
      window.removeEventListener('focus', onFocus);
      if (timer.current) clearTimeout(timer.current);
    };
  }, [bump]);

  const refresh = async () => {
    setRefreshing(true);
    await loadSettings();
    setVersion((v) => v + 1);
    setRefreshing(false);
  };

  const goToCallLink = () => {
    setParams({ tab: 'availability' });
    setTimeout(() => {
      const el = document.getElementById('call-link');
      el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      el?.focus();
    }, 150);
  };

  const tz = settings?.timezone;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 space-y-1">
          <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Call Calendar</h1>
          <p className={cn('text-sm text-muted-foreground', PAGE_DESCRIPTION)}>
            The free onboarding calls: who has booked, and when you are free.
          </p>
          <div className="text-sm font-medium">{tz ? `Times in ${zoneLabel(tz)}` : <Skeleton className="h-5 w-40" />}</div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => void refresh()} disabled={refreshing}>
            <RefreshCw className={cn('mr-2 h-4 w-4', refreshing && 'animate-spin')} />
            Refresh
          </Button>
          <Button size="sm" onClick={() => setBooking(true)} disabled={!settings}>
            <Plus className="mr-2 h-4 w-4" />
            Book for a company
          </Button>
        </div>
      </div>

      {missing ? (
        <Card className="shadow-none">
          <CardHeader>
            <CardTitle>The calendar is not set up yet</CardTitle>
            <CardDescription>
              Apply <code className="text-xs">supabase/migrations/20261128100000_onboarding_call_booking_v2.sql</code> to this database, then
              refresh.
            </CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <>
          {settings && !settings.meeting_url && (
            <div className="flex flex-col gap-3 rounded-2xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-200 sm:flex-row sm:items-center sm:justify-between">
              <p className="flex items-start gap-2">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                No call link is set. Companies are told the link will follow by email.
              </p>
              <Button size="sm" variant="outline" className="shrink-0" onClick={goToCallLink}>
                Set the call link
              </Button>
            </div>
          )}

          <div className="inline-flex max-w-full overflow-x-auto rounded-full bg-muted p-1" role="tablist" aria-label="Call calendar">
            {TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                role="tab"
                aria-selected={tab === t.id}
                onClick={() => setParams({ tab: t.id })}
                className={cn(
                  'shrink-0 rounded-full px-4 py-1.5 text-sm font-medium transition-colors',
                  tab === t.id ? 'bg-background text-foreground ring-1 ring-foreground/10' : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {t.label}
              </button>
            ))}
          </div>

          {!settings || !tz ? (
            <Skeleton className="h-64 w-full" />
          ) : tab === 'bookings' ? (
            <BookingsTab
              hostTz={tz}
              query={query}
              onQuery={(patch) => setParams(patch as Record<string, string>)}
              version={version}
              onOpen={setOpenId}
            />
          ) : tab === 'week' ? (
            <WeekTab
              settings={settings}
              blocks={blocks}
              week={week}
              onWeek={(monday) => setParams({ week: monday })}
              version={version}
              onOpen={setOpenId}
            />
          ) : (
            <AvailabilityTab
              settings={settings}
              blocks={blocks}
              onSaved={async () => {
                await loadSettings();
                setVersion((v) => v + 1);
              }}
            />
          )}
        </>
      )}

      {tz && (
        <>
          <BookingDialog id={openId} hostTz={tz} version={version} onClose={() => setOpenId(null)} onChanged={bump} />
          <BookForCompanyDialog
            open={booking}
            hostTz={tz}
            onClose={() => setBooking(false)}
            onBooked={(id) => {
              setBooking(false);
              bump();
              setOpenId(id);
            }}
          />
        </>
      )}
    </div>
  );
}
