"use client";

/**
 * Messages, before there is a single conversation (lean tenants only — the
 * Messages layout decides when this renders; see its note).
 *
 * The one action is the bulk composer the rail already offers: it picks
 * customers and opens (or reuses) a conversation with each, so the first
 * message sent from here is what fills the inbox.
 */

import { MessageSquare, Plus } from "lucide-react";
import { TeachingEmptyState } from "@/components/empty-states/teaching-empty-state";
import { MessagesEmptyArt } from "@/components/illustrations-v2/scenes/messages";

export function MessagesTeachingEmptyState({
  onMessageCustomers,
}: {
  /** Opens the bulk message composer. Omitted without edit access to Messages. */
  onMessageCustomers?: () => void;
}) {
  return (
    <TeachingEmptyState
      icon={MessageSquare}
      illustration={<MessagesEmptyArt />}
      headline="Every conversation with your customers"
      body="Texts, emails and chats with a customer land here, one thread per person."
      primaryAction={
        onMessageCustomers
          ? {
              label: "Message your customers",
              onClick: onMessageCustomers,
              icon: Plus,
              hint: "Pick customers and send them a message. Each one starts its own conversation.",
            }
          : undefined
      }
    />
  );
}
