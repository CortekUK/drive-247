/**
 * Finance Sync — Zoho Books implementation of AccountingProvider.
 *
 * Sprint 5 full implementation. Replaces the Sprint 3 stub.
 *
 * Key Zoho behaviours that differ from Xero:
 *  - Auth header: `Authorization: Zoho-oauthtoken <access_token>` (NOT Bearer)
 *  - Region matters: `.com / .eu / .in / .com.au / .jp / .sa` — base URL differs
 *  - `organization_id` query param REQUIRED on every API call
 *  - **No Idempotency-Key header** — we pre-flight check our own DB
 *    (`accounting_contact_links` + `financial_event_sync_state.external_invoice_id`)
 *    before every write to avoid duplicates. Caller (process-accounting-sync)
 *    already does the dedupe — this client trusts that and just calls.
 *  - Refresh token is stable (no rotation) — handled in refresh-accounting-tokens
 *  - Tax codes are per-org UUIDs from `/settings/taxes`, not string codes
 *  - Rate limit: 100/min per org — sync worker caps at 80/min
 */

import { ZOHO } from "./oauth-constants.ts";
import {
  AccountingProvider,
  ContactInput,
  CreditNoteInput,
  ExternalAccount,
  ExternalRef,
  ExternalTaxRate,
  InvoiceInput,
  InvoiceLine,
  InvoiceLineAppend,
  PaymentInput,
  ProviderError,
  SyncErrorClass,
} from "./types.ts";

export class ZohoClient implements AccountingProvider {
  readonly name = "zoho" as const;

  constructor(
    private readonly accessToken: string,
    private readonly organizationId: string,
    private readonly region: string,    // 'com' | 'eu' | 'in' | 'com.au' | 'jp' | 'sa'
  ) {}

  private headers(extra: Record<string, string> = {}): Record<string, string> {
    return {
      Authorization: `Zoho-oauthtoken ${this.accessToken}`,
      Accept: "application/json",
      ...extra,
    };
  }

  /** Compose URL with organization_id query param baked in. */
  private url(path: string, qs: Record<string, string | undefined> = {}): string {
    const base = path.startsWith("http") ? path : `${ZOHO.apiBase(this.region)}${path}`;
    const url = new URL(base);
    url.searchParams.set("organization_id", this.organizationId);
    for (const [k, v] of Object.entries(qs)) {
      if (v !== undefined && v !== null) url.searchParams.set(k, v);
    }
    return url.toString();
  }

