'use client';

import { useState } from 'react';
import { SlidersHorizontal } from 'lucide-react';
import { Button } from '@/components/ui-v2/button';
import { Input } from '@/components/ui-v2/input';
import { Label } from '@/components/ui-v2/label';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui-v2/dialog';
import { useTraxSupportOptional } from '@/components/trax/support/trax-support-context';
import type { TraxRetentionPolicy } from '@/types/trax-support';

/**
 * Support retention, for the roles the server grants `managePolicy`. It is a
 * dialog rather than a panel in the page: it is an administrator's occasional
 * setting, and the workspace behind it is sized to the viewport.
 */
export function RetentionDialog({ compact = false }: { compact?: boolean } = {}) {
  const trax = useTraxSupportOptional();
  const support = trax?.support;
  const supportRequest = support?.supportRequest;
  const busy = !!support?.isLoading;
  const [open, setOpen] = useState(false);
  const [policy, setPolicy] = useState<TraxRetentionPolicy | null>(null);
  const [preview, setPreview] = useState<Record<string, unknown> | null>(null);
  const [saved, setSaved] = useState(false);
  const [holdId, setHoldId] = useState('');
  const [hold, setHold] = useState(true);
  const [holdResult, setHoldResult] = useState<string | null>(null);

  const load = async () => {
    trax?.activate();
    const result = await supportRequest?.('retention_policy');
    if (result?.retentionPolicy) setPolicy(result.retentionPolicy);
  };

  return (
    <>
      {/* `compact`: an icon in the Support rail's title row, named for assistive tech. */}
      <Button variant="ghost" size={compact ? 'icon-sm' : 'sm'} className="gap-1.5 text-muted-foreground" disabled={busy}
        aria-label={compact ? 'Retention' : undefined} title={compact ? 'Support retention' : undefined}
        onClick={() => { setOpen(true); void load(); }}>
        <SlidersHorizontal className="size-3.5" aria-hidden />
        {!compact && 'Retention'}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Support retention</DialogTitle>
            <DialogDescription>
              Only TRAX conversations and support tickets are affected. Open tickets remain stored; ticket handoffs survive ordinary conversation cleanup.
            </DialogDescription>
          </DialogHeader>
          {!policy ? (
            <p className="py-6 text-center text-sm text-muted-foreground">Loading the current periods…</p>
          ) : (
            <div className="space-y-4">
              {([['conversation_days', 'Conversation days after last activity'], ['closed_ticket_days', 'Ticket days after latest closure'], ['inactive_open_days', 'Flag open tickets after inactive days']] as const).map(([key, label]) => (
                <div className="space-y-1.5" key={key}>
                  <Label htmlFor={'trax-' + key}>{label}</Label>
                  <Input id={'trax-' + key} type="number" min={1} max={3650} value={policy[key]} onChange={(e) => { setSaved(false); setPolicy({ ...policy, [key]: Number(e.target.value) }); }} />
                </div>
              ))}
              <p className="text-xs text-muted-foreground">
                Destructive cleanup {policy.cleanup_enabled ? 'has been enabled by the deployment administrator' : 'is disabled pending approval'}. This screen cannot enable it. Reopening a ticket cancels its deletion schedule.
              </p>
              {saved && <p role="status" className="text-xs text-muted-foreground">Retention periods saved.</p>}
              {preview && (
                <p role="status" className="rounded-lg border border-border p-3 text-sm">
                  Dry run only: {String(preview.conversationsEligible)} conversations and {String(preview.closedTicketsEligible)} closed tickets eligible. {String(preview.openTicketsForReview)} open tickets need review. Nothing was deleted.
                </p>
              )}
              <div className="space-y-2 border-t border-border pt-4">
                <h3 className="text-sm font-semibold">Approved conversation exception</h3>
                <p className="text-xs text-muted-foreground">Use the conversation reference from a support handoff to preserve its original context. The ticket already retains its own redacted handoff independently.</p>
                <Label htmlFor="trax-hold-id">Conversation reference</Label>
                <Input id="trax-hold-id" value={holdId} onChange={(e) => { setHoldId(e.target.value); setHoldResult(null); }} />
                <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={hold} onChange={(e) => setHold(e.target.checked)} />Keep this conversation beyond normal retention</label>
                <Button size="sm" variant="outline" disabled={busy || !holdId.trim()} onClick={async () => {
                  const result = await supportRequest?.('retention_hold', { resumeId: holdId.trim(), retentionHold: hold });
                  if (result) setHoldResult(hold ? 'Conversation retention exception applied.' : 'Conversation retention exception removed.');
                }}>Apply exception</Button>
                {holdResult && <p role="status" className="text-xs text-muted-foreground">{holdResult}</p>}
              </div>
            </div>
          )}
          <DialogFooter className="gap-2 sm:justify-between">
            <Button size="sm" variant="outline" disabled={busy || !policy} onClick={async () => {
              const result = await supportRequest?.('retention_preview');
              if (result?.retentionPreview) setPreview(result.retentionPreview);
            }}>Preview cleanup</Button>
            <Button size="sm" disabled={busy || !policy} onClick={async () => {
              if (!policy) return;
              const { conversation_days, closed_ticket_days, inactive_open_days } = policy;
              const result = await supportRequest?.('retention_policy', { policy: { conversation_days, closed_ticket_days, inactive_open_days } });
              if (result?.retentionPolicy) { setPolicy(result.retentionPolicy); setSaved(true); }
            }}>Save retention periods</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
