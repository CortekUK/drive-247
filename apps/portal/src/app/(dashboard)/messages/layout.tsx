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
import { useParams } from "next/navigation";
import { BulkMessageModal } from "@/components/chat";
import { ConversationRail } from "@/components/messages-v2/conversation-rail";
import { CustomerContext } from "@/components/messages-v2/customer-context";
import { useChatChannels } from "@/hooks/use-chat-channels";
import { useManagerPermissions } from "@/hooks/use-manager-permissions";

export default function MessagesLayout({ children }: { children: React.ReactNode }) {
  const params = useParams();
  const selectedId = typeof params?.channelId === "string" ? params.channelId : null;
  const { channels } = useChatChannels();
  const { canEdit } = useManagerPermissions();
  const [bulkOpen, setBulkOpen] = useState(false);

  const selected = selectedId ? channels.find((c) => c.id === selectedId) ?? null : null;

  return (
    <div className="flex h-[calc(100vh-4rem)] overflow-hidden">
      {/* Left — compact, and the only always-visible column on a narrow window.
          Hidden once a conversation is open on small screens so the thread gets
          the whole width; the thread carries its own Back control there. */}
      <div
        className={`w-full min-h-0 shrink-0 md:flex md:w-[300px] ${
          selectedId ? "hidden md:flex" : "flex"
        }`}
      >
        <ConversationRail
          selectedId={selectedId}
          onBulkMessage={canEdit("messages") ? () => setBulkOpen(true) : undefined}
        />
      </div>

      {/* Centre — the workspace. `min-w-0` lets a long message shrink it rather
          than pushing the right column off the edge. */}
      <main className={`min-h-0 min-w-0 flex-1 ${selectedId ? "flex" : "hidden md:flex"} flex-col`}>
        {children}
      </main>

      {/* Right — the customer overview, only once somebody is selected. It is
          the first thing to go as the window narrows: everything on it also
          lives on the customer and rental screens. */}
      {selected && <CustomerContext channel={selected} />}

      <BulkMessageModal open={bulkOpen} onOpenChange={setBulkOpen} />
    </div>
  );
}
