"use client";

/**
 * The Messages workspace shell — three columns, permanently mounted.
 *
 * ── why this is a layout and not a page ─────────────────────────────────────
 *
 * A layout in the App Router stays mounted while the child route changes. That
 * is the whole trick behind "it behaves as one workspace, but the URL still
 * points at a conversation": `/messages/<id>` is still a real route with real
 * back/forward and real deep links, and yet the rail and the customer overview
 * never unmount, never refetch, and never lose their scroll position when you
 * click a different person. Only the centre column swaps.
 *
 * Doing this in a page instead would mean either giving up the URL or
 * re-rendering the rail on every selection — which is what the previous
 * two-step "pick a person, navigate, list disappears" flow actually was.
 *
 * ── the height contract, which is what killed the nested scrollbars ─────────
 *
 * ONE fixed-height box, and every column inside it is `min-h-0`. Without
 * `min-h-0` a flex child refuses to shrink below its content, so the column
 * grows, the shell grows, and the page gains a second scrollbar behind the
 * one the column already had — which is exactly what was on screen. The rule
 * here: this file owns the height, and each column scrolls its own list and
 * nothing else.
 */

import { useState } from "react";
import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { BulkMessageModal } from "@/components/chat";
import { ConversationRail } from "@/components/messages-v2/conversation-rail";
import { CustomerContext } from "@/components/messages-v2/customer-context";
import { BulkDim, BulkSelectProvider } from "@/components/messages-v2/bulk-select";
import { useChatChannels } from "@/hooks/use-chat-channels";
import { useManagerPermissions } from "@/hooks/use-manager-permissions";
import { useIsLean } from "@/lib/lean-context";
import { useForcedEmptyState } from "@/hooks/use-forced-empty-state";
import { MessagesTeachingEmptyState } from "@/components/empty-states/messages-empty-state";

export default function MessagesLayout({ children }: { children: React.ReactNode }) {
  const params = useParams();
  const selectedId = typeof params?.channelId === "string" ? params.channelId : null;
  const { channels, unknownThreads, isLoading } = useChatChannels();
  const targetCustomerId = useSearchParams()?.get("customerId") ?? null;
  const { canEdit } = useManagerPermissions();
  const [bulkOpen, setBulkOpen] = useState(false);

  const selected = selectedId ? channels.find((c) => c.id === selectedId) ?? null : null;

  /* No right-edge lane. This used to reserve 48px (`pr-12`) for the v2 quick
     dock, which floated `fixed right-0` over the customer overview — but the
     dock is no longer mounted (its Messages and Notifications moved into
     TopBarV2), so the reservation was an empty strip down the right of the
     workspace. The three columns now run edge to edge. v1 tenants never had
     the padding, so nothing changes for them. */

  /* No conversations at all (lean only): the whole workspace steps aside for
     the teaching empty state, since a rail with nothing in it and an empty
     centre say nothing. Only on the bare /messages index — a thread URL, or a
     `?customerId=` deep link that is about to open one, keeps the workspace
     exactly as it was. Unknown-number threads count as conversations, so an
     operator whose only contact is an unrecognised texter still gets the rail
     and its Link control. `devForceEmpty` is the /dev preview switch, inert
     outside development and inside the lean gate. */
  const leanTenant = useIsLean();
  const devForceEmpty = useForcedEmptyState("messages");
  const teachEmptyMessages =
    leanTenant &&
    !selectedId &&
    !targetCustomerId &&
    ((!isLoading && channels.length === 0 && unknownThreads.length === 0) || devForceEmpty);

  if (teachEmptyMessages) {
    return (
      <div className="flex h-full min-h-0 flex-col overflow-y-auto">
        {/* The rail's own header, heading and way out, since the workspace
            takes the whole window and the portal nav is not on screen. */}
        <div className="flex shrink-0 items-start gap-1.5 px-3 py-3">
          <Link
            href="/"
            title="Back to the portal"
            aria-label="Back to the portal"
            className="-ml-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted"
          >
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <div className="min-w-0 pt-1">
            <h1 className="text-[15px] font-semibold tracking-tight">Messages</h1>
            <p className="text-[13px] text-muted-foreground">Your conversations with customers, in one inbox.</p>
          </div>
        </div>
        <div className="flex flex-1 items-center justify-center pb-8">
          <MessagesTeachingEmptyState
            onMessageCustomers={canEdit("messages") ? () => setBulkOpen(true) : undefined}
          />
        </div>
        <BulkMessageModal open={bulkOpen} onOpenChange={setBulkOpen} />
      </div>
    );
  }

  return (
    /* `h-full` + `min-h-0` — the dashboard shell hands this route a bounded
       viewport-height box, so the workspace fills it exactly rather than doing
       its own `100vh - something` arithmetic. `min-h-0` keeps the flex floor
       off it for the same reason it is on every column below: without it a
       long thread makes the container as tall as the thread, and then the
       PAGE scrolls all three columns together instead of the history scrolling
       inside one. */
    /* BulkSelectProvider: the composer (centre) starts an in-place bulk send
       and the rail (left) finishes it, so the state sits above both. While
       it is active every column but the rail dims and goes inert. */
    <BulkSelectProvider>
    <div className="flex h-full min-h-0 overflow-hidden">
      {/* Left — compact, and the only always-visible column on a narrow window.
          Hidden once a conversation is open on small screens so the thread gets
          the whole width; the thread carries its own Back control there. */}
      <div
        className={`w-full min-h-0 shrink-0 md:flex md:w-[320px] lg:w-[360px] ${
          selectedId ? "hidden md:flex" : "flex"
        }`}
      >
        {/* No bulk icon in the rail header any more: bulk is started from the
            composer (write the message, press Bulk, tick recipients in place).
            The modal stays for the empty-inbox teaching state below. */}
        <ConversationRail selectedId={selectedId} />
      </div>

      {/* Centre — the workspace. `min-w-0` lets a long message shrink it rather
          than pushing the right column off the edge. */}
      <BulkDim as="main" className={`min-h-0 min-w-0 flex-1 ${selectedId ? "flex" : "hidden md:flex"} flex-col`}>
        {children}
      </BulkDim>

      {/* Right — the customer overview, only once somebody is selected. It is
          the first thing to go as the window narrows: everything on it also
          lives on the customer and rental screens. */}
      {selected && (
        <BulkDim className="flex min-h-0">
          <CustomerContext channel={selected} />
        </BulkDim>
      )}

      <BulkMessageModal open={bulkOpen} onOpenChange={setBulkOpen} />
    </div>
    </BulkSelectProvider>
  );
}
