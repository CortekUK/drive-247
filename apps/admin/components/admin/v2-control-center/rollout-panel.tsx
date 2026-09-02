'use client';

import { useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { cn } from '@/lib/utils';
import { toast } from '@/components/ui/sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Search, Undo2, Power, AlertTriangle } from 'lucide-react';
import type { Batch, TenantBatch, TenantLite } from './types';
import { describeDbError, formatWhen } from './types';

interface RolloutPanelProps {
  batch: Batch;
  tenants: TenantLite[];
  /** Every tenant_batches row for THIS batch, enabled or not. */
  rollouts: TenantBatch[];
  actor: string;
  onChanged: () => Promise<void> | void;
}

export function RolloutPanel({ batch, tenants, rollouts, actor, onChanged }: RolloutPanelProps) {
  const [query, setQuery] = useState('');
  const [busyTenantId, setBusyTenantId] = useState<string | null>(null);

  const byTenant = useMemo(() => {
    const map = new Map<string, TenantBatch>();
    for (const row of rollouts) map.set(row.tenant_id, row);
    return map;
  }, [rollouts]);

  const enabled = useMemo(
    () =>
      tenants
        .filter((t) => byTenant.get(t.id)?.enabled === true)
        .sort((a, b) => a.company_name.localeCompare(b.company_name)),
    [tenants, byTenant],
  );

  // The search list deliberately excludes tenants already enabled — they are
  // shown above with a Roll back button, and offering "Enable" twice for the
  // same tenant is the kind of ambiguity that gets a live tenant flipped by
  // accident.
  const candidates = useMemo(() => {
    const q = query.trim().toLowerCase();
    return tenants
      .filter((t) => byTenant.get(t.id)?.enabled !== true)
      .filter(
        (t) =>
          !q ||
          t.company_name.toLowerCase().includes(q) ||
          t.slug.toLowerCase().includes(q),
      )
      .sort((a, b) => a.company_name.localeCompare(b.company_name));
  }, [tenants, byTenant, query]);

  const setEnabled = async (tenant: TenantLite, next: boolean) => {
    setBusyTenantId(tenant.id);
    try {
      const now = new Date().toISOString();
      const existing = byTenant.get(tenant.id);

      if (existing) {
        const { error } = await supabase
          .from('tenant_batches')
          .update(
            next
              ? { enabled: true, enabled_at: now, enabled_by: actor, rolled_back_at: null, rolled_back_by: null }
              : { enabled: false, rolled_back_at: now, rolled_back_by: actor },
          )
          .eq('id', existing.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from('tenant_batches').insert({
          batch_id: batch.id,
          tenant_id: tenant.id,
          enabled: next,
          enabled_at: next ? now : null,
          enabled_by: next ? actor : null,
        });
        if (error) throw error;
      }

      toast.success(
        next
          ? `${batch.key} enabled for ${tenant.company_name}`
          : `${batch.key} rolled back for ${tenant.company_name}`,
      );
      await onChanged();
    } catch (error) {
      toast.error(describeDbError(error, 'Could not change the rollout'));
    } finally {
      setBusyTenantId(null);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold">Rollout</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            {enabled.length} of {tenants.length} tenants enabled
          </p>
        </div>
        <Badge variant={enabled.length > 0 ? 'success' : 'outline'}>
          {enabled.length} / {tenants.length}
        </Badge>
      </div>

      {batch.killswitch && enabled.length > 0 && (
        <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-red-400">
          <AlertTriangle className="h-4 w-4 mt-px shrink-0" />
          <span>
            The kill-switch is on, so none of the {enabled.length} tenant
            {enabled.length === 1 ? '' : 's'} below is actually seeing this batch. Their rows are
            kept as-is — releasing the switch restores exactly this list.
          </span>
        </div>
      )}

      {/* ── Enabled ─────────────────────────────────────────────────────── */}
      <div className="space-y-2">
        <p className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground/70">
          Enabled
        </p>
        {enabled.length === 0 ? (
          <p className="text-xs text-muted-foreground rounded-md border border-dashed border-border px-3 py-4 text-center">
            Not rolled out to any tenant yet.
          </p>
        ) : (
          <div className="space-y-1.5">
            {enabled.map((tenant) => {
              const row = byTenant.get(tenant.id);
              return (
                <div
                  key={tenant.id}
                  className="flex items-center justify-between gap-3 rounded-md border border-emerald-500/25 bg-emerald-500/[0.06] px-3 py-2"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">{tenant.company_name}</p>
                    <p className="text-[11px] text-muted-foreground truncate">
                      {tenant.slug}
                      {row?.enabled_by ? ` · by ${row.enabled_by}` : ''}
                      {row?.enabled_at ? ` · ${formatWhen(row.enabled_at)}` : ''}
                    </p>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={busyTenantId === tenant.id}
                    onClick={() => setEnabled(tenant, false)}
                    className="shrink-0"
                  >
                    <Undo2 className="h-3.5 w-3.5" />
                    Roll back
                  </Button>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ── Search / enable ─────────────────────────────────────────────── */}
      <div className="space-y-2">
        <p className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground/70">
          Add a tenant
        </p>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by company name or slug"
            className="pl-9"
          />
        </div>

        <div className="max-h-[320px] overflow-y-auto space-y-1.5 pr-1">
          {candidates.length === 0 ? (
            <p className="text-xs text-muted-foreground rounded-md border border-dashed border-border px-3 py-4 text-center">
              {query ? 'No tenant matches that search.' : 'Every tenant already has this batch.'}
            </p>
          ) : (
            candidates.map((tenant) => {
              const row = byTenant.get(tenant.id);
              return (
                <div
                  key={tenant.id}
                  className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">{tenant.company_name}</p>
                    <p
                      className={cn(
                        'text-[11px] truncate',
                        row?.rolled_back_at ? 'text-amber-400' : 'text-muted-foreground',
                      )}
                    >
                      {tenant.slug}
                      {row?.rolled_back_at
                        ? ` · rolled back ${formatWhen(row.rolled_back_at)}${
                            row.rolled_back_by ? ` by ${row.rolled_back_by}` : ''
                          }`
                        : ''}
                    </p>
                  </div>
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={busyTenantId === tenant.id}
                    onClick={() => setEnabled(tenant, true)}
                    className="shrink-0"
                  >
                    <Power className="h-3.5 w-3.5" />
                    Enable
                  </Button>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
