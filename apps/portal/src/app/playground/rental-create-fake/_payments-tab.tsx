"use client";

/**
 * Payments — the money surface of the rental control centre. DESIGN SANDBOX;
 * nothing here is real. No Supabase, no auth, no network, no react-query. The
 * ledger is state the host owns, seeded from `_payments-model.ts`, and every
 * number on screen comes from that model's derivations — never from arithmetic
 * done here — so the headline, a period, a charge and a payment cannot
 * disagree.
 *
 * ── What it answers, ranked top to bottom ────────────────────────────────
 *
 *   outstanding     one big figure, pinned — with charged / paid / not applied
 *                   / refunded quiet beside it and the deposit kept apart,
 *                   because a hold is not revenue
 *   per period      the ladder — pick a period and every list under it scopes
 *                   to that period; pick the whole rental and it is everything.
 *                   This is the "ten extensions" problem: one ledger, read one
 *                   period at a time
 *   charges         grouped by period, each reading "$620.00 · $220.00
 *                   outstanding" rather than two numbers to subtract. Paid
 *                   periods fold to one quiet line; unpaid ones stay open. Tick
 *                   charges to send one link for all of them
 *   payments        money that arrived, each wearing its provenance. Card and
 *                   link payments are EVIDENCED — an intent id and a receipt
 *                   sit behind them. A manual one is ASSERTED — somebody typed
 *                   it — and says "no provider record" in its meta line. Not a
 *                   pill, not a warning: a plain fact
 *   links           each with its state. A link nobody opened is a different
 *                   problem from one that bounced, so they never read alike
 *   the deposit     its own surface, its own figures, never in the totals
 *
 * ── One vocabulary ───────────────────────────────────────────────────────
 *
 * Charge side: charged · paid · outstanding. Payment side: received · applied
 * · not applied. The same allocation read from either end, and the same word
 * for it in the headline, the ladder, the rows and the dialogs. The words
 * themselves — a payment's provenance, a link's state, a method — come from
 * `_payments-model`, so this surface, the ladder and the dialogs cannot name
 * the same thing differently. Only how LOUDLY to say it is decided here.
 *
 * ── One row ──────────────────────────────────────────────────────────────
 *
 * A charge, a payment, a link and a deposit deduction are rows of the same
 * family: a 16px glyph where one carries meaning, a 13px line, an 11px meta
 * line, the amount in one right-hand column, and one chevron — group headings
 * included, so a single column of chevrons runs down the ledger. Every row
 * expands; every action on a row lives inside its expansion, so nothing is
 * hover-only and nothing is a pill.
 *
 * ── The one rule ─────────────────────────────────────────────────────────
 *
 * Every figure is traceable in one click. Outstanding → the charges that make
 * it up → the payments applied to each → their proof. Every cross-reference
 * inside an expansion is a JUMP: it opens the target row, scrolls it into view
 * and flashes it. Charge → payment → receipt; payment → charge → period; link
 * → payment. The headline's deposit figure is the one target that is a whole
 * block rather than a row, so it is only scrolled to and flashed.
 *
 * The action row and every dialog belong to `_payments-actions.tsx`; the
 * ladder belongs to `_payments-segments.tsx`. Amber appears nowhere: in this
 * sandbox amber means "out of date". A declined payment is `destructive`; an
 * unpaid charge is plain.
 */

import { useEffect, useRef, useState } from "react";
import { ArrowUpRight, Check, ChevronDown, CreditCard, Link2, Lock, Mail, PenLine, Smartphone } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui-v2/button";
import { Checkbox } from "@/components/ui-v2/checkbox";
import { Panel, cardCls, fmtDateTime } from "@/app/playground/_shared";
import {
  METHOD_WORDS,
  channelWord,
  chargedFor,
  counts,
  day,
  linkWords,
  outstandingFor,
  paidFor,
  parseAt,
  provenance,
  remainingOn,
  totals,
  unallocatedOn,
  usd,
  type Charge,
  type Ledger,
  type Payment,
  type PaymentLink,
  type Segment,
} from "./_payments-model";
import { SegmentMoney, TONE, UNTIED_SEGMENT_ID, type Tone } from "./_payments-segments";
import { PaymentActions, type ActionRequest } from "./_payments-actions";

/* ══════════════════════════════════════════════════════════════════════════
   Reading the ledger — presentation only; every total comes from the model
   ══════════════════════════════════════════════════════════════════════════ */

