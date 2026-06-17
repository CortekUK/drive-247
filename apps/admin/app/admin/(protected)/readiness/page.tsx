'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { supabase } from '@/lib/supabase';
import { cn } from '@/lib/utils';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import {
  ShieldCheck,
  Search,
  CheckCircle2,
  AlertTriangle,
  Building2,
  RefreshCw,
  ArrowRight,
  CreditCard,
  FileSignature,
  Umbrella,
  Crown,
} from 'lucide-react';

interface ReadinessRow {
  tenant_id: string;
  company_name: string | null;
  slug: string | null;
  tenant_type: string | null;
  status: string | null;
  stripe_mode: string | null;
  stripe_onboarding_complete: boolean | null;
  stripe_account_status: string | null;
  stripe_ready: boolean;
  boldsign_mode: string | null;
  boldsign_has_live_brand: boolean | null;
  boldsign_ready: boolean;
  bonzah_enabled: boolean;
  bonzah_mode: string | null;
  bonzah_ready: boolean;
  subscription_status: string | null;
  subscription_stripe_mode: string | null;
  subscription_plan: string | null;
  subscription_ready: boolean;
  issue_count: number;
  overall_ready: boolean;
}

type Filter = 'all' | 'issues' | 'ready';

function IntegrationChip({
  ready,
  label,
  detail,
  na,
}: {
  ready: boolean;
  label: string;
  detail: string;
  na?: boolean;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          className={cn(
            'inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-semibold border whitespace-nowrap',
            na
              ? 'bg-secondary text-muted-foreground border-transparent'
              : ready
              ? 'bg-success/15 text-emerald-400 border-success/30'
              : 'bg-destructive/15 text-red-400 border-destructive/30',
          )}
        >
          <span
            className={cn(
              'h-1.5 w-1.5 rounded-full',
              na ? 'bg-muted-foreground' : ready ? 'bg-emerald-400' : 'bg-red-400',
            )}
          />
          {na ? 'n/a' : ready ? 'live' : 'test'}
        </span>
      </TooltipTrigger>
      <TooltipContent>
        <span className="text-xs">
          {label}: {detail}
        </span>
      </TooltipContent>
    </Tooltip>
  );
}

