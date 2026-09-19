'use client';

import { useEffect, useMemo } from 'react';
import { Plus } from 'lucide-react';
import { Button } from '@/components/ui-v2/button';
import { useSupportInbox, type SupportCompose } from '../../../../../shared/trax-support/use-support-inbox';
import { useSupportRailHost } from '../../../../../shared/trax-support/support-rail';
import { SupportInboxView } from './support-inbox';
import { RetentionDialog } from './retention-dialog';
import { useSupportClient } from '@/hooks/use-support-messaging';
import { useTraxSupportOptional } from '@/components/trax/support/trax-support-context';

/**
 * The portal's Support section: tickets on the left, the human conversation in
 * the centre, and Details | TRAX Summary on the right.
 *
 * On a desktop the ticket list is in the Support RAIL — the sidebar's slot, which
 * on this route holds Back to portal, the tenant, New ticket and the tickets
 * instead of the portal navigation (support-rail.tsx, app-sidebar-v2.tsx). This
 * component owns the inbox and lends it to the rail; where the rail is not showing
 * the list (a phone, a collapsed sidebar) the page shows it, with its own heading.
 *
 * This is the ONE destination for support. The main sidebar's Support item and
 * TRAX's Support control both open it, so both entry points show the same
 * authorized tickets. TRAX itself is the AI conversation only — it renders no
 * tickets, and nothing here sends a tenant to the platform (super-admin) inbox
 * in the admin app.
 *
 * Tickets, messages, unread markers and permissions are the existing ones:
 * `useSupportInbox` over the `trax-messaging` endpoint. Nothing here creates a
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
  const human = useSupportClient();
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

  const inbox = useSupportInbox({ call: human.call, scope: human.scope, initialId: initialTicketId, compose, uploadAttachment: human.uploadAttachment });
  const listInRail = useSupportRailHost(inbox);

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-3">
      {composeIssueId && !issue && ready && (
        <p role="status" className="shrink-0 rounded-lg border border-border bg-secondary/30 px-3 py-2 text-[12px] leading-relaxed text-muted-foreground">
          The TRAX issue that sent you here is no longer in the open conversation, so its recorded checks are not attached. Describe the problem below and support will still receive your message.
        </p>
      )}

      <SupportInboxView
        inbox={inbox}
        listInRail={listInRail}
        listHeader={
          /* Only where the page shows the list itself. Title and actions, no decorative icon. */
          <header className="flex shrink-0 items-center gap-2 border-b border-border/70 px-3 py-2.5">
            <div className="min-w-0 flex-1">
              <h1 className="text-base font-semibold tracking-tight">Support</h1>
              <p className="truncate text-[11.5px] text-muted-foreground">Get help from the Drive247 support team.</p>
            </div>
            {support?.capabilities?.managePolicy && <RetentionDialog compact />}
            <Button size="sm" className="gap-1.5" disabled={inbox.busy || inbox.creating} onClick={inbox.beginNew}>
              <Plus className="size-4" aria-hidden />
              New ticket
            </Button>
          </header>
        }
      />
    </div>
  );
}
