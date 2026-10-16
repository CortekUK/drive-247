/**
 * Accounting sync v2 — Xero adapter (Accounting API 2.0).
 *
 *   Drive customer  → Contact (ContactNumber = D247-<customer id>)
 *   rental invoice  → Invoice ACCREC, AUTHORISED, one line per Drive charge
 *   payment         → Payment against the invoice (partial allowed)
 *   unapplied money → RECEIVE-PREPAYMENT bank transaction
 *   refund          → Credit note ACCRECCREDIT + a refund Payment against it
 *                     (or a refund Payment against the prepayment)
 *
 * Idempotency: every create sends Xero's `Idempotency-Key` header, so a retry
 * of a request whose response was lost returns the original object instead of
 * a second one. Rate limits: 60 calls/min and 5,000/day per organisation; a 429
 * carries Retry-After and becomes a `rate` ProviderError, and the minute/day
 * remaining headers pause the organisation before it gets there.
 */
import { XERO } from "./config.ts";
import {
  type Account, type AccountRef, type Adapter, type DocResult, type Line, ProviderError, round2, type TaxRate,
} from "./types.ts";

type Json = Record<string, any>;

export function xeroAdapter(opts: {
  tenantId: string;                         // Xero tenant (organisation) id
  token: () => Promise<string>;
  refresh: () => Promise<string>;
  onLowBudget?: (pauseSeconds: number) => void;
}): Adapter {
  let calls = 0;

  async function call(method: string, path: string, body?: unknown, idempotencyKey?: string, retried = false): Promise<Json> {
    calls++;
    const token = retried ? await opts.refresh() : await opts.token();
    const headers: Record<string, string> = {
      Authorization: `Bearer ${token}`,
      "xero-tenant-id": opts.tenantId,
      Accept: "application/json",
    };
    if (body !== undefined) headers["Content-Type"] = "application/json";
    if (idempotencyKey) headers["Idempotency-Key"] = idempotencyKey.slice(0, 128);

    let res: Response;
    try {
      res = await fetch(`${XERO.apiBase}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    } catch (e) {
      throw new ProviderError("transient", `Could not reach Xero: ${e instanceof Error ? e.message : e}`);
    }

    const minLeft = Number(res.headers.get("X-MinLimit-Remaining") ?? "99");
    const dayLeft = Number(res.headers.get("X-DayLimit-Remaining") ?? "9999");
    if (dayLeft <= 25) opts.onLowBudget?.(secondsToUtcMidnight());
    else if (minLeft <= 3) opts.onLowBudget?.(60);

    if (res.status === 401 && !retried) return call(method, path, body, idempotencyKey, true);
    if (res.status === 429) {
      const ra = Number(res.headers.get("Retry-After") ?? "60");
      throw new ProviderError("rate", `Xero rate limit reached (${res.headers.get("X-Rate-Limit-Problem") ?? "minute"}) — retrying in ${ra}s.`, 429, ra);
    }

    const text = await res.text();
    let json: Json = {};
    try { json = text ? JSON.parse(text) : {}; } catch { json = { Message: text.slice(0, 300) }; }

    if (res.status === 401 || res.status === 403) {
      throw new ProviderError("auth", `Xero refused access (${json.Detail ?? json.Title ?? res.status}). Reconnect Xero.`, res.status);
    }
    if (res.status === 404) throw new ProviderError("not_found", `Xero: not found (${path.split("?")[0]})`, 404);
    if (res.status >= 500) throw new ProviderError("transient", `Xero is having trouble (${res.status}) — will retry.`, res.status);
    if (res.status >= 400) throw new ProviderError("validation", `Xero rejected it: ${validationMessage(json)}`, res.status);
    return json;
  }

  const first = (json: Json, key: string): Json => {
    const row = json?.[key]?.[0];
    if (!row) throw new ProviderError("transient", `Xero returned no ${key}.`);
    if (row.HasErrors || row.ValidationErrors?.length) {
      throw new ProviderError("validation", `Xero rejected it: ${(row.ValidationErrors ?? []).map((v: Json) => v.Message).join("; ")}`);
    }
    return row;
  };

  const accountField = (a: AccountRef) => (a.code ? { AccountCode: a.code } : { AccountID: a.id });
  const lineItems = (lines: Line[], sign = 1) =>
    lines.map((l) => ({
      Description: l.description,
      Quantity: 1,
      UnitAmount: round2(l.amount * sign),
      ...accountField(l.account),
      ...(l.taxRateId ? { TaxType: l.taxRateId } : {}),
    }));
  const lineAmountTypes = (lines: Line[]) => (lines.some((l) => l.taxRateId) ? "Exclusive" : "NoTax");
  const where = (expr: string) => `where=${encodeURIComponent(expr)}`;
  const q = (s: string) => s.replace(/"/g, '\\"');

  return {
    provider: "xero",
    calls: () => calls,

    async getOrganisation() {
      const o = first(await call("GET", "/Organisation"), "Organisations");
      return { id: o.OrganisationID, name: o.Name, shortCode: o.ShortCode ?? null, currency: o.BaseCurrency ?? null };
    },

    async listAccounts(): Promise<Account[]> {
      const json = await call("GET", "/Accounts");
      return (json.Accounts ?? [])
        .filter((a: Json) => a.Status === "ACTIVE")
        .map((a: Json) => ({
          id: a.AccountID,
          code: a.Code ?? null,
          name: a.Name,
          type: a.Type,
          canPay: a.Type === "BANK" || a.EnablePaymentsToAccount === true,
          canSell: a.Type !== "BANK",
        }));
    },

    async listTaxRates(): Promise<TaxRate[]> {
      const json = await call("GET", "/TaxRates");
      return (json.TaxRates ?? [])
        .filter((t: Json) => t.Status === "ACTIVE" && t.CanApplyToRevenue !== false)
        .map((t: Json) => ({ id: t.TaxType, name: t.Name, rate: t.EffectiveRate ?? null }));
    },

    async ensureContact(c) {
      const number = c.driveRef.slice(0, 50);
      const byNumber = await call("GET", `/Contacts?${where(`ContactNumber=="${q(number)}"`)}`);
      if (byNumber.Contacts?.[0]) return { id: byNumber.Contacts[0].ContactID };
      if (c.email) {
        const byEmail = await call("GET", `/Contacts?${where(`EmailAddress=="${q(c.email)}"`)}`);
        if (byEmail.Contacts?.[0]) return { id: byEmail.Contacts[0].ContactID };
      }
      const contact = {
        Name: c.name.slice(0, 255),
        ContactNumber: number,
        ...(c.email ? { EmailAddress: c.email } : {}),
        ...(c.phone ? { Phones: [{ PhoneType: "MOBILE", PhoneNumber: c.phone }] } : {}),
      };
      try {
        return { id: first(await call("PUT", "/Contacts", { Contacts: [contact] }, `contact:${number}`), "Contacts").ContactID };
      } catch (e) {
        // Xero contact names are unique: a same-named contact already exists (e.g.
        // entered by hand). Adopt it rather than fail — the accountant gets one
        // contact per person, which is what they want.
        if (e instanceof ProviderError && e.kind === "validation" && /already|unique|name/i.test(e.message)) {
          const byName = await call("GET", `/Contacts?${where(`Name=="${q(contact.Name)}"`)}`);
          if (byName.Contacts?.[0]) return { id: byName.Contacts[0].ContactID };
        }
        throw e;
      }
    },

    async findByReference(kind, reference) {
      const r = q(reference);
      if (kind === "invoice") {
        const j = await call("GET", `/Invoices?${where(`Reference=="${r}" AND Status!="VOIDED" AND Status!="DELETED"`)}`);
        const row = j.Invoices?.[0];
        return row ? { id: row.InvoiceID, number: row.InvoiceNumber } : null;
      }
      if (kind === "credit_note") {
        const j = await call("GET", `/CreditNotes?${where(`Reference=="${r}" AND Status!="VOIDED" AND Status!="DELETED"`)}`);
        const row = j.CreditNotes?.[0];
        return row ? { id: row.CreditNoteID, number: row.CreditNoteNumber } : null;
      }
      if (kind === "prepayment") {
        const j = await call("GET", `/BankTransactions?${where(`Reference=="${r}" AND Status!="DELETED"`)}`);
        const row = j.BankTransactions?.[0];
        return row ? { id: row.BankTransactionID, extra: { prepaymentId: row.PrepaymentID } } : null;
      }
      const j = await call("GET", `/Payments?${where(`Reference=="${r}" AND Status!="DELETED"`)}`);
      const row = j.Payments?.[0];
      return row ? { id: row.PaymentID } : null;
    },

    async createInvoice(p, key) {
      const row = first(await call("PUT", "/Invoices", {
        Invoices: [{
          Type: "ACCREC",
          Contact: { ContactID: p.contactId },
          Date: p.date,
          DueDate: p.dueDate,
          InvoiceNumber: p.number,
          Reference: p.reference,
          CurrencyCode: p.currency,
          Status: "AUTHORISED",
          LineAmountTypes: lineAmountTypes(p.lines),
          LineItems: lineItems(p.lines),
        }],
      }, key), "Invoices");
      return { id: row.InvoiceID, number: row.InvoiceNumber };
    },

    async voidInvoice(id) {
      await call("POST", `/Invoices/${id}`, { Invoices: [{ InvoiceID: id, Status: "VOIDED" }] });
    },

    async amountDue(invoiceId) {
      const row = first(await call("GET", `/Invoices/${invoiceId}`), "Invoices");
      return Number(row.AmountDue ?? 0);
    },

    async createPayment(p, key) {
      const row = first(await call("PUT", "/Payments", {
        Payments: [{
          Invoice: { InvoiceID: p.invoiceId },
          Account: { AccountID: p.account.id },
          Date: p.date,
          Amount: round2(p.amount),
          Reference: p.reference,
        }],
      }, key), "Payments");
      return { id: row.PaymentID };
    },

    async deletePayment(id) {
      try {
        await call("POST", `/Payments/${id}`, { Payments: [{ PaymentID: id, Status: "DELETED" }] });
      } catch (e) {
        if (!(e instanceof ProviderError && e.kind === "not_found")) throw e;
      }
    },

    async createPrepayment(p, key) {
      const row = first(await call("PUT", "/BankTransactions", {
        BankTransactions: [{
          Type: "RECEIVE-PREPAYMENT",
          Contact: { ContactID: p.contactId },
          BankAccount: { AccountID: p.account.id },
          Date: p.date,
          Reference: p.reference,
          CurrencyCode: p.currency,
          LineAmountTypes: "NoTax",
          LineItems: [{ Description: `Customer credit · ${p.reference}`, Quantity: 1, UnitAmount: round2(p.amount), ...accountField(p.lineAccount) }],
        }],
      }, key), "BankTransactions");
      return { id: row.BankTransactionID, extra: { prepaymentId: row.PrepaymentID } };
    },

    async deletePrepayment(doc) {
      try {
        await call("POST", `/BankTransactions/${doc.id}`, { BankTransactions: [{ BankTransactionID: doc.id, Status: "DELETED" }] });
      } catch (e) {
        if (!(e instanceof ProviderError && e.kind === "not_found")) throw e;
      }
    },

    async createCreditNote(p, key) {
      const row = first(await call("PUT", "/CreditNotes", {
        CreditNotes: [{
          Type: "ACCRECCREDIT",
          Contact: { ContactID: p.contactId },
          Date: p.date,
          CreditNoteNumber: p.number,
          Reference: p.reference,
          CurrencyCode: p.currency,
          Status: "AUTHORISED",
          LineAmountTypes: lineAmountTypes(p.lines),
          LineItems: lineItems(p.lines),
        }],
      }, key), "CreditNotes");
      return { id: row.CreditNoteID, number: row.CreditNoteNumber };
    },

    async voidCreditNote(id) {
      try {
        await call("POST", `/CreditNotes/${id}`, { CreditNotes: [{ CreditNoteID: id, Status: "VOIDED" }] });
      } catch (e) {
        if (!(e instanceof ProviderError && e.kind === "not_found")) throw e;
      }
    },

    async refundCreditNote(p, key) {
      const row = first(await call("PUT", "/Payments", {
        Payments: [{
          CreditNote: { CreditNoteID: p.creditNoteId },
          Account: { AccountID: p.account.id },
          Date: p.date,
          Amount: round2(p.amount),
          Reference: p.reference,
        }],
      }, key), "Payments");
      return { id: row.PaymentID };
    },

    async refundPrepayment(p, key) {
      const prepaymentId = p.prepayment.extra?.prepaymentId ?? p.prepayment.id;
      const row = first(await call("PUT", "/Payments", {
        Payments: [{
          Prepayment: { PrepaymentID: prepaymentId },
          Account: { AccountID: p.account.id },
          Date: p.date,
          Amount: round2(p.amount),
          Reference: p.reference,
        }],
      }, key), "Payments");
      return { id: row.PaymentID };
    },

    async deleteRefund(p) {
      // In Xero a refund IS a Payment row.
      try {
        await call("POST", `/Payments/${p.id}`, { Payments: [{ PaymentID: p.id, Status: "DELETED" }] });
      } catch (e) {
        if (!(e instanceof ProviderError && e.kind === "not_found")) throw e;
      }
    },

    async revoke(refreshToken) {
      if (!refreshToken) return;
      const id = Deno.env.get("XERO_CLIENT_ID");
      const secret = Deno.env.get("XERO_CLIENT_SECRET");
      if (!id || !secret) return;
      await fetch(XERO.revokeUrl, {
        method: "POST",
        headers: { Authorization: `Basic ${btoa(`${id}:${secret}`)}`, "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ token: refreshToken }).toString(),
      }).catch(() => undefined);
    },
  };
}

function validationMessage(json: Json): string {
  const errs: string[] = [];
  for (const el of json?.Elements ?? []) for (const v of el?.ValidationErrors ?? []) if (v?.Message) errs.push(v.Message);
  return errs.length ? errs.join("; ") : (json?.Message ?? json?.Detail ?? json?.Title ?? "unknown error");
}

function secondsToUtcMidnight(): number {
  const now = new Date();
  const next = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
  return Math.ceil((next - now.getTime()) / 1000);
}
