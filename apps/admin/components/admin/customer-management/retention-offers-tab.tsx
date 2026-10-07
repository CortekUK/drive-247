'use client';

/**
 * Tiered retention offers — what an operator is offered when they say "The
 * price is too high for us" in the v2 portal's cancel flow.
 *
 *   Default offer      everyone gets this unless they have their own (starts at
 *                      10% off for 1 month)
 *   Tenant offers      a specific percent / months for a chosen tenant
 *   Redemptions        who has used theirs, and whether Stripe took the coupon
 *
 * ONE offer per tenant, ever: `tenant_retention_redemptions` is keyed on the
 * tenant, and the `accept-retention-offer` edge function refuses a second
 * accept. Once used, the portal stops showing the offer — even after the
 * discount has run out. The coupon itself is Stripe's (repeating for N months),
 * so it ends by itself.
 *
 * Data is read and written with the super admin's own session; RLS on all
 * three tables is `is_super_admin()`. Redemptions are read-only here except for
 * "Allow again", which deletes one on purpose.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { BadgePercent, Gift, Loader2, Pencil, Plus, RefreshCw, RotateCcw, Trash2, Users } from 'lucide-react';

import { supabase } from '@/lib/supabase';
import { toast } from '@/components/ui/sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

interface Settings {
  enabled: boolean;
  default_percent: number;
  default_months: number;
  updated_at: string;
}

interface TenantOffer {
  tenant_id: string;
  percent: number;
  months: number;
  note: string | null;
  updated_at: string;
}

interface Redemption {
  tenant_id: string;
  percent: number;
  months: number;
  source: 'default' | 'tenant';
  accepted_at: string;
  ends_at: string | null;
  stripe_status: 'pending' | 'applied' | 'failed' | 'no_subscription';
  stripe_error: string | null;
}

interface TenantLite {
  id: string;
  company_name: string | null;
  slug: string | null;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

const MAX_MONTHS = 36;

function offerLabel(percent: number, months: number): string {
  return `${percent}% off for ${months} month${months === 1 ? '' : 's'}`;
}

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

/** Whole numbers inside a range, or null. */
function readInt(value: string, min: number, max: number): number | null {
  const n = Number(value);
  return Number.isInteger(n) && n >= min && n <= max ? n : null;
}

const STRIPE_BADGE: Record<Redemption['stripe_status'], { label: string; className: string }> = {
  applied: { label: 'Applied in Stripe', className: 'bg-green-100 text-green-800 dark:bg-green-500/15 dark:text-green-300' },
  pending: { label: 'Pending', className: 'bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300' },
  failed: { label: 'Stripe failed — apply by hand', className: 'bg-red-100 text-red-800 dark:bg-red-500/15 dark:text-red-300' },
  no_subscription: { label: 'No live subscription', className: 'bg-muted text-muted-foreground' },
};

