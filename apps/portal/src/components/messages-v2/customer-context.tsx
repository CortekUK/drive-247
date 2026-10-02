"use client";

/**
 * The conversation's right rail: who you are talking to, and about what.
 *
 * ── real data first, mocked only where there is nothing to read ─────────────
 *
 * The customer, their contact details and their rentals are REAL — the same
 * tenant-scoped `useCustomerRentals` the attachment menu uses, so this rail
 * shares that cache and adds no request. Nothing here invents a value that the
 * product already stores, because a mocked balance sitting beside a real phone
 * number is the kind of screenshot that gets believed.
 *
 * The one genuinely absent thing is a per-customer outstanding balance: there
 * is no such figure on the customer record, and deriving one from rentals here
 * would be a second, quieter answer to a question Payments already answers. So
 * it is not shown at all rather than shown wrongly.
 *
 * ── why it collapses ────────────────────────────────────────────────────────
 *
 * Below `xl` the conversation needs its width more than the rail does, so the
 * rail is hidden there and the header keeps the identity. Nothing in it is
 * unreachable — every value also lives on the customer and rental screens,
 * which is exactly why it can be dropped on a narrow window.
 */

import { useMemo, useState } from "react";
import Link from "next/link";
import { differenceInCalendarDays, format, formatDistanceToNowStrict } from "date-fns";
import { useQuery } from "@tanstack/react-query";
import {
  CalendarDays, Clock, ExternalLink, Mail, Pencil, Phone, Sparkles,
} from "lucide-react";
import { SteeringWheel } from "@/components/ui/steering-wheel";
import { useTenant } from "@/contexts/TenantContext";
import { useV2 } from "@/lib/v2-context";
import type { ChatMessage } from "@/hooks/use-chat-messages";
import { useContactOverride, type PreferredChannel } from "@/components/messages-v2/contact-override";
import { ContactEditDialog } from "@/components/messages-v2/contact-edit-dialog";

const PREFERRED_LABEL: Record<PreferredChannel, string> = {
  in_app: "In-app",
  sms: "SMS",
  email: "Email",
  call: "Phone",
};
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui-v2/avatar";
import { Button } from "@/components/ui-v2/button";
import { useCustomerRentals, type CustomerRental } from "@/hooks/use-customer-rentals";
import { AutoSkeleton } from "@/components/skeleton-v2/auto-skeleton";
import { skeletonRows } from "@/lib/skeleton-data";
import { useSkeletonLoading } from "@/hooks/use-skeleton-loading";
import type { ChatChannel } from "@/hooks/use-chat-channels";
import type { MessageChannel } from "@/contexts/RealtimeChatContext";
import { NO_SCROLLBAR } from "@/components/messages-v2/no-scrollbar";

const initials = (name?: string | null) =>
  (name || "?").split(" ").map((w) => w[0]).join("").toUpperCase().slice(0, 2);

const CHANNEL_LABEL: Record<MessageChannel, string> = {
  in_app: "In-app",
  sms: "SMS",
  email: "Email",
  voice: "Phone",
};

const STATUS_TONE: Record<string, string> = {
  active: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  pending: "bg-amber-500/10 text-amber-700 dark:text-amber-400",
  reserved: "bg-amber-500/10 text-amber-700 dark:text-amber-400",
  closed: "bg-muted text-muted-foreground",
  completed: "bg-muted text-muted-foreground",
  cancelled: "bg-destructive/10 text-destructive",
};

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-1.5">
      <span className="shrink-0 text-[12px] text-muted-foreground">{label}</span>
      <span className="min-w-0 truncate text-right text-[12px] text-foreground">{value}</span>
    </div>
  );
}

function Section({
  title, action, children,
}: {
  title: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-2.5">
      <div className="flex h-6 items-center justify-between gap-2">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/80">
          {title}
        </p>
        {action}
      </div>
      {children}
    </div>
  );
}

/** A placeholder rental for the Rental card's skeleton: only its shape is seen. */
const [SKELETON_RENTAL] = skeletonRows<CustomerRental>(1, (f) => ({
  id: f.id,
  start_date: f.date(10),
  end_date: f.date(-10),
  monthly_amount: 0,
  status: "Active",
  approval_status: null,
  schedule: "",
  created_at: f.date(10),
  vehicle: { id: f.id, reg: f.word(6, 8), make: f.word(4, 8), model: f.text(1, 2) },
}));

const fmtAgo = (d: Date) => formatDistanceToNowStrict(d, { addSuffix: true });

