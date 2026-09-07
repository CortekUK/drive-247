"use client";

/**
 * Customer tab of the rental control centre — DESIGN SANDBOX. Nothing is real.
 *
 * No Supabase, no tenant, no auth, no network. Every value is local state over
 * hardcoded demo data, so this can be driven hard without touching a row.
 *
 * The question this tab has to answer, in one screenful, is:
 *
 *     who is this person, and are they safe to hand a car to?
 *
 * Three things answer it, in that order — identity (verification), history
 * (rentals), and what your own staff said afterwards (reviews). Everything else
 * is chrome.
 *
 * The second idea is that a rental usually starts BEFORE the customer record
 * exists: someone rings up, the operator opens a rental, and only then does the
 * customer get asked for their details. So "send them a link and let them fill
 * it in themselves" is not a footnote hidden in a dropdown — it sits directly
 * under the search box as the other half of the same decision, and it carries
 * real state (link created → sent → opened → details in) so the operator can
 * see how far the customer has got without leaving the rental.
 *
 * Grounded in the real product, so the fake states match what exists:
 *   invite         `customer_registration_invites` + `create-customer-invite`
 *                  (7-day link; the customer fills details AND does ID)
 *   verification   `identity_verifications` (review_result GREEN/RED, licence
 *                  and selfie images) + the CMD/Modives licence status, plus
 *                  `customers.identity_verification_status`, which includes
 *                  `manually_verified` — an operator can vouch in person.
 *   reviews        `rental_reviews` (rating 1–10, comment, tags) and
 *                  `customer_review_summaries` (AI paragraph, average, count).
 *
 * Amber is not used anywhere here. In this sandbox amber means "out of date",
 * and nothing on this tab is produced from terms that can drift.
 */