export function RetentionOffersTab({ canEdit }: { canEdit: boolean }) {
  const [loading, setLoading] = useState(true);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [offers, setOffers] = useState<TenantOffer[]>([]);
  const [redemptions, setRedemptions] = useState<Redemption[]>([]);
  const [tenants, setTenants] = useState<TenantLite[]>([]);

  const [percentDraft, setPercentDraft] = useState('');
  const [monthsDraft, setMonthsDraft] = useState('');
  const [savingDefault, setSavingDefault] = useState(false);

  const [editing, setEditing] = useState<{ tenantId: string; percent: string; months: string; note: string; isNew: boolean } | null>(null);
  const [savingOffer, setSavingOffer] = useState(false);
  const [confirmReset, setConfirmReset] = useState<Redemption | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [s, o, r, t] = await Promise.all([
        db.from('retention_offer_settings').select('*').eq('id', true).maybeSingle(),
        db.from('tenant_retention_offers').select('*').order('updated_at', { ascending: false }),
        db.from('tenant_retention_redemptions').select('*').order('accepted_at', { ascending: false }),
        db.from('tenants').select('id, company_name, slug').order('company_name', { ascending: true }),
      ]);
      for (const res of [s, o, r, t]) if (res.error) throw res.error;
      const next = (s.data as Settings | null) ?? { enabled: true, default_percent: 10, default_months: 1, updated_at: '' };
      setSettings(next);
      setPercentDraft(String(next.default_percent));
      setMonthsDraft(String(next.default_months));
      setOffers((o.data as TenantOffer[]) ?? []);
      setRedemptions((r.data as Redemption[]) ?? []);
      setTenants((t.data as TenantLite[]) ?? []);
    } catch (e) {
      toast.error('Could not load retention offers', { description: (e as Error).message });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const tenantName = useMemo(() => {
    const map = new Map(tenants.map((t) => [t.id, t.company_name || t.slug || t.id]));
    return (id: string) => map.get(id) ?? 'Unknown tenant';
  }, [tenants]);
  const redeemedBy = useMemo(() => new Map(redemptions.map((r) => [r.tenant_id, r])), [redemptions]);

  const defaultDirty =
    !!settings && (percentDraft !== String(settings.default_percent) || monthsDraft !== String(settings.default_months));

  async function saveDefault(patch: Partial<Settings>) {
    setSavingDefault(true);
    try {
      const { error } = await db
        .from('retention_offer_settings')
        .update({ ...patch, updated_at: new Date().toISOString() })
        .eq('id', true);
      if (error) throw error;
      toast.success('Default offer saved');
      await load();
    } catch (e) {
      toast.error('Could not save', { description: (e as Error).message });
    } finally {
      setSavingDefault(false);
    }
  }

  function submitDefault() {
    const percent = readInt(percentDraft, 1, 100);
    const months = readInt(monthsDraft, 1, MAX_MONTHS);
    if (percent == null || months == null) {
      toast.error(`Percent must be 1–100 and months 1–${MAX_MONTHS}, whole numbers`);
      return;
    }
    void saveDefault({ default_percent: percent, default_months: months });
  }

  async function saveOffer() {
    if (!editing) return;
    const percent = readInt(editing.percent, 1, 100);
    const months = readInt(editing.months, 1, MAX_MONTHS);
    if (!editing.tenantId) {
      toast.error('Choose a tenant');
      return;
    }
    if (percent == null || months == null) {
      toast.error(`Percent must be 1–100 and months 1–${MAX_MONTHS}, whole numbers`);
      return;
    }
    setSavingOffer(true);
    try {
      const { error } = await db.from('tenant_retention_offers').upsert(
        {
          tenant_id: editing.tenantId,
          percent,
          months,
          note: editing.note.trim() || null,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'tenant_id' },
      );
      if (error) throw error;
      toast.success(`Offer saved for ${tenantName(editing.tenantId)}`);
      setEditing(null);
      await load();
    } catch (e) {
      toast.error('Could not save', { description: (e as Error).message });
    } finally {
      setSavingOffer(false);
    }
  }

  async function removeOffer(tenantId: string) {
    const { error } = await db.from('tenant_retention_offers').delete().eq('tenant_id', tenantId);
    if (error) {
      toast.error('Could not remove', { description: error.message });
      return;
    }
    toast.success(`${tenantName(tenantId)} is back on the default offer`);
    await load();
  }

  async function resetRedemption(r: Redemption) {
    const { error } = await db.from('tenant_retention_redemptions').delete().eq('tenant_id', r.tenant_id);
    if (error) {
      toast.error('Could not reset', { description: error.message });
      return;
    }
    toast.success(`${tenantName(r.tenant_id)} can be offered a discount again`);
    setConfirmReset(null);
    await load();
  }

  const tenantsWithoutOffer = useMemo(
    () => tenants.filter((t) => !offers.some((o) => o.tenant_id === t.id)),
    [tenants, offers],
  );

  if (loading && !settings) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-48 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* ── Default ─────────────────────────────────────────────────────── */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="space-y-1">
              <CardTitle className="flex items-center gap-2">
                <BadgePercent className="h-5 w-5 text-primary" />
                Tiered retention offers
              </CardTitle>
              <CardDescription>
                When an operator tries to cancel because &ldquo;the price is too high&rdquo;, the portal offers them a
                discount to stay. It is applied in Stripe automatically and ends by itself. Each tenant can use it{' '}
                <span className="font-medium text-foreground">once, ever</span>.
              </CardDescription>
            </div>
            <Button variant="ghost" size="sm" className="gap-1.5" onClick={() => void load()} disabled={loading}>
              <RefreshCw className={loading ? 'h-4 w-4 animate-spin' : 'h-4 w-4'} />
              Refresh
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="flex items-center justify-between gap-4 rounded-lg border p-4">
            <div>
              <p className="text-sm font-medium">Offer a discount in the cancel flow</p>
              <p className="text-sm text-muted-foreground">
                Off: &ldquo;The price is too high&rdquo; goes straight to the cancellation step for everyone.
              </p>
            </div>
            <Switch
              checked={settings?.enabled ?? true}
              disabled={!canEdit || savingDefault}
              onCheckedChange={(v) => void saveDefault({ enabled: v })}
            />
          </div>

          <div>
            <p className="text-sm font-medium">Default offer — every tenant without their own</p>
            <div className="mt-3 flex flex-wrap items-end gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="ret-percent">Discount</Label>
                <div className="flex items-center gap-2">
                  <Input
                    id="ret-percent"
                    type="number"
                    min={1}
                    max={100}
                    className="w-24"
                    value={percentDraft}
                    disabled={!canEdit}
                    onChange={(e) => setPercentDraft(e.target.value)}
                  />
                  <span className="text-sm text-muted-foreground">% off</span>
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ret-months">For</Label>
                <div className="flex items-center gap-2">
                  <Input
                    id="ret-months"
                    type="number"
                    min={1}
                    max={MAX_MONTHS}
                    className="w-24"
                    value={monthsDraft}
                    disabled={!canEdit}
                    onChange={(e) => setMonthsDraft(e.target.value)}
                  />
                  <span className="text-sm text-muted-foreground">months</span>
                </div>
              </div>
              <Button onClick={submitDefault} disabled={!canEdit || !defaultDirty || savingDefault}>
                {savingDefault ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Save default'}
              </Button>
            </div>
            {settings && (
              <p className="mt-2 text-xs text-muted-foreground">
                Live now: {offerLabel(settings.default_percent, settings.default_months)}.
              </p>
            )}
          </div>
        </CardContent>
      </Card>

      {/* ── Per tenant ──────────────────────────────────────────────────── */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="space-y-1">
              <CardTitle className="flex items-center gap-2">
                <Users className="h-5 w-5 text-primary" />
                Tenant-specific offers
              </CardTitle>
              <CardDescription>Give a chosen tenant a different discount or length. Everyone else gets the default.</CardDescription>
            </div>
            {canEdit && (
              <Button
                size="sm"
                className="gap-1.5"
                onClick={() =>
                  setEditing({
                    tenantId: '',
                    percent: String(settings?.default_percent ?? 10),
                    months: String(settings?.default_months ?? 1),
                    note: '',
                    isNew: true,
                  })
                }
              >
                <Plus className="h-4 w-4" />
                Add tenant offer
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {offers.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">No tenant-specific offers — everyone gets the default.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Tenant</TableHead>
                  <TableHead>Offer</TableHead>
                  <TableHead>Note</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="w-[1%]" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {offers.map((o) => {
                  const used = redeemedBy.get(o.tenant_id);
                  return (
                    <TableRow key={o.tenant_id}>
                      <TableCell className="font-medium">{tenantName(o.tenant_id)}</TableCell>
                      <TableCell>{offerLabel(o.percent, o.months)}</TableCell>
                      <TableCell className="max-w-[260px] truncate text-muted-foreground">{o.note || '—'}</TableCell>
                      <TableCell>
                        {used ? (
                          <span className="text-sm text-muted-foreground">Used {formatDate(used.accepted_at)}</span>
                        ) : (
                          <span className="text-sm text-green-700 dark:text-green-400">Available</span>
                        )}
                      </TableCell>
                      <TableCell>
                        {canEdit && (
                          <div className="flex justify-end gap-1">
                            <Button
                              variant="ghost"
                              size="icon"
                              aria-label="Edit"
                              onClick={() =>
                                setEditing({
                                  tenantId: o.tenant_id,
                                  percent: String(o.percent),
                                  months: String(o.months),
                                  note: o.note ?? '',
                                  isNew: false,
                                })
                              }
                            >
                              <Pencil className="h-4 w-4" />
                            </Button>
                            <Button variant="ghost" size="icon" aria-label="Remove" onClick={() => void removeOffer(o.tenant_id)}>
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* ── Redemptions ─────────────────────────────────────────────────── */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2">
            <Gift className="h-5 w-5 text-primary" />
            Used offers
          </CardTitle>
          <CardDescription>
            Tenants who accepted their offer. They will not be offered another one, even after it ends.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {redemptions.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">No tenant has used an offer yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Tenant</TableHead>
                  <TableHead>Offer</TableHead>
                  <TableHead>Accepted</TableHead>
                  <TableHead>Ends</TableHead>
                  <TableHead>Stripe</TableHead>
                  <TableHead className="w-[1%]" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {redemptions.map((r) => {
                  const badge = STRIPE_BADGE[r.stripe_status];
                  const ended = r.ends_at ? new Date(r.ends_at).getTime() < Date.now() : false;
                  return (
                    <TableRow key={r.tenant_id}>
                      <TableCell className="font-medium">{tenantName(r.tenant_id)}</TableCell>
                      <TableCell>
                        {offerLabel(r.percent, r.months)}
                        <span className="ml-1.5 text-xs text-muted-foreground">({r.source === 'tenant' ? 'tenant offer' : 'default'})</span>
                      </TableCell>
                      <TableCell>{formatDate(r.accepted_at)}</TableCell>
                      <TableCell>
                        {formatDate(r.ends_at)}
                        {ended && <span className="ml-1.5 text-xs text-muted-foreground">(ended)</span>}
                      </TableCell>
                      <TableCell>
                        <Badge variant="secondary" className={badge.className} title={r.stripe_error ?? undefined}>
                          {badge.label}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        {canEdit && (
                          <Button variant="ghost" size="sm" className="gap-1.5" onClick={() => setConfirmReset(r)}>
                            <RotateCcw className="h-3.5 w-3.5" />
                            Allow again
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* ── Add / edit a tenant offer ───────────────────────────────────── */}
      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{editing?.isNew ? 'Add tenant offer' : `Edit offer — ${editing ? tenantName(editing.tenantId) : ''}`}</DialogTitle>
            <DialogDescription>Replaces the default offer for this tenant only.</DialogDescription>
          </DialogHeader>
          {editing && (
            <div className="space-y-4">
              {editing.isNew && (
                <div className="space-y-1.5">
                  <Label>Tenant</Label>
                  <Select value={editing.tenantId} onValueChange={(v) => setEditing({ ...editing, tenantId: v })}>
                    <SelectTrigger>
                      <SelectValue placeholder="Choose a tenant" />
                    </SelectTrigger>
                    <SelectContent className="max-h-72">
                      {tenantsWithoutOffer.map((t) => (
                        <SelectItem key={t.id} value={t.id}>
                          {t.company_name || t.slug || t.id}
                          {redeemedBy.has(t.id) ? ' — already used' : ''}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="to-percent">Discount (%)</Label>
                  <Input
                    id="to-percent"
                    type="number"
                    min={1}
                    max={100}
                    value={editing.percent}
                    onChange={(e) => setEditing({ ...editing, percent: e.target.value })}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="to-months">For (months)</Label>
                  <Input
                    id="to-months"
                    type="number"
                    min={1}
                    max={MAX_MONTHS}
                    value={editing.months}
                    onChange={(e) => setEditing({ ...editing, months: e.target.value })}
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="to-note">Note (internal)</Label>
                <Input
                  id="to-note"
                  placeholder="Why this tenant gets a different offer"
                  value={editing.note}
                  onChange={(e) => setEditing({ ...editing, note: e.target.value })}
                />
              </div>
              {editing.tenantId && redeemedBy.has(editing.tenantId) && (
                <p className="text-sm text-amber-700 dark:text-amber-400">
                  This tenant has already used their one-time offer, so they will not see this unless you use
                  &ldquo;Allow again&rdquo; under Used offers.
                </p>
              )}
            </div>
          )}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setEditing(null)}>
              Cancel
            </Button>
            <Button onClick={() => void saveOffer()} disabled={savingOffer}>
              {savingOffer ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Save offer'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Confirm "Allow again" ───────────────────────────────────────── */}
      <Dialog open={!!confirmReset} onOpenChange={(o) => !o && setConfirmReset(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Allow {confirmReset ? tenantName(confirmReset.tenant_id) : ''} another offer?</DialogTitle>
            <DialogDescription>
              The one-time rule exists so an operator cannot keep threatening to leave for another discount. This
              removes their used offer, so the next time they try to cancel they will be offered a discount again.
              Any discount still running in Stripe is not touched.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setConfirmReset(null)}>
              Keep it used
            </Button>
            <Button variant="destructive" onClick={() => confirmReset && void resetRedemption(confirmReset)}>
              Allow again
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
