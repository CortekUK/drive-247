"use client";

/**
 * Right rail of the rental control centre — DESIGN SANDBOX. Nothing is real.
 *
 * No Supabase, no tenant, no auth, no network, no react-query. Every list here
 * is a module constant and every change is local state, so this rail can be
 * driven hard without touching a row.
 *
 * The rail is SECONDARY. The middle column is where the rental is decided; this
 * side supports it. 13px body, 11px meta, `size-4` icons — the left rail's
 * rhythm, and two sizes only. Three tones per row: foreground, muted, and one
 * accent for the thing that matters. If anything in here pulls the eye away
 * from the middle, it is wrong.
 *
 * Three icon-only tabs in an `h-11` strip that matches the left rail's
 * back-link row exactly, so the two headers agree across the screen. Bare
 * icons, no labels: the title/aria-label carries the name, and three words up
 * here would be the only text in the rail competing with the content under it.
 *
 *   Extensions the rental over time, and the two controls that change it
 *   Messages   talk to this customer without leaving the rental
 *   Activity   everything that ever happened to it, and who did it
 *
 * Every tab has the same shape: a scrolling middle and something pinned. What
 * is pinned is whatever an operator reaches for — the composer, the filter,
 * the Extend button — so it is never scrolled out of reach by a long list.
 *
 * There was once a Payment plan tab, and it is gone on purpose. Money is the
 * platform's most important surface and splitting it between a rail tab and the
 * middle column meant neither half held the whole context. It now lives once,
 * in the middle, with the ledger and the actions. Its money EVENTS stay in
 * Activity, which is the rental-wide record and not a second payments screen.
 *
 * Grounded in the real product so the fake states match what exists:
 *   thread     `chat_channel_messages` — `sender_type: 'tenant' | 'customer'`,
 *              `is_read` / `read_at`, and a per-message `channel` column typed
 *              `'in_app' | 'sms' | 'email' | 'voice'` (hooks/use-chat-messages).
 *              The pipe is a property of each MESSAGE, not of the thread — which
 *              is why one unified history carries mixed channels rather than
 *              three separate threads.
 *   reach      SMS goes via Twilio and needs `customers.phone`; email needs
 *              `customers.email`. A channel with no address is disabled here,
 *              because in the real product it silently fails.
 *   activity   `audit_logs` — an actor, an action, a target, a timestamp.
 *
 * Deliberately NOT copied from `components/chat/ChatWindow.tsx`: that file
 * paints its channels in literal brand hexes (Twilio red `#F22F46`, blue-500,
 * amber-500). Tokens only in here — a rail full of raw palette colours is the
 * fastest way to make the canary read as v1.
 *
 * Amber appears nowhere in this file. In this sandbox amber means "out of date",
 * so a failed payment is `destructive`, not amber.
 */