import { useMemo, useState } from "react";
import {
  Search,
  X,
  Link2,
  Copy,
  Check,
  Mail,
  MessageSquare,
  Send,
  ShieldCheck,
  ShieldAlert,
  IdCard,
  Sparkles,
  RefreshCw,
  UserPlus,
  Wallet,
  ChevronDown,
  ChevronUp,
  Image as ImageIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui-v2/button";
import { Badge } from "@/components/ui-v2/badge";
import {
  money,
  fmtDate,
  fmtDateTime,
  Panel,
  Surface,
  Field,
  inputCls,
  Pill,
  Timeline,
  ActionButton,
  EmptyHint,
} from "@/app/playground/_shared";

/* ══════════════════════════════════════════════════════════════════════════
   Shape
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * The six states an identity check can be in. `manual` is not a shortcut — it
 * is `identity_verification_status = 'manually_verified'`, which is what an
 * operator who has held the licence in their hand actually records.
 */
export type VerificationState =
  | "not_started"
  | "link_sent"
  | "in_review"
  | "verified"
  | "manual"
  | "failed";

export type LicenceStatus = "Valid" | "Expired" | "Invalid" | "Pending";

export type SandboxReview = {
  id: string;
  /** 1–10, as `rental_reviews.rating` is. */
  rating: number;
  comment: string;
  tags: string[];
  by: string;
  at: string;
};

export type SandboxCustomer = {
  id: string;
  name: string;
  email: string;
  phone: string;
  /** Kept because the host rail reads it. Mirrors the verification state. */
  verified: boolean;
  rentals: number;
  since: string;
  /** Lifetime, across every settled rental. */
  spend: number;
  /** Still owed right now. Anything above zero is the loudest thing in the row. */
  balance: number;
  /** How an operator actually recognises a returning face. */
  lastRental: { at: string; vehicle: string } | null;
  /** `portal` = they can log in and see their own rentals. `guest` = we hold the record for them. */
  account: "portal" | "guest";
  licence: { number: string; status: LicenceStatus; expiry: string };
  verification: VerificationState;
  verifiedAt: string | null;
  failReason: string | null;
  summary: string | null;
  summaryAt: string | null;
  reviews: SandboxReview[];
};

/* ══════════════════════════════════════════════════════════════════════════
   Fake roster
   ══════════════════════════════════════════════════════════════════════════ */

export const CUSTOMERS: SandboxCustomer[] = [
  {
    id: "c1",
    name: "Marcus Bell",
    email: "marcus.bell@example.com",
    phone: "+1 305 555 0148",
    verified: true,
    rentals: 4,
    since: "2025-11-02",
    spend: 3240,
    balance: 0,
    lastRental: { at: "2026-07-11", vehicle: "BMW 3 Series" },
    account: "portal",
    licence: { number: "B4419-KT", status: "Valid", expiry: "2029-08-01" },
    verification: "verified",
    verifiedAt: "2026-03-03",
    failReason: null,
    summary:
      "Dependable repeat renter across four completed rentals. Staff note clean returns and proactive communication; the one lower score is a late handover he flagged the night before. No damage, disputes or failed payments on record.",
    summaryAt: "2026-07-13",
    reviews: [
      {
        id: "r1",
        rating: 9,
        comment: "Returned a day early and spotless. Sent photos of the interior without being asked.",
        tags: ["Clean return", "Communicative"],
        by: "Dani R.",
        at: "2026-07-12",
      },
      {
        id: "r2",
        rating: 6,
        comment: "Twenty minutes late to the handover, but told us the night before.",
        tags: ["Late return"],
        by: "Femi O.",
        at: "2026-05-22",
      },
      {
        id: "r3",
        rating: 10,
        comment: "Ideal renter. Would hand over the keys unsupervised.",
        tags: ["Trusted", "Repeat renter"],
        by: "Dani R.",
        at: "2026-03-17",
      },
    ],
  },
  {
    id: "c2",
    name: "Dana Whitfield",
    email: "dana.w@example.com",
    phone: "+1 312 555 0192",
    verified: false,
    rentals: 0,
    since: "2026-09-01",
    spend: 0,
    balance: 0,
    lastRental: null,
    account: "guest",
    licence: { number: "—", status: "Pending", expiry: "" },
    verification: "not_started",
    verifiedAt: null,
    failReason: null,
    summary: null,
    summaryAt: null,
    reviews: [],
  },
  {
    id: "c3",
    name: "Priya Raman",
    email: "priya.raman@example.com",
    phone: "+1 646 555 0110",
    verified: true,
    rentals: 11,
    since: "2024-06-14",
    spend: 12480,
    balance: 0,
    lastRental: { at: "2026-08-18", vehicle: "Tesla Model 3" },
    account: "portal",
    licence: { number: "R7730-NY", status: "Valid", expiry: "2031-02-19" },
    verification: "verified",
    verifiedAt: "2024-06-15",
    failReason: null,
    summary:
      "Your most frequent renter and the highest rated. Eleven rentals, no incidents, always returns fuelled and on time. Two staff separately describe her as the customer they would give a car to at short notice.",
    summaryAt: "2026-08-20",
    reviews: [
      {
        id: "r4",
        rating: 10,
        comment: "Eleventh rental, eleventh clean return. Nothing to report, which is the point.",
        tags: ["Trusted", "Repeat renter", "Clean return"],
        by: "Femi O.",
        at: "2026-08-19",
      },
      {
        id: "r5",
        rating: 9,
        comment: "Returned fuelled and swept out. Asked about a monthly rate.",
        tags: ["Clean return"],
        by: "Dani R.",
        at: "2026-06-04",
      },
      {
        id: "r6",
        rating: 10,
        comment: "Handled a flat tyre herself and sent the receipt. Reimbursed the same day.",
        tags: ["Trusted", "Communicative"],
        by: "Sam K.",
        at: "2026-04-11",
      },
      {
        id: "r7",
        rating: 8,
        comment: "Extended twice mid-rental, paid both extensions straight away.",
        tags: ["Repeat renter"],
        by: "Femi O.",
        at: "2026-01-28",
      },
    ],
  },
  {
    id: "c4",
    name: "Tomas Vega",
    email: "t.vega@example.com",
    phone: "+1 702 555 0175",
    verified: true,
    rentals: 2,
    since: "2026-02-08",
    spend: 1120,
    // The cleaning fee and the excess from the review below, never settled.
    balance: 385,
    lastRental: { at: "2026-07-29", vehicle: "Ford Transit" },
    account: "portal",
    licence: { number: "V2085-NV", status: "Valid", expiry: "2027-11-30" },
    verification: "verified",
    verifiedAt: "2026-02-09",
    failReason: null,
    summary:
      "Two rentals, and the second one went badly: returned three days late with cigarette smoke through the cabin and a scuffed rear bumper. Verified identity and the money was recovered, but staff have asked to be told before he books again.",
    summaryAt: "2026-08-02",
    reviews: [
      {
        id: "r8",
        rating: 3,
        comment: "Three days over, smelled of smoke, bumper scuffed. Charged the cleaning fee and the excess.",
        tags: ["Late return", "Smoking", "Damage"],
        by: "Sam K.",
        at: "2026-08-01",
      },
      {
        id: "r9",
        rating: 7,
        comment: "First rental was fine. Slightly late back, no damage.",
        tags: ["Late return"],
        by: "Dani R.",
        at: "2026-02-24",
      },
    ],
  },
  {
    id: "c5",
    name: "Rhea Delgado",
    email: "rhea.delgado@example.com",
    phone: "+1 415 555 0133",
    verified: false,
    rentals: 1,
    since: "2026-05-19",
    spend: 240,
    balance: 0,
    lastRental: { at: "2026-05-28", vehicle: "Toyota Corolla" },
    account: "guest",
    licence: { number: "D5512-CA", status: "Expired", expiry: "2026-04-30" },
    verification: "failed",
    verifiedAt: null,
    failReason: "The licence she photographed expired on 30 Apr 2026.",
    summary: null,
    summaryAt: null,
    reviews: [
      {
        id: "r10",
        rating: 8,
        comment: "Straightforward rental, back on time. Licence was still in date then.",
        tags: ["Clean return"],
        by: "Dani R.",
        at: "2026-05-30",
      },
    ],
  },
];

/* ══════════════════════════════════════════════════════════════════════════
   Local chrome — the shared kit covers the rest
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * The canary's nested-block grammar: a list INSIDE a card is a softer, tighter
 * version of the card — one step down the radius ramp, a hairline ring instead
 * of a shadow, on a muted ground so it reads as inset rather than as a second
 * card floating on the first.
 */
const listCls = "overflow-hidden rounded-3xl bg-muted/40 ring-1 ring-foreground/5 divide-y divide-foreground/5";
const insetCls = "rounded-3xl bg-muted/40 ring-1 ring-foreground/5";

function Section({
  title,
  description,
  right,
  children,
}: {
  title?: string;
  description?: string;
  right?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <Surface>
      {(title || right) && (
        <div className="mb-5 flex items-start gap-4">
          <div className="min-w-0 flex-1">
            {title && <h3 className="font-heading text-sm font-semibold">{title}</h3>}
            {description && <p className="mt-1 text-xs text-muted-foreground">{description}</p>}
          </div>
          {right}
        </div>
      )}
      {children}
    </Surface>
  );
}

function StatBlock({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: string }) {
  return (
    <div className={cn(insetCls, "px-4 py-3")}>
      <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className={cn("mt-1 font-heading text-lg font-semibold tracking-tight", tone)}>{value}</p>
      {hint && <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

const initials = (name: string) =>
  name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0])
    .join("")
    .toUpperCase();

const firstName = (name: string) => name.split(" ")[0] || "the customer";

/**
 * A rating is the only thing here allowed to go red. Below 5 out of 10 is a
 * genuine "look at this before you hand over keys", not an out-of-date warning,
 * so it wears `destructive` rather than the amber reserved for drift.
 */
const RATING_TONE = {
  good: { text: "text-success", bar: "bg-success", tile: "bg-success-light text-success" },
  fair: { text: "text-primary", bar: "bg-primary", tile: "bg-primary-light text-primary" },
  poor: { text: "text-destructive", bar: "bg-destructive", tile: "bg-destructive-light text-destructive" },
} as const;

const ratingTone = (n: number) => (n >= 8 ? RATING_TONE.good : n >= 5 ? RATING_TONE.fair : RATING_TONE.poor);

const averageOf = (c: SandboxCustomer) =>
  c.reviews.length ? c.reviews.reduce((s, r) => s + r.rating, 0) / c.reviews.length : null;

function VerifyChip({ state }: { state: VerificationState }) {
  if (state === "failed") {
    return (
      <Badge variant="destructive" className="gap-1.5">
        <ShieldAlert />
        ID check failed
      </Badge>
    );
  }
  const map = {
    not_started: { tone: "neutral" as const, label: "ID not verified", icon: false },
    link_sent: { tone: "primary" as const, label: "ID link sent", icon: false },
    in_review: { tone: "primary" as const, label: "ID in review", icon: false },
    verified: { tone: "success" as const, label: "ID verified", icon: true },
    manual: { tone: "success" as const, label: "Verified in person", icon: true },
  }[state];
  return (
    <Pill tone={map.tone}>
      {map.icon && <ShieldCheck />}
      {map.label}
    </Pill>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   Runtime state
   ══════════════════════════════════════════════════════════════════════════ */

type Channel = "email" | "sms";

type VerifyRuntime = {
  state: VerificationState;
  channel: Channel | null;
  sentAt: string | null;
  decidedAt: string | null;
  reason: string | null;
};

/** How far down the verification timeline a state sits. */
const VERIFY_RANK: Record<VerificationState, number> = {
  not_started: 0,
  link_sent: 1,
  in_review: 2,
  verified: 3,
  manual: 3,
  failed: 3,
};

type InviteState = "idle" | "link" | "sent" | "opened" | "completed";

const INVITE_RANK: Record<InviteState, number> = {
  idle: 0,
  link: 1,
  sent: 2,
  opened: 3,
  completed: 4,
};

/* ══════════════════════════════════════════════════════════════════════════
   The roster row
   ══════════════════════════════════════════════════════════════════════════ */

type RowFlag = { label: string; tone: "danger" | "primary" | "neutral"; icon?: React.ReactNode };

/**
 * What should stop an operator mid-scroll.
 *
 * Money owed leads, and deliberately: an unsettled balance is the one fact on
 * this row that appears NOWHERE else on the rental, and the one thing you would
 * want raised before a second car goes out. It is `destructive`, not amber —
 * amber in this sandbox means "out of date", and an unpaid balance is not stale
 * information, it is a live problem.
 */
function flagsOf(c: SandboxCustomer): RowFlag[] {
  const flags: RowFlag[] = [];
  if (c.balance > 0) flags.push({ label: `Owes ${money(c.balance)}`, tone: "danger", icon: <Wallet /> });
  if (c.licence.status === "Expired" || c.licence.status === "Invalid")
    flags.push({ label: `Licence ${c.licence.status.toLowerCase()}`, tone: "danger", icon: <IdCard /> });
  if (c.rentals === 0) flags.push({ label: "Never rented with you", tone: "primary" });
  if (c.account === "guest") flags.push({ label: "Guest — no login", tone: "neutral" });
  return flags;
}

/**
 * A roster row, not a profile card. Four zones, always in the same place, so
 * the eye can run down a column instead of reading each row: initials, who they
 * are, what they are worth, and the rating pulled out to the right where it
 * carries the most weight. A returning renter with eleven rentals and a 9.3
 * cannot be mistaken for a new name with a failed check.
 *
 * Built as its own row rather than on `OptionCard` — the shared tile has one
 * text column and cannot hold a right-hand rating or a flag strip — but it
 * wears exactly the same surface, so it stays in the family.
 */
function CustomerRow({
  customer: c,
  state,
  selected,
  onClick,
}: {
  customer: SandboxCustomer;
  state: VerificationState;
  selected: boolean;
  onClick: () => void;
}) {
  const avg = averageOf(c);
  const tone = avg === null ? null : ratingTone(avg);
  const flags = flagsOf(c);
  const blocked = flags.some((f) => f.tone === "danger") || state === "failed";

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex w-full cursor-pointer items-start gap-4 rounded-4xl px-5 py-4 text-left transition-all",
        selected
          ? "bg-primary-light ring-2 ring-primary/40"
          : "bg-card shadow-md ring-1 ring-foreground/5 hover:ring-primary/30 dark:ring-foreground/10"
      )}
    >
      <span
        className={cn(
          "flex size-11 shrink-0 items-center justify-center rounded-3xl font-heading text-sm font-semibold",
          blocked ? "bg-destructive-light text-destructive" : selected ? "bg-card text-primary" : "bg-muted text-foreground/70"
        )}
      >
        {initials(c.name)}
      </span>

      <span className="min-w-0 flex-1">
        <span className="block truncate font-heading text-sm font-medium">{c.name}</span>
        <span className="mt-0.5 block truncate text-xs text-muted-foreground">
          {c.email} · {c.phone}
        </span>

        <span className="mt-2 block truncate text-xs text-muted-foreground">
          {c.rentals === 0
            ? `No rentals yet · joined ${fmtDate(c.since)}`
            : `${c.rentals} rental${c.rentals === 1 ? "" : "s"} · ${money(c.spend)} lifetime`}
          {c.lastRental && ` · last out ${fmtDate(c.lastRental.at)}, ${c.lastRental.vehicle}`}
        </span>

        <span className="mt-2.5 flex flex-wrap items-center gap-1.5">
          <VerifyChip state={state} />
          {flags.map((f) =>
            f.tone === "danger" ? (
              <Badge key={f.label} variant="destructive" className="gap-1.5">
                {f.icon}
                {f.label}
              </Badge>
            ) : (
              <Pill key={f.label} tone={f.tone === "primary" ? "primary" : "neutral"}>
                {f.label}
              </Pill>
            )
          )}
        </span>
      </span>

      <span className="flex shrink-0 flex-col items-end gap-0.5 pl-1 pt-0.5">
        {avg === null ? (
          <>
            <span className="font-heading text-xl font-semibold leading-none text-muted-foreground/40">—</span>
            <span className="text-[11px] text-muted-foreground">No reviews</span>
          </>
        ) : (
          <>
            <span className="flex items-baseline gap-0.5">
              <span className={cn("font-heading text-xl font-semibold leading-none", tone?.text)}>
                {avg.toFixed(1)}
              </span>
              <span className="text-[11px] text-muted-foreground">/ 10</span>
            </span>
            <span className="text-[11px] text-muted-foreground">
              {c.reviews.length} review{c.reviews.length === 1 ? "" : "s"}
            </span>
          </>
        )}
      </span>
    </button>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   The tab
   ══════════════════════════════════════════════════════════════════════════ */

export function CustomerTab({
  selectedId,
  onSelect,
}: {
  selectedId: string | null;
  onSelect: (id: string | null) => void;
}) {
  /** The roster grows: a completed invite is a customer who did not exist. */
  const [roster, setRoster] = useState<SandboxCustomer[]>(CUSTOMERS);
  const [query, setQuery] = useState("");

  // ── invite ──────────────────────────────────────────────────────────────
  const [invite, setInvite] = useState<InviteState>("idle");
  /** Purely visual: the invite block sits above the roster, so it stays one
   *  line until the operator engages with it and the results stay on screen. */
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteToken, setInviteToken] = useState("");
  const [inviteCreatedAt, setInviteCreatedAt] = useState<Date | null>(null);
  const [inviteSentAt, setInviteSentAt] = useState<Date | null>(null);
  const [inviteChannel, setInviteChannel] = useState<Channel | null>(null);
  const [inviteName, setInviteName] = useState("");
  const [inviteTo, setInviteTo] = useState("");
  const [copied, setCopied] = useState(false);
  const [invitedId, setInvitedId] = useState<string | null>(null);

  // ── verification, keyed by customer so switching back keeps the state ───
  const [runtime, setRuntime] = useState<Record<string, VerifyRuntime>>({});

  const customer = roster.find((c) => c.id === selectedId) ?? null;

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return roster;
    return roster.filter((c) => `${c.name} ${c.email} ${c.phone}`.toLowerCase().includes(q));
  }, [roster, query]);

  const runtimeOf = (c: SandboxCustomer): VerifyRuntime =>
    runtime[c.id] ?? {
      state: c.verification,
      channel: null,
      sentAt: null,
      decidedAt: c.verifiedAt ? fmtDate(c.verifiedAt) : null,
      reason: c.failReason,
    };

  const patchVerify = (c: SandboxCustomer, next: Partial<VerifyRuntime>) => {
    const base = runtimeOf(c);
    setRuntime((prev) => ({ ...prev, [c.id]: { ...base, ...next } }));
  };

  const stamp = () => fmtDateTime(new Date());

  const sendVerification = (c: SandboxCustomer, channel: Channel) =>
    patchVerify(c, { state: "link_sent", channel, sentAt: stamp(), decidedAt: null, reason: null });

  const markManual = (c: SandboxCustomer) =>
    patchVerify(c, { state: "manual", decidedAt: stamp(), reason: null });

  /* ── invite actions ─────────────────────────────────────────────────── */

  const inviteUrl = `northwind.drive-247.com/register/${inviteToken}`;

  const createLink = () => {
    setInviteToken(`inv_${Math.random().toString(36).slice(2, 10)}`);
    setInviteCreatedAt(new Date());
    setInvite("link");
    setCopied(false);
  };

  const copyLink = () => {
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
    navigator.clipboard?.writeText(`https://${inviteUrl}`).catch(() => undefined);
  };

  const sendInvite = (channel: Channel) => {
    setInviteChannel(channel);
    setInviteSentAt(new Date());
    setInvite("sent");
  };

  const completeInvite = () => {
    const viaEmail = inviteTo.includes("@");
    const id = `c-inv-${Math.random().toString(36).slice(2, 7)}`;
    const created: SandboxCustomer = {
      id,
      name: inviteName.trim() || "New customer",
      email: viaEmail ? inviteTo.trim() : "—",
      phone: viaEmail ? "—" : inviteTo.trim() || "—",
      verified: false,
      rentals: 0,
      since: new Date().toISOString().slice(0, 10),
      spend: 0,
      balance: 0,
      lastRental: null,
      // They registered through the link, so they can log in from the off.
      account: "portal",
      licence: { number: "—", status: "Pending", expiry: "" },
      // The invite link collects details AND runs the ID check, so a completed
      // invite lands with the verdict still pending — not with nothing.
      verification: "in_review",
      verifiedAt: null,
      failReason: null,
      summary: null,
      summaryAt: null,
      reviews: [],
    };
    setRoster((prev) => [created, ...prev]);
    setInvitedId(id);
    setInvite("completed");
  };

  const emailOk = inviteTo.includes("@") && inviteTo.trim().length > 3;
  const smsOk = inviteTo.replace(/\D/g, "").length >= 7;

  /* ══════════════════════════════════════════════════════════════════════
     Search view — no customer on the rental yet
     ══════════════════════════════════════════════════════════════════════ */

  if (!customer) {
    const inviteHeadline = {
      idle: "Not in the list?",
      link: "Details link ready",
      sent: "Details link sent",
      opened: "They opened the link",
      completed: "Details received",
    }[invite];

    const inviteSub = {
      idle: "Send a link and they fill in their own details and ID themselves.",
      link: "Copy it into whatever you are already using to talk to them, or have it sent.",
      sent: `Sent by ${inviteChannel === "sms" ? "SMS" : "email"} to ${inviteTo.trim()} · waiting for them.`,
      opened: "They have the form open. Nothing submitted yet.",
      completed: "They are in your customers now — put them on this rental.",
    }[invite];

    return (
      <Panel
        title="Customer"
        description="Who is renting. Everything else on this rental is addressed to them — so this is the one thing worth getting right first."
      >
        <div>
          <div className="relative">
            <Search className="pointer-events-none absolute left-4 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by name, email or phone"
              className={cn(inputCls, "h-11 pl-11 pr-11")}
            />
            {query && (
              <button
                type="button"
                onClick={() => setQuery("")}
                aria-label="Clear search"
                className="absolute right-3.5 top-1/2 flex size-6 -translate-y-1/2 cursor-pointer items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                <X className="size-3.5" />
              </button>
            )}
          </div>

          <p className="mt-2 px-1.5 text-xs text-muted-foreground">
            {query
              ? `${matches.length} of ${roster.length} customers match “${query.trim()}”`
              : `${roster.length} customers · newest first`}
          </p>

          {/* ── the other half of the same decision ──────────────────────────
              It belongs HERE, under the search box, not under the roster: the
              moment a name is not in the list, the very next thing you want is
              the link. So it is one quiet line until you engage with it, and
              only then does it grow — the results never leave the screen. */}
          <div
            className={cn(
              "mt-3 rounded-4xl bg-muted/40 ring-1 ring-foreground/5 transition-all",
              inviteOpen && invite !== "idle" ? "px-5 py-4" : "px-4 py-2.5"
            )}
          >
            <div className="flex items-center gap-3">
              <span className="flex size-8 shrink-0 items-center justify-center rounded-2xl bg-primary-light text-primary">
                <UserPlus className="size-4" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[13px] font-medium">{inviteHeadline}</span>
                <span className="block truncate text-xs text-muted-foreground">{inviteSub}</span>
              </span>

              {invite === "idle" ? (
                <Button
                  size="sm"
                  onClick={() => {
                    createLink();
                    setInviteOpen(true);
                  }}
                >
                  <Link2 />
                  Create a link
                </Button>
              ) : (
                <>
                  {invite === "completed" ? (
                    <Pill tone="success">
                      <Check />
                      Done
                    </Pill>
                  ) : (
                    <Pill tone="primary">
                      {invite === "link" ? "Ready" : invite === "sent" ? "Sent" : "Opened"}
                    </Pill>
                  )}
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={inviteOpen ? "Collapse the details link" : "Expand the details link"}
                    onClick={() => setInviteOpen((o) => !o)}
                  >
                    {inviteOpen ? <ChevronUp /> : <ChevronDown />}
                  </Button>
                </>
              )}
            </div>

            {inviteOpen && invite !== "idle" && (
              <div className="mt-4">
                <div className="flex items-center gap-3 rounded-3xl bg-card px-4 py-3 ring-1 ring-foreground/5">
                  <Link2 className="size-4 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1 truncate font-mono text-xs text-foreground/80">{inviteUrl}</span>
                  <Button variant="outline" size="sm" onClick={copyLink}>
                    {copied ? <Check /> : <Copy />}
                    {copied ? "Copied" : "Copy"}
                  </Button>
                </div>
                <p className="mt-2 text-xs text-muted-foreground">
                  Created {inviteCreatedAt ? fmtDateTime(inviteCreatedAt) : "just now"} · expires in 7 days
                </p>

                {invite !== "completed" && (
                  <>
                    <div className="mt-5 grid gap-4 sm:grid-cols-2">
                      <Field label="Their name" hint="Optional — they can correct it themselves.">
                        <input
                          value={inviteName}
                          onChange={(e) => setInviteName(e.target.value)}
                          placeholder="Dana Whitfield"
                          className={cn(inputCls, "bg-card")}
                        />
                      </Field>
                      <Field label="Send it to" hint="An email address or a mobile number.">
                        <input
                          value={inviteTo}
                          onChange={(e) => setInviteTo(e.target.value)}
                          placeholder="dana.w@example.com"
                          className={cn(inputCls, "bg-card")}
                        />
                      </Field>
                    </div>

                    <div className="mt-5 flex flex-wrap gap-2">
                      <ActionButton onClick={() => sendInvite("email")} disabled={!emailOk}>
                        <Mail className="size-4" />
                        {invite === "link" ? "Send by email" : "Resend by email"}
                      </ActionButton>
                      <ActionButton variant="outline" onClick={() => sendInvite("sms")} disabled={!smsOk}>
                        <MessageSquare className="size-4" />
                        {invite === "link" ? "Send by SMS" : "Resend by SMS"}
                      </ActionButton>
                    </div>
                  </>
                )}

                <div className="mt-6">
                  <Timeline
                    steps={[
                      {
                        label: "Link created",
                        at: inviteCreatedAt ? fmtDateTime(inviteCreatedAt) : undefined,
                        done: true,
                      },
                      {
                        label: inviteChannel
                          ? `Sent by ${inviteChannel === "email" ? "email" : "SMS"} to ${inviteTo.trim()}`
                          : "Sent to the customer",
                        at: inviteSentAt ? fmtDateTime(inviteSentAt) : undefined,
                        done: INVITE_RANK[invite] >= 2,
                      },
                      { label: "Opened the link", done: INVITE_RANK[invite] >= 3 },
                      { label: "Details and ID submitted", done: invite === "completed" },
                    ]}
                  />
                </div>

                <div className="mt-6 flex flex-wrap gap-2">
                  {invite === "sent" && (
                    <ActionButton variant="outline" onClick={() => setInvite("opened")}>
                      Simulate: customer opens it
                    </ActionButton>
                  )}
                  {invite === "opened" && (
                    <ActionButton variant="outline" onClick={completeInvite}>
                      Simulate: customer submits
                    </ActionButton>
                  )}
                  {invite === "completed" && invitedId && (
                    <ActionButton onClick={() => onSelect(invitedId)}>
                      <Check className="size-4" />
                      Put them on this rental
                    </ActionButton>
                  )}
                </div>

                {invite === "completed" && (
                  <p className="mt-4 text-xs text-muted-foreground">
                    Their record sits at the top of the list below. The ID check they started is still running — you
                    will see the verdict once they are on the rental.
                  </p>
                )}
              </div>
            )}
          </div>
        </div>

        {matches.length === 0 ? (
          <EmptyHint>
            Nobody matches “{query.trim()}”. If they are new, use the link above and let them fill their own details
            in.
          </EmptyHint>
        ) : (
          <div className="space-y-2">
            {matches.map((c) => (
              <CustomerRow
                key={c.id}
                customer={c}
                state={runtimeOf(c).state}
                selected={selectedId === c.id}
                onClick={() => onSelect(c.id)}
              />
            ))}
          </div>
        )}

        <p className="text-xs text-muted-foreground">
          Pick anyone. You can change this later — the agreement will notice and offer to re-issue itself.
        </p>
      </Panel>
    );
  }

  /* ══════════════════════════════════════════════════════════════════════
     Selected view — who is this person, and are they safe to rent to
     ══════════════════════════════════════════════════════════════════════ */

  const rt = runtimeOf(customer);
  const rank = VERIFY_RANK[rt.state];
  const avg = averageOf(customer);
  const tone = avg === null ? null : ratingTone(avg);

  const tagCounts = (() => {
    const counted = new Map<string, number>();
    customer.reviews.forEach((r) => r.tags.forEach((t) => counted.set(t, (counted.get(t) ?? 0) + 1)));
    return [...counted.entries()].sort((a, b) => b[1] - a[1]);
  })();

  const verifyTile =
    rt.state === "failed"
      ? "bg-destructive-light text-destructive"
      : rt.state === "verified" || rt.state === "manual"
        ? "bg-success-light text-success"
        : rt.state === "not_started"
          ? "bg-muted text-muted-foreground"
          : "bg-primary-light text-primary";

  const verifyHeadline = {
    not_started: "Not verified",
    link_sent: "Link sent, waiting on them",
    in_review: "Documents in, check running",
    verified: "Identity confirmed",
    manual: "Verified in person",
    failed: "The check did not pass",
  }[rt.state];

  const verifyBlurb = {
    not_started: `Nothing has been checked. Send ${firstName(customer.name)} a link and they photograph their licence and their own face.`,
    link_sent: `Sent ${rt.sentAt ?? "just now"}${rt.channel === "sms" ? " by SMS" : " by email"}. Nothing to do until they open it.`,
    in_review: `${firstName(customer.name)} submitted a licence and a selfie. The result usually lands within a minute.`,
    verified: `Passed ${rt.decidedAt ?? "earlier"} · licence ${customer.licence.number}, ${customer.licence.status.toLowerCase()}${
      customer.licence.expiry ? ` to ${fmtDate(customer.licence.expiry)}` : ""
    }.`,
    manual: `An operator confirmed the licence face to face${rt.decidedAt ? ` on ${rt.decidedAt}` : ""}. No document is on file, so this one rests on your word.`,
    failed: `${rt.reason ?? "The document did not match."} Nothing here blocks the rental — but it goes out with no verified identity behind it.`,
  }[rt.state];

  const verifySteps =
    rt.state === "manual"
      ? [{ label: "Confirmed in person by an operator", at: rt.decidedAt ?? undefined, done: true }]
      : [
          {
            label: rt.channel === "sms" ? "Verification link sent by SMS" : "Verification link sent by email",
            at: rt.sentAt ?? undefined,
            done: rank >= 1,
          },
          { label: "Licence and selfie submitted", done: rank >= 2 },
          {
            label: rt.state === "failed" ? "Check failed" : "Identity confirmed",
            at: rt.decidedAt ?? undefined,
            done: rank >= 3,
          },
        ];

  return (
    <Panel
      title="Customer"
      description="Who is renting. Everything else on this rental is addressed to them."
    >
      {/* ── who ─────────────────────────────────────────────────────────── */}
      <Surface>
        <div className="flex items-start gap-4">
          <span className="flex size-12 shrink-0 items-center justify-center rounded-3xl bg-primary-light font-heading text-sm font-semibold text-primary">
            {initials(customer.name)}
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="font-heading text-lg font-semibold tracking-tight">{customer.name}</h3>
              <VerifyChip state={rt.state} />
            </div>
            <p className="mt-1 truncate text-sm text-muted-foreground">
              {customer.email} · {customer.phone}
            </p>
            <p className="mt-0.5 text-xs text-muted-foreground">Customer since {fmtDate(customer.since)}</p>
          </div>
          <Button variant="outline" size="sm" onClick={() => onSelect(null)}>
            <RefreshCw />
            Change
          </Button>
        </div>

        <div className="mt-5 grid gap-2 sm:grid-cols-3">
          <StatBlock
            label="Rentals"
            value={String(customer.rentals)}
            hint={customer.rentals === 0 ? "First time with you" : "Completed with you"}
          />
          <StatBlock
            label="Staff rating"
            value={avg === null ? "—" : `${avg.toFixed(1)} / 10`}
            hint={
              customer.reviews.length === 0
                ? "No reviews yet"
                : `${customer.reviews.length} review${customer.reviews.length === 1 ? "" : "s"}`
            }
            tone={tone?.text}
          />
          <StatBlock
            label="Licence"
            value={customer.licence.status}
            hint={customer.licence.expiry ? `Expires ${fmtDate(customer.licence.expiry)}` : "Not checked yet"}
          />
        </div>
      </Surface>

      {/* ── verification ────────────────────────────────────────────────── */}
      <Section
        title="Verification"
        description="Whether the person collecting the car is who they say they are."
        right={<VerifyChip state={rt.state} />}
      >
        <div className="flex items-start gap-4">
          <span className={cn("flex size-11 shrink-0 items-center justify-center rounded-3xl", verifyTile)}>
            {rt.state === "failed" ? <ShieldAlert className="size-5" /> : <ShieldCheck className="size-5" />}
          </span>
          <div className="min-w-0 flex-1">
            <p className="font-heading text-sm font-semibold">{verifyHeadline}</p>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{verifyBlurb}</p>
          </div>
        </div>

        {rank >= 2 && rt.state !== "manual" && (
          <>
            <div className="mt-5 grid grid-cols-3 gap-2">
              {["Licence front", "Licence back", "Selfie"].map((l) => (
                <div key={l} className={cn(insetCls, "p-3")}>
                  <div className="flex h-16 items-center justify-center rounded-2xl bg-muted">
                    <ImageIcon className="size-4 text-muted-foreground/50" />
                  </div>
                  <p className="mt-2 text-[11px] text-muted-foreground">{l}</p>
                </div>
              ))}
            </div>
            <p
              className={cn(
                "mt-3 flex items-center gap-1.5 text-xs",
                rt.state === "verified"
                  ? "text-success"
                  : rt.state === "failed"
                    ? "text-destructive"
                    : "text-muted-foreground"
              )}
            >
              <IdCard className="size-3.5" />
              {rt.state === "verified"
                ? "Face match GREEN — the selfie matches the licence photo."
                : rt.state === "failed"
                  ? "Face match RED — the check would not confirm this person."
                  : "Face match running against the licence photo."}
            </p>
          </>
        )}

        <div className="mt-6">
          <Timeline steps={verifySteps} />
        </div>

        <div className="mt-6 flex flex-wrap gap-2">
          {rt.state === "not_started" && (
            <>
              <ActionButton onClick={() => sendVerification(customer, "email")}>
                <Send className="size-4" />
                Send verification link
              </ActionButton>
              <ActionButton variant="outline" onClick={() => sendVerification(customer, "sms")}>
                <MessageSquare className="size-4" />
                Send by SMS
              </ActionButton>
              <ActionButton variant="outline" onClick={() => markManual(customer)}>
                Verified in person
              </ActionButton>
            </>
          )}

          {rt.state === "link_sent" && (
            <>
              <ActionButton variant="outline" onClick={() => sendVerification(customer, rt.channel ?? "email")}>
                <Send className="size-4" />
                Resend
              </ActionButton>
              <ActionButton variant="outline" onClick={() => patchVerify(customer, { state: "in_review" })}>
                Simulate: customer submits
              </ActionButton>
              <ActionButton variant="outline" onClick={() => markManual(customer)}>
                Verified in person
              </ActionButton>
            </>
          )}

          {rt.state === "in_review" && (
            <>
              <ActionButton onClick={() => patchVerify(customer, { state: "verified", decidedAt: stamp(), reason: null })}>
                Simulate: check passes
              </ActionButton>
              <ActionButton
                variant="outline"
                onClick={() =>
                  patchVerify(customer, {
                    state: "failed",
                    decidedAt: stamp(),
                    reason: "The selfie did not match the licence photo.",
                  })
                }
              >
                Simulate: check fails
              </ActionButton>
            </>
          )}

          {(rt.state === "verified" || rt.state === "manual") && (
            <ActionButton
              variant="outline"
              onClick={() =>
                patchVerify(customer, { state: "not_started", channel: null, sentAt: null, decidedAt: null, reason: null })
              }
            >
              <RefreshCw className="size-4" />
              Run it again
            </ActionButton>
          )}

          {rt.state === "failed" && (
            <>
              <ActionButton onClick={() => sendVerification(customer, "email")}>
                <Send className="size-4" />
                Send a new link
              </ActionButton>
              <ActionButton variant="outline" onClick={() => markManual(customer)}>
                Verified in person
              </ActionButton>
            </>
          )}
        </div>
      </Section>

      {/* ── reviews ─────────────────────────────────────────────────────── */}
      {customer.reviews.length === 0 ? (
        <Section title="Reviews" description="What your own staff said after each rental. Never shown to the customer.">
          <EmptyHint>
            Nobody has rated {firstName(customer.name)} yet. This rental would be the first — and the one that starts
            the average.
          </EmptyHint>
        </Section>
      ) : (
        <>
          <Section
            title="Reviews"
            description="What your own staff said after each rental. Never shown to the customer, never on the booking site."
            right={
              <Pill tone="neutral">
                {customer.reviews.length} review{customer.reviews.length === 1 ? "" : "s"}
              </Pill>
            }
          >
            <div className="flex items-end gap-4">
              <p className={cn("font-heading text-4xl font-semibold leading-none tracking-tight", tone?.text)}>
                {avg?.toFixed(1)}
              </p>
              <div className="min-w-0 flex-1 pb-1">
                <p className="text-xs text-muted-foreground">
                  out of 10, across {customer.reviews.length} rental{customer.reviews.length === 1 ? "" : "s"}
                </p>
                <span className="mt-2 flex gap-1">
                  {Array.from({ length: 10 }, (_, i) => (
                    <span
                      key={i}
                      className={cn(
                        "h-1.5 flex-1 rounded-full",
                        avg !== null && i < Math.round(avg) ? tone?.bar : "bg-foreground/10"
                      )}
                    />
                  ))}
                </span>
              </div>
            </div>

            {tagCounts.length > 0 && (
              <div className="mt-5 flex flex-wrap gap-1.5">
                {tagCounts.map(([tag, n]) => (
                  <Pill key={tag} tone="neutral">
                    {tag}
                    {n > 1 ? ` ×${n}` : ""}
                  </Pill>
                ))}
              </div>
            )}

            {customer.summary ? (
              <div className={cn(insetCls, "mt-5 px-5 py-4")}>
                <div className="mb-2 flex items-center gap-2">
                  <Sparkles className="size-3.5 text-primary" />
                  <span className="text-xs font-medium">Summary</span>
                  <Pill tone="primary">Written for you</Pill>
                </div>
                <p className="text-sm leading-relaxed text-muted-foreground">{customer.summary}</p>
                <p className="mt-3 text-[11px] text-muted-foreground">
                  From all {customer.reviews.length} reviews · {fmtDate(customer.summaryAt ?? "")}
                </p>
              </div>
            ) : (
              <p className="mt-5 text-xs text-muted-foreground">
                Too few reviews to summarise yet — read them below.
              </p>
            )}
          </Section>

          <Section title="Every review">
            <div className={listCls}>
              {customer.reviews.map((r) => (
                <div key={r.id} className="flex gap-4 px-5 py-4">
                  <span
                    className={cn(
                      "flex size-10 shrink-0 items-center justify-center rounded-2xl font-heading text-sm font-semibold",
                      ratingTone(r.rating).tile
                    )}
                  >
                    {r.rating}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm">{r.comment}</p>
                    {r.tags.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {r.tags.map((t) => (
                          <Pill key={t} tone="neutral">
                            {t}
                          </Pill>
                        ))}
                      </div>
                    )}
                    <p className="mt-2 text-xs text-muted-foreground">
                      {r.by} · {fmtDate(r.at)}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </Section>
        </>
      )}
    </Panel>
  );
}
