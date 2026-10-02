"use client";

/**
 * The Messages sheet — opened from the chat icon in TopBarV2 (northwind).
 *
 * Replaces `MessagesSheet` from `shared/layout/dock-sheets.tsx` for the top bar,
 * for two reasons.
 *
 * It never opened. TopBarV2 handed it a <Tooltip> as the trigger, and
 * `SheetTrigger asChild` puts its click handler on its direct child — the
 * Tooltip ROOT, which renders no element and drops the prop. The fix is the
 * nesting order: Tooltip › TooltipTrigger › SheetTrigger › button, so both
 * Slots land on the same <button>. The tooltip therefore lives in here.
 *
 * And it now reads as the notification centre's sibling: same shell, same
 * header (title, unread count, icon actions beside the close), one scroll
 * region with no bar, and rows that open THE conversation rather than the
 * inbox's front page.
 *
 * `dock-sheets.tsx` is untouched; the (unmounted) quick dock still imports it.
 */

import { useState, type ComponentProps, type ReactNode } from "react";
import Link from "next/link";
import { formatDistanceToNow } from "date-fns";
import { ArrowUpRight, MessageSquare, X } from "lucide-react";
import {
  Sheet, SheetClose, SheetContent, SheetHeader, SheetTitle, SheetTrigger,
} from "@/components/ui-v2/sheet";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui-v2/tooltip";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui-v2/avatar";
import { Button } from "@/components/ui-v2/button";
import { useChatChannels, type ChatChannel } from "@/hooks/use-chat-channels";
import { NO_SCROLLBAR } from "@/components/messages-v2/no-scrollbar";

const initials = (name?: string | null) =>
  (name || "?").split(" ").map((w) => w[0]).join("").toUpperCase().slice(0, 2);

/** Same shell as the v2 notification centre: one scroll region, no outer bar. */
const SHEET_SHELL =
  `flex w-full flex-col gap-0 overflow-hidden p-0 sm:max-w-[420px] ${NO_SCROLLBAR}`;

/** `formatDistanceToNow` throws on an Invalid Date; a row must not. */
function relativeTime(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  try {
    return formatDistanceToNow(d, { addSuffix: true });
  } catch {
    return null;
  }
}

/* ── mock previews ───────────────────────────────────────────────────────────
   northwind's conversations are synthetic and carry no messages, so every row
   read "No messages yet" and the sheet could not be judged. A conversation with
   no real last message borrows one of these, by position, so the list reads
   like a working inbox. A REAL preview always wins: the moment a thread has
   traffic, its own message and time replace the mock. Delete this block when
   the canary has real conversations. Writes nothing. */
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

const MOCK_LINES: { preview: string; ago: number; unread: number }[] = [
  { preview: "Running about 20 minutes late for pickup, is that okay?", ago: 12 * MINUTE, unread: 2 },
  { preview: "Here's the fuel receipt from this morning.", ago: 48 * MINUTE, unread: 1 },
  { preview: "Perfect, see you at 6pm for the return.", ago: 3 * HOUR, unread: 0 },
  { preview: "Can I extend the rental until Sunday?", ago: DAY + 2 * HOUR, unread: 1 },
  { preview: "Thanks, the deposit came through.", ago: DAY + 5 * HOUR, unread: 0 },
  { preview: "Do you allow a second driver on the agreement?", ago: 3 * DAY, unread: 0 },
  { preview: "Car's back in the lot, keys are in the lockbox.", ago: 6 * DAY, unread: 0 },
  { preview: "Is the Tesla available next weekend?", ago: 11 * DAY, unread: 0 },
  { preview: "Got the invoice, all looks good.", ago: 19 * DAY, unread: 0 },
];

interface Item {
  channel: ChatChannel;
  preview: string;
  at: Date;
  unread: number;
}