export default function ReadinessPage() {
  const [rows, setRows] = useState<ReadinessRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('issues');

  const load = async () => {
    const { data, error } = await (supabase as any)
      .from('v_tenant_readiness')
      .select('*')
      .order('issue_count', { ascending: false })
      .order('company_name', { ascending: true });
    if (!error) setRows((data ?? []) as ReadinessRow[]);
    setLoading(false);
    setRefreshing(false);
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const readyCount = useMemo(() => rows.filter((r) => r.overall_ready).length, [rows]);
  const issuesCount = useMemo(() => rows.filter((r) => !r.overall_ready).length, [rows]);

  const filtered = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return rows.filter((r) => {
      if (filter === 'issues' && r.overall_ready) return false;
      if (filter === 'ready' && !r.overall_ready) return false;
      if (!q) return true;
      return (
        r.company_name?.toLowerCase().includes(q) ||
        r.slug?.toLowerCase().includes(q)
      );
    });
  }, [rows, filter, searchQuery]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex items-center justify-center h-10 w-10 rounded-xl bg-primary/15 glow-purple-sm">
            <ShieldCheck className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Tenant Readiness</h1>
            <p className="text-sm text-muted-foreground">
              Live/test status of each integration, per tenant ·{' '}
              <span className="tabular-nums">{rows.length}</span> tenants
              {issuesCount > 0 && (
                <span className="text-warning"> · {issuesCount} with issues</span>
              )}
            </p>
          </div>
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="gap-1.5"
          onClick={() => { setRefreshing(true); load(); }}
        >
          <RefreshCw className={cn('h-4 w-4', refreshing && 'animate-spin')} />
          Refresh
        </Button>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card
          className={cn('cursor-pointer transition-all', filter === 'all' && 'border-primary/40 bg-primary/5')}
          onClick={() => setFilter('all')}
        >
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">All tenants</p>
                <p className="text-2xl font-bold tabular-nums">{rows.length}</p>
              </div>
              <div className="flex items-center justify-center h-10 w-10 rounded-lg bg-primary/15">
                <Building2 className="h-5 w-5 text-primary" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card
          className={cn('cursor-pointer transition-all', filter === 'issues' && 'border-warning/40 bg-warning/5')}
          onClick={() => setFilter(filter === 'issues' ? 'all' : 'issues')}
        >
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Needs attention</p>
                <p className="text-2xl font-bold tabular-nums">{issuesCount}</p>
              </div>
              <div className="flex items-center justify-center h-10 w-10 rounded-lg bg-warning/15">
                <AlertTriangle className="h-5 w-5 text-warning" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card
          className={cn('cursor-pointer transition-all', filter === 'ready' && 'border-success/40 bg-success/5')}
          onClick={() => setFilter(filter === 'ready' ? 'all' : 'ready')}
        >
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Fully live</p>
                <p className="text-2xl font-bold tabular-nums">{readyCount}</p>
              </div>
              <div className="flex items-center justify-center h-10 w-10 rounded-lg bg-success/15">
                <CheckCircle2 className="h-5 w-5 text-success" />
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Search */}
      <Card>
        <CardContent className="pt-6">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search tenant by name or slug..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9"
            />
          </div>
        </CardContent>
      </Card>

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Tenant</TableHead>
                <TableHead className="text-center"><span className="inline-flex items-center gap-1.5"><CreditCard className="h-3.5 w-3.5" /> Stripe</span></TableHead>
                <TableHead className="text-center"><span className="inline-flex items-center gap-1.5"><FileSignature className="h-3.5 w-3.5" /> BoldSign</span></TableHead>
                <TableHead className="text-center"><span className="inline-flex items-center gap-1.5"><Umbrella className="h-3.5 w-3.5" /> Bonzah</span></TableHead>
                <TableHead className="text-center"><span className="inline-flex items-center gap-1.5"><Crown className="h-3.5 w-3.5" /> Subscription</span></TableHead>
                <TableHead className="text-right">Overall</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                Array.from({ length: 6 }).map((_, i) => (
                  <TableRow key={i}>
                    {Array.from({ length: 6 }).map((__, j) => (
                      <TableCell key={j}><Skeleton className="h-6 w-full" /></TableCell>
                    ))}
                  </TableRow>
                ))
              ) : filtered.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-muted-foreground py-10">
                    No tenants match.
                  </TableCell>
                </TableRow>
              ) : (
                filtered.map((r) => (
                  <TableRow key={r.tenant_id} className={cn(!r.overall_ready && 'bg-destructive/[0.03]')}>
                    <TableCell>
                      <Link
                        href={`/admin/rentals/${r.tenant_id}`}
                        className="group inline-flex flex-col"
                      >
                        <span className="font-medium group-hover:text-primary transition-colors">
                          {r.company_name ?? r.slug ?? 'Unknown'}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {r.slug}
                          {r.tenant_type && <> · {r.tenant_type}</>}
                        </span>
                      </Link>
                    </TableCell>
                    <TableCell className="text-center">
                      <IntegrationChip
                        ready={r.stripe_ready}
                        label="Stripe Connect"
                        detail={`mode ${r.stripe_mode ?? '?'}, status ${r.stripe_account_status ?? 'none'}, onboarding ${r.stripe_onboarding_complete ? 'complete' : 'incomplete'}`}
                      />
                    </TableCell>
                    <TableCell className="text-center">
                      <IntegrationChip
                        ready={r.boldsign_ready}
                        label="BoldSign"
                        detail={`mode ${r.boldsign_mode ?? '?'}${r.boldsign_has_live_brand ? '' : ', no live brand'}`}
                      />
                    </TableCell>
                    <TableCell className="text-center">
                      <IntegrationChip
                        ready={r.bonzah_ready}
                        na={!r.bonzah_enabled}
                        label="Bonzah"
                        detail={r.bonzah_enabled ? `mode ${r.bonzah_mode ?? '?'}` : 'not enabled'}
                      />
                    </TableCell>
                    <TableCell className="text-center">
                      <IntegrationChip
                        ready={r.subscription_ready}
                        label="Subscription"
                        detail={`${r.subscription_status ?? 'none'}${r.subscription_stripe_mode ? `, ${r.subscription_stripe_mode}` : ''}`}
                      />
                    </TableCell>
                    <TableCell className="text-right">
                      {r.overall_ready ? (
                        <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-emerald-400">
                          <CheckCircle2 className="h-4 w-4" /> Ready
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-amber-400">
                          <AlertTriangle className="h-4 w-4" /> {r.issue_count} issue{r.issue_count === 1 ? '' : 's'}
                        </span>
                      )}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
