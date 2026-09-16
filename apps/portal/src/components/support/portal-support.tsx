'use client';

import { useEffect, useMemo, useState } from 'react';
import { Plus, SlidersHorizontal } from 'lucide-react';
import { Button } from '@/components/ui-v2/button';
import { Input } from '@/components/ui-v2/input';
import { Label } from '@/components/ui-v2/label';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui-v2/dialog';
import { useSupportInbox, type SupportCompose } from '../../../../../shared/trax-support/use-support-inbox';
import { SupportInboxView } from './support-inbox';
import { useSupportMessaging } from '@/hooks/use-support-messaging';
import { useTraxSupportOptional } from '@/components/trax/support/trax-support-context';
import type { TraxRetentionPolicy } from '@/types/trax-support';

/**
 * The portal's Support section: one compact page header over one workspace —
 * the tenant's tickets beside the conversation they open.
 *
 * This is the ONE destination for support. The profile menu's Support item and
 * TRAX's Support control both open it, so both entry points show the same
 * authorized tickets. TRAX itself is the AI conversation only — it renders no
 * tickets, and nothing here sends a tenant to the platform (super-admin) inbox
 * in the admin app.
 *
 * Tickets, messages, unread markers and permissions are the existing ones:
 * `useSupportInbox` over the `trax-messaging` endpoint. Nothing here creates a
 * ticket; the tenant's first Send does. The hook lives HERE rather than in the
 * view because the page header carries New ticket.
 *
 * ESCALATION HANDOFF. Arriving with `?issue=<id>` after TRAX recommended human
 * support opens the new-request composer with that issue's summary, and submits
 * through the TRAX conversation's own `submit_ticket` request so the authorized
 * redacted troubleshooting context travels with it. The conversation lives in
 * `TraxSupportProvider` above the route, so it is still there after Trax closes;
 * `activate()` loads it when the operator came straight here. If the issue is no
 * longer in the conversation (a later session, say), the composer stays open as a
 * plain new request and says so rather than silently dropping the context.
 */
export function PortalSupport({ initialTicketId, composeIssueId }: { initialTicketId?: string; composeIssueId?: string }) {
  const human = useSupportMessaging();
  const trax = useTraxSupportOptional();
  const support = trax?.support;
  const activate = trax?.activate;

  // Load the TRAX conversation: this section reads its capabilities (retention,
  // submission) and an escalation submits through it. Outside a Trax surface the
  // hook only fetches context once; it does not keep rechecking.
  useEffect(() => { activate?.(); }, [activate]);

  const issue = composeIssueId ? support?.issues?.find((i) => i.id === composeIssueId) : undefined;
  const ready = !!support?.capabilities;
  const supportRequest = support?.supportRequest;

  const compose = useMemo<SupportCompose | undefined>(() => {
    if (!composeIssueId) return undefined;
    // With the issue in hand, submit through TRAX so its recorded checks are copied.
    if (issue && supportRequest) {
      return {
        summary: issue.summary,
        submit: async (body, nonce, subject) => {
          const result = await supportRequest('submit_ticket', { issueId: issue.id, ticket: { message: body, nonce, subject } });
          return result?.ticket ?? null;
        },
      };
    }
    // No issue context available: a plain new request, stated below.
    return ready ? { summary: '' } : undefined;
  }, [composeIssueId, issue, supportRequest, ready]);

  const inbox = useSupportInbox({ call: human.call, scope: human.scope, initialId: initialTicketId, compose });

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-3">
      <header className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2">
        <div className="min-w-0 flex-1">
          <h1 className="text-lg font-semibold tracking-tight">Support</h1>
          <p className="hidden text-[12px] text-muted-foreground sm:block">Message the Drive247 team. Replies appear here as they arrive.</p>
        </div>
        {support?.capabilities?.managePolicy && <RetentionDialog />}
        <Button size="sm" className="gap-1.5" disabled={inbox.busy || inbox.creating} onClick={inbox.beginNew}>
          <Plus className="size-4" aria-hidden />
          New ticket
        </Button>
      </header>

      {composeIssueId && !issue && ready && (
        <p role="status" className="shrink-0 rounded-lg border border-border bg-secondary/30 px-3 py-2 text-[12px] leading-relaxed text-muted-foreground">
          The TRAX issue that sent you here is no longer in the open conversation, so its recorded checks are not attached. Describe the problem below and support will still receive your message.
        </p>
      )}

      <SupportInboxView inbox={inbox} />
    </div>
  );
}

/**
 * Support retention, for the roles the server grants `managePolicy`. It is a
 * dialog rather than a panel in the page: it is an administrator's occasional
 * setting, and the workspace behind it is sized to the viewport.
 */
function RetentionDialog() {
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
      <Button variant="ghost" size="sm" className="gap-1.5 text-muted-foreground" disabled={busy} onClick={() => { setOpen(true); void load(); }}>
        <SlidersHorizontal className="size-3.5" aria-hidden />
        Retention
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
