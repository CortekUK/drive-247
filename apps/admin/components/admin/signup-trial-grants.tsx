'use client';

/**
 * "Free trial" on the Signup Plans page — who gets a free trial, and for how
 * long, all in one place.
 *
 *   EVERYONE        Each plan's own trial (set on the plan cards below). Shown
 *                   here as a summary so the whole picture is on one card.
 *   SPECIFIC PEOPLE A super admin types the email a new operator will sign up
 *                   with and any number of days (1–90). Only that person gets
 *                   it, on whichever plan they pick, and it overrides the
 *                   plan's trial. When their portal is built it is marked used
 *                   and shows which company it went to.
 *
 * A new operator has no tenant until they sign up, so the email is the only
 * thing that can name them in advance.
 *
 * Written straight to `signup_trial_grants` — RLS lets super admins (and only
 * them) manage it; the signup functions read it with the service role
 * (supabase/functions/_shared/signup-trial.ts).
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Gift, Loader2, Trash2, UserPlus } from 'lucide-react';

import { supabase } from '@/lib/supabase';
import { cn } from '@/lib/utils';
import { toast } from '@/components/ui/sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { parseTrialDays, TRIAL_DAYS_DEFAULT, type SignupPlan } from '@/components/admin/signup-plan-card';

interface Grant {
  id: string;
  email: string;
  trial_days: number;
  note: string | null;
  created_at: string;
  used_at: string | null;
  revoked_at: string | null;
  tenant: { company_name: string | null; slug: string | null } | null;
}

type Status = 'waiting' | 'used' | 'removed';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function statusOf(g: Grant): Status {
  if (g.used_at) return 'used';
  if (g.revoked_at) return 'removed';
  return 'waiting';
}

function fmtDay(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

function isNotInstalled(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  return (
    error.code === '42P01' ||
    error.code === 'PGRST205' ||
    /signup_trial_grants/.test(error.message ?? '')
  );
}

export function SignupTrialGrants({ plans }: { plans: SignupPlan[] }) {
  const [grants, setGrants] = useState<Grant[]>([]);
  const [loading, setLoading] = useState(true);
  const [notInstalled, setNotInstalled] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [email, setEmail] = useState('');
  const [days, setDays] = useState(String(TRIAL_DAYS_DEFAULT));
  const [note, setNote] = useState('');
  const [adding, setAdding] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoadError(null);
    const { data, error } = await (supabase as any)
      .from('signup_trial_grants')
      .select('id, email, trial_days, note, created_at, used_at, revoked_at, tenant:used_tenant_id ( company_name, slug )')
      .order('created_at', { ascending: false })
      .limit(500);
    if (error) {
      if (isNotInstalled(error)) setNotInstalled(true);
      else setLoadError(error.message);
    } else {
      setNotInstalled(false);
      setGrants((data ?? []) as Grant[]);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const cleanEmail = email.trim().toLowerCase();
  const emailOk = EMAIL_RE.test(cleanEmail);
  const parsedDays = parseTrialDays(days);
  const duplicate = grants.some((g) => g.email === cleanEmail && statusOf(g) === 'waiting');
  const canAdd = emailOk && parsedDays.ok && !duplicate && !adding;

  const add = async () => {
    if (!canAdd || !parsedDays.ok) return;
    setAdding(true);
    const { data: auth } = await supabase.auth.getUser();
    const { error } = await (supabase as any).from('signup_trial_grants').insert({
      email: cleanEmail,
      trial_days: parsedDays.days,
      note: note.trim() || null,
      created_by: auth.user?.id ?? null,
    });
    setAdding(false);
    if (error) {
      toast.error(
        error.code === '23505'
          ? `${cleanEmail} already has a trial waiting. Remove it first to change the days.`
          : `Could not add the trial: ${error.message}`,
      );
      return;
    }
    toast.success(`${cleanEmail} will get a ${parsedDays.days}-day free trial when they sign up.`);
    setEmail('');
    setNote('');
    setDays(String(TRIAL_DAYS_DEFAULT));
    void load();
  };

  const remove = async (g: Grant) => {
    setRemovingId(g.id);
    const { error } = await (supabase as any)
      .from('signup_trial_grants')
      .update({ revoked_at: new Date().toISOString() })
      .eq('id', g.id)
      .is('used_at', null);
    setRemovingId(null);
    if (error) {
      toast.error(`Could not remove it: ${error.message}`);
      return;
    }
    toast.success(`${g.email} will no longer get a free trial.`);
    void load();
  };

  const waitingCount = useMemo(() => grants.filter((g) => statusOf(g) === 'waiting').length, [grants]);
  const planTrials = plans.filter((p) => p.trial_days > 0);

  return (
    <Card>
      <CardHeader className="pb-4">
        <CardTitle className="flex items-center gap-2 text-base">
          <Gift className="h-4 w-4 text-primary" />
          Free trial
        </CardTitle>
        <CardDescription>
          New signups on a trial get full access with a countdown. Their card is saved when they
          sign up and charged the day after the trial ends, unless they cancel first. Changes here
          only affect people who have not signed up yet.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-5">
        {/* ---------------- Everyone ---------------- */}
        <section className="space-y-2">
          <h3 className="text-sm font-semibold">For everyone who signs up</h3>
          <div className="flex flex-wrap gap-2">
            {plans.map((p) => (
              <Badge
                key={p.id}
                variant={p.trial_days > 0 ? 'default' : 'outline'}
                className="font-normal"
              >
                {p.name || p.plan_key}: {p.trial_days > 0 ? `${p.trial_days}-day trial` : 'no trial'}
              </Badge>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">
            {planTrials.length === 0
              ? 'Off for every plan — everyone pays on signup. Turn it on for a plan in its "Free trial" section below.'
              : 'Set or change these in each plan’s "Free trial" section below.'}
          </p>
        </section>

        <Separator />

        {/* ---------------- Specific people ---------------- */}
        <section className="space-y-3">
          <div>
            <h3 className="flex items-center gap-2 text-sm font-semibold">
              Only for people you choose
              {waitingCount > 0 && <Badge variant="secondary">{waitingCount} waiting</Badge>}
            </h3>
            <p className="text-xs text-muted-foreground">
              Enter the email they will sign up with and how many days to give. They get it on
              whichever plan they pick, even a plan with no trial, and it replaces that plan&apos;s
              trial length.
            </p>
          </div>

          {notInstalled ? (
            <p className="rounded-lg border border-warning/40 bg-warning/10 p-3 text-xs">
              Needs a database update first: run{' '}
              <code className="rounded bg-muted px-1 py-0.5">
                supabase/migrations/PENDING_20261007b_signup_trial_grants.sql.txt
              </code>
              .
            </p>
          ) : (
            <>
              <form
                className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_110px_minmax(0,1fr)_auto] sm:items-end"
                onSubmit={(e) => {
                  e.preventDefault();
                  void add();
                }}
              >
                <div className="space-y-1.5">
                  <Label htmlFor="trial-grant-email">Email</Label>
                  <Input
                    id="trial-grant-email"
                    type="email"
                    placeholder="mike@rentals.com"
                    value={email}
                    disabled={adding}
                    aria-invalid={!!email && !emailOk}
                    onChange={(e) => setEmail(e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="trial-grant-days">Days</Label>
                  <Input
                    id="trial-grant-days"
                    inputMode="numeric"
                    value={days}
                    disabled={adding}
                    aria-invalid={!parsedDays.ok}
                    onChange={(e) => setDays(e.target.value)}
                    className="tabular-nums"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="trial-grant-note">Note (optional)</Label>
                  <Input
                    id="trial-grant-note"
                    placeholder="Met at the expo"
                    maxLength={200}
                    value={note}
                    disabled={adding}
                    onChange={(e) => setNote(e.target.value)}
                  />
                </div>
                <Button type="submit" disabled={!canAdd} className="gap-1.5">
                  {adding ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserPlus className="h-4 w-4" />}
                  Give trial
                </Button>
              </form>

              <p className="text-xs">
                {email && !emailOk ? (
                  <span className="text-destructive">Enter a full email address.</span>
                ) : !parsedDays.ok ? (
                  <span className="text-destructive">{parsedDays.error}</span>
                ) : duplicate ? (
                  <span className="text-warning">This email already has a trial waiting.</span>
                ) : (
                  <span className="text-muted-foreground">
                    {emailOk
                      ? `${cleanEmail} will get ${parsedDays.days} free days, then pays the plan price.`
                      : 'Up to 90 days.'}
                  </span>
                )}
              </p>

              {loadError && <p className="text-xs text-destructive">Could not load the list: {loadError}</p>}

              <div className="overflow-hidden rounded-lg border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Email</TableHead>
                      <TableHead className="text-right">Days</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Note</TableHead>
                      <TableHead className="w-[90px]" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {loading ? (
                      <TableRow>
                        <TableCell colSpan={5} className="py-6 text-center">
                          <Loader2 className="mx-auto h-4 w-4 animate-spin text-muted-foreground" />
                        </TableCell>
                      </TableRow>
                    ) : grants.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={5} className="py-6 text-center text-sm text-muted-foreground">
                          No one yet. Add an email above to give that person a free trial.
                        </TableCell>
                      </TableRow>
                    ) : (
                      grants.map((g) => {
                        const status = statusOf(g);
                        return (
                          <TableRow key={g.id} className={cn(status === 'removed' && 'opacity-60')}>
                            <TableCell className="font-medium">{g.email}</TableCell>
                            <TableCell className="text-right tabular-nums">{g.trial_days}</TableCell>
                            <TableCell className="text-sm whitespace-nowrap">
                              {status === 'waiting' && (
                                <span className="text-amber-600">Waiting for signup · added {fmtDay(g.created_at)}</span>
                              )}
                              {status === 'used' && (
                                <span className="text-emerald-600">
                                  Used by {g.tenant?.company_name ?? g.tenant?.slug ?? 'a new company'} ·{' '}
                                  {fmtDay(g.used_at)}
                                </span>
                              )}
                              {status === 'removed' && (
                                <span className="text-muted-foreground">Removed {fmtDay(g.revoked_at)}</span>
                              )}
                            </TableCell>
                            <TableCell className="max-w-[220px] truncate text-sm text-muted-foreground">
                              {g.note ?? '—'}
                            </TableCell>
                            <TableCell className="text-right">
                              {status === 'waiting' && (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="gap-1 text-destructive"
                                  disabled={removingId === g.id}
                                  onClick={() => void remove(g)}
                                >
                                  {removingId === g.id ? (
                                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                  ) : (
                                    <Trash2 className="h-3.5 w-3.5" />
                                  )}
                                  Remove
                                </Button>
                              )}
                            </TableCell>
                          </TableRow>
                        );
                      })
                    )}
                  </TableBody>
                </Table>
              </div>
            </>
          )}
        </section>
      </CardContent>
    </Card>
  );
}
