"use client";

/**
 * Payments — every MONEY ACTION on the rental. DESIGN SANDBOX, nothing is real.
 *
 * `_payments-tab.tsx` shows the ledger; this file changes it. It renders the
 * action row that sits in the Panel's pinned footer, and owns every dialog
 * behind it. A dialog opens either from the row or when the surface hands in a
 * `request` from a row (Refund on a payment, Charge on a period); either way
 * confirming produces a NEW `Ledger` through `onChange` and the dialog closes.
 * There is no Save — the confirm button IS the action, and it says what it does.
 *
 * ── Each dialog is one shape ─────────────────────────────────────────────────
 *
 * A title, the fields, ONE preview sentence saying what confirming will do
 * ("Will charge $592.00 to Visa 4242 and mark Extension 5 paid."), a primary
 * button carrying the amount, and Cancel. The sentence is the explanation;
 * there is no paragraph above the fields. What the operator reads is what
 * lands on the ledger, allocations and trail included.
 *
 * ── Decisions taken here ─────────────────────────────────────────────────────
 *
 *   charges list   Charge, Send link, Record and Apply all list EVERY
 *                  outstanding charge with the requested ones pre-ticked. A
 *                  request from a row narrows the default, never the choice —
 *                  "send it for one thing, or tick them all and send it once"
 *                  is the same list either way.
 *   FIFO           money is applied oldest charge first across the ticked ones,
 *                  never beyond what a charge still needs. Anything over sits
 *                  NOT APPLIED, and the preview says so.
 *   refunds        do not touch allocations. The derivations already net
 *                  `refundedCents` out of what is not applied, so refunding an
 *                  overpayment clears it, and refunding a paid period (returned
 *                  early) leaves the period marked paid — as the seed's own $55
 *                  refund does. The preview states which case it is.
 *   links          a live link (created / sent / opened) that shares a charge
 *                  with the new one is expired when the new one is sent, so
 *                  the customer can never pay the same charge twice. Declined
 *                  and expired links are left as the record they are.
 *   deposit        a deduction that takes the last cent held moves the hold to
 *                  `captured`; otherwise it stays `held`. Release needs money
 *                  still held. Both open from the deposit block, which the
 *                  headline jumps to — the footer does not repeat them.
 *   operator       the sandbox has no auth; "Priya" is the operator across the
 *                  playground and is who these actions are recorded by.
 */

