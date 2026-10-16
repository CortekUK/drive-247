/**
 * Accounting sync v2 — the provider-agnostic contract.
 *
 * The engine (`engine.ts`) only ever talks to an `Adapter`; Xero and Zoho Books
 * each implement one. Anything provider-specific — ids vs codes, payment modes,
 * how a refund is expressed — stays inside the adapter.
 */
import type { Provider } from "./config.ts";

export interface Connection {
  id: string;
  tenant_id: string;
  provider: Provider;
  status: "pending_org" | "connected" | "disconnected" | "error" | "needs_reauth";
  external_org_id: string | null;
  external_org_name: string | null;
  external_org_short_code: string | null;
  external_connection_id: string | null;
  region: string | null;
  api_domain: string | null;
  accounts_server: string | null;
  token_expires_at: string | null;
  connected_at: string | null;
  sync_from: string | null;
  settings: AccountSettings;
}

/** One account in the provider's chart, as the portal's selects show it. */
export interface Account {
  id: string;
  code: string | null;
  name: string;
  /** Provider's own type word (BANK, REVENUE, income, other_current_liability…). */
  type: string;
  /** Can a customer payment / refund be posted to it? */
  canPay: boolean;
  /** Can it carry an invoice line? */
  canSell: boolean;
}

export interface AccountRef {
  id: string;
  code?: string | null;
  name?: string | null;
}

export interface TaxRate {
  id: string;
  name: string;
  rate: number | null;
}

/**
 * The account mapping. Every key is optional: the engine fills anything unset
 * from the provider's chart (see `resolveSettings`), so a fresh connection
 * works with zero configuration.
 */
export interface AccountSettings {
  card_account?: AccountRef | null;      // card payments (Stripe / Square) land here
  manual_account?: AccountRef | null;    // cash, bank transfer, cheque… (default: Undeposited Funds / Cash)
  sales_account?: AccountRef | null;     // rental, fees, extras
  deposit_account?: AccountRef | null;   // security deposits — a liability, not income
  tax_account?: AccountRef | null;       // Drive's own Tax line
  tax_rate?: { id: string; name?: string | null } | null; // applied to sales lines; default none
  /** Which of the above were chosen automatically (shown as "default" in the portal). */
  auto?: string[];
}

export interface Line {
  name: string;          // category, e.g. "Rental"
  description: string;   // what the accountant reads
  amount: number;        // signed for invoices (an adjustment line may be negative)
  account: AccountRef;
  taxRateId?: string | null;
}

export interface DocResult {
  id: string;
  number?: string | null;
  /** Extra provider ids worth keeping (Xero PrepaymentID beside BankTransactionID). */
  extra?: Record<string, string>;
}

export type PayMethod = "card" | "cash" | "bank_transfer" | "cheque" | "other";

export interface Adapter {
  provider: Provider;
  /** Calls made through this adapter in this run — the worker's rate budget. */
  calls(): number;

  getOrganisation(): Promise<{ id: string; name: string; shortCode?: string | null; currency?: string | null }>;
  listAccounts(): Promise<Account[]>;
  listTaxRates(): Promise<TaxRate[]>;

  /** Create-or-match. `driveRef` is stable per Drive customer. */
  ensureContact(c: { driveRef: string; name: string; email: string | null; phone: string | null }): Promise<DocResult>;

  /** Look an object up by the reference we gave it — used when a create's outcome is unknown. */
  findByReference(kind: "invoice" | "payment" | "credit_note" | "prepayment", reference: string): Promise<DocResult | null>;

  createInvoice(p: {
    contactId: string; number: string; reference: string; date: string; dueDate: string; currency: string; lines: Line[];
  }, idempotencyKey: string): Promise<DocResult>;
  voidInvoice(id: string): Promise<void>;
  amountDue(invoiceId: string): Promise<number>;

  createPayment(p: {
    invoiceId: string; contactId: string; amount: number; date: string; account: AccountRef; reference: string; method: PayMethod;
  }, idempotencyKey: string): Promise<DocResult>;
  deletePayment(id: string): Promise<void>;

  /** Money received that is not (yet) against an invoice — Xero prepayment / Zoho excess payment. */
  createPrepayment(p: {
    contactId: string; amount: number; date: string; account: AccountRef; reference: string; method: PayMethod;
    currency: string; lineAccount: AccountRef;
  }, idempotencyKey: string): Promise<DocResult>;
  deletePrepayment(doc: DocResult): Promise<void>;

  createCreditNote(p: {
    contactId: string; number: string; reference: string; date: string; currency: string; lines: Line[];
  }, idempotencyKey: string): Promise<DocResult>;
  voidCreditNote(id: string): Promise<void>;

  /** Cash out against a credit note. */
  refundCreditNote(p: {
    creditNoteId: string; amount: number; date: string; account: AccountRef; reference: string; method: PayMethod;
  }, idempotencyKey: string): Promise<DocResult>;
  /** Cash out against a prepayment / excess payment. */
  refundPrepayment(p: {
    prepayment: DocResult; amount: number; date: string; account: AccountRef; reference: string; method: PayMethod;
  }, idempotencyKey: string): Promise<DocResult>;
  deleteRefund(p: { id: string; creditNoteId?: string | null; prepaymentId?: string | null }): Promise<void>;

  /** Best-effort: revoke our grant at the provider on disconnect. */
  revoke(refreshToken: string | null): Promise<void>;
}

/* ─────────────────────────────── errors ─────────────────────────────────── */

export type ErrorKind = "auth" | "rate" | "validation" | "transient" | "not_found";

/** Every provider failure is one of these, so the worker can decide retry vs reauth vs back-off. */
export class ProviderError extends Error {
  constructor(
    public kind: ErrorKind,
    message: string,
    public status = 0,
    /** For `rate`: seconds until the provider will take calls again. */
    public retryAfter = 60,
  ) {
    super(message);
  }
}

export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export const EPS = 0.004;