function toItem(channel: ChatChannel, index: number, now: number): Item {
  if (channel.last_message_preview) {
    return {
      channel,
      preview: channel.last_message_preview,
      at: new Date(channel.last_message_at ?? channel.created_at),
      unread: channel.unread_count,
    };
  }
  const line = MOCK_LINES[index % MOCK_LINES.length];
  /* Rows past the pool step a further week back each lap, so nothing ties. */
  const lap = Math.floor(index / MOCK_LINES.length);
  return {
    channel,
    preview: line.preview,
    at: new Date(now - line.ago - lap * 7 * DAY),
    unread: line.unread,
  };
}

type Bucket = "today" | "yesterday" | "earlier";
const BUCKETS: Bucket[] = ["today", "yesterday", "earlier"];
const BUCKET_LABEL: Record<Bucket, string> = { today: "Today", yesterday: "Yesterday", earlier: "Earlier" };

/** Calendar days, not 24-hour windows — "Yesterday" means the date before today. */
function bucketOf(d: Date): Bucket {
  const t = d.getTime();
  if (Number.isNaN(t)) return "earlier";
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  if (t >= startOfToday) return "today";
  if (t >= startOfToday - DAY) return "yesterday";
  return "earlier";
}

function Row({ item, onOpen }: { item: Item; onOpen: () => void }) {
  const { channel, preview } = item;
  const unread = item.unread > 0;
  const when = Number.isNaN(item.at.getTime()) ? null : relativeTime(item.at.toISOString());

  return (
    <Link
      href={`/messages/${channel.id}`}
      onClick={onOpen}
      className={`flex items-start gap-3 px-5 py-3.5 transition-colors duration-200 ease-out hover:bg-accent/50 motion-reduce:transition-none ${
        unread ? "bg-primary/[0.03]" : ""
      }`}
    >
      <Avatar className="h-9 w-9 shrink-0">
        <AvatarImage src={channel.customer?.profile_photo_url || undefined} />
        <AvatarFallback className="bg-primary/10 text-xs font-medium text-primary">
          {initials(channel.customer?.name)}
        </AvatarFallback>
      </Avatar>
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-3">
          <p className={`truncate text-[13px] leading-snug ${
            unread ? "font-semibold text-foreground" : "font-medium text-foreground/80"
          }`}>
            {channel.customer?.name || "Unknown"}
          </p>
          {when && <span className="shrink-0 text-[11px] text-muted-foreground/70">{when}</span>}
        </div>
        <div className="mt-0.5 flex items-center justify-between gap-3">
          <p className={`truncate text-[12px] ${unread ? "text-foreground/80" : "text-muted-foreground"}`}>
            {preview}
          </p>
          {unread && (
            <span className="inline-flex h-4 min-w-4 shrink-0 items-center justify-center rounded-full bg-primary px-1 text-[9px] font-bold leading-none text-primary-foreground">
              {item.unread > 9 ? "9+" : item.unread}
            </span>
          )}
        </div>
      </div>
    </Link>
  );
}

/**
 * Everything inside the sheet. Its own component so the channel query runs only
 * while the sheet is open — SheetContent unmounts when closed — and the top bar
 * pays nothing for it on every page.
 */