  private async call<T>(
    path: string,
    init: RequestInit = {},
    qs: Record<string, string | undefined> = {},
  ): Promise<T> {
    const headers: Record<string, string> = {
      ...this.headers(),
      ...(init.headers as Record<string, string> | undefined),
    };
    if (init.body !== undefined) {
      headers["Content-Type"] = "application/json";
    }
    const res = await fetch(this.url(path, qs), { ...init, headers });
    const text = await res.text();
    let json: unknown = null;
    try { json = text ? JSON.parse(text) : null; } catch { /* ignore */ }

    if (!res.ok) {
      throw classifyZohoError(res.status, json, text);
    }
    // Zoho returns `{ code, message, ...data }`. Non-zero `code` = error
    // even with HTTP 200.
    const body = json as { code?: number; message?: string } | null;
    if (body && typeof body.code === "number" && body.code !== 0) {
      throw classifyZohoError(res.status, body, text);
    }
    return json as T;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Contacts
  // ─────────────────────────────────────────────────────────────────────────

  async upsertContact(input: ContactInput): Promise<ExternalRef> {
    // Zoho's POST /contacts creates a new contact. No native upsert — caller
    // checks accounting_contact_links first. If we reach here, this customer
    // isn't linked yet to this Zoho org.
    const body = {
      contact_name: input.name,
      contact_type: "customer",
      contact_persons: input.email || input.phone ? [{
        email: input.email,
        phone: input.phone,
        is_primary_contact: true,
      }] : undefined,
      billing_address: input.address ? {
        address: input.address.line1,
        city: input.address.city,
        state: input.address.region,
        zip: input.address.postcode,
        country: input.address.country,
      } : undefined,
      // Drive247 customer id stored as a reference for sanity at audit time
      reference_number: input.externalIdHint ?? undefined,
    };
    type ZohoContactResponse = { contact: { contact_id: string } };
    const out = await this.call<ZohoContactResponse>(
      "/contacts",
      { method: "POST", body: JSON.stringify(body) },
    );
    if (!out.contact?.contact_id) {
      throw new ProviderError("Zoho contact response missing contact_id", "unknown", undefined, undefined, out);
    }
    return { externalId: out.contact.contact_id, raw: out };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Invoices
  // ─────────────────────────────────────────────────────────────────────────

  async createInvoice(input: InvoiceInput): Promise<ExternalRef> {
    const body = {
      customer_id: input.contactExternalId,
      invoice_number: input.invoiceNumber,
      reference_number: input.reference,
      date: input.issueDate,
      due_date: input.dueDate ?? input.issueDate,
      currency_code: input.currency,
      // Send=false because Drive247 already notified the customer — don't
      // send a duplicate email from Zoho.
      send: false,
      line_items: input.lines.map(toZohoLine),
    };
    type ZohoInvoiceResponse = { invoice: { invoice_id: string; invoice_number: string; status: string } };
    const out = await this.call<ZohoInvoiceResponse>(
      "/invoices",
      { method: "POST", body: JSON.stringify(body) },
    );
    if (!out.invoice?.invoice_id) {
      throw new ProviderError("Zoho invoice response missing invoice_id", "unknown", undefined, undefined, out);
    }
    // Approve / send-as-sent in one step — Zoho creates as Draft by default.
    try {
      await this.call(`/invoices/${out.invoice.invoice_id}/status/sent`, { method: "POST" });
    } catch (err) {
      // Status flip isn't fatal — invoice exists; operator can approve manually.
      console.warn("zoho invoice status flip failed:", err);
    }
    return { externalId: out.invoice.invoice_id, raw: out };
  }

  async appendInvoiceLine(input: InvoiceLineAppend): Promise<ExternalRef> {
    // Zoho's PUT /invoices/{id} replaces the line_items array. We GET first,
    // append our new line, then PUT back.
    type ZohoGetInvoice = { invoice: { line_items: unknown[]; status: string } };
    const existing = await this.call<ZohoGetInvoice>(`/invoices/${input.invoiceExternalId}`, { method: "GET" });
    const inv = existing.invoice;
    if (!inv) {
      throw new ProviderError("Zoho invoice not found for append", "validation");
    }
    if (inv.status === "paid" || inv.status === "void" || inv.status === "voided") {
      throw new ProviderError(`Cannot append to invoice in status ${inv.status}`, "validation");
    }

    type ZohoUpdateInvoice = { invoice: { invoice_id: string } };
    const body = {
      line_items: [...inv.line_items, toZohoLine(input.line)],
    };
    const out = await this.call<ZohoUpdateInvoice>(
      `/invoices/${input.invoiceExternalId}`,
      { method: "PUT", body: JSON.stringify(body) },
    );
    if (!out.invoice?.invoice_id) {
      throw new ProviderError("Zoho append-line response missing invoice_id", "unknown", undefined, undefined, out);
    }
    return { externalId: out.invoice.invoice_id, raw: out };
  }

  async voidInvoice(externalInvoiceId: string): Promise<void> {
    await this.call(`/invoices/${externalInvoiceId}/status/void`, { method: "POST" });
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Payments
  // ─────────────────────────────────────────────────────────────────────────

  async recordPayment(input: PaymentInput): Promise<ExternalRef> {
    // Zoho needs the customer_id on the customerpayment, which we look up
    // from the source invoice.
    type ZohoGetInvoice = { invoice: { customer_id: string } };
    const inv = await this.call<ZohoGetInvoice>(`/invoices/${input.invoiceExternalId}`, { method: "GET" });
    const customerId = inv.invoice?.customer_id;
    if (!customerId) {
      throw new ProviderError("Zoho payment: source invoice has no customer_id", "validation");
    }

    const body = {
      customer_id: customerId,
      payment_mode: "Other",
      // Account is the bank/clearing — `account_id` is the Zoho chart-of-accounts ID
      // for the cash/bank account. We pass the code through and look up the id
      // on the Zoho side; if Zoho can't resolve we get a 400 validation error.
      account_id: input.paymentAccountCode,
      date: input.paidAt,
      amount: input.amountCents / 100,
      reference_number: input.reference,
      invoices: [{
        invoice_id: input.invoiceExternalId,
        amount_applied: input.amountCents / 100,
      }],
    };
    type ZohoPaymentResponse = { payment: { payment_id: string } };
    const out = await this.call<ZohoPaymentResponse>(
      "/customerpayments",
      { method: "POST", body: JSON.stringify(body) },
    );
    if (!out.payment?.payment_id) {
      throw new ProviderError("Zoho payment response missing payment_id", "unknown", undefined, undefined, out);
    }
    return { externalId: out.payment.payment_id, raw: out };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Credit notes (refunds)
  // ─────────────────────────────────────────────────────────────────────────

  async createCreditNote(input: CreditNoteInput): Promise<ExternalRef> {
    // Pull customer + currency from the source invoice.
    type ZohoGetInvoice = { invoice: { customer_id: string; currency_code: string } };
    const inv = await this.call<ZohoGetInvoice>(`/invoices/${input.invoiceExternalId}`, { method: "GET" });
    if (!inv.invoice?.customer_id) {
      throw new ProviderError("Zoho credit note: source invoice not found", "validation");
    }

    const body = {
      customer_id: inv.invoice.customer_id,
      date: input.issueDate,
      currency_code: input.currency,
      reference_number: input.reason,
      reason: input.reason,
      line_items: input.lines.map(toZohoLine),
      // Apply the credit note to the source invoice immediately so the books reconcile.
      invoice_id: input.invoiceExternalId,
    };
    type ZohoCreditNoteResponse = { creditnote: { creditnote_id: string } };
    const out = await this.call<ZohoCreditNoteResponse>(
      "/creditnotes",
      { method: "POST", body: JSON.stringify(body) },
    );
    if (!out.creditnote?.creditnote_id) {
      throw new ProviderError("Zoho credit note response missing creditnote_id", "unknown", undefined, undefined, out);
    }
    return { externalId: out.creditnote.creditnote_id, raw: out };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Lookups for the mapping UI
  // ─────────────────────────────────────────────────────────────────────────

  async listAccounts(): Promise<ExternalAccount[]> {
    type ZohoAccountsResponse = {
      chartofaccounts: Array<{
        account_id: string;
        account_name: string;
        account_type?: string;
        account_code?: string;
        is_active?: boolean;
      }>;
    };
    const out = await this.call<ZohoAccountsResponse>("/chartofaccounts", { method: "GET" });
    return (out.chartofaccounts ?? []).map((a) => ({
      // Zoho uses internal account_id; map to `code` so the mapping UI works
      // identically to Xero. account_code is a display field, often empty.
      code: a.account_id,
      name: a.account_code ? `${a.account_code} — ${a.account_name}` : a.account_name,
      type: a.account_type,
      isActive: a.is_active !== false,
    }));
  }

  async listTaxRates(): Promise<ExternalTaxRate[]> {
    type ZohoTaxesResponse = {
      taxes: Array<{
        tax_id: string;
        tax_name: string;
        tax_percentage: number;
      }>;
    };
    const out = await this.call<ZohoTaxesResponse>("/settings/taxes", { method: "GET" });
    return (out.taxes ?? []).map((t) => ({
      code: t.tax_id,
      name: t.tax_name,
      rate: t.tax_percentage,
    }));
  }
}

/** Translate an InvoiceLine to Zoho's line_item shape. */
function toZohoLine(line: InvoiceLine) {
  return {
    name: line.description.slice(0, 100),
    description: line.description,
    quantity: line.quantity || 1,
    rate: line.unitAmountCents / 100,
    // account_id from mapping table
    account_id: line.accountCode,
    // tax_id (UUID) from mapping table — Zoho will reject string codes.
    tax_id: line.taxCode ?? undefined,
  };
}

function classifyZohoError(status: number, json: unknown, text: string): ProviderError {
  // Zoho returns errors in `{ code, message }` shape even on 200.
  const errBody = json as { code?: number; message?: string } | null;
  const detail = errBody?.message ?? text.slice(0, 300);
  const zCode = errBody?.code;

  let classification: SyncErrorClass;
  let errorCode: string | undefined;

  if (status === 401 || status === 403) {
    classification = "auth";
    errorCode = "AUTH";
  } else if (status === 429 || status >= 500) {
    classification = "transient";
    errorCode = status === 429 ? "RATE_LIMIT" : "SERVER_ERROR";
  } else if (status === 404) {
    classification = "validation";
    errorCode = "NOT_FOUND";
  } else if (status === 400) {
    // Zoho duplicate-detect codes: 1010 (contact), 36005 (invoice number used)
    if (zCode === 1010 || zCode === 36005 || /already exists|duplicate/i.test(detail)) {
      classification = "duplicate";
      errorCode = "DUPLICATE";
    } else {
      classification = "validation";
      errorCode = `VALIDATION_${zCode ?? 400}`;
    }
  } else if (zCode && zCode !== 0) {
    // HTTP 200 but Zoho-side error.
    classification = "validation";
    errorCode = `ZOHO_${zCode}`;
  } else {
    classification = "unknown";
    errorCode = `HTTP_${status}`;
  }

  return new ProviderError(
    `zoho ${status} ${classification}: ${detail.slice(0, 300)}`,
    classification,
    status,
    errorCode,
    json,
  );
}
