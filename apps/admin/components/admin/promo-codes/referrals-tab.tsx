'use client';

import { useCallback, useEffect, useState } from 'react';
import { Link2, Loader2, RefreshCw } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';
import { toast } from '@/components/ui/sonner';
import { promoApi, SOURCE_LABEL, type Referral, type TenantLite } from './api';
import { TenantPicker } from './shared';

export function ReferralsTab({ canEdit }: { canEdit: boolean }) {
  const [rows, setRows] = useState<Referral[]>([]);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<'all' | 'active' | 'void'>('active');
  const [search, setSearch] = useState('');
  const [attaching, setAttaching] = useState(false);
  const [voiding, setVoiding] = useState<Referral | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await promoApi<{ referrals: Referral[] }>('list_referrals', {
        ...(status !== 'all' ? { status } : {}),
        ...(search.trim() ? { search } : {}),
      });
      setRows(res.referrals);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [status, search]);

  useEffect(() => {
    const t = setTimeout(load, search ? 300 : 0);
    return () => clearTimeout(t);
  }, [load, search]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-[200px] flex-1 space-y-1.5">
          <Label htmlFor="ref-search">Search</Label>
          <Input id="ref-search" placeholder="Operator name" value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label>Status</Label>
          <Select value={status} onValueChange={v => setStatus(v as typeof status)}>
            <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="active">Live</SelectItem>
              <SelectItem value="void">Voided</SelectItem>
              <SelectItem value="all">All</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <Button variant="outline" size="icon" onClick={load} aria-label="Reload"><RefreshCw className="h-4 w-4" /></Button>
        {canEdit && <Button className="gap-1.5" onClick={() => setAttaching(true)}><Link2 className="h-4 w-4" /> Attach referral</Button>}
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Referrer</TableHead>
                <TableHead>New operator</TableHead>
                <TableHead>How</TableHead>
                <TableHead>Since</TableHead>
                <TableHead>Counts toward tier</TableHead>
                <TableHead className="text-right" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow><TableCell colSpan={6} className="py-10 text-center"><Loader2 className="mx-auto h-5 w-5 animate-spin text-muted-foreground" /></TableCell></TableRow>
              ) : rows.length === 0 ? (
                <TableRow><TableCell colSpan={6} className="py-10 text-center text-sm text-muted-foreground">No referrals yet.</TableCell></TableRow>
              ) : rows.map(r => (
                <TableRow key={r.id}>
                  <TableCell className="text-sm font-medium">{r.referrer_name_snapshot}</TableCell>
                  <TableCell className="text-sm">
                    {r.referred_name_snapshot}
                    {r.referee_discount_applied && <p className="text-xs text-muted-foreground">got the new-operator discount</p>}
                  </TableCell>
                  <TableCell className="text-sm">{SOURCE_LABEL[r.source]}{r.note && <p className="max-w-[240px] truncate text-xs text-muted-foreground" title={r.note}>{r.note}</p>}</TableCell>
                  <TableCell className="text-sm">{new Date(r.attributed_at).toLocaleDateString()}</TableCell>
                  <TableCell>
                    {r.status === 'void'
                      ? <Badge variant="outline" title={r.void_reason ?? ''}>Voided</Badge>
                      : <Badge variant={r.counts ? 'success' : 'warning'}>{r.counts ? 'Yes' : 'Not subscribed'}</Badge>}
                  </TableCell>
                  <TableCell className="text-right">
                    {canEdit && r.status === 'active' && <Button variant="ghost" size="sm" onClick={() => setVoiding(r)}>Void</Button>}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {attaching && <AttachReferralDialog onClose={() => setAttaching(false)} onDone={async () => { setAttaching(false); await load(); }} />}
      {voiding && <VoidReferralDialog referral={voiding} onClose={() => setVoiding(null)} onDone={async () => { setVoiding(null); await load(); }} />}
    </div>
  );
}