function Panel({ onClose }: { onClose: () => void }) {
  /* Tenant isolation is the hook's: `useChatChannels` filters on tenant_id and
     keys its cache on the tenant. Nothing here queries Supabase directly. */
  const { channels = [], isLoading } = useChatChannels();

  /* Newest first, by the time the row actually SHOWS — real or mock — so the
     order and the day headings can never disagree. */
  const now = Date.now();
  const items = channels
    .map((c, i) => toItem(c, i, now))
    .sort((a, b) => (b.at.getTime() || 0) - (a.at.getTime() || 0));
  const unreadThreads = items.filter((i) => i.unread > 0).length;

  const grouped: Record<Bucket, Item[]> = { today: [], yesterday: [], earlier: [] };
  for (const it of items) grouped[bucketOf(it.at)].push(it);

  return (
    <>
      <SheetHeader className="shrink-0 border-b border-border/60 px-5 py-4">
        <div className="flex items-center justify-between gap-2">
          <SheetTitle className="text-[15px] font-semibold tracking-tight">
            Crossroads
            {unreadThreads > 0 && (
              <span className="ml-2 inline-flex h-5 items-center rounded-full bg-primary/10 px-2 text-[11px] font-semibold text-primary">
                {unreadThreads}
              </span>
            )}
          </SheetTitle>
          <div className="flex shrink-0 items-center gap-0.5">
            <Button
              asChild
              variant="ghost"
              size="icon"
              className="h-7 w-7 shrink-0 rounded-full"
            >
              <Link
                href="/messages"
                onClick={onClose}
                title="Open inbox"
                aria-label="Open inbox"
              >
                <ArrowUpRight className="h-4 w-4" />
              </Link>
            </Button>
            <SheetClose asChild>
              <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0 rounded-full" aria-label="Close">
                <X className="h-4 w-4" />
              </Button>
            </SheetClose>
          </div>
        </div>
      </SheetHeader>

      <div className={`min-h-0 flex-1 overflow-y-auto overscroll-contain ${NO_SCROLLBAR}`}>
        {isLoading ? (
          <div className="space-y-4 p-5">
            {[0, 1, 2, 3, 4].map((i) => (
              <div key={i} className="flex items-center gap-3">
                <div className="h-9 w-9 shrink-0 animate-pulse rounded-full bg-muted" />
                <div className="flex-1 space-y-2">
                  <div className="h-3 w-1/2 animate-pulse rounded-full bg-muted" />
                  <div className="h-3 w-4/5 animate-pulse rounded-full bg-muted/70" />
                </div>
              </div>
            ))}
          </div>
        ) : items.length === 0 ? (
          <div className="flex flex-col items-center justify-center px-8 py-20 text-center">
            <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-muted text-muted-foreground">
              <MessageSquare className="h-5 w-5" />
            </div>
            <p className="text-[13px] font-semibold tracking-tight">No conversations yet</p>
            <p className="mt-1.5 max-w-[260px] text-[12px] leading-relaxed text-muted-foreground">
              When a customer messages you, or you message them from a rental, the conversation appears here.
            </p>
          </div>
        ) : (
          <>
            {BUCKETS.map((bucket) =>
              grouped[bucket].length === 0 ? null : (
                <div key={bucket}>
                  {/* Same sticky day heading as the notification centre. */}
                  <p className="sticky top-0 z-10 bg-background/95 px-5 py-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground backdrop-blur">
                    {BUCKET_LABEL[bucket]}
                  </p>
                  <div className="divide-y divide-border/40">
                    {grouped[bucket].map((it) => (
                      <Row key={it.channel.id} item={it} onOpen={onClose} />
                    ))}
                  </div>
                </div>
              ),
            )}
          </>
        )}
      </div>
    </>
  );
}

export function MessagesSheetV2({
  trigger,
  tooltip,
  tooltipClassName,
}: {
  /** The button. Must be a single element — both Slots land on it. */
  trigger: ReactNode;
  tooltip?: ReactNode;
  tooltipClassName?: string;
}) {
  const [open, setOpen] = useState(false);

  /* Two copies of @types/react in the repo make radix's ReactNode nominally
     different from ours (see dock-sheets.tsx); narrow to what Slot declares. */
  const button = (
    <SheetTrigger asChild>
      {trigger as ComponentProps<typeof SheetTrigger>["children"]}
    </SheetTrigger>
  );

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      {tooltip ? (
        <Tooltip>
          <TooltipTrigger asChild>{button}</TooltipTrigger>
          <TooltipContent side="bottom" sideOffset={8} className={tooltipClassName}>
            {tooltip}
          </TooltipContent>
        </Tooltip>
      ) : (
        button
      )}

      <SheetContent side="right" className={SHEET_SHELL} showCloseButton={false}>
        <Panel onClose={() => setOpen(false)} />
      </SheetContent>
    </Sheet>
  );
}
