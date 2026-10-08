'use client';

/**
 * Advisory Board — the 8–15 operators (v1 and v2) who help shape the product.
 *
 * Every tenant is listed with how long they have been with us, counted from
 * account creation (the subscription system arrived in Feb 2026, after the
 * oldest tenants signed up, so a first subscription would undercount them).
 * One button per row puts a tenant on the board or takes them off.
 *
 * Membership is only a tag (`advisory_board_members`, super-admin RLS):
 * nothing is sent or automated when a tenant is added.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Award, Loader2, RefreshCw, Search, UserMinus, UserPlus } from 'lucide-react';

import { supabase } from '@/lib/supabase';
import { cn } from '@/lib/utils';
import { useAuthStore } from '@/store/authStore';
import { toast } from '@/components/ui/sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

interface TenantLite {
  id: string;
  company_name: string | null;
  slug: string;
  portal_experience: string | null;
  status: string | null;
  tenant_type: string | null;
  created_at: string;
}

interface Member {
  tenant_id: string;
  added_at: string;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

const BOARD_MIN = 8;
const BOARD_MAX = 15;
const DAY_MS = 86_400_000;

const isV2 = (t: TenantLite) => t.portal_experience === 'v2' || t.slug === 'northwind';

/** Whole calendar months between two dates (the day of month must be reached). */
function monthsBetween(from: Date, to: Date): number {
  let m = (to.getFullYear() - from.getFullYear()) * 12 + (to.getMonth() - from.getMonth());
  if (to.getDate() < from.getDate()) m--;
  return Math.max(0, m);
}

