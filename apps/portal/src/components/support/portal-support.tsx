'use client';

import { useEffect, useMemo, useState } from 'react';
import { LifeBuoy } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { SupportInbox, type SupportCompose } from '../../../../../shared/trax-support/SupportInbox';
import { useSupportMessaging } from '@/hooks/use-support-messaging';
import { useTraxSupportOptional } from '@/components/trax/support/trax-support-context';
import type { TraxRetentionPolicy } from '@/types/trax-support';

/**
 * The portal's Support section: human support tickets and messages.
 *
 * This is the ONE destination for support. The profile menu's Support item and
 * TRAX's Support control both open it, so both entry points show the same
 * authorized tickets. TRAX itself is the AI conversation only — it no longer
 * renders tickets, and it never sends a tenant to the platform (super-admin)
 * inbox in the admin app.
 *
 * Tickets, messages, unread counts and permissions are the existing ones:
 * `SupportInbox` over the `trax-messaging` endpoint. Nothing here creates a
 * ticket; the tenant's first Send does.
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

  const [policy, setPolicy] = useState<TraxRetentionPolicy | null>(null);
  const [preview, setPreview] = useState<Record<string, unknown> | null>(null);
  const [policySaved, setPolicySaved] = useState(false);
  const [holdId, setHoldId] = useState('');
  const [hold, setHold] = useState(true);
  const [holdResult, setHoldResult] = useState<string | null>(null);
  const [showRetention, setShowRetention] = useState(false);
  const busy = !!support?.isLoading;

  const inspectPolicy = async () => {
    activate?.();
    const result = await supportRequest?.('retention_policy');
    if (result?.retentionPolicy) { setPolicy(result.retentionPolicy); setShowRetention(true); }
  };

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary"><LifeBuoy className="size-4" aria-hidden /></span>
        <div className="min-w-0 flex-1">
          <h1 className="text-lg font-semibold tracking-tight">Support</h1>
          <p className="text-xs text-muted-foreground">Your conversations with the Drive247 support team. TRAX answers questions; people answer here.</p>
        </div>
        {support?.capabilities?.managePolicy && (
          <Button variant="outline" size="sm" disabled={busy} onClick={() => (showRetention ? setShowRetention(false) : void inspectPolicy())}>
            {showRetention ? 'Hide retention' : 'Retention'}
          </Button>
        )}
      </div>

      {composeIssueId && !issue && ready && (
        <p role="status" className="rounded-lg border border-border bg-secondary/30 p-3 text-xs leading-relaxed text-muted-foreground">
          The TRAX issue that sent you here is no longer in the open conversation, so its recorded checks are not attached. Describe the problem below and support will still receive your message.
        </p>
      )}

      {showRetention && policy && (
        <section className="space-y-4 rounded-xl border border-border p-4">
          <div>
            <h2 className="text-sm font-semibold">Support retention</h2>
            <p className="mt-1 text-xs text-muted-foreground">Only TRAX conversations and support tickets are affected. Open tickets remain stored; ticket handoffs survive ordinary conversation cleanup.</p>
          </div>
          {([['conversation_days', 'Conversation days after last activity'], ['closed_ticket_days', 'Ticket days after latest closure'], ['inactive_open_days', 'Flag open tickets after inactive days']] as const).map(([key, label]) => (
            <div className="max-w-sm space-y-1.5" key={key}>
              <Label htmlFor={'trax-' + key}>{label}</Label>
              <Input id={'trax-' + key} type="number" min={1} max={3650} value={policy[key]} onChange={(e) => { setPolicySaved(false); setPolicy({ ...policy, [key]: Number(e.target.value) }); }} />
            </div>
          ))}
          <div className="flex flex-wrap gap-2">
            <Button size="sm" disabled={busy} onClick={async () => {
              const { conversation_days, closed_ticket_days, inactive_open_days } = policy;
              const result = await supportRequest?.('retention_policy', { policy: { conversation_days, closed_ticket_days, inactive_open_days } });
              if (result?.retentionPolicy) { setPolicy(result.retentionPolicy); setPolicySaved(true); }
            }}>Save retention periods</Button>
            <Button size="sm" variant="outline" disabled={busy} onClick={async () => {
              const result = await supportRequest?.('retention_preview');
              if (result?.retentionPreview) setPreview(result.retentionPreview);
            }}>Preview cleanup</Button>
          </div>
          {policySaved && <p role="status" className="text-xs text-muted-foreground">Retention periods saved.</p>}
          <p className="text-xs text-muted-foreground">Destructive cleanup {policy.cleanup_enabled ? 'has been enabled by the deployment administrator' : 'is disabled pending approval'}. This screen cannot enable it. Reopening a ticket cancels its deletion schedule.</p>
          {preview && <div role="status" className="rounded-lg border p-3 text-sm">Dry run only: {String(preview.conversationsEligible)} conversations and {String(preview.closedTicketsEligible)} closed tickets eligible. {String(preview.openTicketsForReview)} open tickets need review. Nothing was deleted.</div>}
          <div className="space-y-3 border-t pt-4">
            <h3 className="text-sm font-semibold">Approved conversation exception</h3>
            <p className="text-xs text-muted-foreground">Use the conversation reference from a support handoff to preserve its original context. The ticket already retains its own redacted handoff independently.</p>
            <Label htmlFor="trax-hold-id">Conversation reference</Label>
            <Input id="trax-hold-id" className="max-w-sm" value={holdId} onChange={(e) => { setHoldId(e.target.value); setHoldResult(null); }} />
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={hold} onChange={(e) => setHold(e.target.checked)} />Keep this conversation beyond normal retention</label>
            <Button size="sm" variant="outline" disabled={busy || !holdId.trim()} onClick={async () => {
              const result = await supportRequest?.('retention_hold', { resumeId: holdId.trim(), retentionHold: hold });
              if (result) setHoldResult(hold ? 'Conversation retention exception applied.' : 'Conversation retention exception removed.');
            }}>Apply exception</Button>
            {holdResult && <p role="status" className="text-xs text-muted-foreground">{holdResult}</p>}
          </div>
        </section>
      )}

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-border bg-background">
        <SupportInbox
          key={human.scope + String(initialTicketId) + String(!!compose)}
          call={human.call}
          scope={human.scope}
          initialId={initialTicketId}
          compose={compose}
        />
      </div>
    </div>
  );
}
