/* ─────────────────────────────────────────────────────────────────────────────
 * Customer record v2 — everything the screen works out for itself.
 *
 * These live in one file because more than one column reads each of them, and a
 * number derived twice is a number that eventually disagrees with itself. The
 * right-hand rail's verdict, the Money panel's tiles and the amber banners all
 * come from here.
 * ────────────────────────────────────────────────────────────────────────── */

import { formatCurrency } from "@/lib/format-utils";
import { addressOf, expiryOf, fmtDate } from "./kit";
import type { Drift } from "./kit";
import type { CustomerRecord } from "./types";
import type { SectionId } from "./sections";

export const moneyIn = (currency: string) => (n: number) =>
  formatCurrency(n, currency, { minimumFractionDigits: 0, maximumFractionDigits: 0 });

export const signedMoney = (n: number, money: (v: number) => string) =>
  n < 0 ? `−${money(Math.abs(n))}` : money(n);

/* ══════════════════════════════════════════════════════════════════════════
   Money
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * The numbers the Money panel and the overview rail both read.
 *
 * A write-off is NOT a receipt. Both reduce what the customer owes, so both are
 * negative rows in the ledger — but only one of them is money that arrived, and
 * conflating them makes the "Received" tile disagree with the operator's bank
 * statement by exactly the amount of goodwill they have given away. That is the
 * worst kind of wrong number: plausible, unexplained, and on the surface people
 * trust least to begin with.
 *
 * So `received` counts payments only, and `writtenOff` is reported separately.
 * `outstanding` is unchanged either way — a write-off still settles a charge.
 */
export function ledgerTotals(c: CustomerRecord) {
  const charges = c.ledger.filter((r) => r.amount > 0).reduce((s, r) => s + r.amount, 0);

  /** Money that arrived but has not been pointed at a charge yet. */
  const credit = c.ledger.reduce((s, r) => s + (r.unallocated ?? 0), 0);

  const received = c.ledger.filter((r) => r.kind === "payment").reduce((s, r) => s + Math.abs(r.amount), 0);

  /** Refunds and goodwill — owed less, with no money behind it. */
  const writtenOff = c.ledger.filter((r) => r.kind === "refund").reduce((s, r) => s + Math.abs(r.amount), 0);

  const applied = received - credit;
  const outstanding = Math.max(0, charges - applied - writtenOff);

  return { charges, received, applied, writtenOff, credit, outstanding, net: outstanding - credit };
}

/* ══════════════════════════════════════════════════════════════════════════
   Staleness — the two outputs that can fall behind their inputs
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * What the verdict promised, against what the record says now.
 *
 * This needs no new column and no snapshot of our own:
 * `identity_verifications` already stores document_number, first_name,
 * last_name, date_of_birth and address as the provider read them at the moment
 * it decided. Those values ARE the snapshot, and this function is the whole
 * mechanism behind the amber banner.
 *
 * Licence EXPIRY is deliberately not compared. There is no expiry column on
 * `customers` for it to drift against — the verification row is the only place
 * the date exists, so it is displayed from there and cannot disagree with
 * itself.
 */
export function verificationDrift(c: CustomerRecord): Drift[] {
  const ex = c.ai.extracted;
  if (c.ai.state !== "passed" || !ex) return [];

  const [first = "", ...rest] = c.identity.name.trim().split(/\s+/);
  const last = rest.join(" ");
  const accepted = c.ai.acceptedBaseline || {};

  const out: Drift[] = [];
  // Values stay SHORT — the banner strikes the "was" through, and a struck-out
  // sentence is unreadable. Blanks on either side are skipped rather than
  // reported: a provider that never read a field has not disagreed about it.
  const cmp = (key: string, label: string, was: string, now: string) => {
    if (!was.trim() || !now.trim()) return;
    if (was.trim().toLowerCase() === now.trim().toLowerCase()) return;
    // Someone has already looked at exactly this value and let the verdict
    // stand. Raising it again every time the page opens is how a warning
    // becomes furniture.
    if ((accepted[key] ?? "").trim().toLowerCase() === now.trim().toLowerCase()) return;
    out.push({ label, was, now });
  };

  cmp("documentNumber", "Licence number", ex.documentNumber, c.licence.number);
  cmp("firstName", "First name", ex.firstName, first);
  cmp("lastName", "Last name", ex.lastName, last);
  cmp("dob", "Date of birth", fmtDate(ex.dob), fmtDate(c.identity.dob));
  cmp("address", "Address", ex.address, addressOf(c.identity));
  return out;
}