function minutesLabel(min: number) {
  if (min < 1) return "under a minute";
  if (min < 60) return `~${Math.round(min)} min`;
  const h = min / 60;
  if (h < 24) return `~${Math.round(h)} h`;
  return `~${Math.round(h / 24)} days`;
}

/** Where this rental stands in time, in one phrase. */
function rentalTiming(r: CustomerRental): { text: string; tone: string } | null {
  const today = new Date();
  const start = new Date(r.start_date);
  const end = r.end_date ? new Date(r.end_date) : null;
  const s = differenceInCalendarDays(start, today);
  if (s > 0) return { text: `Starts in ${s} day${s === 1 ? "" : "s"}`, tone: "text-blue-600 dark:text-blue-400" };
  if (!end) return { text: "Open-ended", tone: "text-muted-foreground" };
  const e = differenceInCalendarDays(end, today);
  if (e > 1) return { text: `Ends in ${e} days`, tone: e <= 3 ? "text-amber-600 dark:text-amber-400" : "text-emerald-600 dark:text-emerald-400" };
  if (e === 1) return { text: "Ends tomorrow", tone: "text-amber-600 dark:text-amber-400" };
  if (e === 0) return { text: "Due back today", tone: "text-amber-600 dark:text-amber-400" };
  const ago = -e;
  return { text: `Ended ${ago} day${ago === 1 ? "" : "s"} ago`, tone: "text-muted-foreground" };
}

