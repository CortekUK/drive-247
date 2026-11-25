'use client';

/**
 * Customer Management → Signups: everyone who signed up on drive-247.com and
 * their details, whether or not they finished.
 *
 * Bryan (2026-11-25): a lead who stopped at the card step had a phone number
 * on record and nowhere in admin showed it. The rows come from
 * `admin_signups()` (migration 20261125150000), a super-admin-only read of
 * the signup answers (signup_attribution), the signup's own state and, once
 * the portal is built, the company and its subscription.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Copy, ExternalLink, Loader2, Mail, Phone, RefreshCw, Search } from 'lucide-react';

import { supabase } from '@/lib/supabase';
import { toast } from '@/components/ui/sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { PAGE_DESCRIPTION } from '@/components/admin/header-buttons';
import { cn } from '@/lib/utils';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

interface SignupRow {
  auth_user_id: string;
  email: string | null;
  full_name: string | null;
  phone: string | null;
  city_state: string | null;
  fleet_size: string | null;
  heard_about: string | null;
  heard_about_other: string | null;
  plan_id: string | null;
  signup_status: string | null;
  company_name: string | null;
  tenant_id: string | null;
  tenant_slug: string | null;
  subscription_status: string | null;
  trial_end: string | null;
  signed_up_at: string;
  email_verified_at: string | null;
  paid_at: string | null;
  last_sign_in_at: string | null;
  exit_offer_seen_at: string | null;
}

type Group = 'no_card' | 'signed_up' | 'failed';

/** Where a signup got to, in words Bryan uses, and which filter it falls under. */
function stageOf(r: SignupRow): { label: string; cls: string; group: Group } {
  switch (r.signup_status) {
    case 'provisioned':
      return { label: 'Portal live', cls: 'text-green-700 dark:text-green-400', group: 'signed_up' };
    case 'paid':
    case 'provisioning':
      return { label: 'Card added, building portal', cls: 'text-blue-700 dark:text-blue-400', group: 'signed_up' };
    case 'failed':
      return { label: 'Setup failed', cls: 'text-red-700 dark:text-red-400', group: 'failed' };
    case 'payment_pending':
      return { label: 'At the card step, no card yet', cls: 'text-amber-700 dark:text-amber-400', group: 'no_card' };
    default:
      return { label: 'Account created, no card yet', cls: 'text-amber-700 dark:text-amber-400', group: 'no_card' };
  }
}

const FILTERS: Array<{ id: Group | 'all'; label: string; cls: string }> = [
  { id: 'all', label: 'All signups', cls: 'text-foreground' },
  { id: 'no_card', label: 'No card yet', cls: 'text-amber-700 dark:text-amber-400' },
  { id: 'signed_up', label: 'Signed up', cls: 'text-green-700 dark:text-green-400' },
  { id: 'failed', label: 'Setup failed', cls: 'text-red-700 dark:text-red-400' },
];

const PLAN_LABEL: Record<string, string> = {
  starter_2: 'Starter',
  growth_2: 'Growth',
  scale_2: 'Scale',
};

const HEARD_LABEL: Record<string, string> = {
  google: 'Google',
  facebook: 'Facebook',
  instagram: 'Instagram',
  tiktok: 'TikTok',
  youtube: 'YouTube',
  referral: 'A referral',
  turo: 'Turo',
  other: 'Other',
};