import { useState } from "react";
import { CreditCard, Link2, Mail, PenLine, Plus, Smartphone, Undo2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui-v2/button";
import { Checkbox } from "@/components/ui-v2/checkbox";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui-v2/dialog";
import { Field, inputCls, textareaCls } from "@/app/playground/_shared";
import {
  METHOD_WORDS,
  channelWord,
  day,
  heldOn,
  outstandingFor,
  paymentWord,
  remainingOn,
  sum,
  totals,
  unallocatedOn,
  usd,
  type Allocation,
  type Charge,
  type Deposit,
  type Ledger,
  type Payment,
  type PaymentLink,
  type PaymentMethod,
  type Proof,
  type Refund,
} from "./_payments-model";

/* ══════════════════════════════════════════════════════════════════════════
   Contract
   ══════════════════════════════════════════════════════════════════════════ */

export type ActionRequest =
  | { kind: "charge"; chargeIds?: string[] }
  | { kind: "link"; chargeIds?: string[] }
  | { kind: "manual"; chargeIds?: string[] }
  | { kind: "refund"; paymentId: string }
  | { kind: "adhoc" }
  | { kind: "deposit-deduct" }
  | { kind: "deposit-release" }
  | { kind: "allocate"; paymentId: string };

/** The row's own Refund button has no payment in hand — the dialog offers a picker. */
type Open = ActionRequest | { kind: "refund"; paymentId: null };

/* ══════════════════════════════════════════════════════════════════════════
   Money, time, words
   ══════════════════════════════════════════════════════════════════════════ */

const OPERATOR = "Priya";
const FALLBACK_CARD = { brand: "Visa", last4: "4242" };

const toDollars = (c: number) => (c / 100).toFixed(2);
const parseCents = (s: string) => {
  const n = Math.round(Number(s) * 100);
  return Number.isFinite(n) && n > 0 ? n : 0;
};

const pad = (n: number) => String(n).padStart(2, "0");
/** Local time in the seed's own shape, `2026-09-05T14:12:00`. Only ever called on a click. */
const stamp = () => {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
};

const uid = (prefix: string) => `${prefix}_${Math.random().toString(36).slice(2, 8)}`;

const list = (xs: string[]) => (xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);

const METHODS = [
  { id: "cash", label: "Cash" },
  { id: "bank", label: "Bank transfer" },
  { id: "cheque", label: "Cheque" },
  { id: "other", label: "Other" },
] as const satisfies readonly { id: PaymentMethod; label: string }[];

const CHANNELS = [
  { id: "email", label: "Email", icon: Mail },
  { id: "sms", label: "SMS", icon: Smartphone },
] as const;
type Channel = (typeof CHANNELS)[number]["id"];

/* ══════════════════════════════════════════════════════════════════════════
   Reading the ledger
   ══════════════════════════════════════════════════════════════════════════ */

const periodOf = (l: Ledger, c: Charge) => l.segments.find((s) => s.id === c.segmentId)?.label ?? "Not tied to a period";
const describe = (l: Ledger, c: Charge) => `${periodOf(l, c)} · ${c.label}`;
const chargeById = (l: Ledger, id: string) => l.charges.find((c) => c.id === id);

const outstandingIds = (l: Ledger) => l.charges.filter((c) => remainingOn(l, c.id) > 0).map((c) => c.id);

/** The charges a request points at, kept to those that still need money. */
const targetsFor = (l: Ledger, ids?: string[]) => outstandingIds(l).filter((id) => !ids || ids.includes(id));

const refundableOn = (p: Payment) =>
  p.status === "paid" || p.status === "partly_refunded" ? p.amountCents - p.refundedCents : 0;

function cardOnFile(l: Ledger) {
  const seen = [...l.payments].reverse().map((p) => p.proof).find((p): p is Extract<Proof, { source: "card" }> => p.source === "card");
  return seen ? { brand: seen.brand, last4: seen.last4 } : FALLBACK_CARD;
}

/**
 * Where a refund goes, in one phrase. A manual payment has no provider to send
 * it back through — somebody has to move the money — so it says that rather
 * than naming a card that was never charged.
 */
const refundTo = (p: Proof) =>
  p.source === "manual"
    ? `by ${METHOD_WORDS[p.method]} — nothing goes back through the provider`
    : `to ${p.source === "card" ? `${p.brand} ${p.last4}` : "the card that paid the link"} through the provider`;

/** Oldest charge first across the ticked ones, never past what a charge still needs. */
function fifo(l: Ledger, amount: number, ids: Set<string>) {
  let left = amount;
  const allocations: Allocation[] = [];
  for (const c of l.charges) {
    if (left <= 0) break;
    if (!ids.has(c.id)) continue;
    const take = Math.min(left, remainingOn(l, c.id));
    if (take <= 0) continue;
    allocations.push({ chargeId: c.id, amountCents: take });
    left -= take;
  }
  return { allocations, spare: left, applied: amount - left };
}

/**
 * What the allocations do to each period, in words: "mark Extension 5 paid and
 * leave Extension 4 $270.00 outstanding". Reckoned per period because that is
 * how the ladder reports it; an ad-hoc charge is its own line.
 */
function settleWords(l: Ledger, allocations: Allocation[]) {
  const groups = new Map<string, { label: string; owed: number; applied: number }>();
  for (const a of allocations) {
    const c = chargeById(l, a.chargeId);
    if (!c) continue;
    const key = c.segmentId ?? c.id;
    const g = groups.get(key) ?? {
      label: c.segmentId ? periodOf(l, c) : c.label,
      owed: c.segmentId ? outstandingFor(l, c.segmentId) : remainingOn(l, c.id),
      applied: 0,
    };
    g.applied += a.amountCents;
    groups.set(key, g);
  }
  const paid: string[] = [];
  const short: string[] = [];
  for (const g of groups.values()) {
    if (g.applied >= g.owed) paid.push(g.label);
    else short.push(`${g.label} ${usd(g.owed - g.applied)} outstanding`);
  }
  const parts: string[] = [];
  if (paid.length) parts.push(`mark ${list(paid)} paid`);
  if (short.length) parts.push(`leave ${list(short)}`);
  return parts.join(" and ");
}

/* ══════════════════════════════════════════════════════════════════════════
   Dialog vocabulary
   ══════════════════════════════════════════════════════════════════════════ */

/** The one sentence every dialog carries: what confirming will do. */
function Preview({ children }: { children: React.ReactNode }) {
  return <p className="rounded-3xl bg-muted/40 px-4 py-3 text-sm leading-relaxed">{children}</p>;
}

function Actions({
  label,
  onConfirm,
  onCancel,
  disabled,
  destructive,
}: {
  label: string;
  onConfirm: () => void;
  onCancel: () => void;
  disabled?: boolean;
  destructive?: boolean;
}) {
  return (
    <DialogFooter>
      <Button variant="outline" onClick={onCancel}>
        Cancel
      </Button>
      <Button variant={destructive ? "destructive" : "default"} onClick={onConfirm} disabled={disabled}>
        {label}
      </Button>
    </DialogFooter>
  );
}

function AmountField({
  label = "Amount",
  value,
  onChange,
  hint,
}: {
  label?: string;
  value: string;
  onChange: (v: string) => void;
  hint?: string;
}) {
  return (
    <Field label={label} hint={hint}>
      <div className="relative">
        <span className="pointer-events-none absolute inset-y-0 left-3.5 flex items-center text-sm text-muted-foreground">
          $
        </span>
        <input
          type="number"
          min="0"
          step="0.01"
          inputMode="decimal"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className={cn(inputCls, "pl-7 tabular-nums")}
        />
      </div>
    </Field>
  );
}

function Segmented<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (v: T) => void;
  options: readonly { id: T; label: string; icon?: React.ComponentType<{ className?: string }> }[];
}) {
  return (
    <div className="flex h-9 gap-1 rounded-3xl bg-input/50 p-1">
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          onClick={() => onChange(o.id)}
          className={cn(
            "flex flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-3xl px-2 text-xs transition-colors",
            value === o.id ? "bg-primary/10 font-medium text-primary" : "text-muted-foreground hover:bg-primary/10 hover:text-primary"
          )}
        >
          {o.icon && <o.icon className="size-3.5" />}
          {o.label}
        </button>
      ))}
    </div>
  );
}

