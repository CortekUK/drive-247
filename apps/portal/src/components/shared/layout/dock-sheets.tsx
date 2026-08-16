"use client";

import { useState, type ComponentProps, type ReactNode, type ElementType } from "react";
import Link from "next/link";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { MessageSquare, Inbox } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { useChatChannels } from "@/hooks/use-chat-channels";
import { useEnquiries } from "@/hooks/use-enquiries";

const initials = (name?: string | null) =>
  (name || "?")
    .split(" ")
    .map((w) => w[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);

function EmptyState({ icon: Icon, text }: { icon: ElementType; text: string }) {
  return (
    <div className="flex flex-col items-center justify-center px-8 py-20 text-center">
      <Icon className="mb-3 h-8 w-8 text-muted-foreground/25" strokeWidth={1.5} />
      <p className="text-sm text-muted-foreground/70">{text}</p>
    </div>
  );
}

function SheetShell({
  open,
  setOpen,
  trigger,
  title,
  viewAllHref,
  children,
}: {
  open: boolean;
  setOpen: (v: boolean) => void;
  trigger: ReactNode;
  title: string;
  viewAllHref: string;
  children: ReactNode;
}) {
  return (
    <Sheet open={open} onOpenChange={setOpen}>
      {/* The repo carries two copies of @types/react (portal pins 19, the root
          resolves 18), so radix's ReactNode and ours are nominally different
          types. Same value, different declaration — narrow the node to the one
          SheetTrigger declares rather than leak a second error class in here. */}
      <SheetTrigger asChild>
        {trigger as ComponentProps<typeof SheetTrigger>["children"]}
      </SheetTrigger>
      <SheetContent side="right" showCloseButton={false} className="gap-0 p-0">
        <SheetHeader className="h-16 flex-row items-center justify-between space-y-0 border-b px-5">
          <SheetTitle className="text-base font-semibold">{title}</SheetTitle>
          <Link
            href={viewAllHref}
            onClick={() => setOpen(false)}
            className="text-[12px] font-medium text-muted-foreground transition-colors hover:text-primary"
          >
            View all
          </Link>
        </SheetHeader>
        {/* Children mount only while open (Sheet unmounts content when closed),
            so the data hooks don't run on every page. */}
        <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
      </SheetContent>
    </Sheet>
  );
}

/* ── Messages ──────────────────────────────────────────────────────────── */

function MessagesList({ onClose }: { onClose: () => void }) {
  const { channels = [], isLoading } = useChatChannels();

  if (isLoading) {
    return <div className="px-5 py-20 text-center text-sm text-muted-foreground/70">Loading…</div>;
  }
  if (channels.length === 0) {
    return <EmptyState icon={MessageSquare} text="No conversations yet" />;
  }
  return (
    <div className="divide-y divide-border/40">
      {channels.map((ch) => (
        <Link
          key={ch.id}
          href="/messages"
          onClick={onClose}
          className="flex items-center gap-3 px-5 py-3 transition-colors hover:bg-accent/40"
        >
          <Avatar className="h-9 w-9 shrink-0">
            <AvatarImage src={ch.customer?.profile_photo_url || undefined} />
            <AvatarFallback className="bg-primary/10 text-xs font-medium text-primary">
              {initials(ch.customer?.name)}
            </AvatarFallback>
          </Avatar>
          <div className="min-w-0 flex-1">
            <div className="flex items-center justify-between gap-2">
              <p className="truncate text-[13px] font-semibold">{ch.customer?.name || "Unknown"}</p>
              {ch.unread_count > 0 && (
                <span className="inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[9px] font-bold leading-none text-white">
                  {ch.unread_count > 9 ? "9+" : ch.unread_count}
                </span>
              )}
            </div>
            <p className="truncate text-[12px] text-muted-foreground">
              {ch.last_message_preview || "No messages yet"}
            </p>
          </div>
        </Link>
      ))}
    </div>
  );
}

export function MessagesSheet({ trigger }: { trigger: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <SheetShell open={open} setOpen={setOpen} trigger={trigger} title="Messages" viewAllHref="/messages">
      <MessagesList onClose={() => setOpen(false)} />
    </SheetShell>
  );
}

/* ── Enquiries ─────────────────────────────────────────────────────────── */

function EnquiriesList({ onClose }: { onClose: () => void }) {
  const { data: enquiries = [], isLoading } = useEnquiries();

  if (isLoading) {
    return <div className="px-5 py-20 text-center text-sm text-muted-foreground/70">Loading…</div>;
  }
  if (enquiries.length === 0) {
    return <EmptyState icon={Inbox} text="No enquiries" />;
  }
  return (
    <div className="divide-y divide-border/40">
      {enquiries.slice(0, 40).map((e) => (
        <Link
          key={e.id}
          href="/enquiries"
          onClick={onClose}
          className="block px-5 py-3 transition-colors hover:bg-accent/40"
        >
          <div className="flex items-center justify-between gap-2">
            <p className="truncate text-[13px] font-semibold">{e.customer_name}</p>
            <span
              className={`shrink-0 rounded-full px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide ${
                e.status === "new" ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"
              }`}
            >
              {e.status}
            </span>
          </div>
          <p className="mt-0.5 truncate text-[12px] text-muted-foreground">
            {e.description || e.customer_email}
          </p>
          <p className="mt-1 text-[11px] text-muted-foreground/60">
            {formatDistanceToNow(new Date(e.created_at), { addSuffix: true })}
          </p>
        </Link>
      ))}
    </div>
  );
}

export function EnquiriesSheet({ trigger }: { trigger: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <SheetShell open={open} setOpen={setOpen} trigger={trigger} title="Enquiries" viewAllHref="/enquiries">
      <EnquiriesList onClose={() => setOpen(false)} />
    </SheetShell>
  );
}