import { useEffect, useRef, useState } from "react";
import {
  MessageSquare,
  History,
  Smartphone,
  Mail,
  Send,
  Check,
  CheckCheck,
  Clock,
  Plus,
  UserPlus,
  Car,
  CalendarDays,
  CalendarPlus,
  SlidersHorizontal,
  FileSignature,
  Gavel,
  ShieldCheck,
  Link2,
  CreditCard,
  RotateCcw,
  Lock,
  KeyRound,
  StickyNote,
  AlertCircle,
  RefreshCw,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { ExtensionsTab } from "./_extensions";
import { Button } from "@/components/ui-v2/button";
import { money, textareaCls } from "@/app/playground/_shared";

/* ══════════════════════════════════════════════════════════════════════════
   Shape
   ══════════════════════════════════════════════════════════════════════════ */

type TabId = "extensions" | "messages" | "activity";

/** The three pipes an operator can reach a customer on. `voice` exists in the
 *  real enum but a call is not something you compose in a textarea. */
type Channel = "chat" | "sms" | "email";

/** `sending` is the optimistic state — on screen before anything confirmed it.
 *  `read` is the customer having opened it, not us having sent it; the two are
 *  worth separating when you are deciding whether to chase someone. */
type Delivery = "sending" | "sent" | "read";

type Msg = {
  id: string;
  /** `us` is `sender_type: 'tenant'`; `them` is `'customer'`. */
  from: "us" | "them";
  body: string;
  /** Labels, not Dates. Rendering `new Date()` during SSR and again on
   *  hydration is how you earn a mismatch warning for no benefit. */
  day: string;
  time: string;
  channel: Channel;
  delivery?: Delivery;
};

const TABS: { id: TabId; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { id: "extensions", label: "Extensions", icon: CalendarPlus },
  { id: "messages", label: "Messages", icon: MessageSquare },
  { id: "activity", label: "Activity", icon: History },
];

const CHANNELS: { id: Channel; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { id: "chat", label: "Chat", icon: MessageSquare },
  { id: "sms", label: "SMS", icon: Smartphone },
  { id: "email", label: "Email", icon: Mail },
];

/* ══════════════════════════════════════════════════════════════════════════
   Fake thread
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * A realistic exchange about THIS rental, deliberately mixed across all three
 * pipes — that is the whole argument for one unified thread. The operator
 * answered in chat, chased on SMS, and the agreement went by email; none of
 * that is three conversations.
 *
 * It ends on an inbound message on purpose, so the composer has an obvious
 * reason to exist and the tab strip has something to flag.
 */
const SEED: Msg[] = [
  { id: "s1", from: "them", body: "Hi — is the pickup still 10:00 on Friday?", day: "Yesterday", time: "9:14 AM", channel: "chat" },
  {
    id: "s2",
    from: "us",
    body: "Yes, 10:00 Friday.",
    day: "Yesterday",
    time: "9:30 AM",
    channel: "chat",
    delivery: "read",
  },
  {
    id: "s3",
    from: "us",
    body: "I'll send the exact address and the code an hour before.",
    day: "Yesterday",
    time: "9:31 AM",
    channel: "chat",
    delivery: "read",
  },
  { id: "s4", from: "them", body: "Great. Anything I need to bring other than my licence?", day: "Yesterday", time: "9:33 AM", channel: "chat" },
  {
    id: "s5",
    from: "us",
    body: "Just the licence and the card you booked with. The deposit hold comes off when the car's back.",
    day: "Yesterday",
    time: "9:40 AM",
    channel: "sms",
    delivery: "read",
  },
  {
    id: "s6",
    from: "us",
    body: "Agreement is on its way over — sign it whenever suits.",
    day: "Today",
    time: "8:02 AM",
    channel: "email",
    delivery: "sent",
  },
  { id: "s7", from: "them", body: "Signed it. See you Friday.", day: "Today", time: "8:47 AM", channel: "chat" },
];

/**
 * The three things operators send over and over. They fill the composer rather
 * than sending — nobody wants a canned message to leave the building before
 * they have read it back.
 */
const QUICK: { label: string; text: (first: string) => string }[] = [
  { label: "Pickup details", text: (f) => `Hi ${f} — pickup is at 10:00. I'll send the exact address and the code an hour before.` },
  {
    label: "Licence photo",
    text: (f) => `Hi ${f}, could you send a photo of your driving licence, front and back? It's the last thing we need before pickup.`,
  },
  { label: "Running late?", text: (f) => `Hi ${f} — still on track for pickup? Let me know if you're running late and we'll hold the car.` },
];

/* ══════════════════════════════════════════════════════════════════════════
   Fake activity
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * WHO did it is as load-bearing as what happened. An operator scanning this
 * needs to know instantly whether they did something or whether it happened to
 * them, so the actor is carried by the icon's colour — primary (one of us),
 * solid (a person on the other side), faded (nobody, it just fired) — and by
 * name on the meta line.
 */
type Actor = "operator" | "customer" | "system";

/** What the filter narrows by. Bucketed by SUBJECT, not by who acted. */
type EvKind = "money" | "doc" | "change";

type Ev = {
  id: string;
  day: string;
  time: string;
  icon: React.ComponentType<{ className?: string }>;
  text: string;
  actor: Actor;
  by: string;
  kind: EvKind;
  /** Money events are what the eye hunts for, so the figure gets its own column. */
  amount?: string;
  /** Failures. `destructive`, never amber — amber is drift. */
  bad?: boolean;
};

/**
 * The whole life of RNT-2049, newest first.
 *
 * Two things this list is trying to prove:
 *
 *  1. Every actor appears. A rental is not a thing one person does — a webhook
 *     took the money, a cron let a deposit hold expire, the customer opened the
 *     link, and two different staff touched the terms.
 *  2. DECISIONS are recorded, not just actions. "Kept the signed agreement
 *     despite the mileage change — Priya" is the entry that settles a dispute,
 *     and today that click writes to nothing at all. It is the reason this tab
 *     is worth building.
 */
const buildEvents = (who: string): Ev[] => [
  /* ── today ──────────────────────────────────────────────────────────── */
  { id: "e01", day: "Today", time: "8:47 AM", icon: FileSignature, text: "Agreement signed", actor: "customer", by: who, kind: "doc" },
  { id: "e02", day: "Today", time: "8:31 AM", icon: FileSignature, text: "Agreement opened", actor: "customer", by: who, kind: "doc" },
  { id: "e03", day: "Today", time: "8:02 AM", icon: FileSignature, text: "Agreement v3 sent for signature", actor: "operator", by: "Priya", kind: "doc" },
  {
    id: "e04",
    day: "Today",
    time: "7:58 AM",
    icon: Gavel,
    text: "Superseded the signed agreement — vehicle and daily rate had both moved",
    actor: "operator",
    by: "Priya",
    kind: "doc",
  },
  {
    id: "e05",
    day: "Today",
    time: "7:41 AM",
    icon: Lock,
    text: "Deposit hold partially captured — toll charge passed on",
    actor: "operator",
    by: "Dan",
    kind: "money",
    amount: money(60),
  },
  { id: "e06", day: "Today", time: "7:20 AM", icon: KeyRound, text: "Lockbox code sent by SMS", actor: "system", by: "System", kind: "doc" },

  /* ── yesterday ──────────────────────────────────────────────────────── */
  {
    id: "e07",
    day: "Yesterday",
    time: "6:12 PM",
    icon: RefreshCw,
    text: "Agreement flagged out of date — vehicle, daily rate",
    actor: "system",
    by: "System",
    kind: "doc",
  },
  {
    id: "e08",
    day: "Yesterday",
    time: "6:11 PM",
    icon: SlidersHorizontal,
    text: "Daily rate changed · $95 → $110",
    actor: "operator",
    by: "Priya",
    kind: "change",
  },
  {
    id: "e09",
    day: "Yesterday",
    time: "5:49 PM",
    icon: RotateCcw,
    text: "Refund issued — toll pass removed",
    actor: "operator",
    by: "Dan",
    kind: "money",
    amount: money(35),
  },
  {
    id: "e10",
    day: "Yesterday",
    time: "5:48 PM",
    icon: SlidersHorizontal,
    text: "Extras changed · Toll pass removed",
    actor: "operator",
    by: "Dan",
    kind: "change",
  },
  {
    id: "e11",
    day: "Yesterday",
    time: "2:14 PM",
    icon: CreditCard,
    text: "Card charged directly · Visa ending 4242",
    actor: "operator",
    by: "Priya",
    kind: "money",
    amount: money(285),
  },
  {
    id: "e12",
    day: "Yesterday",
    time: "1:55 PM",
    icon: AlertCircle,
    text: "Card payment failed — insufficient funds",
    actor: "system",
    by: "System",
    kind: "money",
    amount: money(285),
    bad: true,
  },
  { id: "e13", day: "Yesterday", time: "1:40 PM", icon: Link2, text: "Payment link opened", actor: "customer", by: who, kind: "money" },
  { id: "e14", day: "Yesterday", time: "1:12 PM", icon: Smartphone, text: "Payment link sent by SMS", actor: "system", by: "System", kind: "money" },
  {
    id: "e15",
    day: "Yesterday",
    time: "1:10 PM",
    icon: Link2,
    text: "Payment link created for the extension",
    actor: "operator",
    by: "Priya",
    kind: "money",
    amount: money(285),
  },

  /* ── 2 Sep ──────────────────────────────────────────────────────────── */
  { id: "e16", day: "2 Sep", time: "4:30 PM", icon: Lock, text: "Deposit hold extended to 14 Sep", actor: "system", by: "System", kind: "money", amount: money(200) },
  { id: "e17", day: "2 Sep", time: "4:03 PM", icon: ShieldCheck, text: "Policy replaced · BZ-88134-D", actor: "system", by: "System", kind: "doc" },
  {
    id: "e18",
    day: "2 Sep",
    time: "4:02 PM",
    icon: ShieldCheck,
    text: "Insurance re-quoted for the new dates",
    actor: "system",
    by: "System",
    kind: "money",
    amount: money(140),
  },
  {
    id: "e19",
    day: "2 Sep",
    time: "3:38 PM",
    icon: Car,
    text: "Vehicle swapped · Model 3 (8XLR224) → Model Y (7KRB910)",
    actor: "operator",
    by: "Dan",
    kind: "change",
  },
  {
    id: "e20",
    day: "2 Sep",
    time: "11:26 AM",
    icon: CalendarPlus,
    text: "Rental extended by 3 days · now ends 14 Sep",
    actor: "operator",
    by: "Priya",
    kind: "change",
  },
  {
    id: "e21",
    day: "2 Sep",
    time: "9:04 AM",
    icon: StickyNote,
    text: "Note added — “asked about airport parking, told him lot B”",
    actor: "operator",
    by: "Dan",
    kind: "change",
  },

  /* ── 31 Aug ─────────────────────────────────────────────────────────── */
  {
    id: "e22",
    day: "31 Aug",
    time: "4:19 PM",
    icon: Gavel,
    text: "Kept the signed agreement despite the mileage change",
    actor: "operator",
    by: "Priya",
    kind: "doc",
  },
  { id: "e23", day: "31 Aug", time: "4:15 PM", icon: RefreshCw, text: "Agreement flagged out of date — mileage", actor: "system", by: "System", kind: "doc" },
  {
    id: "e24",
    day: "31 Aug",
    time: "4:11 PM",
    icon: SlidersHorizontal,
    text: "Mileage changed · Unlimited → 100 mi/day",
    actor: "operator",
    by: "Priya",
    kind: "change",
  },
  { id: "e25", day: "31 Aug", time: "10:02 AM", icon: Lock, text: "Deposit hold re-placed", actor: "system", by: "System", kind: "money", amount: money(200) },
  {
    id: "e26",
    day: "31 Aug",
    time: "10:01 AM",
    icon: Lock,
    text: "Deposit hold released — 7-day authorisation expired",
    actor: "system",
    by: "System",
    kind: "money",
  },

  /* ── 28 Aug ─────────────────────────────────────────────────────────── */
  { id: "e27", day: "28 Aug", time: "5:30 PM", icon: Mail, text: "Booking confirmation email sent", actor: "system", by: "System", kind: "doc" },
  { id: "e28", day: "28 Aug", time: "5:12 PM", icon: Lock, text: "Deposit hold placed", actor: "operator", by: "Priya", kind: "money", amount: money(200) },
  { id: "e29", day: "28 Aug", time: "4:58 PM", icon: ShieldCheck, text: "Insurance purchased · Collision Damage Waiver", actor: "operator", by: "Priya", kind: "money", amount: money(98) },
  { id: "e30", day: "28 Aug", time: "4:57 PM", icon: ShieldCheck, text: "Policy issued · BZ-88134-C", actor: "system", by: "System", kind: "doc" },
  { id: "e31", day: "28 Aug", time: "4:44 PM", icon: ShieldCheck, text: "Insurance quoted", actor: "system", by: "System", kind: "doc", amount: money(98) },
  { id: "e32", day: "28 Aug", time: "3:20 PM", icon: FileSignature, text: "Agreement signed", actor: "customer", by: who, kind: "doc" },
  { id: "e33", day: "28 Aug", time: "2:51 PM", icon: FileSignature, text: "Agreement opened", actor: "customer", by: who, kind: "doc" },
  { id: "e34", day: "28 Aug", time: "2:30 PM", icon: FileSignature, text: "Agreement sent for signature", actor: "operator", by: "Priya", kind: "doc" },
  {
    id: "e35",
    day: "28 Aug",
    time: "1:15 PM",
    icon: CreditCard,
    text: "Paid on the link · Visa ending 4242",
    actor: "customer",
    by: who,
    kind: "money",
    amount: money(760),
  },
  { id: "e36", day: "28 Aug", time: "1:02 PM", icon: Link2, text: "Payment link opened", actor: "customer", by: who, kind: "money" },
  { id: "e37", day: "28 Aug", time: "12:40 PM", icon: Mail, text: "Payment link sent by email", actor: "system", by: "System", kind: "money" },
  {
    id: "e38",
    day: "28 Aug",
    time: "12:38 PM",
    icon: Link2,
    text: "Payment link created",
    actor: "operator",
    by: "Priya",
    kind: "money",
    amount: money(760),
  },
  { id: "e39", day: "28 Aug", time: "11:20 AM", icon: SlidersHorizontal, text: "Security deposit set · $200", actor: "operator", by: "Priya", kind: "change" },
  { id: "e40", day: "28 Aug", time: "11:19 AM", icon: SlidersHorizontal, text: "Daily rate set · $95", actor: "operator", by: "Priya", kind: "change" },
  { id: "e41", day: "28 Aug", time: "11:15 AM", icon: CalendarDays, text: "Dates set · 4 Sep → 11 Sep", actor: "operator", by: "Priya", kind: "change" },
  { id: "e42", day: "28 Aug", time: "11:09 AM", icon: Car, text: "Vehicle attached · Tesla Model 3 (8XLR224)", actor: "operator", by: "Priya", kind: "change" },
  { id: "e43", day: "28 Aug", time: "11:04 AM", icon: UserPlus, text: `Customer attached · ${who}`, actor: "operator", by: "Priya", kind: "change" },
  { id: "e44", day: "28 Aug", time: "11:02 AM", icon: Plus, text: "Rental created", actor: "operator", by: "Priya", kind: "change" },
];

const FILTERS: { id: EvKind | "all"; label: string }[] = [
  { id: "all", label: "All" },
  { id: "money", label: "Money" },
  { id: "doc", label: "Documents" },
  { id: "change", label: "Changes" },
];

/** Primary / solid / faded — the three-step ramp that says who acted. */
const ACTOR_ICON: Record<Actor, string> = {
  operator: "text-primary",
  customer: "text-foreground",
  system: "text-muted-foreground/50",
};

/* ══════════════════════════════════════════════════════════════════════════
   Bits
   ══════════════════════════════════════════════════════════════════════════ */

const firstName = (name: string | null) => (name ? name.split(" ")[0] : "there");

/** Client-only — only ever called from a click handler, so no SSR to mismatch. */
const clock = () => new Date().toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });

