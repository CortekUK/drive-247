'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { supabase } from '@/lib/supabase';
import { cn } from '@/lib/utils';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import CreateTenantDialog from '@/components/admin/CreateTenantDialog';
import {
  Plus,
  ArrowRight,
  Search,
  Star,
  Building2,
  ArrowLeftRight,
} from 'lucide-react';

interface Tenant {
  id: string;
  slug: string;
  company_name: string;
  admin_name: string | null;
  status: string;
  contact_email: string;
  created_at: string;
  tenant_type: 'production' | 'test' | null;
  subscription_account: 'uk' | 'uae' | null;
  payment_model: 'managed' | 'own' | null;
  own_stripe_account_id: string | null;
  migration_blocker: 'off' | 'soft' | 'hard' | null;
}

/**
 * Derives a tenant's UK→UAE migration picture from its raw fields.
 *
 * Two independent axes move from UK to UAE:
 *   - Subscription: subscription_account  ('uk' | 'uae')
 *   - Connect:      payment_model         ('managed' = UK Express | 'own' = UAE)
 *
 * A tenant on payment_model='own' is counted as UAE on the Connect axis even
 * before they OAuth a real account — the model routes them to UAE the moment
 * they connect ("configured for UAE"). own_stripe_account_id only refines the
 * push status (Done vs Auto/UAE-ready), not the state chip.
 */
type MigrationState = 'uk' | 'partial-sub' | 'partial-connect' | 'uae';
type PushStatus = 'hard' | 'soft' | 'done' | 'ready' | 'auto' | 'not-started';

function getMigrationState(t: Tenant): MigrationState {
  const subUae = t.subscription_account === 'uae';
  const payUae = t.payment_model === 'own';
  if (subUae && payUae) return 'uae';
  if (!subUae && !payUae) return 'uk';
  return subUae ? 'partial-sub' : 'partial-connect';
}

function getPushStatus(t: Tenant, state: MigrationState): PushStatus {
  if (t.migration_blocker === 'hard') return 'hard';
  if (t.migration_blocker === 'soft') return 'soft';
  if (state === 'uae') {
    // "Done" only when they've ACTUALLY connected their own Stripe account.
    // Flags pointing to UAE without a connected account = configured-but-idle
    // (e.g. a brand-new empty tenant) → "UAE-ready", not "Done".
    return t.own_stripe_account_id ? 'done' : 'ready';
  }
  if (state === 'uk') return 'not-started';
  return 'auto';
}

