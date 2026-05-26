/**
 * Finance Sync — Provider abstraction (Spec §7.1).
 *
 * `process-accounting-sync` and the list/test edge functions only ever talk
 * to this interface. Xero and Zoho implementations live in `xero-client.ts`
 * and `zoho-client.ts`. Factory in `factory.ts` returns the right one for
 * a (tenant_id, provider) tuple.
 *
 * Keeping this layer free of Drive247-specific types — everything flows
 * through `ContactInput`, `InvoiceInput`, `PaymentInput`, `CreditNoteInput`.
 * The sync worker translates `financial_events` rows into these.
 */

export type ProviderName = "xero" | "zoho";

/** A reference to something we created (or upserted) in the provider's books. */
export interface ExternalRef {
  externalId: string;
  /** Optional raw response payload — used by the sync worker to populate
   *  external_invoice_paid_at / external_status when webhooks land in Phase 2. */
  raw?: unknown;
}

export interface ContactInput {
  /** Customer's full name as it should appear on invoices. */
  name: string;
  email?: string;
  phone?: string;
  address?: {
    line1?: string;
    city?: string;
    region?: string;
    postcode?: string;
    country?: string;
  };
  /** Optional hint when we want the provider to UPSERT against an existing
   *  contact (Xero uses ContactNumber for this; Zoho doesn't support it). */
  externalIdHint?: string;
}

export interface InvoiceLine {
  description: string;
  /** Whole units, not cents. Defaults to 1 if omitted. */
  quantity: number;
  /** Per-unit amount in cents — preserves precision until the provider call. */
  unitAmountCents: number;
  /** Provider account code from `accounting_account_mappings`. */
  accountCode: string;
  /** Optional Xero TaxType (e.g. `OUTPUT2`) or Zoho tax UUID. */
  taxCode?: string;
  taxRate?: number;
  /** Optional line ref — vehicle reg, ledger entry id, etc. */
  reference?: string;
}

export interface InvoiceInput {
  /** Provider contact id from `accounting_contact_links`. */
  contactExternalId: string;
  /** Drive247-issued number — used as Xero `InvoiceNumber` + Zoho `invoice_number`.
   *  Acts as the per-invoice idempotency key so re-syncing the same logical
   *  invoice doesn't duplicate. */
  invoiceNumber: string;
  /** Date the invoice is dated — usually the rental's start_date. */
  issueDate: string; // YYYY-MM-DD
  dueDate?: string;  // YYYY-MM-DD
  currency: string;
  /** Free-form text — rental ref + extension number etc. */
  reference?: string;
  lines: InvoiceLine[];
  /** Where this invoice came from — `rental_id` so existing-invoice lookup works. */
  sourceRentalId?: string;
}

/** Used when adding a line to an EXISTING invoice. */
export interface InvoiceLineAppend {
  /** The provider's invoice id (Xero InvoiceID or Zoho invoice_id). */
  invoiceExternalId: string;
  line: InvoiceLine;
}

export interface PaymentInput {
  /** The provider invoice we're recording a payment against. */
  invoiceExternalId: string;
  /** Amount in cents. */
  amountCents: number;
  currency: string;
  /** YYYY-MM-DD */
  paidAt: string;
  /** Provider bank/clearing account code from the payment-account sentinel mapping. */
  paymentAccountCode: string;
  reference?: string;
}

export interface CreditNoteInput {
  /** The provider invoice this credit note relates to. */
  invoiceExternalId: string;
  /** Refund amount in cents (positive). */
  amountCents: number;
  currency: string;
  issueDate: string;
  /** Operator-entered reason — surfaces in Xero/Zoho. */
  reason?: string;
  /** Lines mirror the original invoice's accounts when possible. */
  lines: InvoiceLine[];
}

export interface ExternalAccount {
  code: string;
  name: string;
  type?: string;             // e.g. 'REVENUE', 'BANK'
  isActive?: boolean;
}

export interface ExternalTaxRate {
  /** Xero `TaxType` code or Zoho `tax_id` UUID. */
  code: string;
  name: string;
  rate?: number;             // percent
}

/**
 * The provider abstraction. Every call returns or throws — never returns
 * a half-failed state. The sync worker catches throw + classifies the error
 * per spec §14.2 (transient | auth | validation | duplicate | unknown).
 */
export interface AccountingProvider {
  readonly name: ProviderName;

  /** Find-or-create the contact. Returns the provider's contact id. */
  upsertContact(input: ContactInput): Promise<ExternalRef>;

  /** Create a brand-new invoice with N lines. */
  createInvoice(input: InvoiceInput): Promise<ExternalRef>;

  /** Append a single line to an EXISTING invoice (rental still open). */
  appendInvoiceLine(input: InvoiceLineAppend): Promise<ExternalRef>;

  /** Record a customer payment against an invoice. */
  recordPayment(input: PaymentInput): Promise<ExternalRef>;

  /** Create a credit note refunding part/all of an invoice. */
  createCreditNote(input: CreditNoteInput): Promise<ExternalRef>;

  /** Void an invoice. Used only when an operator manually voids in Drive247. */
  voidInvoice(externalInvoiceId: string): Promise<void>;

  /** Provider's chart of accounts — for the mapping UI dropdowns. */
  listAccounts(): Promise<ExternalAccount[]>;

  /** Provider's tax rates — for the mapping UI dropdowns. */
  listTaxRates(): Promise<ExternalTaxRate[]>;
}

/** Returned by the sync worker after classifying a thrown provider error. */
export type SyncErrorClass =
  | "transient"     // 429, 5xx, timeout — retry per backoff schedule
  | "auth"          // 401/403 — flip connection to expired, no retry
  | "validation"    // 400 with invalid-account / missing-tax — no retry, surface to UI
  | "duplicate"     // idempotency hit — silent success
  | "unknown";      // anything else — retry 3x then surface

export class ProviderError extends Error {
  constructor(
    message: string,
    public readonly classification: SyncErrorClass,
    public readonly statusCode?: number,
    public readonly errorCode?: string,
    public readonly raw?: unknown,
  ) {
    super(message);
    this.name = "ProviderError";
  }
}