/** The left rail's group label, at the same weight. A rail does not get <h2>s. */
function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="px-0.5 pb-1.5 pt-1 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/50">
      {children}
    </p>
  );
}

/**
 * One small text button for every row of choices in the rail — the channel,
 * the quick messages, the activity filter. Plain text at rest; only the one
 * that is ON gets a fill, so a row of four chips reads as one word lit and
 * three at rest, not four pills.
 */
function Chip({
  on,
  disabled,
  title,
  onClick,
  children,
}: {
  on?: boolean;
  disabled?: boolean;
  title?: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      title={title}
      onClick={onClick}
      className={cn(
        "flex shrink-0 cursor-pointer items-center gap-1.5 rounded-3xl px-2 py-0.5 text-[11px] transition-colors",
        on ? "bg-primary/10 font-medium text-primary" : "text-muted-foreground hover:text-primary",
        disabled && "cursor-not-allowed opacity-40 hover:text-muted-foreground"
      )}
    >
      {children}
    </button>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   Tab strip
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * `h-11` is not a taste call — it is the left rail's back-link row, so the two
 * headers line up across the screen. Idle/active/hover are `RailItem`'s
 * verbatim; a second active treatment in one viewport is how a screen starts
 * reading as two apps stitched together.
 */
function TabStrip({ tab, onTab, flagged }: { tab: TabId; onTab: (t: TabId) => void; flagged: TabId[] }) {
  return (
    <div className="flex h-11 shrink-0 items-center gap-1 border-b border-foreground/10 px-2">
      {TABS.map((t) => {
        const on = t.id === tab;
        return (
          <button
            key={t.id}
            type="button"
            onClick={() => onTab(t.id)}
            title={t.label}
            aria-label={t.label}
            aria-current={on ? "page" : undefined}
            className={cn(
              "relative flex size-8 cursor-pointer items-center justify-center rounded-xl transition-colors",
              on ? "bg-primary/10 text-primary" : "text-sidebar-foreground/60 hover:bg-primary/10 hover:text-primary"
            )}
          >
            <t.icon className="size-4" />
            {flagged.includes(t.id) && !on && (
              <span className="absolute right-1 top-1 size-1.5 rounded-full bg-primary" />
            )}
          </button>
        );
      })}
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   Rail
   ══════════════════════════════════════════════════════════════════════════ */

export function RightSidebar({
  customerName,
  customerEmail,
  customerPhone,
}: {
  customerName: string | null;
  customerEmail: string | null;
  customerPhone: string | null;
}) {
  const [tab, setTab] = useState<TabId>("extensions");

  /**
   * The thread carries who it belongs to. Switching the rental to a different
   * customer must not leave the last person's messages sitting under the new
   * person's name — so the guard is a render-time derivation rather than an
   * effect, which would show one wrong frame first.
   */
  const [thread, setThread] = useState<{ who: string | null; msgs: Msg[] }>({ who: null, msgs: SEED });
  const msgs = thread.who === customerName ? thread.msgs : SEED;

  const [draft, setDraft] = useState("");

  /** What the operator picked, which is not always what they get. */
  const [wanted, setWanted] = useState<Channel>("chat");
  const reach: Record<Channel, boolean> = { chat: true, sms: !!customerPhone, email: !!customerEmail };
  // A pipe with no address is not a choice. Fall back rather than let a message
  // be composed into a void.
  const channel: Channel = reach[wanted] ? wanted : "chat";

  /**
   * Where a message on each pipe actually goes. It used to be its own line
   * under the channel switch; now it is the composer's placeholder and the
   * channel button's tooltip, which is where the eye already is.
   */
  const destination: Record<Channel, string> = {
    chat: `Message ${firstName(customerName)}…`,
    sms: `Text ${customerPhone}…`,
    email: `Email ${customerEmail}…`,
  };
  const reachTitle = (c: Channel) =>
    !reach[c]
      ? c === "sms"
        ? "No phone number on file"
        : "No email address on file"
      : c === "chat"
        ? "In-app chat"
        : c === "sms"
          ? `SMS to ${customerPhone}`
          : `Email to ${customerEmail}`;

  const scroller = useRef<HTMLDivElement | null>(null);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  // Newest message is the point of the panel — never open scrolled to history.
  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [msgs.length, tab]);

  const send = () => {
    const body = draft.trim();
    if (!body || !customerName) return;

    const id = `m-${Date.now()}`;
    const optimistic: Msg = { id, from: "us", body, day: "Today", time: clock(), channel, delivery: "sending" };
    setThread({ who: customerName, msgs: [...msgs, optimistic] });
    setDraft("");

    // The optimistic → confirmed flip, which is the honest shape of sending
    // anything through Twilio or a mail provider.
    timers.current.push(
      setTimeout(() => {
        setThread((prev) => ({
          ...prev,
          msgs: prev.msgs.map((m): Msg => (m.id === id ? { ...m, delivery: "sent" } : m)),
        }));
      }, 800)
    );
  };

  /**
   * The last word being theirs is the only "needs you" signal this rail has, and
   * it only earns a dot while you are on another tab — flagging the page you are
   * already looking at is noise.
   */
  const unanswered = !!customerName && msgs[msgs.length - 1]?.from === "them";

  return (
    <>
      <TabStrip tab={tab} onTab={setTab} flagged={unanswered ? ["messages"] : []} />

      {/*
       * One column for every tab. Each tab supplies its own scrolling middle
       * and its own pinned part, so nothing in here is special-cased and a
       * long list can never push a control off the bottom of the screen.
       */}
      <div className="flex min-h-0 flex-1 flex-col px-4 pb-3 pt-2">
        {tab === "extensions" ? (
          <ExtensionsTab />
        ) : tab === "activity" ? (
          <ActivityBody who={customerName ?? "the customer"} />
        ) : !customerName ? (
          <NoCustomer />
        ) : (
          <>
            {/* Who, in one line. The full card lived here once and spent 90px
                repeating what the left rail and the page title already say. */}
            <div className="flex shrink-0 items-baseline gap-2 px-1 pb-1">
              <p className="min-w-0 flex-1 truncate text-[13px] font-medium">{customerName}</p>
              <p className="min-w-0 max-w-[50%] truncate text-[11px] text-muted-foreground/70">
                {customerPhone ?? customerEmail ?? "No contact details"}
              </p>
            </div>

            {/* The thread takes every pixel the composer does not. */}
            <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto py-2">
              {msgs.map((m, i) => (
                <Bubble key={m.id} msg={m} prev={msgs[i - 1]} next={msgs[i + 1]} />
              ))}
            </div>

            {/* ── send ─────────────────────────────────────────────────── */}
            <div className="shrink-0 pt-2">
              {/* Three labelled chips fit on one row at 360px, so the pipe
                  says its own name rather than making you hover an icon. */}
              <div className="flex gap-1">
                {CHANNELS.map((c) => (
                  <Chip
                    key={c.id}
                    on={c.id === channel}
                    disabled={!reach[c.id]}
                    title={reachTitle(c.id)}
                    onClick={() => setWanted(c.id)}
                  >
                    <c.icon className="size-3.5 shrink-0" />
                    {c.label}
                  </Chip>
                ))}
              </div>

              {/* One row, always — a wrapped chip row cost more height than the
                  chips save typing. */}
              <div className="mt-1 flex gap-1 overflow-x-auto">
                {QUICK.map((q) => (
                  <Chip key={q.label} onClick={() => setDraft(q.text(firstName(customerName)))}>
                    {q.label}
                  </Chip>
                ))}
              </div>

              <div className="mt-2 flex items-end gap-1.5">
                <textarea
                  rows={1}
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    // Enter sends, Shift+Enter breaks the line — the convention
                    // every operator already has in their fingers.
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      send();
                    }
                  }}
                  placeholder={destination[channel]}
                  className={cn(textareaCls, "min-h-9 rounded-3xl px-3 py-2 text-[13px]")}
                />
                <Button
                  size="icon"
                  className="shrink-0"
                  onClick={send}
                  disabled={!draft.trim()}
                  title={`Send via ${CHANNELS.find((c) => c.id === channel)?.label}`}
                  aria-label="Send"
                >
                  <Send />
                </Button>
              </div>
            </div>
          </>
        )}
      </div>
    </>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   Messages — one bubble
   ══════════════════════════════════════════════════════════════════════════ */

const DELIVERY_ICON: Record<Delivery, React.ReactNode> = {
  sending: <Clock className="size-3" />,
  sent: <Check className="size-3" />,
  read: <CheckCheck className="size-3 text-primary" />,
};

/**
 * Consecutive messages from the same sender on the same pipe are a RUN, and a
 * run carries one meta line, not one per message. That line was costing a full
 * row per bubble to say something that matters occasionally — the thread showed
 * four messages where it now shows eight.
 *
 * The tail corner is squared only on the last bubble of a run, which is what
 * makes a run read as one utterance rather than three.
 */
function Bubble({ msg, prev, next }: { msg: Msg; prev?: Msg; next?: Msg }) {
  const ours = msg.from === "us";
  const newDay = !prev || prev.day !== msg.day;
  const startsRun = newDay || prev.from !== msg.from || prev.channel !== msg.channel;
  const endsRun = !next || next.day !== msg.day || next.from !== msg.from || next.channel !== msg.channel;
  const ChannelIcon = CHANNELS.find((c) => c.id === msg.channel)?.icon ?? MessageSquare;

  return (
    <>
      {/* A day is a word and some air, not a rule across the rail. */}
      {newDay && (
        <p className={cn("mb-2 text-center text-[11px] text-muted-foreground/50", prev && "mt-4")}>{msg.day}</p>
      )}

      <div className={cn("flex flex-col", ours ? "items-end" : "items-start", !newDay && (startsRun ? "mt-2" : "mt-0.5"))}>
        {/*
         * Three signals separate the directions, because one is not enough at
         * 248px: the side it hangs off, the fill, and the squared tail.
         */}
        <div
          className={cn(
            "max-w-[80%] rounded-xl px-3 py-1.5 text-[13px] leading-[1.4]",
            ours ? "bg-primary text-primary-foreground" : "bg-muted/60 text-foreground",
            endsRun && (ours ? "rounded-br-sm" : "rounded-bl-sm")
          )}
        >
          {msg.body}
        </div>

        {/* The pipe and the ticks keep their icons: which channel it went on
            and whether it was read are the two things worth a glance here. */}
        {endsRun && (
          <p className="mt-0.5 flex items-center gap-1 px-1 text-[11px] leading-none text-muted-foreground/60">
            <ChannelIcon className="size-3" />
            <span>{msg.time}</span>
            {ours && msg.delivery && DELIVERY_ICON[msg.delivery]}
          </p>
        )}
      </div>
    </>
  );
}

function NoCustomer() {
  return (
    <div className="shrink-0 rounded-3xl bg-muted/40 px-4 py-5 text-center">
      <p className="text-[13px] font-medium text-muted-foreground">No customer on this rental yet</p>
      <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground/70">
        Pick someone on the Customer tab and their conversation opens here.
      </p>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   Activity
   ══════════════════════════════════════════════════════════════════════════ */

function ActivityBody({ who }: { who: string }) {
  const [filter, setFilter] = useState<EvKind | "all">("all");
  const events = buildEvents(who).filter((e) => filter === "all" || e.kind === filter);

  return (
    <>
      {/* Forty-odd rows is a long way to scroll back to change your mind, so
          the filter is pinned above the list rather than riding inside it. */}
      <div className="flex shrink-0 gap-1 pb-1.5">
        {FILTERS.map((f) => (
          <Chip key={f.id} on={filter === f.id} onClick={() => setFilter(f.id)}>
            {f.label}
          </Chip>
        ))}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {events.length === 0 ? (
          <p className="px-0.5 pt-2 text-[11px] text-muted-foreground">Nothing of that kind on this rental yet.</p>
        ) : (
          events.map((e, i) => (
            <div key={e.id}>
              {(i === 0 || events[i - 1].day !== e.day) && <SectionLabel>{e.day}</SectionLabel>}

              {/* Icon, what, who · when, and money in its own column. The icon
                  is coloured by actor and that is the only colour on a healthy
                  row; a failure turns the icon and the figure destructive. */}
              <div className="flex gap-2.5 py-1.5">
                <e.icon
                  className={cn("mt-0.5 size-3.5 shrink-0", e.bad ? "text-destructive" : ACTOR_ICON[e.actor])}
                />

                <div className="min-w-0 flex-1">
                  <p className="text-[13px] leading-snug">{e.text}</p>
                  <p className="mt-0.5 text-[11px] leading-none text-muted-foreground/60">
                    <span className={cn(e.actor !== "system" && "font-medium text-foreground/70")}>{e.by}</span>
                    {" · "}
                    {e.time}
                  </p>
                </div>

                {e.amount && (
                  <span className={cn("shrink-0 text-[13px] font-medium tabular-nums", e.bad && "text-destructive")}>
                    {e.amount}
                  </span>
                )}
              </div>
            </div>
          ))
        )}
      </div>
    </>
  );
}
