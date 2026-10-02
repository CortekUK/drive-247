/**
 * PREVIEW DATA for the rental rail's Activity and Notifications tabs.
 *
 * northwind is the synthetic canary (V2_PLAN §1): its rentals carry almost no
 * history — usually one "Rental created" row and no notifications — so neither
 * tab could be judged. Same answer as the Messages sheet's mock previews and
 * the call preview: on the v2 chrome only (`useV2("chrome")`, northwind today),
 * a rental with too little of its own borrows a believable history, built from
 * the rental's own number, customer, car and total. NOTHING is written to the
 * database; marking a preview notification read is local to the tab.
 *
 * A REAL row always wins: once a rental has `MIN_REAL` events (or any real
 * notification), the preview stops being added. Every preview id starts with
 * `preview:`. Delete this file, and the call sites that import it, when the
 * canary carries real traffic. `previewPeriods` feeds the Management tab: two
 * manual extensions and one auto extension after the original booking.
 */

import type { RentalDetailV2 } from "./use-rental-detail-v2";
import type { Notification } from "@/hooks/use-notifications";

/** Below this many real activity events, the preview is added. */
export const MIN_REAL = 3;

const H = 3_600_000;
const ago = (hours: number) => new Date(Date.now() - hours * H).toISOString();

const usd = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

function facts(detail: RentalDetailV2) {
  const total = Number(detail.rental.total_amount) || 840;
  return {
    ref: detail.rentalNumber ?? "this rental",
    who: detail.customer?.name ?? "the customer",
    first: (detail.customer?.name ?? "The customer").split(" ")[0],
    car: detail.vehicleName ?? "the car",
    total,
    deposit: 500,
  };
}

export type PreviewActivity = {
  id: string;
  at: string;
  kind: "money" | "doc" | "change";
  icon: "plus" | "check" | "card" | "lock" | "key" | "shield" | "sign" | "mail" | "car" | "bell";
  text: string;
  by?: string | null;
  amount?: string;
};

/** A week of a rental's life, newest first. */
export function previewActivity(detail: RentalDetailV2): PreviewActivity[] {
  const f = facts(detail);
  const rows: PreviewActivity[] = [
    { id: "preview:reminder", at: ago(1.5), kind: "change", icon: "bell", text: `Return reminder sent to ${f.first}` },
    { id: "preview:payment-2", at: ago(5), kind: "money", icon: "card", text: "Payment received · Visa ···4242", amount: usd(Math.round(f.total / 2)) },
    { id: "preview:handover", at: ago(26), kind: "change", icon: "car", text: `${f.car} handed over · 12,430 mi`, by: "You" },
    { id: "preview:lockbox", at: ago(27), kind: "change", icon: "key", text: "Lockbox code sent by SMS" },
    { id: "preview:policy", at: ago(29), kind: "doc", icon: "shield", text: "Insurance policy issued · BZ-48213" },
    { id: "preview:signed", at: ago(30), kind: "doc", icon: "sign", text: `Agreement signed by ${f.who}` },
    { id: "preview:sent", at: ago(31), kind: "doc", icon: "mail", text: "Agreement sent for signature" },
    { id: "preview:hold", at: ago(50), kind: "money", icon: "lock", text: "Deposit hold placed", amount: usd(f.deposit) },
    { id: "preview:payment-1", at: ago(51), kind: "money", icon: "card", text: "Payment received · Visa ···4242", amount: usd(f.total - Math.round(f.total / 2)) },
    { id: "preview:approved", at: ago(53), kind: "change", icon: "check", text: "Booking approved", by: "You" },
  ];
  return rows;
}