const MIGRATION_STATE_META: Record<MigrationState, { label: string; className: string }> = {
  uk: { label: '🇬🇧 UK', className: 'bg-secondary text-muted-foreground border-border' },
  'partial-sub': { label: '🟡 Partial · Sub UAE', className: 'bg-amber-500/15 text-amber-400 border-amber-500/30' },
  'partial-connect': { label: '🟡 Partial · Connect UAE', className: 'bg-amber-500/15 text-amber-400 border-amber-500/30' },
  uae: { label: '🇦🇪 UAE', className: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30' },
};

const PUSH_STATUS_META: Record<PushStatus, { label: string; className: string }> = {
  hard: { label: 'Hard blocker', className: 'text-destructive' },
  soft: { label: 'Soft blocker', className: 'text-amber-400' },
  done: { label: 'Done', className: 'text-emerald-400' },
  ready: { label: 'UAE-ready', className: 'text-sky-400' },
  auto: { label: 'In progress', className: 'text-sky-400' },
  'not-started': { label: 'Not started', className: 'text-muted-foreground' },
};

export default function RentalCompaniesPage() {
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [typeFilter, setTypeFilter] = useState<'all' | 'production' | 'test'>('all');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'suspended'>('all');
  const [showMigration, setShowMigration] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [showFavoritesOnly, setShowFavoritesOnly] = useState(false);
  const [favorites, setFavorites] = useState<Set<string>>(() => {
    if (typeof window !== 'undefined') {
      try {
        const saved = localStorage.getItem('admin_favorite_tenants');
        return saved ? new Set(JSON.parse(saved)) : new Set();
      } catch { return new Set(); }
    }
    return new Set();
  });

  useEffect(() => {
    loadTenants();
  }, [typeFilter, statusFilter]);

  const loadTenants = async () => {
    try {
      let query = supabase
        .from('tenants')
        .select('*')
        .order('created_at', { ascending: false });

      // Type (production/test) and status (active/suspended) are independent
      // axes and combine with AND, so e.g. "Production + Suspended" works.
      if (typeFilter !== 'all') {
        query = query.eq('tenant_type', typeFilter);
      }
      if (statusFilter !== 'all') {
        query = query.eq('status', statusFilter);
      }

      const { data, error } = await query;
      if (error) throw error;
      setTenants(data || []);
    } catch (error) {
      console.error('Error loading tenants:', error);
    } finally {
      setLoading(false);
    }
  };

  const toggleFavorite = (tenantId: string) => {
    setFavorites((prev) => {
      const next = new Set(prev);
      if (next.has(tenantId)) next.delete(tenantId);
      else next.add(tenantId);
      localStorage.setItem('admin_favorite_tenants', JSON.stringify([...next]));
      return next;
    });
  };

  const filteredTenants = tenants
    .filter((t) => {
      if (showFavoritesOnly && !favorites.has(t.id)) return false;
      if (!searchQuery) return true;
      const q = searchQuery.toLowerCase();
      return (
        t.company_name?.toLowerCase().includes(q) ||
        t.slug?.toLowerCase().includes(q) ||
        t.contact_email?.toLowerCase().includes(q) ||
        t.admin_name?.toLowerCase().includes(q)
      );
    })
    .sort((a, b) => {
      // Favorites first
      const aFav = favorites.has(a.id) ? 0 : 1;
      const bFav = favorites.has(b.id) ? 0 : 1;
      if (aFav !== bFav) return aFav - bFav;
      return 0; // preserve original order otherwise
    });

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="flex justify-between items-center">
          <div>
            <Skeleton className="h-8 w-48" />
            <Skeleton className="h-4 w-80 mt-2" />
          </div>
          <Skeleton className="h-10 w-44" />
        </div>
        <Skeleton className="h-10 w-60" />
        <Card>
          <CardContent className="p-0">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="flex items-center gap-4 px-4 py-3 border-b last:border-0">
                <Skeleton className="h-5 w-40" />
                <Skeleton className="h-5 w-20" />
                <Skeleton className="h-5 w-20" />
                <Skeleton className="h-5 w-24" />
                <Skeleton className="h-5 w-24 ml-auto" />
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex items-center justify-center h-10 w-10 rounded-xl bg-primary/15 glow-purple-sm">
            <Building2 className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Rental Companies</h1>
            <p className="text-sm text-muted-foreground">
              Manage all rental companies · {tenants.length} total
            </p>
          </div>
        </div>
        <Button onClick={() => setShowCreateModal(true)}>
          <Plus className="h-4 w-4" />
          Add New Rental
        </Button>
      </div>

      {/* Search & Filters */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex flex-col sm:flex-row gap-3">
            {/* Search */}
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search by name, slug, or email..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9"
              />
            </div>

            {/* Favorites toggle */}
            <button
              onClick={() => setShowFavoritesOnly(!showFavoritesOnly)}
              className={cn(
                'flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-all border',
                showFavoritesOnly
                  ? 'bg-amber-500/15 text-amber-400 border-amber-500/30 glow-amber'
                  : 'bg-secondary text-muted-foreground border-transparent hover:bg-secondary/80'
              )}
            >
              <Star className={cn('h-4 w-4', showFavoritesOnly && 'fill-amber-400')} />
              Favorites{favorites.size > 0 && ` (${favorites.size})`}
            </button>

            {/* Type pills (production/test) */}
            <div className="flex items-center gap-1.5">
              {(['all', 'production', 'test'] as const).map((type) => (
                <button
                  key={type}
                  onClick={() => setTypeFilter(type)}
                  className={cn(
                    'px-3 py-2 rounded-md text-xs font-semibold transition-all capitalize border',
                    typeFilter === type
                      ? type === 'production'
                        ? 'bg-sky-500/15 text-sky-400 border-sky-500/30'
                        : type === 'test'
                        ? 'bg-warning/15 text-amber-400 border-warning/30'
                        : 'bg-primary/15 text-primary border-primary/30'
                      : 'bg-secondary text-muted-foreground border-transparent hover:bg-secondary/80'
                  )}
                >
                  {type}
                </button>
              ))}
            </div>

            {/* Divider between the two independent filter axes */}
            <div className="hidden sm:block w-px self-stretch bg-border" />

            {/* Status pills (active/suspended) — combines with type via AND */}
            <div className="flex items-center gap-1.5">
              {(['all', 'active', 'suspended'] as const).map((status) => (
                <button
                  key={status}
                  onClick={() => setStatusFilter(status)}
                  className={cn(
                    'px-3 py-2 rounded-md text-xs font-semibold transition-all capitalize border',
                    statusFilter === status
                      ? status === 'active'
                        ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30'
                        : status === 'suspended'
                        ? 'bg-destructive/15 text-destructive border-destructive/30'
                        : 'bg-primary/15 text-primary border-primary/30'
                      : 'bg-secondary text-muted-foreground border-transparent hover:bg-secondary/80'
                  )}
                >
                  {status === 'all' ? 'Any status' : status}
                </button>
              ))}
            </div>

            {/* Divider before the migration toggle */}
            <div className="hidden sm:block w-px self-stretch bg-border" />

            {/* Migration status toggle — reveals the UK→UAE column */}
            <button
              onClick={() => setShowMigration((v) => !v)}
              className={cn(
                'flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-all border whitespace-nowrap',
                showMigration
                  ? 'bg-primary/15 text-primary border-primary/30'
                  : 'bg-secondary text-muted-foreground border-transparent hover:bg-secondary/80'
              )}
            >
              <ArrowLeftRight className="h-4 w-4" />
              {showMigration ? 'Hide migration' : 'Show migration status'}
            </button>
          </div>
        </CardContent>
      </Card>

      {/* Table */}
      <Card>
        <Table>
          <TableHeader>
            <TableRow className="bg-primary/5 hover:bg-primary/5">
              <TableHead className="w-10"></TableHead>
              <TableHead>Company</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Status</TableHead>
              {showMigration && <TableHead>Migration</TableHead>}
              <TableHead>Created</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredTenants.map((tenant) => (
              <TableRow key={tenant.id}>
                <TableCell className="pr-0">
                  <button
                    onClick={() => toggleFavorite(tenant.id)}
                    className="p-1 rounded hover:bg-accent transition-colors"
                    title={favorites.has(tenant.id) ? 'Remove from favorites' : 'Add to favorites'}
                  >
                    <Star
                      className={cn(
                        'h-4 w-4 transition-colors',
                        favorites.has(tenant.id)
                          ? 'fill-amber-400 text-amber-400'
                          : 'text-muted-foreground/40 hover:text-muted-foreground'
                      )}
                    />
                  </button>
                </TableCell>
                <TableCell className="font-medium">{tenant.company_name}</TableCell>
                <TableCell>
                  {tenant.tenant_type ? (
                    <Badge variant={tenant.tenant_type === 'production' ? 'info' : 'warning'} className="capitalize whitespace-nowrap">
                      {tenant.tenant_type}
                    </Badge>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </TableCell>
                <TableCell>
                  <Badge variant={tenant.status === 'active' ? 'success' : 'destructive'} className="capitalize whitespace-nowrap">
                    {tenant.status}
                  </Badge>
                </TableCell>
                {showMigration && (() => {
                  const state = getMigrationState(tenant);
                  const push = getPushStatus(tenant, state);
                  const sm = MIGRATION_STATE_META[state];
                  const pm = PUSH_STATUS_META[push];
                  return (
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <span className={cn('inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap', sm.className)}>
                          {sm.label}
                        </span>
                        <span className={cn('text-[11px] font-medium whitespace-nowrap', pm.className)}>
                          {pm.label}
                        </span>
                      </div>
                    </TableCell>
                  );
                })()}
                <TableCell className="text-muted-foreground tabular-nums">
                  {new Date(tenant.created_at).toLocaleDateString('en-US', { day: '2-digit', month: 'short', year: 'numeric' })}
                </TableCell>
                <TableCell className="text-right">
                  <Button variant="ghost" size="sm" asChild>
                    <Link href={`/admin/rentals/${tenant.id}`}>
                      View Details
                      <ArrowRight className="h-4 w-4" />
                    </Link>
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>

        {filteredTenants.length === 0 && (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <Building2 className="h-10 w-10 text-muted-foreground/40 mb-3" />
            <p className="text-sm text-muted-foreground">
              {showFavoritesOnly
                ? 'No favorite companies yet. Star a company to add it here.'
                : searchQuery
                ? 'No companies match your search.'
                : 'No rental companies yet. Create one to get started.'}
            </p>
          </div>
        )}
      </Card>

      <CreateTenantDialog
        open={showCreateModal}
        onOpenChange={setShowCreateModal}
        onCreated={loadTenants}
      />
    </div>
  );
}