function fmtWhen(iso: string | null): string {
  if (!iso) return '';
  return new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

/** "+14044541524" → "+1 404-454-1524"; anything else as typed. */
function fmtPhone(raw: string): string {
  const m = /^\+1(\d{3})(\d{3})(\d{4})$/.exec(raw);
  return m ? `+1 ${m[1]}-${m[2]}-${m[3]}` : raw;
}

function heardText(r: SignupRow): string | null {
  if (!r.heard_about) return null;
  if (r.heard_about === 'other' && r.heard_about_other) return `Other: ${r.heard_about_other}`;
  return HEARD_LABEL[r.heard_about] ?? r.heard_about;
}

export function SignupsTab() {
  const [rows, setRows] = useState<SignupRow[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [notInstalled, setNotInstalled] = useState(false);
  const [filter, setFilter] = useState<Group | 'all'>('all');
  const [query, setQuery] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await db.rpc('admin_signups');
      if (error) {
        if (error.code === 'PGRST202' || error.code === '42883') {
          setNotInstalled(true);
          return;
        }
        throw error;
      }
      setNotInstalled(false);
      setRows((data ?? []) as SignupRow[]);
    } catch (e) {
      toast.error(`Could not load signups: ${(e as Error).message}`);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const counts = useMemo(() => {
    const c = { all: 0, no_card: 0, signed_up: 0, failed: 0 };
    for (const r of rows ?? []) {
      c.all += 1;
      c[stageOf(r).group] += 1;
    }
    return c;
  }, [rows]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    const digits = q.replace(/\D/g, '');
    return (rows ?? []).filter((r) => {
      if (filter !== 'all' && stageOf(r).group !== filter) return false;
      if (!q) return true;
      const hay = [r.full_name, r.email, r.company_name, r.city_state, r.tenant_slug].filter(Boolean).join(' ').toLowerCase();
      return hay.includes(q) || (digits.length >= 3 && (r.phone ?? '').replace(/\D/g, '').includes(digits));
    });
  }, [rows, filter, query]);

  const copy = useCallback(async (text: string, what: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(`${what} copied`);
    } catch {
      toast.error(`Could not copy the ${what.toLowerCase()}`);
    }
  }, []);

  if (notInstalled) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Not installed</CardTitle>
          <CardDescription>
            This list needs the database function from migration 20261125150000_admin_signups.sql.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">Signups</h1>
          <p className={cn('max-w-2xl text-sm text-muted-foreground', PAGE_DESCRIPTION)}>
            Everyone who signed up on drive-247.com, newest first, with the details they gave: phone, location, fleet
            size and how they heard about us. People who stopped before adding a card are here too, so you can call
            them.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
          <RefreshCw className={cn('mr-2 h-4 w-4', loading && 'animate-spin')} />
          Refresh
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {FILTERS.map((f) => (
          <button
            key={f.id}
            type="button"
            aria-pressed={filter === f.id}
            onClick={() => setFilter(f.id)}
            className="rounded-xl text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Card className={cn('h-full transition-colors hover:bg-muted/40', filter === f.id && 'border-primary')}>
              <CardContent className="p-4">
                <p className={cn('text-xs font-medium', f.cls)}>{f.label}</p>
                <p className="mt-1 text-2xl font-semibold tabular-nums">{loading && !rows ? '—' : counts[f.id]}</p>
              </CardContent>
            </Card>
          </button>
        ))}
      </div>

      <Card>
        <CardHeader className="gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div className="space-y-1.5">
            <CardTitle>People</CardTitle>
            <CardDescription>Tap a phone number to call, or copy it.</CardDescription>
          </div>
          <div className="relative w-full sm:w-72">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search name, email, phone, city"
              className="pl-8"
              aria-label="Search signups"
            />
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {loading && !rows ? (
            <div className="space-y-2 p-6">
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
            </div>
          ) : shown.length === 0 ? (
            <p className="px-6 pb-6 text-sm text-muted-foreground">
              {query || filter !== 'all' ? 'Nobody matches.' : 'No signups yet.'}
            </p>
          ) : (
            <ul className="divide-y">
              {shown.map((r) => {
                const st = stageOf(r);
                const heard = heardText(r);
                const plan = r.plan_id ? PLAN_LABEL[r.plan_id] ?? r.plan_id : null;
                return (
                  <li key={r.auth_user_id} className="flex flex-col gap-3 px-6 py-4 lg:flex-row lg:items-center lg:gap-6">
                    <div className="min-w-0 lg:w-[32%]">
                      <p className="truncate text-sm font-medium max-sm:whitespace-normal">
                        {r.full_name || r.email || 'No name'}
                        {r.company_name && <span className="font-normal text-muted-foreground"> · {r.company_name}</span>}
                      </p>
                      <p className="truncate text-xs text-muted-foreground max-sm:whitespace-normal max-sm:[overflow-wrap:anywhere]">
                        {[r.city_state, r.fleet_size && `${r.fleet_size} cars`, plan && `${plan} plan`, heard && `heard via ${heard}`]
                          .filter(Boolean)
                          .join(' · ') || 'No answers yet'}
                      </p>
                    </div>

                    <div className="min-w-0 space-y-1 text-sm lg:w-[34%]">
                      {r.phone ? (
                        <p className="flex items-center gap-2">
                          <a href={`tel:${r.phone}`} className="inline-flex items-center gap-1.5 font-medium text-indigo-700 hover:underline dark:text-indigo-400">
                            <Phone className="h-3.5 w-3.5" aria-hidden />
                            {fmtPhone(r.phone)}
                          </a>
                          <button
                            type="button"
                            onClick={() => void copy(r.phone!, 'Phone number')}
                            className="text-muted-foreground hover:text-foreground"
                            aria-label={`Copy ${r.phone}`}
                            title="Copy"
                          >
                            <Copy className="h-3.5 w-3.5" />
                          </button>
                        </p>
                      ) : (
                        <p className="text-xs text-muted-foreground">No phone given</p>
                      )}
                      {r.email && (
                        <p className="flex min-w-0 items-center gap-2">
                          <a href={`mailto:${r.email}`} className="inline-flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground hover:underline">
                            <Mail className="h-3.5 w-3.5 shrink-0" aria-hidden />
                            <span className="truncate">{r.email}</span>
                          </a>
                          <button
                            type="button"
                            onClick={() => void copy(r.email!, 'Email')}
                            className="text-muted-foreground hover:text-foreground"
                            aria-label={`Copy ${r.email}`}
                            title="Copy"
                          >
                            <Copy className="h-3.5 w-3.5" />
                          </button>
                        </p>
                      )}
                    </div>

                    <div className="lg:flex-1">
                      <p className={cn('text-xs font-medium', st.cls)}>
                        {st.label}
                        {r.subscription_status && r.signup_status === 'provisioned' && ` · ${r.subscription_status}`}
                      </p>
                      <p className="text-[11px] text-muted-foreground">
                        Signed up {fmtWhen(r.signed_up_at)}
                        {r.trial_end && r.subscription_status === 'trialing' && ` · trial until ${fmtWhen(r.trial_end).split(',')[0]}`}
                      </p>
                    </div>

                    {r.tenant_id && (
                      <Button variant="outline" size="sm" asChild className="shrink-0 self-start lg:self-center">
                        <a href={`/admin/rentals/${r.tenant_id}`}>
                          <ExternalLink className="mr-1.5 h-3.5 w-3.5" />
                          Company
                        </a>
                      </Button>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
          {loading && rows && (
            <div className="flex justify-center pb-4">
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