const when = (iso: string) => fmtDateTime(parseAt(iso));

const linkOf = (l: Ledger, p: Payment) =>
  p.proof.source === "link" ? (l.links.find((k) => k.id === p.proof.linkId) ?? null) : null;

/** Does this payment bear on these charges — by allocation, or by the link it
 *  came in on? The second clause is what lets a DECLINED link payment, which
 *  has no allocations, still show under the period it was for. */
const touches = (l: Ledger, p: Payment, ids: Set<string>) =>
  p.allocations.some((a) => ids.has(a.chargeId)) || (linkOf(l, p)?.chargeIds.some((id) => ids.has(id)) ?? false);

const periodOf = (l: Ledger, c: Charge) =>
  c.segmentId === null ? "Not tied to a period" : (l.segments.find((s) => s.id === c.segmentId)?.label ?? c.segmentId);

/** The periods a link is for, as one phrase — "Extension 5", or "Original, Extension 1". */
const periodsOf = (l: Ledger, charges: Charge[]) => [...new Set(charges.map((c) => periodOf(l, c)))].join(", ");

/**
 * The link's state and how loudly to say it. The WORDS come from the model, so
 * a period in the ladder and the link row under it cannot describe the same
 * link differently; only the weight is decided here. A link that has been
 * superseded is a quiet record, a declined one is a fault, everything still in
 * flight is plain.
 */
const linkTone = (k: PaymentLink): Tone =>
  k.status === "declined" ? "wrong" : k.status === "paid" || k.status === "expired" ? "fine" : "pending";

/** When a link last moved — the meta line's timestamp. */
const linkAt = (k: PaymentLink) => k.trail[k.trail.length - 1]?.at ?? k.createdAt;

/** The deposit's state in a few words. Shared by the pinned headline and the
 *  block itself so the two can never disagree. */
const depositWord = (l: Ledger, held: number) => {
  switch (l.deposit.status) {
    case "held":
      return `${usd(held)} held`;
    case "not_held":
      return "Not held";
    case "released":
      return l.deposit.releasedAt ? `Released ${day(l.deposit.releasedAt)}` : "Released";
    case "captured":
      return "Captured in full";
    default:
      return l.deposit.expiresAt ? `Expired ${day(l.deposit.expiresAt)}` : "Expired";
  }
};

/**
 * Groups and scopes share one key space: a segment id, or `UNTIED_SEGMENT_ID`
 * for charges tied to no period — the same key the ladder selects with. The
 * model addresses untied charges as `segmentId === null`, so this is the one
 * translation between the wire and the derivations.
 */
const modelIdOf = (key: string) => (key === UNTIED_SEGMENT_ID ? null : key);

/* ══════════════════════════════════════════════════════════════════════════
   Bits
   ══════════════════════════════════════════════════════════════════════════ */

function Heading({ title, right }: { title: string; right?: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <h3 className="font-heading text-sm font-semibold">{title}</h3>
      {right && <p className="text-[12px] text-muted-foreground tabular-nums">{right}</p>}
    </div>
  );
}

/** The label above a block inside an expansion. */
function Label({ children }: { children: React.ReactNode }) {
  return (
    <p className="mb-1 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/50">{children}</p>
  );
}

/** An amount and what it is — the line shape every expansion uses. */
function Line({ amount, muted, children }: { amount: number; muted?: boolean; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline gap-2.5 text-[11px]">
      <span className={cn("w-[68px] shrink-0 text-right tabular-nums", muted ? "text-muted-foreground" : "font-medium")}>
        {usd(amount)}
      </span>
      <span className="min-w-0 flex-1">{children}</span>
    </div>
  );
}

/** A cross-reference. Opens the target row, scrolls to it, flashes it. */
function Jump({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <Button variant="link" size="xs" className="h-auto gap-0.5 p-0 text-[11px] font-normal" onClick={onClick}>
      {children}
      <ArrowUpRight className="size-3" />
    </Button>
  );
}

/** Every event, in order, with its moment in a column so the eye can run down it. */
function Trail({ trail }: { trail: { at: string; event: string }[] }) {
  return (
    <ol className="space-y-0.5">
      {trail.map((e, i) => (
        <li key={`${e.at}-${i}`} className="flex gap-2.5 text-[11px]">
          <span className="w-[104px] shrink-0 text-right text-[10px] leading-4 text-muted-foreground/60 tabular-nums">
            {when(e.at)}
          </span>
          <span>{e.event}</span>
        </li>
      ))}
    </ol>
  );
}