/** Manual fallback (brief §2.3): someone was referred but did not use the code. */
export function AttachReferralDialog({
  onClose, onDone, presetReferrer, claimId, claimLabel,
}: {
  onClose: () => void;
  onDone: () => Promise<void>;
  presetReferrer?: TenantLite | null;
  /** When approving a claim, the attach goes through resolve_claim. */
  claimId?: string;
  claimLabel?: string;
}) {
  const [referrer, setReferrer] = useState<TenantLite | null>(presetReferrer ?? null);
  const [referred, setReferred] = useState<TenantLite | null>(null);
  const [note, setNote] = useState('');
  const [applyDiscount, setApplyDiscount] = useState(false);
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (!referrer || !referred) return;
    setSaving(true);
    try {
      if (claimId) {
        await promoApi('resolve_claim', { claimId, decision: 'approve', referredTenantId: referred.id, applyRefereeDiscount: applyDiscount });
      } else {
        await promoApi('attach_referral', { referrerTenantId: referrer.id, referredTenantId: referred.id, note, applyRefereeDiscount: applyDiscount });
      }
      toast.success(`${referred.company_name || referred.slug} now counts for ${referrer.company_name || referrer.slug}`);
      await onDone();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={o => { if (!o) onClose(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{claimId ? 'Approve referral claim' : 'Attach a referral'}</DialogTitle>
          <DialogDescription>
            {claimLabel ?? 'For an operator who was referred but subscribed without the code. The referrer’s count goes up straight away and their reward updates from their next bill.'}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-1">
          <div className="space-y-1.5">
            <Label>Referrer (who told them about Drive247)</Label>
            {presetReferrer ? (
              <p className="rounded-lg border border-border px-3 py-2 text-sm font-medium">{presetReferrer.company_name || presetReferrer.slug}</p>
            ) : (
              <TenantPicker value={referrer} onChange={setReferrer} excludeId={referred?.id} />
            )}
          </div>
          <div className="space-y-1.5">
            <Label>New operator</Label>
            <TenantPicker value={referred} onChange={setReferred} excludeId={referrer?.id} />
          </div>
          {!claimId && (
            <div className="space-y-1.5">
              <Label htmlFor="attach-note">Note</Label>
              <Textarea id="attach-note" rows={2} value={note} onChange={e => setNote(e.target.value)} placeholder="e.g. Kristen told us on the phone" />
            </div>
          )}
          <label className="flex items-start gap-2 text-sm">
            <Checkbox checked={applyDiscount} onCheckedChange={v => setApplyDiscount(v === true)} className="mt-0.5" />
            <span>
              Also give the new operator the discount the referrer&apos;s code gives, from their next bill.
              <span className="block text-xs text-muted-foreground">They must have a live subscription, and no other promo code.</span>
            </span>
          </label>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button onClick={save} disabled={saving || !referrer || !referred}>
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} {claimId ? 'Approve' : 'Attach'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function VoidReferralDialog({ referral, onClose, onDone }: { referral: Referral; onClose: () => void; onDone: () => Promise<void> }) {
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const save = async () => {
    setSaving(true);
    try {
      await promoApi('void_referral', { referralId: referral.id, reason });
      toast.success('Referral voided. The referrer’s reward updates from their next bill.');
      await onDone();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  };
  return (
    <Dialog open onOpenChange={o => { if (!o) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Void this referral?</DialogTitle>
          <DialogDescription>
            {referral.referred_name_snapshot} will stop counting for {referral.referrer_name_snapshot}. Any discount the new operator already has is not taken back.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-1.5">
          <Label htmlFor="void-reason">Reason</Label>
          <Textarea id="void-reason" rows={2} value={reason} onChange={e => setReason(e.target.value)} placeholder="Wrong operator, duplicate, fraud…" />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button variant="destructive" onClick={save} disabled={saving || reason.trim().length < 3}>
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Void referral
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