/**
 * Every outstanding charge, tick the ones this action covers. With `applied`
 * each ticked row also shows the effect — "$270.00 → $0.00" — so the operator
 * sees the reconciliation before it happens, not after.
 */
function ChargePicker({
  ledger,
  picked,
  onToggle,
  applied,
}: {
  ledger: Ledger;
  picked: Set<string>;
  onToggle: (id: string) => void;
  applied?: Map<string, number>;
}) {
  const ids = outstandingIds(ledger);
  return (
    <ul className="divide-y divide-foreground/5 overflow-hidden rounded-3xl bg-muted/40">
      {ids.map((id) => {
        const c = chargeById(ledger, id)!;
        const left = remainingOn(ledger, id);
        const on = picked.has(id);
        const take = applied?.get(id) ?? 0;
        return (
          <li key={id}>
            <label className="flex cursor-pointer items-center gap-3 px-4 py-2.5">
              <Checkbox checked={on} onCheckedChange={() => onToggle(id)} />
              <span className="min-w-0 flex-1">
                <span className={cn("block truncate text-sm", !on && "text-muted-foreground")}>{describe(ledger, c)}</span>
                {left < c.amountCents && (
                  <span className="block text-xs text-muted-foreground tabular-nums">
                    {usd(c.amountCents - left)} of {usd(c.amountCents)} already paid
                  </span>
                )}
              </span>
              {/* The arrow only where something moves. A ticked charge the
                  money never reaches — FIFO ran out before it — showed
                  "$550.00 → $550.00", which reads as an effect and is none. */}
              <span className={cn("shrink-0 text-sm tabular-nums", !on && "text-muted-foreground")}>
                {take > 0 ? (
                  <>
                    {usd(left)} <span className="text-muted-foreground">→ {usd(left - take)}</span>
                  </>
                ) : (
                  usd(left)
                )}
              </span>
            </label>
          </li>
        );
      })}
    </ul>
  );
}

const usePicked = (initial: string[]) => {
  const [picked, setPicked] = useState(() => new Set(initial));
  const toggle = (id: string) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  return [picked, toggle] as const;
};

type DialogProps = { ledger: Ledger; commit: (next: Ledger) => void; cancel: () => void };

/* ══════════════════════════════════════════════════════════════════════════
   1 · Charge the card on file
   ══════════════════════════════════════════════════════════════════════════ */