/** The notifications that rental would have raised, newest first. */
export function previewNotifications(detail: RentalDetailV2): Notification[] {
  const f = facts(detail);
  const n = (id: string, hours: number, type: string, title: string, message: string, read: boolean): Notification => ({
    id: `preview:${id}`,
    user_id: null,
    title,
    message,
    type,
    is_read: read,
    link: null,
    metadata: { rental_id: detail.rental.id, preview: true },
    created_at: ago(hours),
  });
  return [
    n("reminder", 1.5, "rental_reminder", "Return due tomorrow", `${f.ref} · ${f.car} is due back tomorrow at 10:00 AM.`, false),
    n("payment-2", 5, "payment_received", `Payment received · ${usd(Math.round(f.total / 2))}`, `${f.who} paid the second instalment on ${f.ref}.`, false),
    n("started", 26, "rental_started", "Rental started", `${f.car} went out to ${f.who}.`, true),
    n("signed", 30, "signing_completed", "Agreement signed", `${f.who} signed the rental agreement for ${f.ref}.`, true),
    n("hold", 48, "deposit_hold_failure", "Deposit hold needs a retry", `The first ${usd(f.deposit)} hold on ${f.ref} was declined. It went through on the second attempt.`, true),
    n("approved", 53, "booking_approved", "Booking approved", `${f.ref} for ${f.who} was approved.`, true),
    n("new", 54, "booking_new", "New booking", `${f.who} booked ${f.car} · ${usd(f.total)}.`, true),
  ];
}

export type PeriodAgreement = {
  status: "signed" | "sent";
  ref: string;
  sentOn: string;
  signedOn: string | null;
  signer: string;
  email: string | null;
  /** When the customer first opened the envelope. */
  openedOn: string | null;
};
export type PeriodCover = { code: string; name: string; perDay: number; included: boolean };
export type PeriodInsurance = {
  status: "active" | "renewing";
  covers: PeriodCover[];
  policy: string;
  provider: string;
  from: string;
  to: string | null;
  premium: number;
};
export type PeriodCharge = {
  label: string;
  on: string;
  amount: number;
  status: "paid" | "due" | "scheduled";
  method?: string;
};
export type PeriodPayments = {
  rate: number;
  lines: { label: string; amount: number }[];
  tax: number;
  total: number;
  /** One per charge: a manual extension has one, an auto extension one per renewal. */
  charges: PeriodCharge[];
};

export type PreviewPeriod = {
  id: string;
  kind: "manual" | "auto";
  start: string;
  /** null for an auto extension — it runs until stopped. */
  end: string | null;
  days: number | null;
  amount: number;
  /** Auto only: how often it renews, and the next renewal day. */
  cadence?: "week" | "month";
  next?: string;
  /** Auto only: renewals already charged. */
  renewals?: number;
  times: { pickup: string | null; ret: string | null };
  agreement: PeriodAgreement;
  insurance: PeriodInsurance;
  payments: PeriodPayments;
};

