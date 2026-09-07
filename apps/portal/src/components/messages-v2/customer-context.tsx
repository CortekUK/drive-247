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

import { useMemo } from "react";
import Link from "next/link";
import { format } from "date-fns";
import { Car, CalendarDays, ExternalLink, Mail, Phone, Sparkles } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui-v2/avatar";
import { Button } from "@/components/ui-v2/button";
import { useCustomerRentals } from "@/hooks/use-customer-rentals";
import type { ChatChannel } from "@/hooks/use-chat-channels";
import type { MessageChannel } from "@/contexts/RealtimeChatContext";

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

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        {title}
      </p>
      {children}
    </div>
  );
}

export function CustomerContext({ channel }: { channel: ChatChannel }) {
  const customerId = channel.customer_id;
  const name = channel.customer?.name || "Customer";
  const email = channel.customer?.email || null;
  const phone = channel.customer?.phone || null;
  const { data: rentals = [], isLoading } = useCustomerRentals(customerId);

  /* The rental this conversation is most likely about: the live one, else the
     most recent. Sorting here rather than trusting order — the hook does not
     promise one. */
  const current = useMemo(() => {
    if (!rentals.length) return null;
    const byRecency = [...rentals].sort(
      (a, b) => new Date(b.start_date).getTime() - new Date(a.start_date).getTime(),
    );
    return byRecency.find((r) => r.status.toLowerCase() === "active") ?? byRecency[0];
  }, [rentals]);

  const preferred = CHANNEL_LABEL[channel.last_channel] ?? "In-app";

  return (
    <aside className="hidden w-[300px] shrink-0 overflow-y-auto border-l border-border/50 xl:block">
      <div className="space-y-6 p-5">
        {/* Identity */}
        <div className="flex flex-col items-center text-center">
          <Avatar className="h-16 w-16">
            <AvatarImage src={channel.customer?.profile_photo_url || undefined} alt={name} />
            <AvatarFallback className="bg-primary/10 text-base font-semibold text-primary">
              {initials(name)}
            </AvatarFallback>
          </Avatar>
          <p className="mt-3 text-[14px] font-semibold leading-tight">{name}</p>
          {email && <p className="mt-0.5 truncate text-[12px] text-muted-foreground">{email}</p>}
          <Button asChild variant="outline" size="sm" className="mt-3 gap-1.5 rounded-full">
            <Link href={`/customers/${customerId}`}>
              Open customer
              <ExternalLink className="h-3 w-3" />
            </Link>
          </Button>
        </div>

        <Section title="Contact">
          <div className="rounded-2xl bg-muted/40 px-3.5 py-2">
            {email && (
              <Row
                label="Email"
                value={
                  <span className="inline-flex items-center gap-1.5">
                    <Mail className="h-3 w-3 text-muted-foreground" />
                    {email}
                  </span>
                }
              />
            )}
            {phone && (
              <Row
                label="Phone"
                value={
                  <span className="inline-flex items-center gap-1.5">
                    <Phone className="h-3 w-3 text-muted-foreground" />
                    {phone}
                  </span>
                }
              />
            )}
            <Row
              label="Usual channel"
              value={
                <span className="inline-flex items-center gap-1.5">
                  <Sparkles className="h-3 w-3 text-muted-foreground" />
                  {preferred}
                </span>
              }
            />
            {!email && !phone && (
              <p className="py-2 text-[12px] text-muted-foreground">
                No contact details on this customer yet.
              </p>
            )}
          </div>
        </Section>

        <Section title="Rental">
          {isLoading ? (
            <div className="space-y-2 rounded-2xl bg-muted/40 p-3.5">
              <div className="h-3 w-2/3 animate-pulse rounded-full bg-muted" />
              <div className="h-3 w-full animate-pulse rounded-full bg-muted/70" />
            </div>
          ) : !current ? (
            <p className="rounded-2xl bg-muted/40 px-3.5 py-3 text-[12px] text-muted-foreground">
              No rentals for this customer yet.
            </p>
          ) : (
            <Link
              href={`/rentals/${current.id}`}
              className="block rounded-2xl bg-muted/40 px-3.5 py-3 transition-colors hover:bg-accent/60"
            >
              <div className="flex items-start justify-between gap-2">
                <span className="inline-flex items-center gap-1.5 text-[13px] font-medium">
                  <Car className="h-3.5 w-3.5 text-muted-foreground" />
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
              <p className="mt-1 text-[11px] text-muted-foreground">{current.vehicle?.reg}</p>
              <p className="mt-2 inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
                <CalendarDays className="h-3 w-3" />
                {format(new Date(current.start_date), "d MMM")}
                {current.end_date ? ` – ${format(new Date(current.end_date), "d MMM yyyy")}` : ""}
              </p>
            </Link>
          )}
        </Section>

        {rentals.length > 1 && (
          <Section title={`Earlier rentals (${rentals.length - 1})`}>
            <div className="space-y-1">
              {rentals
                .filter((r) => r.id !== current?.id)
                .slice(0, 3)
                .map((r) => (
                  <Link
                    key={r.id}
                    href={`/rentals/${r.id}`}
                    className="flex items-center justify-between gap-2 rounded-xl px-2.5 py-1.5 transition-colors hover:bg-accent/60"
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
    </aside>
  );
}
