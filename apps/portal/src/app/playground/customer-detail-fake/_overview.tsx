"use client";

/* ─────────────────────────────────────────────────────────────────────────────
 * Right rail — the customer at a glance. DESIGN SANDBOX, nothing is real.
 *
 * The left rail is the RECORD, split into the areas you work through. The
 * middle is where you work. This rail is neither: it is the one place the whole
 * customer is visible at once, assembled from every panel, and it moves the
 * instant anything in the middle does.
 *
 * It answers one question the panels cannot answer individually — "can I hand
 * this person keys, and if not, what is stopping me?" No single panel knows
 * that. Verification does not know about the balance; Account does not know the
 * licence expired last week. The answer only exists once everything is added up,
 * which is why it lives here rather than being repeated on each tab.
 *
 * Two rules it is built to:
 *
 *   SECONDARY. 12px body, 10px meta, `size-4` icons — the left rail's rhythm,
 *   not the middle column's. One bold thing only: the verdict. If anything else
 *   in here pulls the eye off the middle, it is wrong.
 *
 *   NEVER A THIRD PLACE TO EDIT. Every row is a link to the panel that owns it.
 *   The rail states a conclusion and hands you the tab; it does not offer a
 *   shortcut to change the thing, because then there would be two places to
 *   change it and one of them would eventually disagree.
 * ────────────────────────────────────────────────────────────────────────── */

import { useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  Ban,
  BadgeCheck,
  Car,
  Check,
  CreditCard,
  Gavel,
  Globe,
  IdCard,
  Mail,
  Minus,
  MessageSquare,
  Smartphone,
  Star,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { fmtDate, money } from "@/app/playground/_shared";
import type { Drift } from "@/app/playground/_shared";
import type { CustomerState, TabId } from "./_data";
import { addressOf, dayCount, expiryOf } from "./_bits";
import { ledgerTotals, reviewAverage } from "./_history";

/* ══════════════════════════════════════════════════════════════════════════
   Readiness — the whole point of the rail
   ══════════════════════════════════════════════════════════════════════════ */

export type Check = {
  id: string;
  label: string;
  /** `blocked` is a hard stop, `open` is unfinished, `ok` is satisfied. */
  state: "ok" | "open" | "blocked";
  detail: string;
  /** Where to go to do something about it. */
  tab: TabId;
  /** Required to hand over a car. The other rows are worth knowing, not fatal. */
  required: boolean;
};

export function readinessOf(c: CustomerState, verifyDrift: Drift[]): Check[] {
  const licence = expiryOf(c.licence.expiry);
  const totals = ledgerTotals(c);

  const identityDone =
    !!c.identity.name && !!(c.identity.email || c.identity.phone) && !!c.identity.dob && !!c.identity.street;

  const docExpired = c.docs.filter((d) => expiryOf(d.until).state === "expired").length;
  const docFlagged = c.docs.filter((d) => d.scan.status === "flagged").length;

  const unpaidFines = c.fines.filter((f) => f.status === "Unpaid");
  const reachable = !!c.identity.email || (c.consent.sms && !!c.identity.phone);

  return [
    {
      id: "identity",
      label: "Identity on file",
      state: identityDone ? "ok" : "open",
      detail: identityDone
        ? addressOf(c.identity) || "Complete"
        : "Name, contact, date of birth and address",
      tab: "identity",
      required: true,
    },
    {
      id: "licence",
      label: "Licence in date",
      state: !c.licence.number ? "open" : licence.state === "expired" ? "blocked" : "ok",
      detail: !c.licence.number
        ? "Nothing on file"
        : licence.state === "expired"
          ? `Expired ${fmtDate(c.licence.expiry)}`
          : `${c.licence.state} · ${licence.label.toLowerCase()}`,
      tab: "licence",
      required: true,
    },
    {
      id: "verified",
      label: "Identity verified",
      state: c.ai.state === "passed" ? (verifyDrift.length ? "open" : "ok") : c.ai.state === "declined" ? "blocked" : "open",
      detail: verifyDrift.length
        ? `Verdict is behind ${verifyDrift.length} change${verifyDrift.length === 1 ? "" : "s"}`
        : c.ai.state === "passed"
          ? `Passed ${c.ai.completedAt ? fmtDate(c.ai.completedAt) : "earlier"}`
          : c.ai.state === "declined"
            ? "The provider declined"
            : c.ai.state === "pending"
              ? "Waiting on the provider"
              : "Never run",
      tab: "verification",
      required: true,
    },
    {
      id: "standing",
      label: "Cleared to rent",
      state: c.account.globalBlocks.length || c.account.blockedHere || c.account.status === "Rejected"
        ? "blocked"
        : c.account.status === "Inactive"
          ? "open"
          : "ok",
      detail: c.account.globalBlocks.length
        ? "On the platform blocklist"
        : c.account.blockedHere
          ? "Blocked with you"
          : c.account.status === "Rejected"
            ? "Rejected"
            : c.account.status === "Inactive"
              ? "Account is dormant"
              : "No blocks",
      tab: "account",
      required: true,
    },
    {
      id: "documents",
      label: "Documents in order",
      // `open`, never `blocked`: an expired proof of address is worth chasing,
      // but it does not stop a car going out the way an expired LICENCE does.
      state: docExpired || docFlagged ? "open" : "ok",
      detail: docExpired
        ? `${docExpired} expired`
        : docFlagged
          ? `${docFlagged} flagged by the scanner`
          : c.docs.length
            ? `${c.docs.length} on file`
            : "Nothing uploaded",
      tab: "documents",
      required: false,
    },
    {
      id: "money",
      label: "Nothing owed",
      state: totals.net > 0 || unpaidFines.length ? "open" : "ok",
      detail: totals.net > 0
        ? `${money(totals.net)} outstanding`
        : unpaidFines.length
          ? `${unpaidFines.length} unpaid fine${unpaidFines.length === 1 ? "" : "s"}`
          : totals.credit > 0
            ? `${money(totals.credit)} in credit`
            : "Settled",
      tab: totals.net > 0 ? "money" : unpaidFines.length ? "fines" : "money",
      required: false,
    },
    {
      id: "reach",
      label: "Reachable",
      state: reachable ? "ok" : "open",
      detail: reachable
        ? [c.identity.email && "email", c.consent.sms && c.identity.phone && "SMS"].filter(Boolean).join(" · ")
        : "No permitted channel — they cannot be sent a lockbox code",
      tab: "consent",
      required: false,
    },
  ];
}

/* ══════════════════════════════════════════════════════════════════════════
   Chrome
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * Tints for the moment a value changes, then fades out.
 *
 * The whole claim of this rail is that it moves when the middle column does,
 * and that claim is invisible if the reader happens to be looking at the panel
 * they just typed in. A brief highlight is the cheapest way to make the link
 * between the two columns something you notice once and then trust.
 *
 * Compares on first render without flashing — `prev` starts at the current
 * value, so a fresh mount and a hydration pass are both silent.
 */
function Live({ on, children }: { on: string | number; children: React.ReactNode }) {
  const prev = useRef(on);
  const [hot, setHot] = useState(false);

  useEffect(() => {
    if (prev.current === on) return;
    prev.current = on;
    setHot(true);
    const t = setTimeout(() => setHot(false), 1100);
    return () => clearTimeout(t);
  }, [on]);

  return (
    <span
      className={cn(
        "-mx-1 rounded-md px-1 transition-colors duration-700",
        hot ? "bg-primary/20 duration-100" : "bg-transparent"
      )}
    >
      {children}
    </span>
  );
}

function Group({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="px-4 pt-5">
      <p className="pb-2 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/50">
        {label}
      </p>
      {children}
    </div>
  );
}

/** A quiet label/value line. The value is what moves, so only it is `Live`. */
function Line({
  icon: Icon,
  label,
  value,
  tone,
  onClick,
}: {
  icon?: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  tone?: "muted" | "success" | "warning" | "destructive";
  onClick?: () => void;
}) {
  const tones = {
    muted: "text-muted-foreground",
    success: "text-success",
    warning: "text-warning",
    destructive: "text-destructive",
  } as const;

  const body = (
    <>
      <span className="flex min-w-0 flex-1 items-center gap-2">
        {Icon && <Icon className="size-3.5 shrink-0 text-muted-foreground/60" />}
        <span className="truncate text-[12px] text-muted-foreground">{label}</span>
      </span>
      <span className={cn("shrink-0 text-[12px] font-medium tabular-nums", tone && tones[tone])}>
        <Live on={value}>{value}</Live>
      </span>
    </>
  );

  return onClick ? (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full cursor-pointer items-center gap-3 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-primary/10"
    >
      {body}
    </button>
  ) : (
    <div className="flex items-center gap-3 px-2 py-1.5">{body}</div>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   The rail
   ══════════════════════════════════════════════════════════════════════════ */

const MARK = {
  ok: { icon: Check, cls: "bg-success/15 text-success" },
  open: { icon: Minus, cls: "bg-muted text-muted-foreground" },
  blocked: { icon: X, cls: "bg-destructive/15 text-destructive" },
} as const;

export function Overview({
  c,
  verifyDrift,
  reviewDrift,
  onJump,
}: {
  c: CustomerState;
  verifyDrift: Drift[];
  reviewDrift: Drift[];
  onJump: (t: TabId) => void;
}) {
  const checks = readinessOf(c, verifyDrift);
  const required = checks.filter((k) => k.required);
  /**
   * Only a REQUIRED row can say "cannot rent". An earlier version of this
   * counted every blocked row, so a proof of address that lapsed last month
   * — a row this same rail labels "optional" — reported the customer as
   * unrentable on first load. A verdict that contradicts the word printed
   * beside it is worse than no verdict.
   */
  const blockers = required.filter((k) => k.state === "blocked");
  const openRequired = required.filter((k) => k.state === "open");
  const optionalOpen = checks.filter((k) => !k.required && k.state !== "ok");

  const totals = ledgerTotals(c);
  const avg = reviewAverage(c);
  const settled = c.rentals.filter((r) => r.status !== "Cancelled");
  const lifetime = settled.reduce((s, r) => s + r.total, 0);
  const lastRental = c.rentals[0] ?? null;
  const unpaidFines = c.fines.filter((f) => f.status === "Unpaid");

  /** One verdict, computed from the checks — never chosen, never stored. */
  const verdict = blockers.length
    ? {
        tone: "destructive" as const,
        icon: blockers[0].id === "standing" ? Ban : AlertTriangle,
        word: "Cannot rent",
        why: blockers.map((b) => b.detail).join(" · "),
      }
    : openRequired.length
      ? {
          tone: "warning" as const,
          icon: AlertTriangle,
          word: "Not ready",
          why: `Outstanding: ${openRequired.map((k) => k.label.toLowerCase()).join(", ")}.`,
        }
      : optionalOpen.length
        ? {
            tone: "caution" as const,
            icon: Check,
            word: "Ready, with a caveat",
            why: `Identity, licence and standing check out. ${optionalOpen
              .map((k) => k.detail)
              .join(" · ")}.`,
          }
        : {
            tone: "success" as const,
            icon: BadgeCheck,
            word: "Ready to rent",
            why: "Identity, licence and standing all check out. Nothing outstanding.",
          };

  const verdictCls = {
    destructive: "bg-destructive/[0.07] ring-destructive/20 text-destructive",
    warning: "bg-warning-light/60 ring-warning/25 text-warning",
    // Deliberately the accent, not amber. Amber on this screen means one thing
    // — an output is behind its inputs — and "there is a lapsed document" is
    // not that.
    caution: "bg-primary-light/70 ring-primary/25 text-primary",
    success: "bg-success-light/70 ring-success/25 text-success",
  } as const;

  /** Outputs that are behind the inputs they were built from. */
  const stale = [
    verifyDrift.length && { label: "Verification", tab: "verification" as TabId, n: verifyDrift.length },
    reviewDrift.length && { label: "Review summary", tab: "reviews" as TabId, n: reviewDrift.length },
  ].filter(Boolean) as { label: string; tab: TabId; n: number }[];

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* h-16, the same as the sidebar's back-link row, so the two columns line
          up across the screen rather than being a few pixels out. */}
      <div className="flex h-16 shrink-0 items-center justify-between px-4">
        <p className="text-[13px] font-medium">At a glance</p>
        <p className="text-[11px] text-muted-foreground">
          {required.filter((k) => k.state === "ok").length}/{required.length} ready
        </p>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto pb-6">
        {/* ── the verdict ─────────────────────────────────────────────── */}
        <div className="px-4 pt-1">
          <div className={cn("rounded-3xl px-4 py-3.5 ring-1", verdictCls[verdict.tone])}>
            <p className="flex items-center gap-2 font-heading text-sm font-semibold">
              <verdict.icon className="size-4 shrink-0" />
              <Live on={verdict.word}>{verdict.word}</Live>
            </p>
            {/* Not wrapped in `Live`. The highlight is an inline background, so
                on a sentence that wraps it paints one ragged box per line and
                reads as a rendering fault rather than as a change. The verdict
                WORD above carries the flash for this block; everything else
                that flashes is a single-line value. */}
            <p className="mt-1 text-[11px] leading-relaxed text-foreground/70">{verdict.why}</p>
          </div>
        </div>

        {/* ── the checklist ───────────────────────────────────────────── */}
        <Group label="Before handover">
          <div className="space-y-0.5">
            {checks.map((k) => {
              const m = MARK[k.state];
              return (
                <button
                  key={k.id}
                  type="button"
                  onClick={() => onJump(k.tab)}
                  className="flex w-full cursor-pointer items-start gap-2.5 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-primary/10"
                >
                  <span
                    className={cn(
                      "mt-px flex size-4 shrink-0 items-center justify-center rounded-full",
                      m.cls
                    )}
                  >
                    <m.icon className="size-2.5" strokeWidth={3} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5">
                      <span
                        className={cn(
                          "truncate text-[12px]",
                          k.state === "ok" ? "text-muted-foreground" : "font-medium"
                        )}
                      >
                        {k.label}
                      </span>
                      {!k.required && (
                        <span className="shrink-0 text-[9px] uppercase tracking-wider text-muted-foreground/50">
                          optional
                        </span>
                      )}
                    </span>
                    <span
                      className={cn(
                        "mt-0.5 block truncate text-[11px] leading-tight",
                        k.state === "blocked" ? "text-destructive" : "text-muted-foreground/80"
                      )}
                    >
                      <Live on={k.detail}>{k.detail}</Live>
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        </Group>

        {/* ── out of date ─────────────────────────────────────────────── */}
        {stale.length > 0 && (
          <Group label="Out of date">
            <div className="space-y-0.5">
              {stale.map((s) => (
                <button
                  key={s.label}
                  type="button"
                  onClick={() => onJump(s.tab)}
                  className="flex w-full cursor-pointer items-center gap-2.5 rounded-lg bg-warning-light/50 px-2.5 py-2 text-left transition-colors hover:bg-warning-light"
                >
                  <AlertTriangle className="size-3.5 shrink-0 text-warning" />
                  <span className="min-w-0 flex-1 truncate text-[12px] font-medium">{s.label}</span>
                  <span className="shrink-0 text-[11px] text-warning">
                    {s.n} change{s.n === 1 ? "" : "s"}
                  </span>
                </button>
              ))}
            </div>
          </Group>
        )}

        {/* ── money ───────────────────────────────────────────────────── */}
        <Group label="Money">
          <div className="space-y-0.5">
            <Line
              icon={CreditCard}
              label="Net position"
              value={totals.net > 0 ? `${money(totals.net)} owed` : totals.net < 0 ? `${money(-totals.net)} up` : "Settled"}
              tone={totals.net > 0 ? "warning" : "success"}
              onClick={() => onJump("money")}
            />
            {totals.credit > 0 && (
              <Line
                label="Credit held"
                value={money(totals.credit)}
                tone="muted"
                onClick={() => onJump("money")}
              />
            )}
            <Line
              icon={Gavel}
              label="Fines"
              value={unpaidFines.length ? `${unpaidFines.length} unpaid` : c.fines.length ? "All handled" : "None"}
              tone={unpaidFines.length ? "warning" : "muted"}
              onClick={() => onJump("fines")}
            />
            <Line
              label="Card on file"
              value={c.card ? `${c.card.brand} ••${c.card.last4}` : "None"}
              tone={c.card ? undefined : "muted"}
              onClick={() => onJump("money")}
            />
          </div>
        </Group>

        {/* ── track record ────────────────────────────────────────────── */}
        <Group label="Track record">
          <div className="space-y-0.5">
            <Line
              icon={Car}
              label="Rentals"
              value={c.rentals.length ? `${c.rentals.length} · ${money(lifetime)}` : "None yet"}
              tone={c.rentals.length ? undefined : "muted"}
              onClick={() => onJump("rentals")}
            />
            <Line
              icon={Star}
              label="Staff rating"
              value={c.reviews.length ? `${avg.toFixed(1)} / 10` : "Unrated"}
              tone={c.reviews.length ? (avg >= 8 ? "success" : avg >= 5 ? undefined : "warning") : "muted"}
              onClick={() => onJump("reviews")}
            />
            {lastRental && (
              <Line
                label="Last out"
                value={`${fmtDate(lastRental.start)} · ${dayCount(lastRental.start, lastRental.end)}d`}
                tone="muted"
                onClick={() => onJump("rentals")}
              />
            )}
          </div>
        </Group>

        {/* ── reach ───────────────────────────────────────────────────── */}
        <Group label="How to reach them">
          <div className="space-y-0.5">
            <Line
              icon={Mail}
              label="Email"
              value={c.identity.email ? "Allowed" : "None on file"}
              tone={c.identity.email ? "success" : "muted"}
              onClick={() => onJump("identity")}
            />
            <Line
              icon={MessageSquare}
              label="SMS"
              value={!c.identity.phone ? "No number" : c.consent.sms ? "Allowed" : "No consent"}
              tone={c.consent.sms && c.identity.phone ? "success" : "warning"}
              onClick={() => onJump("consent")}
            />
            <Line
              icon={Smartphone}
              label="WhatsApp"
              value={!c.identity.phone ? "No number" : c.consent.whatsapp ? "Allowed" : "Not opted in"}
              tone={c.consent.whatsapp && c.identity.phone ? "success" : "muted"}
              onClick={() => onJump("consent")}
            />
          </div>
        </Group>

        {/* ── the flags worth carrying everywhere ─────────────────────── */}
        <Group label="Flags">
          <div className="flex flex-wrap gap-1.5 px-2">
            <Flag on={c.licence.isGigDriver} icon={IdCard} label="Gig driver" tone="primary" />
            <Flag on={c.identity.customerType === "Company"} icon={Globe} label="Company" tone="primary" />
            <Flag on={!!c.account.blockedHere} icon={Ban} label="Blocked with you" tone="destructive" />
            <Flag
              on={c.account.globalBlocks.length > 0}
              icon={Globe}
              label="Platform blocklist"
              tone="destructive"
            />
            <Flag on={c.account.status !== "Active"} icon={X} label={c.account.status} tone="destructive" />
            {!c.licence.isGigDriver &&
              c.identity.customerType !== "Company" &&
              !c.account.blockedHere &&
              !c.account.globalBlocks.length &&
              c.account.status === "Active" && (
                <p className="px-0.5 text-[11px] text-muted-foreground">Nothing flagged.</p>
              )}
          </div>
        </Group>
      </div>
    </div>
  );
}

function Flag({
  on,
  icon: Icon,
  label,
  tone,
}: {
  on: boolean;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  tone: "primary" | "destructive";
}) {
  if (!on) return null;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium",
        tone === "destructive" ? "bg-destructive/10 text-destructive" : "bg-primary-light text-primary"
      )}
    >
      <Icon className="size-3" />
      {label}
    </span>
  );
}