/** The values a "verdict still stands" decision would be recorded against. */
export function currentBaseline(c: CustomerRecord): Record<string, string> {
  const [first = "", ...rest] = c.identity.name.trim().split(/\s+/);
  return {
    documentNumber: c.licence.number,
    firstName: first,
    lastName: rest.join(" "),
    dob: fmtDate(c.identity.dob),
    address: addressOf(c.identity),
  };
}

export const reviewAverage = (c: CustomerRecord) =>
  c.reviews.length ? c.reviews.reduce((s, r) => s + r.rating, 0) / c.reviews.length : 0;

/**
 * The summary against the set it was written from. Both numbers are stored
 * beside the paragraph, so this needs nothing new either.
 */
export function summaryDrift(c: CustomerRecord): Drift[] {
  if (!c.summary || c.summary.basedOn === c.reviews.length) return [];
  return [
    { label: "Review count", was: `${c.summary.basedOn} reviews`, now: `${c.reviews.length} reviews` },
    {
      label: "Average rating",
      was: `${c.summary.avg.toFixed(1)} / 10`,
      now: `${reviewAverage(c).toFixed(1)} / 10`,
    },
  ];
}

/* ══════════════════════════════════════════════════════════════════════════
   Readiness — can this person be handed keys
   ══════════════════════════════════════════════════════════════════════════ */

export type Check = {
  id: string;
  label: string;
  /** `blocked` is a hard stop, `open` is unfinished, `ok` is satisfied. */
  state: "ok" | "open" | "blocked";
  detail: string;
  /** Where to go to do something about it. */
  tab: SectionId;
  /** Required to hand over a car. The other rows are worth knowing, not fatal. */
  required: boolean;
};

export function readinessOf(c: CustomerRecord, verifyDrift: Drift[], currency: string): Check[] {
  const money = moneyIn(currency);
  const licence = expiryOf(c.licence.expiry);
  const totals = ledgerTotals(c);

  const identityDone =
    !!c.identity.name && !!(c.identity.email || c.identity.phone) && !!c.identity.dob && !!c.identity.street;

  const docExpired = c.docs.filter((d) => expiryOf(d.until).state === "expired").length;
  const docFlagged = c.docs.filter((d) => d.scan.status === "flagged").length;

  const unpaidFines = c.fines.filter((f) => f.status === "Open");
  const reachable = !!c.identity.email || (c.consent.sms && !!c.identity.phone);

  return [
    {
      id: "identity",
      label: "Identity on file",
      state: identityDone ? "ok" : "open",
      detail: identityDone ? addressOf(c.identity) || "Complete" : "Name, contact, date of birth and address",
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
          : licence.state === "none"
            ? `${c.licence.state || "On file"} · no expiry known`
            : `${c.licence.state || "On file"} · ${licence.label.toLowerCase()}`,
      tab: "licence",
      required: true,
    },
    {
      id: "verified",
      label: "Identity verified",
      state:
        c.ai.state === "passed"
          ? verifyDrift.length
            ? "open"
            : "ok"
          : c.ai.state === "declined"
            ? "blocked"
            : "open",
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
      state:
        c.account.globalBlocks.length || c.account.blockedHere || c.account.status === "Rejected"
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
      detail:
        totals.net > 0
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

/**
 * Did the verification provider actually read anything off the document?
 *
 * A DECLINED verdict usually extracted nothing — OCR failed, the photo was
 * unusable — so the row exists but every field on it is blank. The "editing
 * this will put Verification out of date" notes are only true when there IS
 * something to fall out of date, and printing them anyway teaches operators
 * that this screen says things it cannot back up.
 *
 * Lives here rather than beside either section that shows the note, because
 * Identity and Licence both draw it and neither of them owns the rule.
 */
export const readSomething = (c: CustomerRecord) =>
  !!c.ai.extracted && Object.values(c.ai.extracted).some((v) => !!v);