export function CustomerContext({ channel }: { channel: ChatChannel }) {
  const customerId = channel.customer_id;
  const name = channel.customer?.name || "Customer";
  const email = channel.customer?.email || null;
  const phone = channel.customer?.phone || null;
  const { tenant } = useTenant();
  const { data: loadedRentals = [], isLoading: rentalsLoading } = useCustomerRentals(customerId);
  const isLoading = useSkeletonLoading(rentalsLoading);
  // While loading, one placeholder rental renders through the real card below.
  const rentals = isLoading ? [SKELETON_RENTAL] : loadedRentals;

  /* Per-conversation contact. v2 only: the one-off send path behind it
     (`send-conversation-message-v2`) is a canary function. */
  const canOverride = useV2("chrome");
  const { override, setAll } = useContactOverride(channel.id);
  const [editingContact, setEditingContact] = useState(false);

  /* The thread the centre column already loaded — READ from the cache, never
     fetched again (`enabled: false`), so this rail adds no request and does
     not join the realtime room a second time. Live as the cache updates. */
  const { data: thread } = useQuery<{ pages: { messages: ChatMessage[] }[] }>({
    queryKey: ["chat-messages", tenant?.id, channel.id],
    enabled: false,
  });
  const convo = useMemo(() => {
    const all = (thread?.pages ?? [])
      .flatMap((p) => p.messages)
      .filter((m) => m.created_at)
      .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
    if (!all.length) return null;
    const lastCustomer = [...all].reverse().find((m) => m.sender_type === "customer");
    const last = all[all.length - 1];
    /* Response time: each customer message to the next operator reply. */
    const gaps: number[] = [];
    for (let i = 0; i < all.length; i++) {
      if (all[i].sender_type !== "customer" || (i > 0 && all[i - 1].sender_type === "customer")) continue;
      const reply = all.slice(i + 1).find((m) => m.sender_type === "tenant");
      if (reply) gaps.push((new Date(reply.created_at).getTime() - new Date(all[i].created_at).getTime()) / 60000);
    }
    gaps.sort((a, b) => a - b);
    const channels = Array.from(new Set(all.map((m) => (m.channel || "in_app") as MessageChannel)));
    return {
      count: all.length,
      lastCustomerAt: lastCustomer ? new Date(lastCustomer.created_at) : null,
      waiting: last.sender_type === "customer" ? new Date(last.created_at) : null,
      typicalReply: gaps.length ? gaps[Math.floor(gaps.length / 2)] : null,
      channels,
    };
  }, [thread]);

  /* The rental this conversation is most likely about: the live one, else the
     next one coming, else the most recent. */
  const current = useMemo(() => {
    if (!rentals.length) return null;
    const byRecency = [...rentals].sort(
      (a, b) => new Date(b.start_date).getTime() - new Date(a.start_date).getTime(),
    );
    const upcoming = byRecency.filter((r) => differenceInCalendarDays(new Date(r.start_date), new Date()) > 0);
    return (
      byRecency.find((r) => r.status.toLowerCase() === "active") ??
      upcoming[upcoming.length - 1] ??
      byRecency[0]
    );
  }, [rentals]);

  const customerSince = useMemo(() => {
    if (isLoading || !loadedRentals.length) return null;
    return loadedRentals.reduce((min, r) => (new Date(r.start_date) < min ? new Date(r.start_date) : min), new Date(loadedRentals[0].start_date));
  }, [isLoading, loadedRentals]);

  const preferred = CHANNEL_LABEL[channel.last_channel] ?? "In-app";
  const usualKey: PreferredChannel =
    channel.last_channel === "voice" ? "call" : ((channel.last_channel as PreferredChannel) || "in_app");
  const timing = current && !isLoading ? rentalTiming(current) : null;

  return (
    /* Narrower than the conversation list on purpose: the visual order the
       brief asks for is thread first, list second, this third, and width is how
       that order is actually expressed. Everything here is also one click away
       on the customer screen, which is why it is the first column to go as the
       window narrows. */
    <aside className="hidden min-h-0 w-[292px] shrink-0 flex-col xl:flex">
      {/* Who you are talking to — one compact row (avatar, name, how long
          they have been a customer, and the way to their record), so the
          whole rail fits the window without scrolling. */}
      <div className="flex shrink-0 items-center gap-3 px-5 pb-5 pt-6">
        <Avatar className="h-11 w-11 shrink-0">
          <AvatarImage src={channel.customer?.profile_photo_url || undefined} alt={name} />
          <AvatarFallback className="bg-primary/10 text-[13px] font-semibold text-primary dark:text-[hsl(var(--v2-link,var(--primary)))]">
            {initials(name)}
          </AvatarFallback>
        </Avatar>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[14px] font-semibold leading-tight">{name}</p>
          <p className="mt-0.5 truncate text-[11.5px] text-muted-foreground">
            {customerSince
              ? `Since ${format(customerSince, "MMM yyyy")} · ${loadedRentals.length} rental${loadedRentals.length === 1 ? "" : "s"}`
              : "No rentals yet"}
          </p>
        </div>
        <Button
          asChild variant="ghost" size="icon"
          title="Open customer" aria-label="Open customer"
          className="h-8 w-8 shrink-0 rounded-full text-muted-foreground hover:text-foreground"
        >
          <Link href={`/customers/${customerId}`}><ExternalLink className="h-3.5 w-3.5" /></Link>
        </Button>
      </div>

      {/* One scroll region, and it only scrolls when the content genuinely
          overflows. */}
      {/* Minimal and spacious: no boxes, just labelled groups on the page,
          spread down the full height of the column (`justify-between`) so the
          rail ends at the bottom of the screen rather than stopping short. It
          scrolls only on a window too short to hold it, with no bar drawn. */}
      <div className={`flex min-h-0 flex-1 flex-col justify-between gap-6 overflow-y-auto no-scrollbar px-5 pb-10 pt-1 ${NO_SCROLLBAR}`}>
        {/* ── needs you ─────────────────────────────────────────────────── */}
        {convo?.waiting && (
          <div className="flex items-start gap-2 rounded-2xl bg-amber-500/10 px-3 py-2 text-[11.5px] text-amber-800 dark:text-amber-300">
            <Clock className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <p className="leading-snug">
              <span className="font-semibold">Waiting on your reply</span> — {name.split(" ")[0]} wrote {fmtAgo(convo.waiting)}.
            </p>
          </div>
        )}

        {/* Plain rows and ONE pencil. The explanation, the on-record values
            and the way back all live in the dialog, where the change is made.
            A value changed for this chat carries a small indigo dot. */}
        <Section
          title="Contact"
          action={
            canOverride && (
              <button
                type="button"
                onClick={() => setEditingContact(true)}
                aria-label="Edit contact for this conversation"
                title="Edit contact for this conversation"
                className="flex h-6 w-6 items-center justify-center rounded-full text-muted-foreground transition-colors duration-200 hover:bg-primary/10 hover:text-primary"
              >
                <Pencil className="h-3 w-3" />
              </button>
            )
          }
        >
          <div>
            {[
              { label: "Email", icon: Mail, value: override.email || email, changed: !!override.email },
              { label: "Phone", icon: Phone, value: override.phone || phone, changed: !!override.phone },
              {
                label: "Usual channel",
                icon: Sparkles,
                value: override.channel ? PREFERRED_LABEL[override.channel] : preferred,
                changed: !!override.channel,
              },
            ].map(({ label, icon: Icon, value, changed }) => (
              <Row
                key={label}
                label={label}
                value={
                  <span className="inline-flex max-w-full items-center gap-1.5">
                    <Icon className="h-3 w-3 shrink-0 text-muted-foreground" />
                    <span className={`truncate ${value ? "" : "text-muted-foreground"}`}>{value || "None on file"}</span>
                    {changed && (
                      <span
                        title="Changed for this chat"
                        className="h-1.5 w-1.5 shrink-0 rounded-full bg-primary dark:bg-[hsl(var(--v2-link,var(--primary)))]"
                      />
                    )}
                  </span>
                }
              />
            ))}
          </div>
        </Section>

        <Section title="Rental">
          {!isLoading && !current ? (
            <p className="text-[12px] text-muted-foreground">
              No rentals for this customer yet.
            </p>
          ) : (
            <AutoSkeleton loading={isLoading}>
            <Link
              href={`/rentals/${current.id}`}
              className="-mx-2 block rounded-xl px-2 py-1.5 transition-colors hover:bg-[hsl(var(--v2-hover,var(--accent)_/_0.6))]"
            >
              <div className="flex items-start justify-between gap-2">
                <span className="inline-flex items-center gap-1.5 text-[13px] font-medium">
                  <SteeringWheel className="h-3.5 w-3.5 text-muted-foreground" />
                  {current.vehicle?.make} {current.vehicle?.model}
                </span>
                <span
                  className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium capitalize ${
                    STATUS_TONE[current.status.toLowerCase()] ?? "bg-muted text-muted-foreground"
                  }`}
                >
                  {current.status}
                </span>
              </div>
              <p className="mt-1 flex items-center gap-1.5 text-[11px] text-muted-foreground">
                <CalendarDays className="h-3 w-3 shrink-0" />
                <span className="truncate">
                  {current.vehicle?.reg} · {format(new Date(current.start_date), "d MMM")}
                  {current.end_date ? ` – ${format(new Date(current.end_date), "d MMM")}` : ""}
                </span>
              </p>
              {timing && <p className={`mt-1 text-[11.5px] font-medium ${timing.tone}`}>{timing.text}</p>}
            </Link>
            </AutoSkeleton>
          )}
        </Section>

        {convo && (
          <Section title="Conversation">
            {/* Four figures as a 2×2 of small tiles rather than four rows —
                the same facts in half the height. */}
            <div className="grid grid-cols-2 gap-x-4 gap-y-3.5">
              {[
                { k: "Started", v: format(new Date(channel.created_at), "d MMM yyyy") },
                { k: "Messages", v: `${convo.count} recent` },
                { k: "Last heard", v: convo.lastCustomerAt ? formatDistanceToNowStrict(convo.lastCustomerAt, { addSuffix: true }) : "—" },
                { k: "You reply in", v: convo.typicalReply != null ? minutesLabel(convo.typicalReply) : "—" },
              ].map((t) => (
                <div key={t.k}>
                  <p className="text-[11px] text-muted-foreground">{t.k}</p>
                  <p className="mt-0.5 truncate text-[13px] font-medium">{t.v}</p>
                </div>
              ))}
            </div>
            <div className="flex flex-wrap items-center gap-1 pt-1">
              {convo.channels.map((c) => (
                <span key={c} className="rounded-full bg-primary/[0.07] px-2 py-0.5 text-[10.5px] font-medium text-foreground/75">
                  {CHANNEL_LABEL[c] ?? c}
                </span>
              ))}
            </div>
          </Section>
        )}

        {rentals.length > 1 && (
          <Section title={`Earlier rentals (${rentals.length - 1})`}>
            <div>
              {rentals
                .filter((r) => r.id !== current?.id)
                .slice(0, 2)
                .map((r) => (
                  <Link
                    key={r.id}
                    href={`/rentals/${r.id}`}
                    className="-mx-2 flex items-center justify-between gap-2 rounded-xl px-2 py-1.5 transition-colors hover:bg-[hsl(var(--v2-hover,var(--accent)_/_0.6))]"
                  >
                    <span className="truncate text-[12px]">
                      {r.vehicle?.make} {r.vehicle?.model}
                    </span>
                    <span className="shrink-0 text-[11px] text-muted-foreground">
                      {format(new Date(r.start_date), "MMM yyyy")}
                    </span>
                  </Link>
                ))}
            </div>
          </Section>
        )}
      </div>

      <ContactEditDialog
        open={editingContact}
        onOpenChange={setEditingContact}
        customerId={customerId}
        customerName={name}
        onFileEmail={email}
        onFilePhone={phone}
        usualChannel={usualKey}
        override={override}
        onSave={setAll}
      />
    </aside>
  );
}
