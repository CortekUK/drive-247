/**
 * Finance Sync — Xero implementation of AccountingProvider.
 *
 * Spec §3 + §7 + §19.1.
 *
 * Key Xero behaviours:
 *  - Auth: Bearer + `Xero-tenant-id` header (the org id, not Drive247's tenant_id)
 *  - Idempotency: `Idempotency-Key` header on POSTs to /Invoices, /Payments, /CreditNotes
 *  - Rate limit: 60 calls/min per tenant — sync worker caps at 50/min
 *  - Tax: pass `TaxType` string codes like `OUTPUT2` (UK 20% VAT) or `NONE`
 *  - `LineAmountTypes: 'Inclusive'` or `'Exclusive'` — we use Exclusive so
 *    `UnitAmount` is the net price and Xero computes the tax line.
 */

import { XERO } from "./oauth-constants.ts";
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

export class XeroClient implements AccountingProvider {
  readonly name = "xero" as const;

  constructor(
    private readonly accessToken: string,
    private readonly tenantId: string,    // Xero's tenantId (their org id)
  ) {}

  private headers(extra: Record<string, string> = {}): Record<string, string> {
    return {
      Authorization: `Bearer ${this.accessToken}`,
      "Xero-tenant-id": this.tenantId,
      Accept: "application/json",
      ...extra,
    };
  }

