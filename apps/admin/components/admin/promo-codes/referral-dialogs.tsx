'use client';

// Attaching a referral by hand, and voiding one. Both are reached from an
// operator's referral set-up (Referral Links -> View) and from a claim.

import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { toast } from '@/components/ui/sonner';
import { promoApi, type Referral, type TenantLite } from './api';
import { TenantPicker } from './shared';

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