const plusDays = (isoDay: string, n: number) => {
  const d = new Date(`${isoDay.slice(0, 10)}T00:00:00`);
  d.setDate(d.getDate() + n);
  const p = (x: number) => String(x).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

const TAX = 0.08;
const COVER_PER_DAY = 14;
/** CDW + SLI make the 14/day; the other two are offered and not taken. */
const COVERS: PeriodCover[] = [
  { code: "CDW", name: "Collision damage waiver", perDay: 9, included: true },
  { code: "SLI", name: "Supplemental liability", perDay: 5, included: true },
  { code: "RCLI", name: "Rental car liability", perDay: 8, included: false },
  { code: "PAI", name: "Personal accident", perDay: 5, included: false },
];

function pay(rate: number, days: number, label: string, charges: PeriodCharge[]): PeriodPayments {
  const rent = rate * days;
  const cover = COVER_PER_DAY * days;
  const tax = Math.round((rent + cover) * TAX);
  return {
    rate,
    lines: [
      { label, amount: rent },
      { label: `Insurance · ${days} days`, amount: cover },
    ],
    tax,
    total: rent + cover + tax,
    charges,
  };
}

/** Manual +4 days (signed, paid), manual +3 days (sent, due), then auto-renewing weekly. */
export function previewPeriods(detail: RentalDetailV2): PreviewPeriod[] {
  const end = detail.rental.end_date;
  if (!end) return [];
  const f = facts(detail);
  const rate = detail.days ? Math.max(40, Math.round(f.total / detail.days)) : 120;
  const ref = (detail.rentalNumber ?? "R").replace(/\s+/g, "");
  const a = String(end).slice(0, 10);
  const b = plusDays(a, 4);
  const c = plusDays(b, 3);
  const times = { pickup: detail.rental.return_time ?? "10:00", ret: detail.rental.return_time ?? "10:00" };

  const p1 = pay(rate, 4, `4 days × ${usd(rate)}`, []);
  p1.charges = [{ label: "Extension charge", on: plusDays(a, -1), amount: p1.total, status: "paid", method: "Visa ···4242" }];
  const p2 = pay(rate, 3, `3 days × ${usd(rate)}`, []);
  p2.charges = [{ label: "Extension charge", on: b, amount: p2.total, status: "due" }];
  const p3 = pay(rate, 7, `7 days × ${usd(rate)} · per week`, []);
  p3.charges = [
    { label: "Week 1", on: c, amount: p3.total, status: "paid", method: "Visa ···4242" },
    { label: "Week 2", on: plusDays(c, 7), amount: p3.total, status: "scheduled", method: "Visa ···4242" },
    { label: "Week 3", on: plusDays(c, 14), amount: p3.total, status: "scheduled", method: "Visa ···4242" },
  ];

  return [
    {
      id: "preview:ext-1", kind: "manual", start: a, end: b, days: 4, amount: p1.total, times,
      agreement: { status: "signed", ref: `${ref}-E1`, sentOn: plusDays(a, -2), signedOn: plusDays(a, -1), signer: f.who, email: detail.customer?.email ?? null, openedOn: plusDays(a, -2) },
      insurance: { status: "active", covers: COVERS, policy: "BZ-48231", provider: "Bonzah", from: a, to: b, premium: COVER_PER_DAY * 4 },
      payments: p1,
    },
    {
      id: "preview:ext-2", kind: "manual", start: b, end: c, days: 3, amount: p2.total, times,
      agreement: { status: "sent", ref: `${ref}-E2`, sentOn: plusDays(b, -1), signedOn: null, signer: f.who, email: detail.customer?.email ?? null, openedOn: plusDays(b, -1) },
      insurance: { status: "active", covers: COVERS, policy: "BZ-48377", provider: "Bonzah", from: b, to: c, premium: COVER_PER_DAY * 3 },
      payments: p2,
    },
    {
      id: "preview:auto", kind: "auto", start: c, end: null, days: null, amount: p3.total, times,
      cadence: "week", next: plusDays(c, 7), renewals: 1,
      agreement: { status: "signed", ref: `${ref}-A1`, sentOn: plusDays(c, -1), signedOn: plusDays(c, -1), signer: f.who, email: detail.customer?.email ?? null, openedOn: plusDays(c, -1) },
      insurance: { status: "renewing", covers: COVERS, policy: "BZ-48502", provider: "Bonzah", from: c, to: null, premium: COVER_PER_DAY * 7 },
      payments: p3,
    },
  ];
}

/** The original booking, in the same shape the overview reads for a period. */
export function previewBooking(detail: RentalDetailV2) {
  const f = facts(detail);
  const start = String(detail.rental.start_date ?? "").slice(0, 10);
  const end = detail.rental.end_date ? String(detail.rental.end_date).slice(0, 10) : null;
  const days = detail.days ?? 7;
  const rate = days ? Math.max(40, Math.round(f.total / days)) : 120;
  const p = pay(rate, days, `${days} days × ${usd(rate)}`, []);
  p.charges = [{ label: "Booking charge", on: start ? plusDays(start, -2) : start, amount: p.total, status: "paid", method: "Visa ···4242" }];
  return {
    id: "booking",
    start,
    end,
    days,
    payments: p,
    agreement: { status: "signed" as const, ref: `${(detail.rentalNumber ?? "R").replace(/\s+/g, "")}`, signedOn: start ? plusDays(start, -2) : null },
    insurance: { policy: "BZ-48102", from: start, to: end },
  };
}