function ChargeDialog({ ledger, chargeIds, commit, cancel }: DialogProps & { chargeIds?: string[] }) {
  const [picked, toggle] = usePicked(targetsFor(ledger, chargeIds));
  // null = the amount follows the ticks, until the operator types one.
  const [typed, setTyped] = useState<string | null>(null);
  const card = cardOnFile(ledger);

  const owed = sum([...picked].map((id) => remainingOn(ledger, id)));
  const cents = typed === null ? owed : parseCents(typed);
  const { allocations, spare } = fifo(ledger, cents, picked);
  const applied = new Map(allocations.map((a) => [a.chargeId, a.amountCents]));
  const nothing = outstandingIds(ledger).length === 0;
  const settle = settleWords(ledger, allocations);

  const confirm = () => {
    const at = stamp();
    const payment: Payment = {
      id: uid("p"),
      amountCents: cents,
      at,
      status: "paid",
      proof: { source: "card", intentId: uid("pi"), brand: card.brand, last4: card.last4, receiptUrl: "#", by: OPERATOR },
      allocations,
      trail: [{ at, event: `Charged card on file · ${card.brand} ${card.last4} · ${usd(cents)}` }],
      refundedCents: 0,
    };
    commit({ ...ledger, payments: [...ledger.payments, payment] });
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>Charge the card on file</DialogTitle>
      </DialogHeader>

      {nothing ? (
        <Preview>Nothing is outstanding. Add a charge first if you need to take money for something new.</Preview>
      ) : (
        <div className="space-y-5">
          <Field label="Apply to">
            <ChargePicker ledger={ledger} picked={picked} onToggle={toggle} applied={applied} />
          </Field>
          <AmountField value={typed ?? toDollars(owed)} onChange={setTyped} />
          <Preview>
            {cents <= 0
              ? "Enter an amount."
              : `Will charge ${usd(cents)} to ${card.brand} ${card.last4}${settle ? ` and ${settle}` : ""}${
                  spare > 0 ? `, leaving ${usd(spare)} not applied` : ""
                }.`}
          </Preview>
        </div>
      )}

      <Actions label={cents > 0 ? `Charge ${usd(cents)}` : "Charge"} onConfirm={confirm} onCancel={cancel} disabled={nothing || cents <= 0} />
    </>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   2 · Send a payment link
   ══════════════════════════════════════════════════════════════════════════ */

const LIVE = new Set(["created", "sent", "opened"]);

function LinkDialog({
  ledger,
  chargeIds,
  selectedChargeIds,
  commit,
  cancel,
}: DialogProps & { chargeIds?: string[]; selectedChargeIds: string[] }) {
  const [picked, toggle] = usePicked(targetsFor(ledger, chargeIds ?? (selectedChargeIds.length ? selectedChargeIds : undefined)));
  const [channel, setChannel] = useState<Channel>("email");

  const ids = outstandingIds(ledger).filter((id) => picked.has(id));
  const amount = sum(ids.map((id) => remainingOn(ledger, id)));
  const nothing = outstandingIds(ledger).length === 0;

  /** Live links that share a charge with this one; they are expired on send. */
  const live = ledger.links.filter((k) => LIVE.has(k.status) && k.chargeIds.some((id) => picked.has(id)));

  const confirm = () => {
    const at = stamp();
    const link: PaymentLink = {
      id: uid("plink"),
      chargeIds: ids,
      amountCents: amount,
      status: "sent",
      channel,
      createdAt: at,
      sentAt: at,
      trail: [
        { at, event: "Created" },
        { at, event: `Sent by ${channelWord(channel)}` },
      ],
    };
    const links = ledger.links.map((k) =>
      live.includes(k)
        ? { ...k, status: "expired" as const, trail: [...k.trail, { at, event: "Expired — replaced by a new link" }] }
        : k
    );
    commit({ ...ledger, links: [...links, link] });
  };

  const replacing =
    live.length === 0
      ? ""
      : `, replacing the ${list(live.map((k) => `${usd(k.amountCents)} link sent ${day(k.sentAt ?? k.createdAt)}`))}`;

  return (
    <>
      <DialogHeader>
        <DialogTitle>Send a payment link</DialogTitle>
      </DialogHeader>

      {nothing ? (
        <Preview>Nothing is outstanding, so there is nothing to put on a link.</Preview>
      ) : (
        <div className="space-y-5">
          <Field label="The link carries">
            <ChargePicker ledger={ledger} picked={picked} onToggle={toggle} />
          </Field>
          <Field label="Send it by">
            <Segmented value={channel} onChange={setChannel} options={CHANNELS} />
          </Field>
          <Preview>
            {amount <= 0
              ? "Tick at least one charge."
              : `Will send a link for ${usd(amount)} by ${channelWord(channel)} carrying ${
                  ids.length === 1 ? "one charge" : `${ids.length} charges`
                }${replacing}.`}
          </Preview>
        </div>
      )}

      <Actions label={`Send by ${channelWord(channel)}`} onConfirm={confirm} onCancel={cancel} disabled={nothing || amount <= 0} />
    </>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   3 · Record a payment manually
   ══════════════════════════════════════════════════════════════════════════ */

function ManualDialog({ ledger, chargeIds, commit, cancel }: DialogProps & { chargeIds?: string[] }) {
  const [picked, toggle] = usePicked(targetsFor(ledger, chargeIds));
  const [typed, setTyped] = useState<string | null>(null);
  const [method, setMethod] = useState<PaymentMethod>("bank");
  const [date, setDate] = useState(() => stamp().slice(0, 10));
  const [reference, setReference] = useState("");
  const [note, setNote] = useState("");

  const owed = sum([...picked].map((id) => remainingOn(ledger, id)));
  const cents = typed === null ? owed : parseCents(typed);
  const { allocations, spare } = fifo(ledger, cents, picked);
  const applied = new Map(allocations.map((a) => [a.chargeId, a.amountCents]));
  const settle = settleWords(ledger, allocations);
  const hasCharges = outstandingIds(ledger).length > 0;

  const confirm = () => {
    const at = `${date}T${stamp().slice(11)}`;
    const payment: Payment = {
      id: uid("p"),
      amountCents: cents,
      at,
      status: "paid",
      proof: {
        source: "manual",
        method,
        reference: reference.trim() || undefined,
        by: OPERATOR,
        note: note.trim() || undefined,
      },
      allocations,
      trail: [{ at, event: `Recorded by ${OPERATOR} · ${METHOD_WORDS[method]}${reference.trim() ? ` · ${reference.trim()}` : ""}` }],
      refundedCents: 0,
    };
    commit({ ...ledger, payments: [...ledger.payments, payment] });
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>Record a payment</DialogTitle>
      </DialogHeader>

      <div className="space-y-5">
        <div className="grid grid-cols-2 gap-4">
          <AmountField value={typed ?? toDollars(owed)} onChange={setTyped} />
          <Field label="Received on">
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={inputCls} />
          </Field>
        </div>
        <Field label="How">
          <Segmented value={method} onChange={setMethod} options={METHODS} />
        </Field>
        <Field label="Reference">
          <input
            value={reference}
            onChange={(e) => setReference(e.target.value)}
            placeholder="Bank reference or receipt number"
            className={inputCls}
          />
        </Field>
        <Field label="Note">
          <textarea
            rows={2}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Anything the next person needs to know about this money"
            className={textareaCls}
          />
        </Field>
        {hasCharges && (
          <Field label="Apply to">
            <ChargePicker ledger={ledger} picked={picked} onToggle={toggle} applied={applied} />
          </Field>
        )}

        <Preview>
          {cents <= 0
            ? "Enter an amount."
            : `Will record ${usd(cents)} by ${METHOD_WORDS[method]} on ${day(date)}, with no provider record${
                settle ? `, and ${settle}` : ""
              }${spare > 0 ? `, leaving ${usd(spare)} not applied` : ""}.`}
        </Preview>
      </div>

      <Actions label={cents > 0 ? `Record ${usd(cents)}` : "Record"} onConfirm={confirm} onCancel={cancel} disabled={cents <= 0} />
    </>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   4 · Refund
   ══════════════════════════════════════════════════════════════════════════ */

function RefundDialog({ ledger, paymentId, commit, cancel }: DialogProps & { paymentId: string | null }) {
  const refundable = ledger.payments.filter((p) => refundableOn(p) > 0);
  const [pid, setPid] = useState(paymentId ?? refundable[refundable.length - 1]?.id ?? "");
  const [typed, setTyped] = useState<string | null>(null);
  const [reason, setReason] = useState("");

  const payment = ledger.payments.find((p) => p.id === pid);
  const max = payment ? refundableOn(payment) : 0;
  const cents = typed === null ? max : parseCents(typed);
  const manual = payment?.proof.source === "manual";
  const spare = payment ? unallocatedOn(payment) : 0;
  const ok = !!payment && cents > 0 && cents <= max && reason.trim().length > 0;

  const confirm = () => {
    if (!payment) return;
    const at = stamp();
    const refund: Refund = {
      id: uid("r"),
      paymentId: payment.id,
      amountCents: cents,
      at,
      reason: reason.trim(),
      by: OPERATOR,
      ...(manual ? {} : { intentId: uid("re") }),
    };
    const refunded = payment.refundedCents + cents;
    const payments = ledger.payments.map((p) =>
      p.id === payment.id
        ? {
            ...p,
            refundedCents: refunded,
            status: (refunded >= p.amountCents ? "refunded" : "partly_refunded") as Payment["status"],
            trail: [...p.trail, { at, event: `Refunded ${usd(cents)}${manual ? " by hand" : ""} — ${reason.trim()}` }],
          }
        : p
    );
    commit({ ...ledger, payments, refunds: [...ledger.refunds, refund] });
  };

  /** Where the money goes, and what it does to the charges it paid. */
  const preview = () => {
    if (!payment) return "Nothing on this rental can be refunded.";
    if (cents <= 0) return `Enter an amount up to ${usd(max)}.`;
    if (cents > max) return `That is more than the ${usd(max)} still on this payment.`;
    const effect =
      spare >= cents
        ? `it comes out of the ${usd(spare)} on this payment that was never applied`
        : "the charges it paid stay marked paid";
    return `Will refund ${usd(cents)} of ${usd(payment.amountCents)} ${refundTo(payment.proof)}; ${effect}.`;
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>Refund</DialogTitle>
      </DialogHeader>

      {payment ? (
        <div className="space-y-5">
          {paymentId === null ? (
            <Field label="Payment">
              <select value={pid} onChange={(e) => { setPid(e.target.value); setTyped(null); }} className={cn(inputCls, "cursor-pointer")}>
                {refundable.map((p) => (
                  <option key={p.id} value={p.id}>
                    {paymentWord(p)}
                  </option>
                ))}
              </select>
            </Field>
          ) : (
            <Field label="Payment">
              <p className="text-sm">{paymentWord(payment)}</p>
            </Field>
          )}
          <AmountField value={typed ?? toDollars(max)} onChange={setTyped} hint={`Up to ${usd(max)}.`} />
          <Field label="Reason" hint="The customer sees this.">
            <textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} className={textareaCls} />
          </Field>
          <Preview>{preview()}</Preview>
        </div>
      ) : (
        <Preview>{preview()}</Preview>
      )}

      <Actions label={ok ? `Refund ${usd(cents)}` : "Refund"} onConfirm={confirm} onCancel={cancel} disabled={!ok} destructive />
    </>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   5 · Ad-hoc charge — money that comes under no period
   ══════════════════════════════════════════════════════════════════════════ */

function AdhocDialog({ ledger, commit, cancel }: DialogProps) {
  const [typed, setTyped] = useState("");
  const [reason, setReason] = useState("");
  const [detail, setDetail] = useState("");
  const cents = parseCents(typed);
  const ok = cents > 0 && reason.trim().length > 0;
  const t = totals(ledger);

  const confirm = () => {
    const charge: Charge = {
      id: uid("c"),
      segmentId: null,
      kind: "adhoc",
      label: reason.trim(),
      amountCents: cents,
      createdAt: stamp().slice(0, 10),
      note: detail.trim() || undefined,
      by: OPERATOR,
    };
    commit({ ...ledger, charges: [...ledger.charges, charge] });
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>Add a charge</DialogTitle>
      </DialogHeader>

      <div className="space-y-5">
        <AmountField value={typed} onChange={setTyped} />
        <Field label="Reason" hint="The customer sees this.">
          <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Parking fine · 21 Aug, Brickell" className={inputCls} />
        </Field>
        <Field label="Detail">
          <textarea
            rows={2}
            value={detail}
            onChange={(e) => setDetail(e.target.value)}
            placeholder="Where it came from, for whoever picks this up next"
            className={textareaCls}
          />
        </Field>

        <Preview>
          {!ok
            ? "Enter an amount and a reason."
            : `Will add ${usd(cents)} · ${reason.trim()}, tied to no period, taking outstanding from ${usd(t.outstanding)} to ${usd(
                t.outstanding + cents
              )}.`}
        </Preview>
      </div>

      <Actions label={cents > 0 ? `Add ${usd(cents)}` : "Add charge"} onConfirm={confirm} onCancel={cancel} disabled={!ok} />
    </>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   6 · Deposit — deduct
   ══════════════════════════════════════════════════════════════════════════ */

function DeductDialog({ ledger, commit, cancel }: DialogProps) {
  const [typed, setTyped] = useState("");
  const [reason, setReason] = useState("");
  const held = heldOn(ledger.deposit);
  const cents = parseCents(typed);
  const ok = held > 0 && cents > 0 && cents <= held && reason.trim().length > 0;

  const confirm = () => {
    const left = held - cents;
    const deposit: Deposit = {
      ...ledger.deposit,
      status: left === 0 ? "captured" : "held",
      deductions: [...ledger.deposit.deductions, { amountCents: cents, reason: reason.trim(), at: stamp(), by: OPERATOR }],
    };
    commit({ ...ledger, deposit });
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>Deduct from the deposit</DialogTitle>
      </DialogHeader>

      {held > 0 ? (
        <div className="space-y-5">
          <AmountField value={typed} onChange={setTyped} hint={`Up to ${usd(held)}.`} />
          <Field label="Reason" hint="The customer sees this.">
            <textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Interior cleaning — smoke" className={textareaCls} />
          </Field>

          <Preview>
            {cents <= 0
              ? "Enter an amount and a reason."
              : cents > held
                ? `That is more than the ${usd(held)} still held.`
                : `Will capture ${usd(cents)} of the ${usd(held)} still held through the provider, leaving ${
                    held - cents === 0 ? "nothing to release" : `${usd(held - cents)} to release`
                  }.`}
          </Preview>
        </div>
      ) : (
        <Preview>Nothing is held, so there is nothing to deduct from.</Preview>
      )}

      <Actions label={ok ? `Deduct ${usd(cents)}` : "Deduct"} onConfirm={confirm} onCancel={cancel} disabled={!ok} destructive />
    </>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   7 · Deposit — release what remains
   ══════════════════════════════════════════════════════════════════════════ */

function ReleaseDialog({ ledger, commit, cancel }: DialogProps) {
  const d = ledger.deposit;
  const held = heldOn(d);
  const deducted = sum(d.deductions.map((x) => x.amountCents));

  const confirm = () => commit({ ...ledger, deposit: { ...d, status: "released", releasedAt: stamp() } });

  return (
    <>
      <DialogHeader>
        <DialogTitle>Release the deposit</DialogTitle>
      </DialogHeader>

      <Preview>
        {held > 0
          ? `Will drop the ${usd(held)} hold through the provider — nothing is charged${
              deducted > 0 ? `, and the ${usd(deducted)} already deducted stays deducted` : ""
            }.`
          : "Nothing is held, so there is nothing to release."}
      </Preview>

      <Actions label={held > 0 ? `Release ${usd(held)}` : "Release"} onConfirm={confirm} onCancel={cancel} disabled={held <= 0} />
    </>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   8 · Apply money that arrived and was never applied — reconciliation
   ══════════════════════════════════════════════════════════════════════════ */

function AllocateDialog({ ledger, paymentId, commit, cancel }: DialogProps & { paymentId: string }) {
  const payment = ledger.payments.find((p) => p.id === paymentId);
  const spare = payment ? unallocatedOn(payment) : 0;
  const [picked, toggle] = usePicked(outstandingIds(ledger));

  const { allocations, spare: left, applied } = fifo(ledger, spare, picked);
  const effect = new Map(allocations.map((a) => [a.chargeId, a.amountCents]));
  const settle = settleWords(ledger, allocations);
  const nothing = outstandingIds(ledger).length === 0;

  const confirm = () => {
    if (!payment) return;
    const at = stamp();
    const merged = [...payment.allocations];
    for (const a of allocations) {
      const i = merged.findIndex((m) => m.chargeId === a.chargeId);
      if (i >= 0) merged[i] = { ...merged[i], amountCents: merged[i].amountCents + a.amountCents };
      else merged.push(a);
    }
    const trail = allocations.map((a) => ({ at, event: `Applied ${usd(a.amountCents)} to ${describe(ledger, chargeById(ledger, a.chargeId)!)}` }));
    const payments = ledger.payments.map((p) => (p.id === payment.id ? { ...p, allocations: merged, trail: [...p.trail, ...trail] } : p));
    commit({ ...ledger, payments });
  };

  const preview = () => {
    if (!payment) return "That payment is not on this rental.";
    if (spare <= 0) return `Everything on ${paymentWord(payment)} is already applied.`;
    if (nothing) return `Nothing is outstanding to apply it to; the ${usd(spare)} stays on the rental, not applied.`;
    if (applied <= 0) return "Tick at least one charge.";
    return `Will apply ${usd(applied)} of the ${usd(spare)} not applied from ${paymentWord(payment)}${settle ? ` and ${settle}` : ""}${
      left > 0 ? `, leaving ${usd(left)} not applied` : ""
    }.`;
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>Apply this payment</DialogTitle>
      </DialogHeader>

      <div className="space-y-5">
        {payment && spare > 0 && !nothing && (
          <Field label="Apply to">
            <ChargePicker ledger={ledger} picked={picked} onToggle={toggle} applied={effect} />
          </Field>
        )}
        <Preview>{preview()}</Preview>
      </div>

      <Actions label={applied > 0 ? `Apply ${usd(applied)}` : "Apply"} onConfirm={confirm} onCancel={cancel} disabled={applied <= 0} />
    </>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   The surface's half: the row, and the one dialog shell
   ══════════════════════════════════════════════════════════════════════════ */

function Body({
  req,
  ledger,
  selectedChargeIds,
  commit,
  cancel,
}: DialogProps & { req: Open; selectedChargeIds: string[] }) {
  switch (req.kind) {
    case "charge":
      return <ChargeDialog ledger={ledger} chargeIds={req.chargeIds} commit={commit} cancel={cancel} />;
    case "link":
      return <LinkDialog ledger={ledger} chargeIds={req.chargeIds} selectedChargeIds={selectedChargeIds} commit={commit} cancel={cancel} />;
    case "manual":
      return <ManualDialog ledger={ledger} chargeIds={req.chargeIds} commit={commit} cancel={cancel} />;
    case "refund":
      return <RefundDialog ledger={ledger} paymentId={req.paymentId} commit={commit} cancel={cancel} />;
    case "adhoc":
      return <AdhocDialog ledger={ledger} commit={commit} cancel={cancel} />;
    case "deposit-deduct":
      return <DeductDialog ledger={ledger} commit={commit} cancel={cancel} />;
    case "deposit-release":
      return <ReleaseDialog ledger={ledger} commit={commit} cancel={cancel} />;
    case "allocate":
      return <AllocateDialog ledger={ledger} paymentId={req.paymentId} commit={commit} cancel={cancel} />;
  }
}

export function PaymentActions({
  ledger,
  onChange,
  request,
  onClose,
  selectedChargeIds,
}: {
  ledger: Ledger;
  onChange: (next: Ledger) => void;
  /** The surface sets this to open a dialog from a row (e.g. Refund on a payment). Null = nothing requested. */
  request: ActionRequest | null;
  onClose: () => void;
  /** Charges the operator has ticked in the surface, for the collective link. */
  selectedChargeIds: string[];
}) {
  const [own, setOwn] = useState<Open | null>(null);
  const active: Open | null = request ?? own;

  // Every open gets a fresh form: the body is keyed on `seq`, which advances
  // when a new request arrives. `shown` outlives `active` by one close so the
  // content stays put through the dialog's exit animation instead of vanishing
  // from an empty shell. Compared by value, not identity — a surface that
  // rebuilds the same request object on every render must not reset the form.
  const [seen, setSeen] = useState<string | null>(null);
  const [seq, setSeq] = useState(0);
  const [shown, setShown] = useState<Open | null>(null);
  const key = active ? JSON.stringify(active) : null;
  if (key !== seen) {
    setSeen(key);
    if (active) {
      setShown(active);
      setSeq((s) => s + 1);
    }
  }

  const close = () => {
    setOwn(null);
    onClose();
  };
  const commit = (next: Ledger) => {
    onChange(next);
    close();
  };

  const t = totals(ledger);
  const selectedSum = sum(selectedChargeIds.map((id) => remainingOn(ledger, id)));
  const refundable = ledger.payments.some((p) => refundableOn(p) > 0);

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="outline" onClick={() => setOwn({ kind: "charge" })} disabled={t.outstanding === 0}>
          <CreditCard className="size-3.5" />
          Charge card
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => setOwn({ kind: "link" })}
          disabled={t.outstanding === 0 && selectedChargeIds.length === 0}
        >
          <Link2 className="size-3.5" />
          {selectedChargeIds.length > 0
            ? `Send link · ${selectedChargeIds.length} ticked · ${usd(selectedSum)}`
            : "Send link"}
        </Button>
        <Button size="sm" variant="outline" onClick={() => setOwn({ kind: "manual" })}>
          <PenLine className="size-3.5" />
          Record payment
        </Button>
        <Button size="sm" variant="outline" onClick={() => setOwn({ kind: "adhoc" })}>
          <Plus className="size-3.5" />
          Add charge
        </Button>
        <Button size="sm" variant="outline" onClick={() => setOwn({ kind: "refund", paymentId: null })} disabled={!refundable}>
          <Undo2 className="size-3.5" />
          Refund
        </Button>
      </div>

      <Dialog
        open={active !== null}
        onOpenChange={(o) => {
          if (!o) close();
        }}
      >
        {/* The preview sentence is each dialog's description; it sits below the
            fields, so Radix is told there is no separate description node. */}
        <DialogContent className="max-h-[85vh] overflow-y-auto" aria-describedby={undefined}>
          {shown && (
            <Body key={seq} req={shown} ledger={ledger} selectedChargeIds={selectedChargeIds} commit={commit} cancel={close} />
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
