'use client';
import React from 'react';
import { type MessagingCall } from './client';
import { useSupportInbox, type SupportCompose, type SupportInboxOptions } from './use-support-inbox';
import { useSupportRailHost } from './support-rail';
import { SupportWorkspace } from './support-workspace';

export type { HumanTicket, SupportCompose } from './use-support-inbox';

/**
 * The PLATFORM support inbox, in the admin app: the cross-tenant queue on the
 * left (the Support rail, or a column here when the rail is not showing it), one
 * ticket's conversation in the centre, and Details | TRAX Summary on the right,
 * where the status control lives.
 *
 * It is the tenant's Support section with the role's differences — which company a
 * ticket belongs to, a search that spans companies, "Reply to tenant…", and the
 * status selector — because both are `SupportWorkspace` over the same
 * `useSupportInbox`, so polling, unread acknowledgement, retry nonces and ordering
 * cannot drift.
 *
 * Authorization is NOT here. Every action goes through the authenticated
 * messaging endpoint, and the SQL rechecks the platform support grant.
 *
 * `admin={false}` is kept for the isolated messaging fixture, which drives a
 * requester's side through this same component.
 */
export function SupportInbox({ call, admin = false, initialId, compose, scope, uploadAttachment }: {
  call: MessagingCall; admin?: boolean; initialId?: string; compose?: SupportCompose; scope: string;
  uploadAttachment?: SupportInboxOptions['uploadAttachment'];
}) {
  const inbox = useSupportInbox({ call, admin, initialId, compose, scope, uploadAttachment });
  const listInRail = useSupportRailHost(inbox);
  const listHeader = admin ? (
    <header className="shrink-0 border-b border-border/70 px-3 py-2.5">
      <h1 className="text-base font-semibold tracking-tight">Support</h1>
      <p className="text-[11.5px] text-muted-foreground">Tenant conversations across every company.</p>
    </header>
  ) : (
    <div className="flex shrink-0 justify-end border-b border-border/70 px-2 py-2">
      <button type="button" disabled={inbox.busy} onClick={inbox.beginNew}
        className="h-9 rounded-lg border border-border bg-background px-3 text-[12px] font-medium hover:bg-muted disabled:opacity-50">New request</button>
    </div>
  );
  return <SupportWorkspace inbox={inbox} viewer={admin ? 'support' : 'tenant'} listInRail={listInRail} listHeader={listHeader} />;
}
