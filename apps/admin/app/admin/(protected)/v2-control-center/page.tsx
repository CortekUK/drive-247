'use client';

/**
 * V2 Control Center — where a super admin sees every v2 batch and controls its
 * rollout.
 *
 * The v2 UI is being rebuilt with a strangler pattern: new screens ship beside
 * the ones they replace, and tenants move across one at a time. A BATCH is one
 * coherent change owning one area, built on a branch, verified on `northwind`,
 * then rolled out tenant by tenant — and rolled back the same way.
 *
 * Backed by `batches` / `tenant_batches` / `batch_files`
 * (supabase/migrations/20260902120000_add_v2_control_center.sql). All three are
 * super-admin-only under RLS.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/store/authStore';
import { cn } from '@/lib/utils';
import { toast } from '@/components/ui/sonner';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Plus, Layers, ShieldOff, Search } from 'lucide-react';
import { BatchDetail } from '@/components/admin/v2-control-center/batch-detail';
import type { Batch, BatchStatus, TenantBatch, TenantLite } from '@/components/admin/v2-control-center/types';
import {
  BATCH_STATUSES,
  BATCH_TAGS,
  STATUS_META,
  TAG_LABELS,
  describeDbError,
  parseBatch,
} from '@/components/admin/v2-control-center/types';

interface NewBatchForm {
  key: string;
  title: string;
  description: string;
  status: BatchStatus;
  tags: string[];
  branch: string;
  owner: string;
  area: string;
}

const EMPTY_FORM: NewBatchForm = {
  key: '',
  title: '',
  description: '',
  status: 'not_started',
  tags: [],
  branch: '',
  owner: '',
  area: '',
};

export default function V2ControlCenterPage() {
  const { user } = useAuthStore();
  const actor = user?.email ?? 'unknown';

  const [batches, setBatches] = useState<Batch[]>([]);
  const [tenants, setTenants] = useState<TenantLite[]>([]);
  const [rollouts, setRollouts] = useState<TenantBatch[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [filter, setFilter] = useState('');

  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState<NewBatchForm>(EMPTY_FORM);
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    const [batchRes, tenantRes, rolloutRes] = await Promise.all([
      supabase.from('batches').select('*').order('key', { ascending: true }),
      supabase
        .from('tenants')
        .select('id, slug, company_name, status')
        .order('company_name', { ascending: true }),
      supabase.from('tenant_batches').select('*'),
    ]);

    if (batchRes.error) {
      toast.error(`Could not load batches: ${batchRes.error.message}`);
    } else {
      setBatches(((batchRes.data ?? []) as Record<string, unknown>[]).map(parseBatch));
    }

    if (tenantRes.error) {
      toast.error(`Could not load tenants: ${tenantRes.error.message}`);
    } else {
      setTenants((tenantRes.data ?? []) as TenantLite[]);
    }

    if (rolloutRes.error) {
      toast.error(`Could not load rollout state: ${rolloutRes.error.message}`);
    } else {
      setRollouts((rolloutRes.data ?? []) as TenantBatch[]);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      await load();
      if (!cancelled) setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [load]);

  /** enabled-tenant count per batch, for the list's "6 / 35". */
  const enabledCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const row of rollouts) {
      if (!row.enabled) continue;
      counts.set(row.batch_id, (counts.get(row.batch_id) ?? 0) + 1);
    }
    return counts;
  }, [rollouts]);

  const visibleBatches = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return batches;
    return batches.filter(
      (b) =>
        b.key.toLowerCase().includes(q) ||
        b.title.toLowerCase().includes(q) ||
        (b.area ?? '').toLowerCase().includes(q) ||
        (b.owner ?? '').toLowerCase().includes(q) ||
        (b.branch ?? '').toLowerCase().includes(q),
    );
  }, [batches, filter]);

  const selected = useMemo(
    () => batches.find((b) => b.id === selectedId) ?? null,
    [batches, selectedId],
  );

  // Land on the first batch so the page is never a dead list, and recover if the
  // selected batch is deleted or filtered out of existence.
  useEffect(() => {
    if (loading) return;
    if (selectedId && batches.some((b) => b.id === selectedId)) return;
    setSelectedId(batches[0]?.id ?? null);
  }, [loading, batches, selectedId]);

  const selectedRollouts = useMemo(
    () => (selected ? rollouts.filter((r) => r.batch_id === selected.id) : []),
    [rollouts, selected],
  );

  const createBatch = async () => {
    const key = form.key.trim().toLowerCase();
    const title = form.title.trim();
    if (!key || !title) {
      toast.error('A batch needs a key and a title');
      return;
    }
    setCreating(true);
    try {
      const { data, error } = await supabase
        .from('batches')
        .insert({
          key,
          title,
          description: form.description.trim() || null,
          status: form.status,
          tags: form.tags,
          branch: form.branch.trim() || null,
          owner: form.owner.trim() || null,
          area: form.area.trim() || null,
        })
        .select()
        .single();
      if (error) throw error;

      const created = parseBatch(data as Record<string, unknown>);
      await load();
      setSelectedId(created.id);
      setForm(EMPTY_FORM);
      setCreateOpen(false);
      toast.success(`Batch ${created.key} created`);
    } catch (error) {
      toast.error(describeDbError(error, 'Could not create the batch'));
    } finally {
      setCreating(false);
    }
  };

  if (loading) {
    return (
      <div className="space-y-6">
        <div>
          <Skeleton className="h-8 w-56" />
          <Skeleton className="h-4 w-96 mt-2" />
        </div>
        <div className="grid gap-6 lg:grid-cols-[360px_minmax(0,1fr)]">
          <Skeleton className="h-[420px] rounded-lg" />
          <Skeleton className="h-[560px] rounded-lg" />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">V2 Control Center</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Each batch is one coherent v2 change, owning one area. Roll it out tenant by tenant, and
            roll it back the same way.
          </p>
        </div>
        <Button onClick={() => setCreateOpen(true)}>
          <Plus className="h-4 w-4" />
          New batch
        </Button>
      </div>

      <div className="grid gap-6 lg:grid-cols-[360px_minmax(0,1fr)] items-start">
        {/* ── Batch list ──────────────────────────────────────────────── */}
        <Card className="lg:sticky lg:top-0">
          <CardContent className="p-3 space-y-3">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                placeholder="Filter batches"
                className="pl-9"
              />
            </div>

            {batches.length === 0 ? (
              <div className="rounded-md border border-dashed border-border px-4 py-10 text-center">
                <Layers className="h-6 w-6 mx-auto text-muted-foreground mb-2" />
                <p className="text-sm font-medium">No batches yet</p>
                <p className="text-xs text-muted-foreground mt-1">
                  Create b1 to start tracking the v2 rollout.
                </p>
              </div>
            ) : visibleBatches.length === 0 ? (
              <p className="text-xs text-muted-foreground px-1 py-6 text-center">
                No batch matches that filter.
              </p>
            ) : (
              <div className="space-y-1.5 max-h-[calc(100vh-14rem)] overflow-y-auto pr-1">
                {visibleBatches.map((batch) => {
                  const active = batch.id === selectedId;
                  const enabled = enabledCounts.get(batch.id) ?? 0;
                  return (
                    <button
                      key={batch.id}
                      type="button"
                      onClick={() => setSelectedId(batch.id)}
                      className={cn(
                        'w-full text-left rounded-lg border px-3 py-2.5 transition-colors',
                        active
                          ? 'border-primary/40 bg-primary/10'
                          : 'border-border hover:bg-secondary',
                      )}
                    >
                      <div className="flex items-center gap-2">
                        <Badge variant="outline" className="font-mono uppercase shrink-0">
                          {batch.key}
                        </Badge>
                        <span className="text-sm font-medium truncate flex-1">{batch.title}</span>
                        {batch.killswitch && (
                          <ShieldOff className="h-3.5 w-3.5 text-red-400 shrink-0" />
                        )}
                      </div>

                      <div className="flex items-center gap-2 mt-2">
                        <span
                          className={cn(
                            'rounded-full border px-2 py-0.5 text-[10px] font-semibold',
                            STATUS_META[batch.status].className,
                          )}
                        >
                          {STATUS_META[batch.status].label}
                        </span>
                        <span
                          className={cn(
                            'text-[11px] tabular-nums ml-auto',
                            batch.killswitch
                              ? 'text-red-400'
                              : enabled > 0
                                ? 'text-emerald-400'
                                : 'text-muted-foreground',
                          )}
                        >
                          {enabled} / {tenants.length}
                        </span>
                      </div>

                      {batch.tags.length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-2">
                          {batch.tags.map((tag) => (
                            <span
                              key={tag}
                              className="rounded-full border border-border px-1.5 py-0.5 text-[10px] text-muted-foreground"
                            >
                              {TAG_LABELS[tag as keyof typeof TAG_LABELS] ?? tag}
                            </span>
                          ))}
                        </div>
                      )}

                      {batch.area && (
                        <p className="text-[11px] text-muted-foreground mt-1.5 truncate">
                          owns {batch.area}
                        </p>
                      )}
                    </button>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

        {/* ── Detail ──────────────────────────────────────────────────── */}
        {selected ? (
          <BatchDetail
            key={selected.id}
            batch={selected}
            tenants={tenants}
            rollouts={selectedRollouts}
            actor={actor}
            onChanged={load}
            onDeleted={async () => {
              setSelectedId(null);
              await load();
            }}
          />
        ) : (
          <Card>
            <CardContent className="py-20 text-center">
              <Layers className="h-8 w-8 mx-auto text-muted-foreground mb-3" />
              <p className="text-sm font-medium">Nothing selected</p>
              <p className="text-xs text-muted-foreground mt-1">
                Pick a batch on the left, or create one.
              </p>
            </CardContent>
          </Card>
        )}
      </div>

      {/* ── Create ────────────────────────────────────────────────────── */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>New batch</DialogTitle>
            <DialogDescription>
              One coherent change, owning one area, independently roll-back-able.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="grid grid-cols-[110px_minmax(0,1fr)] gap-3">
              <div>
                <Label className="mb-1.5 block">Key</Label>
                <Input
                  value={form.key}
                  onChange={(e) => setForm({ ...form, key: e.target.value })}
                  placeholder="b1"
                  className="font-mono"
                />
              </div>
              <div>
                <Label className="mb-1.5 block">Title</Label>
                <Input
                  value={form.title}
                  onChange={(e) => setForm({ ...form, title: e.target.value })}
                  placeholder="New portal dashboard"
                />
              </div>
            </div>

            <div>
              <Label className="mb-1.5 block">Description</Label>
              <Textarea
                rows={3}
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                placeholder="What this batch changes, and what it replaces."
              />
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <Label className="mb-1.5 block">Status</Label>
                <Select
                  value={form.status}
                  onValueChange={(value) => setForm({ ...form, status: value as BatchStatus })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {BATCH_STATUSES.map((status) => (
                      <SelectItem key={status} value={status}>
                        {STATUS_META[status].label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="mb-1.5 block">Owner</Label>
                <Input
                  value={form.owner}
                  onChange={(e) => setForm({ ...form, owner: e.target.value })}
                  placeholder="Who is building it"
                />
              </div>
              <div>
                <Label className="mb-1.5 block">Branch</Label>
                <Input
                  value={form.branch}
                  onChange={(e) => setForm({ ...form, branch: e.target.value })}
                  placeholder="v2/b1-dashboard"
                  className="font-mono text-xs"
                />
              </div>
              <div>
                <Label className="mb-1.5 block">Area</Label>
                <Input
                  value={form.area}
                  onChange={(e) => setForm({ ...form, area: e.target.value })}
                  placeholder="portal/dashboard"
                />
              </div>
            </div>

            <div>
              <Label className="mb-2 block">Tags</Label>
              <div className="flex flex-wrap gap-1.5">
                {BATCH_TAGS.map((tag) => {
                  const on = form.tags.includes(tag);
                  return (
                    <button
                      key={tag}
                      type="button"
                      onClick={() =>
                        setForm({
                          ...form,
                          tags: on ? form.tags.filter((t) => t !== tag) : [...form.tags, tag],
                        })
                      }
                      className={cn(
                        'rounded-full border px-2.5 py-0.5 text-[11px] font-semibold transition-colors',
                        on
                          ? 'border-primary/30 bg-primary/15 text-primary'
                          : 'border-border text-muted-foreground hover:text-foreground hover:bg-secondary',
                      )}
                    >
                      {TAG_LABELS[tag]}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="ghost" onClick={() => setCreateOpen(false)} disabled={creating}>
              Cancel
            </Button>
            <Button onClick={createBatch} disabled={creating}>
              {creating ? 'Creating…' : 'Create batch'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