  /**
   * Helper that does fetch + Xero-flavoured error classification.
   * Centralised so every provider call gets consistent retry semantics.
   */
  private async call<T>(
    path: string,
    init: RequestInit = {},
    idempotencyKey?: string,
  ): Promise<T> {
    const headers: Record<string, string> = {
      ...this.headers(),
      ...(init.headers as Record<string, string> | undefined),
    };
    if (init.body !== undefined) {
      headers["Content-Type"] = "application/json";
    }
    if (idempotencyKey) {
      headers["Idempotency-Key"] = idempotencyKey;
    }
    const url = path.startsWith("http") ? path : `${XERO.apiBase}${path}`;

    const res = await fetch(url, { ...init, headers });
    const text = await res.text();
    let json: unknown = null;
    try { json = text ? JSON.parse(text) : null; } catch { /* ignore */ }

    if (!res.ok) {
      throw classifyXeroError(res.status, json, text);
    }
    return json as T;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Contacts
  // ─────────────────────────────────────────────────────────────────────────

  async upsertContact(input: ContactInput): Promise<ExternalRef> {
    // Xero supports POST /Contacts with summarizeErrors=false to upsert.
    // ContactNumber acts as our idempotency anchor — if same ContactNumber
    // already exists, Xero updates it instead of creating a duplicate.
    const body = {
      Contacts: [{
        Name: input.name,
        EmailAddress: input.email,
        Phones: input.phone ? [{ PhoneType: "DEFAULT", PhoneNumber: input.phone }] : undefined,
        Addresses: input.address ? [{
          AddressType: "STREET",
          AddressLine1: input.address.line1,
          City: input.address.city,
          Region: input.address.region,
          PostalCode: input.address.postcode,
          Country: input.address.country,
        }] : undefined,
        ContactNumber: input.externalIdHint,
      }],
    };
    type XeroContactsResponse = { Contacts: Array<{ ContactID: string }> };
    const out = await this.call<XeroContactsResponse>(
      "/Contacts?summarizeErrors=false",
      { method: "POST", body: JSON.stringify(body) },
      input.externalIdHint ? `contact-${input.externalIdHint}` : undefined,
    );
    const created = out.Contacts?.[0];
    if (!created?.ContactID) throw new ProviderError("Xero contact response missing ContactID", "unknown", undefined, undefined, out);
    return { externalId: created.ContactID, raw: out };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Invoices
  // ─────────────────────────────────────────────────────────────────────────

  async createInvoice(input: InvoiceInput): Promise<ExternalRef> {
    const body = {
      Invoices: [{
        Type: "ACCREC",                  // accounts receivable invoice
        Contact: { ContactID: input.contactExternalId },
        InvoiceNumber: input.invoiceNumber,
        Reference: input.reference,
        Date: input.issueDate,
        DueDate: input.dueDate ?? input.issueDate,
        CurrencyCode: input.currency,
        Status: "AUTHORISED",            // immediately approved — operator already approved in Drive247
        LineAmountTypes: "Exclusive",
        LineItems: input.lines.map(toXeroLine),
      }],
    };
    type XeroInvoicesResponse = {
      Invoices: Array<{
        InvoiceID: string;
        InvoiceNumber: string;
        Status: string;
        HasErrors?: boolean;
        ValidationErrors?: Array<{ Message: string }>;
      }>;
    };
    // Idempotency key — Xero caches the request body keyed on this for 24h.
    // We hash the actual request body into the key so legitimate retries
    // (same body) dedupe, but distinct attempts (different lines, currency
    // change, etc.) get fresh keys. Avoids the "Idempotency Key is used
    // with a different request" 400 when config changes mid-debug.
    const bodyDigestSrc = `${input.invoiceNumber}|${input.currency}|${input.lines.map((l) => `${l.description}:${l.unitAmountCents}:${l.accountCode}`).join(",")}`;
    let digest = 0;
    for (let i = 0; i < bodyDigestSrc.length; i++) digest = ((digest << 5) - digest + bodyDigestSrc.charCodeAt(i)) | 0;
    const bodyHash = Math.abs(digest).toString(36);
    const out = await this.call<XeroInvoicesResponse>(
      "/Invoices?summarizeErrors=false",
      { method: "POST", body: JSON.stringify(body) },
      `invoice-${input.invoiceNumber}-${bodyHash}`,
    );
    const created = out.Invoices?.[0];
    // With ?summarizeErrors=false Xero returns 200 even when validation fails;
    // the failed Invoice carries `ValidationErrors[]` and `InvoiceID` is the
    // all-zeros sentinel `00000000-0000-0000-0000-000000000000`. Treat both
    // signals as a hard failure so we don't store a phantom invoice id.
    const isNullUUID = created?.InvoiceID && /^0{8}-0{4}-0{4}-0{4}-0{12}$/.test(created.InvoiceID);
    const hasValidationErrors = (created?.ValidationErrors?.length ?? 0) > 0 || created?.HasErrors === true;
    if (!created?.InvoiceID || isNullUUID || hasValidationErrors) {
      const reasons = (created?.ValidationErrors ?? []).map((e) => e.Message).join("; ") || "InvoiceID missing or null UUID";
      throw new ProviderError(
        `Xero invoice creation rejected: ${reasons}`,
        "validation",
        undefined,
        "INVOICE_VALIDATION_FAILED",
        out,
      );
    }
    return { externalId: created.InvoiceID, raw: out };
  }

  async appendInvoiceLine(input: InvoiceLineAppend): Promise<ExternalRef> {
    // Xero's update pattern: GET the existing invoice, append the new line
    // to the existing LineItems array, then POST back. Idempotency is
    // tricky — we tag the new line with a unique LineItem.LineItemID-less
    // payload and rely on the caller (sync worker) to check the line wasn't
    // already added via Tracking categories / Description prefix.
    type GetInvoiceResponse = { Invoices: Array<{ LineItems: unknown[]; Status: string }> };
    const existing = await this.call<GetInvoiceResponse>(
      `/Invoices/${input.invoiceExternalId}`,
      { method: "GET" },
    );
    const inv = existing.Invoices?.[0];
    if (!inv) {
      throw new ProviderError("Xero invoice not found for append", "validation");
    }
    if (inv.Status !== "AUTHORISED" && inv.Status !== "DRAFT") {
      throw new ProviderError(`Cannot append to invoice in status ${inv.Status}`, "validation");
    }

    const body = {
      Invoices: [{
        InvoiceID: input.invoiceExternalId,
        LineAmountTypes: "Exclusive",
        LineItems: [...inv.LineItems, toXeroLine(input.line)],
      }],
    };
    type XeroInvoicesResponse = { Invoices: Array<{ InvoiceID: string }> };
    // Idempotency key — hash the line's content so each distinct line gets
    // a unique key. Previously this used `line.reference` (the vehicle reg)
    // which is identical across all lines for the same rental, causing
    // "Idempotency Key is used with a different request" on the 2nd+ line.
    const lineDigestSrc = `${input.line.description}:${input.line.unitAmountCents}:${input.line.accountCode}:${input.line.taxCode ?? ""}`;
    let lineDigest = 0;
    for (let i = 0; i < lineDigestSrc.length; i++) lineDigest = ((lineDigest << 5) - lineDigest + lineDigestSrc.charCodeAt(i)) | 0;
    const lineHash = Math.abs(lineDigest).toString(36);
    const out = await this.call<XeroInvoicesResponse>(
      `/Invoices/${input.invoiceExternalId}`,
      { method: "POST", body: JSON.stringify(body) },
      `invoice-line-${input.invoiceExternalId}-${lineHash}`,
    );
    const updated = out.Invoices?.[0];
    if (!updated?.InvoiceID) throw new ProviderError("Xero append-line response missing InvoiceID", "unknown", undefined, undefined, out);
    return { externalId: updated.InvoiceID, raw: out };
  }

  async voidInvoice(externalInvoiceId: string): Promise<void> {
    await this.call(
      `/Invoices/${externalInvoiceId}`,
      { method: "POST", body: JSON.stringify({ Invoices: [{ InvoiceID: externalInvoiceId, Status: "VOIDED" }] }) },
    );
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Payments
  // ─────────────────────────────────────────────────────────────────────────

  async recordPayment(input: PaymentInput): Promise<ExternalRef> {
    const body = {
      Payments: [{
        Invoice: { InvoiceID: input.invoiceExternalId },
        Account: { Code: input.paymentAccountCode },
        Date: input.paidAt,
        Amount: input.amountCents / 100,
        CurrencyRate: 1.0,
        Reference: input.reference,
      }],
    };
    type XeroPaymentsResponse = { Payments: Array<{ PaymentID: string }> };
    const out = await this.call<XeroPaymentsResponse>(
      "/Payments?summarizeErrors=false",
      { method: "POST", body: JSON.stringify(body) },
      `payment-${input.invoiceExternalId}-${input.paidAt}-${input.amountCents}`,
    );
    const created = out.Payments?.[0];
    if (!created?.PaymentID) throw new ProviderError("Xero payment response missing PaymentID", "unknown", undefined, undefined, out);
    return { externalId: created.PaymentID, raw: out };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Credit notes (refunds)
  // ─────────────────────────────────────────────────────────────────────────

  async createCreditNote(input: CreditNoteInput): Promise<ExternalRef> {
    // First, find the contact id from the invoice. We need it because Xero's
    // CreditNote endpoint requires the contact, not just an invoice ref.
    type GetInvoiceResponse = { Invoices: Array<{ Contact: { ContactID: string }; CurrencyCode: string }> };
    const inv = await this.call<GetInvoiceResponse>(`/Invoices/${input.invoiceExternalId}`, { method: "GET" });
    const contactId = inv.Invoices?.[0]?.Contact?.ContactID;
    if (!contactId) throw new ProviderError("Xero credit note: source invoice not found", "validation");

    const body = {
      CreditNotes: [{
        Type: "ACCRECCREDIT",
        Contact: { ContactID: contactId },
        Date: input.issueDate,
        CurrencyCode: input.currency,
        Status: "AUTHORISED",
        LineAmountTypes: "Exclusive",
        Reference: input.reason,
        LineItems: input.lines.map(toXeroLine),
      }],
    };
    type XeroCreditNotesResponse = { CreditNotes: Array<{ CreditNoteID: string }> };
    const out = await this.call<XeroCreditNotesResponse>(
      "/CreditNotes?summarizeErrors=false",
      { method: "POST", body: JSON.stringify(body) },
      `creditnote-${input.invoiceExternalId}-${input.amountCents}-${input.issueDate}`,
    );
    const created = out.CreditNotes?.[0];
    if (!created?.CreditNoteID) throw new ProviderError("Xero credit note response missing CreditNoteID", "unknown", undefined, undefined, out);

    // Apply the credit note to the source invoice immediately so the books reconcile.
    try {
      await this.call(
        `/CreditNotes/${created.CreditNoteID}/Allocations`,
        {
          method: "POST",
          body: JSON.stringify({
            Allocations: [{
              Amount: input.amountCents / 100,
              Invoice: { InvoiceID: input.invoiceExternalId },
              Date: input.issueDate,
            }],
          }),
        },
        `creditnote-alloc-${created.CreditNoteID}`,
      );
    } catch (err) {
      // Allocation failure isn't fatal — the credit note exists; operator can
      // allocate manually. Log + continue.
      console.warn("xero allocation failed:", err);
    }

    return { externalId: created.CreditNoteID, raw: out };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Lookups for the mapping UI
  // ─────────────────────────────────────────────────────────────────────────

  async listAccounts(): Promise<ExternalAccount[]> {
    type XeroAccountsResponse = { Accounts: Array<{ Code: string; Name: string; Type: string; Status: string }> };
    const out = await this.call<XeroAccountsResponse>(`/Accounts?where=Status%3D%3D%22ACTIVE%22`, { method: "GET" });
    return (out.Accounts ?? []).map((a) => ({
      code: a.Code,
      name: a.Name,
      type: a.Type,
      isActive: a.Status === "ACTIVE",
    }));
  }

  async listTaxRates(): Promise<ExternalTaxRate[]> {
    type XeroTaxRatesResponse = { TaxRates: Array<{ TaxType: string; Name: string; EffectiveRate?: number; Status: string }> };
    const out = await this.call<XeroTaxRatesResponse>("/TaxRates", { method: "GET" });
    return (out.TaxRates ?? [])
      .filter((r) => r.Status === "ACTIVE")
      .map((r) => ({
        code: r.TaxType,
        name: r.Name,
        rate: r.EffectiveRate,
      }));
  }
}

/** Convert an InvoiceLine into the Xero line shape. */
function toXeroLine(line: InvoiceLine) {
  return {
    Description: line.description,
    Quantity: line.quantity || 1,
    UnitAmount: line.unitAmountCents / 100,
    AccountCode: line.accountCode,
    TaxType: line.taxCode ?? undefined,
    LineAmount: undefined,            // let Xero compute
  };
}

function classifyXeroError(status: number, json: unknown, text: string): ProviderError {
  const errBody = json as { Title?: string; Detail?: string; ErrorNumber?: number; Elements?: Array<{ ValidationErrors?: Array<{ Message: string }> }> } | null;
  const validationMsgs = errBody?.Elements?.[0]?.ValidationErrors?.map((v) => v.Message).join("; ");
  const detail = validationMsgs ?? errBody?.Detail ?? errBody?.Title ?? text.slice(0, 300);

  let classification: SyncErrorClass;
  let errorCode: string | undefined;

  if (status === 401 || status === 403) {
    classification = "auth";
    errorCode = "AUTH";
  } else if (status === 429 || status >= 500) {
    classification = "transient";
    errorCode = status === 429 ? "RATE_LIMIT" : "SERVER_ERROR";
  } else if (status === 400) {
    // Xero returns 400 for both validation errors AND duplicate detections.
    // Detect "already exists" wording.
    if (/already exists|duplicate|conflict/i.test(detail)) {
      classification = "duplicate";
      errorCode = "DUPLICATE";
    } else {
      classification = "validation";
      errorCode = "VALIDATION";
    }
  } else if (status === 404) {
    classification = "validation";
    errorCode = "NOT_FOUND";
  } else {
    classification = "unknown";
    errorCode = `HTTP_${status}`;
  }

  return new ProviderError(
    `xero ${status} ${classification}: ${detail.slice(0, 300)}`,
    classification,
    status,
    errorCode,
    json,
  );
}