function formatTenure(createdAt: string, now: Date): string {
  const start = new Date(createdAt);
  const months = monthsBetween(start, now);
  if (months >= 1) return `${months} month${months === 1 ? '' : 's'}`;
  const days = Math.max(0, Math.floor((now.getTime() - start.getTime()) / DAY_MS));
  return `${days} day${days === 1 ? '' : 's'}`;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

type PortalFilter = 'all' | 'v1' | 'v2';
type BoardFilter = 'all' | 'on' | 'off';
type SortKey = 'tenure' | 'newest' | 'name';

export function AdvisoryBoardTab({ canEdit }: { canEdit: boolean }) {
  const { user } = useAuthStore();
  const [loading, setLoading] = useState(true);
  const [tenants, setTenants] = useState<TenantLite[]>([]);
  const [members, setMembers] = useState<Map<string, Member>>(new Map());
  const [busy, setBusy] = useState<Set<string>>(new Set());

  const [search, setSearch] = useState('');
  const [portal, setPortal] = useState<PortalFilter>('all');
  const [board, setBoard] = useState<BoardFilter>('all');
  const [sort, setSort] = useState<SortKey>('tenure');
  const [showTest, setShowTest] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [t, m] = await Promise.all([
        db.from('tenants').select('id, company_name, slug, portal_experience, status, tenant_type, created_at'),
        db.from('advisory_board_members').select('tenant_id, added_at'),
      ]);
      for (const res of [t, m]) if (res.error) throw res.error;
      setTenants((t.data as TenantLite[]) ?? []);
      setMembers(new Map(((m.data as Member[]) ?? []).map((r) => [r.tenant_id, r])));
    } catch (e) {
      toast.error('Could not load the advisory board', { description: (e as Error).message });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const now = new Date();

  const nameOf = (t: TenantLite) => t.company_name || t.slug;

  const boardTenants = useMemo(
    () =>
      tenants
        .filter((t) => members.has(t.id))
        .sort((a, b) => members.get(a.id)!.added_at.localeCompare(members.get(b.id)!.added_at)),
    [tenants, members],
  );

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = tenants.filter((t) => {
      const on = members.has(t.id);
      // A test tenant already on the board stays visible, so it can be taken off.
      if (!showTest && t.tenant_type === 'test' && !on) return false;
      if (portal !== 'all' && (portal === 'v2') !== isV2(t)) return false;
      if (board === 'on' && !on) return false;
      if (board === 'off' && on) return false;
      if (q && !nameOf(t).toLowerCase().includes(q) && !t.slug.toLowerCase().includes(q)) return false;
      return true;
    });
    return list.sort((a, b) => {
      if (sort === 'name') return nameOf(a).localeCompare(nameOf(b));
      if (sort === 'newest') return b.created_at.localeCompare(a.created_at);
      return a.created_at.localeCompare(b.created_at);
    });
  }, [tenants, members, search, portal, board, sort, showTest]);

  const toggle = async (t: TenantLite) => {
    const on = members.has(t.id);
    setBusy((s) => new Set(s).add(t.id));
    try {
      if (on) {
        const { error } = await db.from('advisory_board_members').delete().eq('tenant_id', t.id);
        if (error) throw error;
        setMembers((m) => {
          const next = new Map(m);
          next.delete(t.id);
          return next;
        });
        toast.success(`${nameOf(t)} removed from the Advisory Board`);
      } else {
        const { data, error } = await db
          .from('advisory_board_members')
          .upsert({ tenant_id: t.id, added_by: user?.id ?? null }, { onConflict: 'tenant_id' })
          .select('tenant_id, added_at')
          .single();
        if (error) throw error;
        setMembers((m) => new Map(m).set(t.id, data as Member));
        const count = members.size + 1;
        toast.success(`${nameOf(t)} added to the Advisory Board`, {
          description: count > BOARD_MAX ? `${count} members — above the ${BOARD_MIN}–${BOARD_MAX} target.` : undefined,
        });
      }
    } catch (e) {
      toast.error('Could not update the Advisory Board', { description: (e as Error).message });
    } finally {
      setBusy((s) => {
        const next = new Set(s);
        next.delete(t.id);
        return next;
      });
    }
  };

  if (loading && tenants.length === 0) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }

  const count = members.size;
  const seatState =
    count < BOARD_MIN
      ? { text: `${BOARD_MIN - count} more to reach the minimum of ${BOARD_MIN}`, cls: 'text-amber-700 dark:text-amber-400' }
      : count > BOARD_MAX
        ? { text: `${count - BOARD_MAX} over the maximum of ${BOARD_MAX}`, cls: 'text-red-700 dark:text-red-400' }
        : { text: `Within the ${BOARD_MIN}–${BOARD_MAX} target`, cls: 'text-green-700 dark:text-green-400' };

  return (
    <div className="space-y-6">
      {/* ── the board ────────────────────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="space-y-1">
              <CardTitle className="flex items-center gap-2">
                <Award className="h-5 w-5 text-primary" />
                Advisory Board
              </CardTitle>
              <CardDescription>
                The {BOARD_MIN}–{BOARD_MAX} top operators — v1 and v2 — who help shape the product. Tag them from the list
                below; nothing is sent to an operator when they are added or removed.
              </CardDescription>
            </div>
            <Button variant="ghost" size="sm" className="gap-1.5" onClick={() => void load()} disabled={loading}>
              <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} />
              Refresh
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <span className="text-3xl font-semibold tabular-nums">{count}</span>
            <span className="text-sm text-muted-foreground">
              member{count === 1 ? '' : 's'} · target {BOARD_MIN}–{BOARD_MAX}
            </span>
            <span className={cn('text-sm font-medium', seatState.cls)}>{seatState.text}</span>
          </div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
            <div
              className={cn(
                'h-full rounded-full transition-all',
                count > BOARD_MAX ? 'bg-red-600 dark:bg-red-500' : count >= BOARD_MIN ? 'bg-green-600 dark:bg-green-500' : 'bg-amber-500',
              )}
              style={{ width: `${Math.min(100, (count / BOARD_MAX) * 100)}%` }}
            />
          </div>
          {boardTenants.length === 0 ? (
            <p className="text-sm text-muted-foreground">No one on the board yet — use “Put in Advisory Board” on a row below.</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {boardTenants.map((t) => (
                <Badge key={t.id} variant="secondary" className="gap-1.5 py-1 text-sm font-medium">
                  {nameOf(t)}
                  <span className="text-xs font-normal text-muted-foreground">
                    {isV2(t) ? 'V2' : 'V1'} · {formatTenure(t.created_at, now)}
                  </span>
                </Badge>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── every operator ───────────────────────────────────────────────── */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">All operators</CardTitle>
          <CardDescription>
            {rows.length} of {tenants.length} tenants · “With us” counts from account creation.
          </CardDescription>
          <div className="flex flex-wrap items-center gap-2 pt-2">
            <div className="relative w-full sm:w-64">
              <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search operators" className="h-9 pl-8" />
            </div>
            <Select value={portal} onValueChange={(v) => setPortal(v as PortalFilter)}>
              <SelectTrigger className="h-9 w-[130px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">V1 and V2</SelectItem>
                <SelectItem value="v1">V1 only</SelectItem>
                <SelectItem value="v2">V2 only</SelectItem>
              </SelectContent>
            </Select>
            <Select value={board} onValueChange={(v) => setBoard(v as BoardFilter)}>
              <SelectTrigger className="h-9 w-[170px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Everyone</SelectItem>
                <SelectItem value="on">On the board</SelectItem>
                <SelectItem value="off">Not on the board</SelectItem>
              </SelectContent>
            </Select>
            <Select value={sort} onValueChange={(v) => setSort(v as SortKey)}>
              <SelectTrigger className="h-9 w-[170px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="tenure">Longest with us</SelectItem>
                <SelectItem value="newest">Newest first</SelectItem>
                <SelectItem value="name">Name A–Z</SelectItem>
              </SelectContent>
            </Select>
            <label className="flex cursor-pointer items-center gap-2 text-sm text-muted-foreground">
              <input type="checkbox" checked={showTest} onChange={(e) => setShowTest(e.target.checked)} />
              Show test tenants
            </label>
          </div>
        </CardHeader>
        <CardContent>
          {!canEdit && (
            <p className="pb-3 text-sm text-muted-foreground">Read-only: changing the board needs a super admin account.</p>
          )}
          {rows.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">No operators match.</p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Operator</TableHead>
                    <TableHead>Portal</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">With us</TableHead>
                    <TableHead>Since</TableHead>
                    <TableHead>On board since</TableHead>
                    <TableHead className="text-right">Advisory Board</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((t) => {
                    const member = members.get(t.id);
                    const pending = busy.has(t.id);
                    return (
                      <TableRow key={t.id} className={cn(member && 'bg-primary/5')}>
                        <TableCell>
                          <div className="flex items-center gap-2 font-medium">
                            {member && <Award className="h-4 w-4 shrink-0 text-primary" aria-label="On the Advisory Board" />}
                            {nameOf(t)}
                          </div>
                          <div className="text-xs text-muted-foreground">
                            {t.slug}
                            {t.tenant_type === 'test' && ' · test'}
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline">{isV2(t) ? 'V2' : 'V1'}</Badge>
                        </TableCell>
                        <TableCell
                          className={cn(
                            'capitalize',
                            t.status === 'active' ? 'text-green-700 dark:text-green-400' : 'text-muted-foreground',
                          )}
                        >
                          {t.status ?? '—'}
                        </TableCell>
                        <TableCell className="text-right font-medium tabular-nums">{formatTenure(t.created_at, now)}</TableCell>
                        <TableCell className="text-muted-foreground">{formatDate(t.created_at)}</TableCell>
                        <TableCell className="text-muted-foreground">{member ? formatDate(member.added_at) : '—'}</TableCell>
                        <TableCell className="text-right">
                          <Button
                            size="sm"
                            variant={member ? 'outline' : 'default'}
                            className="w-[190px] gap-1.5"
                            disabled={!canEdit || pending}
                            onClick={() => void toggle(t)}
                          >
                            {pending ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : member ? (
                              <UserMinus className="h-4 w-4" />
                            ) : (
                              <UserPlus className="h-4 w-4" />
                            )}
                            {member ? 'Remove from Board' : 'Put in Advisory Board'}
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