/** Stripe's receipt page. `#` in the sandbox, a real URL in the product. */
function Receipt({ href }: { href: string }) {
  return (
    <a href={href} className="inline-flex items-center gap-0.5 text-primary hover:underline">
      Receipt
      <ArrowUpRight className="size-3" />
    </a>
  );
}

/** The chevron every expandable row and group wears. */
function Chevron({ open, hidden }: { open: boolean; hidden?: boolean }) {
  return (
    <ChevronDown
      className={cn(
        "size-3.5 shrink-0 text-muted-foreground/40 transition-transform",
        open && "rotate-180",
        hidden && "invisible"
      )}
    />
  );
}

/**
 * The one row. `lead` sits outside the toggle so a checkbox in it can be
 * ticked without opening the row. `min-h-11` keeps a one-line charge the same
 * height as a two-line payment, so the three lists share one rhythm.
 */
function Row({
  lead,
  title,
  meta,
  right,
  open,
  onToggle,
  children,
}: {
  lead: React.ReactNode;
  title: React.ReactNode;
  meta?: React.ReactNode;
  right: React.ReactNode;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <>
      <div className="flex min-h-11 items-center gap-3 py-1.5">
        <span className="flex size-4 shrink-0 items-center justify-center">{lead}</span>
        <button
          type="button"
          onClick={onToggle}
          className="flex min-w-0 flex-1 cursor-pointer items-center gap-3 text-left"
        >
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[13px] leading-snug">{title}</span>
            {meta && <span className="mt-0.5 block truncate text-[11px] leading-snug text-muted-foreground">{meta}</span>}
          </span>
          <span className="shrink-0 text-[13px] tabular-nums">{right}</span>
          <Chevron open={open} />
        </button>
      </div>
      {open && <div className="mb-3 ml-7 space-y-3 border-l border-foreground/10 pl-4">{children}</div>}
    </>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   Tab
   ══════════════════════════════════════════════════════════════════════════ */

export function PaymentsTab({
  ledger,
  onChange: setLedger,
}: {
  ledger: Ledger;
  onChange: (next: Ledger) => void;
}) {
  const [segmentId, setSegmentId] = useState<string | null>(null);
  const [request, setRequest] = useState<ActionRequest | null>(null);
  const [selected, setSelected] = useState<string[]>([]);

  /** Expanded rows, keyed `c:` `p:` `l:`. Several can be open at once — a walk
   *  from a charge to its payment should leave both in view. */
  const [open, setOpen] = useState<Set<string>>(() => new Set());
  /** Paid periods start folded so the unpaid ones are what you see. Folded
   *  rather than open-listed, so a period that gets paid later stays visible
   *  until the operator folds it themselves. Read from the ledger handed in,
   *  not the seed — this tab remounts on every visit. */
  const [folded, setFolded] = useState<Set<string>>(
    () =>
      new Set(
        [...ledger.segments.map((s) => s.id), UNTIED_SEGMENT_ID].filter((k) => outstandingFor(ledger, modelIdOf(k)) === 0)
      )
  );

  /** The row a jump just landed on. Cleared after the flash. */
  const [flash, setFlash] = useState<string | null>(null);
  const rows = useRef(new Map<string, HTMLElement>());

  useEffect(() => {
    if (!flash) return;
    rows.current.get(flash)?.scrollIntoView({ behavior: "smooth", block: "center" });
    const id = setTimeout(() => setFlash(null), 1400);
    return () => clearTimeout(id);
  }, [flash]);

  const t = totals(ledger);

  /** `segmentId` is a period, the untied bucket, or null for the whole rental.
   *  Everything under the headline reads through `scopeIds` when it is set. */
  const scoped = segmentId !== null;
  const scopeIds = scoped
    ? new Set(ledger.charges.filter((c) => c.segmentId === modelIdOf(segmentId)).map((c) => c.id))
    : null;

  /* ── state changes ─────────────────────────────────────────────────────── */

  const change = (next: Ledger) => {
    setLedger(next);
    // A charge that just got paid has nothing left to send a link for.
    setSelected((prev) => prev.filter((id) => remainingOn(next, id) > 0));
  };

  const flip = (set: React.Dispatch<React.SetStateAction<Set<string>>>) => (key: string) =>
    set((prev) => {
      const n = new Set(prev);
      if (n.has(key)) n.delete(key);
      else n.add(key);
      return n;
    });
  const toggle = flip(setOpen);
  const toggleFold = flip(setFolded);

  /** Scroll a bound element into view and flash it. */
  const reveal = (key: string) => setFlash(key);

  /** A cross-reference: open the target ROW, then reveal it. The deposit block
   *  is not a row and has nothing to open, so the headline reveals it instead. */
  const jump = (key: string) => {
    setOpen((prev) => new Set(prev).add(key));
    reveal(key);
  };

  /** A charge may be folded away or scoped out; make it visible, then jump. */
  const jumpToCharge = (c: Charge) => {
    const group = c.segmentId ?? UNTIED_SEGMENT_ID;
    setFolded((prev) => {
      if (!prev.has(group)) return prev;
      const n = new Set(prev);
      n.delete(group);
      return n;
    });
    // Following a chain into another period moves the scope with it, rather
    // than dropping to the whole rental and losing the thread.
    if (scoped && group !== segmentId) setSegmentId(group);
    jump(`c:${c.id}`);
  };

  const bind = (key: string) => (el: HTMLElement | null) => {
    if (el) rows.current.set(key, el);
    else rows.current.delete(key);
  };

  const flashCls = (key: string) => cn("rounded-2xl transition-colors duration-700", flash === key && "bg-primary/5");

  /* ── what the lists hold ───────────────────────────────────────────────── */

  const groups: { key: string; seg: Segment | null; charges: Charge[] }[] = [
    ...ledger.segments.map((s) => ({ key: s.id, seg: s, charges: ledger.charges.filter((c) => c.segmentId === s.id) })),
    { key: UNTIED_SEGMENT_ID, seg: null, charges: ledger.charges.filter((c) => c.segmentId === null) },
  ].filter((g) => g.charges.length > 0 && (!scoped || g.key === segmentId));

  const newest = (a: { at?: string; createdAt?: string }, b: { at?: string; createdAt?: string }) =>
    (b.at ?? b.createdAt ?? "").localeCompare(a.at ?? a.createdAt ?? "");

  const payments = ledger.payments.filter((p) => !scopeIds || touches(ledger, p, scopeIds)).sort(newest);
  const links = ledger.links.filter((k) => !scopeIds || k.chargeIds.some((id) => scopeIds.has(id))).sort(newest);

  /* ══════════════════════════════════════════════════════════════════════ */

  return (
    <Panel
      title="Payments"
      toolbar={
        /* ═══ the demand — pinned, so the figure is in view whatever row you
           are reading. Whole-rental always; a period's own figures sit on its
           cell and its group heading, next to the rows they describe. */
        <div className="flex items-end justify-between gap-6 border-b border-foreground/10 pb-5">
          <div className="min-w-0">
            <p className="text-[11px] font-medium uppercase tracking-widest text-muted-foreground/60">Outstanding</p>
            <p className="mt-1 font-heading text-[40px] font-medium leading-none tracking-tight tabular-nums">
              {usd(t.outstanding)}
            </p>
            <p className="mt-3 text-[12px] text-muted-foreground tabular-nums">
              {usd(t.charged)} charged · {usd(t.applied)} paid
              {t.unapplied > 0 && ` · ${usd(t.unapplied)} not applied`}
              {t.refunded > 0 && ` · ${usd(t.refunded)} refunded`}
            </p>
          </div>

          {/* Apart on purpose, and a jump to its own block: a hold is not money
              in, and the fastest way to make every figure on the left suspect
              is to let it sit in the same sentence. */}
          <button
            type="button"
            onClick={() => reveal("deposit")}
            className="shrink-0 cursor-pointer text-right transition-colors hover:text-primary"
          >
            <p className="flex items-center justify-end gap-1 text-[11px] font-medium uppercase tracking-widest text-muted-foreground/60">
              <Lock className="size-3" />
              Deposit
            </p>
            <p className="mt-1 text-[15px] font-medium tabular-nums">{depositWord(ledger, t.depositHeld)}</p>
            <p className="mt-0.5 text-[11px] text-muted-foreground tabular-nums">
              {ledger.deposit.status === "not_held"
                ? "nothing against damage"
                : `of ${usd(ledger.deposit.amountCents)}${t.depositDeducted > 0 ? ` · ${usd(t.depositDeducted)} deducted` : ""}`}
            </p>
          </button>
        </div>
      }
      footer={
        <PaymentActions
          ledger={ledger}
          onChange={change}
          request={request}
          onClose={() => setRequest(null)}
          selectedChargeIds={selected}
        />
      }
    >
      {/* ═══ the ledger — one surface: the ladder, then three lists ══════════ */}
      <div className={cn(cardCls, "space-y-8 p-6")}>
        <SegmentMoney ledger={ledger} selectedSegmentId={segmentId} onSelect={setSegmentId} />

        {/* ── charges ──────────────────────────────────────────────────────── */}
        <section>
          <Heading title="Charges" />

          <div className="mt-2 space-y-1">
            {groups.map((g) => {
              const modelId = modelIdOf(g.key);
              const charged = chargedFor(ledger, modelId);
              const outstanding = outstandingFor(ledger, modelId);
              const opened = scoped || !folded.has(g.key);
              return (
                <div key={g.key}>
                  {/* The group's chevron sits in the same right-hand column as
                      every row's, so one column of chevrons runs down the whole
                      ledger instead of two pointing at each other. */}
                  <button
                    type="button"
                    onClick={() => !scoped && toggleFold(g.key)}
                    className={cn("flex w-full items-center gap-3 py-1.5 text-left", !scoped && "cursor-pointer")}
                  >
                    <span className="flex min-w-0 flex-1 items-baseline gap-2">
                      <span className="truncate text-[13px] font-medium">{g.seg?.label ?? "Not tied to a period"}</span>
                      {g.seg && (
                        <span className="shrink-0 text-[11px] text-muted-foreground">
                          {day(g.seg.from)} → {day(g.seg.to)}
                        </span>
                      )}
                    </span>
                    {/* Never "$592.00 · $592.00 outstanding": when nothing has
                        been paid the two figures are one figure, and the same
                        three cases decide a charge row's amount below. */}
                    <span className="shrink-0 text-[12px] tabular-nums">
                      {outstanding === 0 ? (
                        <span className="text-muted-foreground/60">{usd(charged)} · paid</span>
                      ) : outstanding === charged ? (
                        <span className="font-medium">{usd(charged)} outstanding</span>
                      ) : (
                        <>
                          <span className="text-muted-foreground">{usd(charged)} · </span>
                          <span className="font-medium">{usd(outstanding)} outstanding</span>
                        </>
                      )}
                    </span>
                    <Chevron open={opened} hidden={scoped} />
                  </button>

                  {opened && (
                    <div className="divide-y divide-foreground/5 pl-7">
                      {g.charges.map((c) => {
                        const key = `c:${c.id}`;
                        const outstandingOn = remainingOn(ledger, c.id);
                        const paid = outstandingOn === 0;
                        const applied = ledger.payments
                          .filter(counts)
                          .flatMap((p) => p.allocations.filter((a) => a.chargeId === c.id).map((a) => ({ p, amount: a.amountCents })));
                        const viaLinks = ledger.links.filter((k) => k.chargeIds.includes(c.id));
                        return (
                          <div key={c.id} ref={bind(key)} className={flashCls(key)}>
                            <Row
                              open={open.has(key)}
                              onToggle={() => toggle(key)}
                              lead={
                                paid ? (
                                  <Check className="size-4 text-muted-foreground/40" strokeWidth={2.5} />
                                ) : (
                                  <Checkbox
                                    checked={selected.includes(c.id)}
                                    onCheckedChange={(v) =>
                                      setSelected((prev) => (v === true ? [...prev, c.id] : prev.filter((id) => id !== c.id)))
                                    }
                                    aria-label={`Tick ${c.label}`}
                                  />
                                )
                              }
                              title={<span className={cn(paid && "text-muted-foreground")}>{c.label}</span>}
                              right={
                                paid ? (
                                  <span className="text-muted-foreground/60">{usd(c.amountCents)}</span>
                                ) : outstandingOn === c.amountCents ? (
                                  <span className="font-medium">{usd(c.amountCents)}</span>
                                ) : (
                                  <>
                                    <span className="text-muted-foreground">{usd(c.amountCents)} · </span>
                                    <span className="font-medium">{usd(outstandingOn)} outstanding</span>
                                  </>
                                )
                              }
                            >
                              <div className="space-y-1">
                                {applied.map(({ p, amount }) => (
                                  <Line key={p.id} amount={amount}>
                                    <Jump onClick={() => jump(`p:${p.id}`)}>
                                      {provenance(p)} · {when(p.at)}
                                    </Jump>
                                  </Line>
                                ))}
                                {outstandingOn > 0 && (
                                  <Line amount={outstandingOn}>
                                    <span className="text-muted-foreground">outstanding</span>
                                  </Line>
                                )}
                                {viaLinks.map((k) => (
                                  <Line key={k.id} amount={k.amountCents} muted>
                                    <Jump onClick={() => jump(`l:${k.id}`)}>
                                      {linkWords(k.status)} · link by {channelWord(k.channel)}
                                    </Jump>
                                  </Line>
                                ))}
                                <p className="pt-1 text-[11px] text-muted-foreground">
                                  Raised {day(c.createdAt)}
                                  {c.by && ` by ${c.by}`}
                                  {c.note && ` · “${c.note}”`}
                                </p>
                              </div>

                              {!paid && (
                                <div className="flex gap-2">
                                  <Button variant="outline" size="xs" onClick={() => setRequest({ kind: "charge", chargeIds: [c.id] })}>
                                    Charge card
                                  </Button>
                                  <Button variant="outline" size="xs" onClick={() => setRequest({ kind: "link", chargeIds: [c.id] })}>
                                    Send link
                                  </Button>
                                </div>
                              )}
                            </Row>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </section>

        {/* ── payments ─────────────────────────────────────────────────────── */}
        <section>
          <Heading
            title="Payments"
            right={scoped ? `${usd(paidFor(ledger, modelIdOf(segmentId)))} applied here` : `${usd(t.received)} received`}
          />

          {payments.length === 0 ? (
            <p className="mt-2 text-[12px] text-muted-foreground">
              {scoped ? "Nothing has arrived for these charges yet." : "Nothing has arrived yet."}
            </p>
          ) : (
            <div className="mt-1 divide-y divide-foreground/5">
              {payments.map((p) => {
                const key = `p:${p.id}`;
                const pr = p.proof;
                const failed = p.status === "failed";
                const pending = p.status === "pending";
                const manual = pr.source === "manual";
                const spare = unallocatedOn(p);
                const link = linkOf(ledger, p);
                const refunds = ledger.refunds.filter((r) => r.paymentId === p.id);
                const Icon = pr.source === "card" ? CreditCard : pr.source === "link" ? Link2 : PenLine;

                /* The Activity rail's actor ramp, and the same meaning: coloured
                   is one of us, solid is the customer, faded is nobody's word
                   but the typist's. */
                const glyph = failed
                  ? "text-destructive"
                  : pr.source === "card"
                    ? "text-primary"
                    : pr.source === "link"
                      ? "text-foreground/80"
                      : "text-muted-foreground/50";

                /* The title says the thing that most needs knowing: normally
                   where the money came from, and on a failure the failure —
                   with its reason, which is the only place on the screen the
                   customer's bank gives a reason at all. Provenance then moves
                   into the meta line rather than being lost. */
                const headline = failed
                  ? (p.trail[p.trail.length - 1]?.event ?? "Declined")
                  : pending
                    ? `${provenance(p)} · pending`
                    : provenance(p);

                const meta = [
                  failed && provenance(p),
                  when(p.at),
                  pr.source === "card" && pr.by,
                  pr.source === "link" && link?.openedAt && `opened ${when(link.openedAt)}`,
                  manual && METHOD_WORDS[pr.method],
                  manual && pr.reference,
                  manual && "no provider record",
                  p.refundedCents > 0 && (p.status === "refunded" ? "refunded in full" : `${usd(p.refundedCents)} refunded`),
                  spare > 0 && `${usd(spare)} not applied`,
                ]
                  .filter(Boolean)
                  .join(" · ");

                return (
                  <div key={p.id} ref={bind(key)} className={flashCls(key)}>
                    <Row
                      open={open.has(key)}
                      onToggle={() => toggle(key)}
                      lead={<Icon className={cn("size-4", glyph)} />}
                      title={
                        <span className={cn(failed ? "text-destructive" : (manual || pending) && "text-muted-foreground")}>
                          {headline}
                        </span>
                      }
                      meta={meta}
                      right={
                        <span className={cn("font-medium", failed && "text-destructive", pending && "text-muted-foreground")}>
                          {usd(p.amountCents)}
                        </span>
                      }
                    >
                      {/* ── proof: every provider id behind this money ──────── */}
                      <div>
                        <Label>Proof</Label>
                        {pr.source === "card" && (
                          <p className="text-[11px]">
                            <span className="font-mono text-foreground/80">{pr.intentId}</span> · {pr.brand} ···· {pr.last4} · charged
                            by {pr.by} · <Receipt href={pr.receiptUrl} />
                          </p>
                        )}
                        {pr.source === "link" && (
                          <p className="text-[11px]">
                            <span className="font-mono text-foreground/80">{pr.intentId}</span> ·{" "}
                            <Jump onClick={() => jump(`l:${pr.linkId}`)}>
                              <span className="font-mono">{pr.linkId}</span>
                            </Jump>{" "}
                            · by {pr.channel === "email" ? "email" : "SMS"}
                            {!failed && (
                              <>
                                {" · "}
                                <Receipt href={pr.receiptUrl} />
                              </>
                            )}
                          </p>
                        )}
                        {pr.source === "manual" && (
                          <>
                            <p className="text-[11px] text-muted-foreground">No provider record — only what was typed here.</p>
                            <p className="mt-1 text-[11px]">
                              {METHOD_WORDS[pr.method]}
                              {pr.reference && (
                                <>
                                  {" · "}
                                  <span className="font-mono text-foreground/80">{pr.reference}</span>
                                </>
                              )}{" "}
                              · recorded by {pr.by}
                              {pr.note && <span className="text-muted-foreground"> · “{pr.note}”</span>}
                            </p>
                          </>
                        )}
                        {refunds.map((r) => (
                          <p key={r.id} className="mt-1 text-[11px]">
                            <span className="text-muted-foreground">Refund of {usd(r.amountCents)} · {r.by}</span>
                            {r.intentId && (
                              <>
                                {" · "}
                                <span className="font-mono text-foreground/80">{r.intentId}</span>
                              </>
                            )}
                          </p>
                        ))}
                      </div>

                      {/* ── applied to ───────────────────────────────────── */}
                      {counts(p) && (
                        <div>
                          <Label>Applied to</Label>
                          <div className="space-y-1">
                            {p.allocations.map((a) => {
                              const c = ledger.charges.find((x) => x.id === a.chargeId);
                              return (
                                <Line key={a.chargeId} amount={a.amountCents}>
                                  {c ? (
                                    <Jump onClick={() => jumpToCharge(c)}>
                                      {c.label} · {periodOf(ledger, c)}
                                    </Jump>
                                  ) : (
                                    <span className="text-muted-foreground">{a.chargeId}</span>
                                  )}
                                </Line>
                              );
                            })}
                            {p.allocations.length === 0 && <p className="text-[11px] text-muted-foreground">Nothing yet</p>}
                            {spare > 0 && (
                              <Line amount={spare}>
                                <span className="text-muted-foreground">not applied to anything</span>
                              </Line>
                            )}
                          </div>
                        </div>
                      )}

                      {/* ── trail ────────────────────────────────────────── */}
                      <div>
                        <Label>Trail</Label>
                        <Trail trail={p.trail} />
                      </div>

                      {counts(p) && (p.amountCents - p.refundedCents > 0 || spare > 0) && (
                        <div className="flex gap-2">
                          {p.amountCents - p.refundedCents > 0 && (
                            <Button variant="outline" size="xs" onClick={() => setRequest({ kind: "refund", paymentId: p.id })}>
                              Refund
                            </Button>
                          )}
                          {spare > 0 && (
                            <Button variant="outline" size="xs" onClick={() => setRequest({ kind: "allocate", paymentId: p.id })}>
                              Apply {usd(spare)}
                            </Button>
                          )}
                        </div>
                      )}
                    </Row>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        {/* ── links ────────────────────────────────────────────────────────── */}
        <section>
          <Heading title="Links" />

          {links.length === 0 ? (
            <p className="mt-2 text-[12px] text-muted-foreground">
              {scoped ? "No links sent for these charges." : "No links sent yet."}
            </p>
          ) : (
            <div className="mt-1 divide-y divide-foreground/5">
              {links.map((k) => {
                const key = `l:${k.id}`;
                const tone = linkTone(k);
                const Icon = k.channel === "email" ? Mail : Smartphone;
                const covers = k.chargeIds
                  .map((id) => ledger.charges.find((c) => c.id === id))
                  .filter((c): c is Charge => !!c);
                const stillOutstanding = covers.some((c) => remainingOn(ledger, c.id) > 0);
                const paidBy = k.paymentId ? ledger.payments.find((p) => p.id === k.paymentId) : null;
                return (
                  <div key={k.id} ref={bind(key)} className={flashCls(key)}>
                    <Row
                      open={open.has(key)}
                      onToggle={() => toggle(key)}
                      lead={<Icon className={cn("size-4", tone === "wrong" ? "text-destructive" : "text-muted-foreground/50")} />}
                      title={<span className={TONE[tone]}>{linkWords(k.status)}</span>}
                      meta={`${periodsOf(ledger, covers)} · by ${channelWord(k.channel)} · ${when(linkAt(k))}`}
                      right={
                        <span
                          className={cn(
                            "font-medium",
                            tone === "fine" && "text-muted-foreground/60",
                            tone === "wrong" && "text-destructive"
                          )}
                        >
                          {usd(k.amountCents)}
                        </span>
                      }
                    >
                      <div>
                        <Label>For</Label>
                        <div className="space-y-1">
                          {covers.map((c) => (
                            <Line key={c.id} amount={c.amountCents}>
                              <Jump onClick={() => jumpToCharge(c)}>
                                {c.label} · {periodOf(ledger, c)}
                              </Jump>
                            </Line>
                          ))}
                        </div>
                      </div>

                      <div>
                        <Label>Trail</Label>
                        <Trail trail={k.trail} />
                      </div>

                      {paidBy ? (
                        <Jump onClick={() => jump(`p:${paidBy.id}`)}>See the payment</Jump>
                      ) : (
                        stillOutstanding && (
                          <div className="flex gap-2">
                            <Button variant="outline" size="xs" onClick={() => setRequest({ kind: "charge", chargeIds: k.chargeIds })}>
                              Charge card
                            </Button>
                            <Button variant="outline" size="xs" onClick={() => setRequest({ kind: "link", chargeIds: k.chargeIds })}>
                              Send again
                            </Button>
                          </div>
                        )
                      )}
                    </Row>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </div>

      {/* ═══ the deposit — its own surface, never in the totals ══════════════ */}
      <div
        ref={bind("deposit")}
        className={cn(cardCls, "p-6 transition-shadow duration-700", flash === "deposit" && "ring-primary/40")}
      >
        <Heading title="Security deposit" right={depositWord(ledger, t.depositHeld)} />

        {ledger.deposit.status === "not_held" ? (
          <p className="mt-1.5 text-[11px] text-muted-foreground">Nothing is being held against damage.</p>
        ) : (
          <p className="mt-1.5 text-[11px] text-muted-foreground">
            {usd(ledger.deposit.amountCents)} authorised
            {ledger.deposit.heldAt && ` ${when(ledger.deposit.heldAt)}`}
            {ledger.deposit.intentId && (
              <>
                {" · "}
                <span className="font-mono text-foreground/80">{ledger.deposit.intentId}</span>
              </>
            )}
            {ledger.deposit.status === "held" && ledger.deposit.expiresAt && ` · good until ${day(ledger.deposit.expiresAt)}`}
          </p>
        )}

        {/* A deduction is a row of the same family as a charge, a payment and a
            link — 13px reason, 11px meta, the amount in the right-hand column.
            No glyph: one repeated on every row would only say "deposit" again,
            which the block it sits in already said. */}
        {ledger.deposit.deductions.length > 0 && (
          <div className="mt-2 divide-y divide-foreground/5">
            {ledger.deposit.deductions.map((d, i) => (
              <div key={`${d.at}-${i}`} className="flex min-h-11 items-center gap-3 py-1.5">
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] leading-snug">{d.reason}</span>
                  <span className="mt-0.5 block truncate text-[11px] leading-snug text-muted-foreground">
                    {when(d.at)} · {d.by}
                  </span>
                </span>
                <span className="shrink-0 text-[13px] font-medium tabular-nums">{usd(d.amountCents)}</span>
              </div>
            ))}
          </div>
        )}

        {ledger.deposit.status === "held" && (
          <div className="mt-4 flex gap-2">
            <Button variant="outline" size="sm" onClick={() => setRequest({ kind: "deposit-deduct" })}>
              Deduct
            </Button>
            <Button variant="outline" size="sm" onClick={() => setRequest({ kind: "deposit-release" })}>
              Release {usd(t.depositHeld)}
            </Button>
          </div>
        )}
      </div>
    </Panel>
  );
}
