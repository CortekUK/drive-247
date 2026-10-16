/**
 * Accounting sync v2 — Zoho Books adapter (Books API v3).
 *
 *   Drive customer  → Contact (contact_type customer)
 *   rental invoice  → Invoice (marked sent), one line per Drive charge
 *   payment         → Customer payment applied to the invoice
 *   unapplied money → Customer payment with no invoice (excess payment)
 *   refund          → Credit note + credit-note refund (or a refund of the excess payment)
 *
 * Zoho has no idempotency header. Duplicates are prevented the two ways the
 * engine always uses: the entity map is checked before every create, and a
 * create whose outcome is unknown (the map holds a `pending:` marker) is first
 * looked up by its reference via `findByReference`.
 *
 * The API base is the `api_domain` Zoho returned at sign-in (www.zohoapis.eu
 * for an EU account and so on), never a guessed one. Zoho reports most errors
 * as HTTP 200/400 with a non-zero `code`. Rate limit: ~100 calls/min per org;
 * 429 → `rate`.
 */
import {
  type Account, type AccountRef, type Adapter, type DocResult, type Line, type PayMethod, ProviderError, round2, type TaxRate,
} from "./types.ts";

type Json = Record<string, any>;

const MODE: Record<PayMethod, string> = {
  card: "creditcard",
  cash: "cash",
  bank_transfer: "banktransfer",
  cheque: "check",
  other: "others",
};

export function zohoAdapter(opts: {
  orgId: string;
  apiDomain: string;               // https://www.zohoapis.com
  accountsServer: string | null;
  token: () => Promise<string>;
  refresh: () => Promise<string>;
}): Adapter {
  let calls = 0;
  const base = `${opts.apiDomain.replace(/\/+$/, "")}/books/v3`;

  async function call(method: string, path: string, body?: unknown, retried = false): Promise<Json> {
    calls++;
    const token = retried ? await opts.refresh() : await opts.token();
    const sep = path.includes("?") ? "&" : "?";
    let res: Response;
    try {
      res = await fetch(`${base}${path}${sep}organization_id=${encodeURIComponent(opts.orgId)}`, {
        method,
        headers: {
          Authorization: `Zoho-oauthtoken ${token}`,
          Accept: "application/json",
          ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch (e) {
      throw new ProviderError("transient", `Could not reach Zoho: ${e instanceof Error ? e.message : e}`);
    }
    if (res.status === 429) {
      throw new ProviderError("rate", "Zoho rate limit reached — retrying in a minute.", 429, Number(res.headers.get("Retry-After") ?? "60"));
    }
    const json = await res.json().catch(() => ({})) as Json;
    const code = typeof json.code === "number" ? json.code : res.ok ? 0 : -1;

    // 57: not authorised for this org/scope; 14: invalid token.
    if ((res.status === 401 || code === 14) && !retried) return call(method, path, body, true);
    if (res.status === 401 || code === 14 || code === 57) {
      throw new ProviderError("auth", `Zoho refused access (${json.message ?? res.status}). Reconnect Zoho Books.`, res.status);
    }
    if (code === 44 || code === 45 || /too many requests|maximum number of api/i.test(json.message ?? "")) {
      throw new ProviderError("rate", `Zoho rate limit: ${json.message}`, res.status, 60);
    }
    if (res.status === 404 || code === 1002 || code === 5) throw new ProviderError("not_found", `Zoho: ${json.message ?? "not found"}`, res.status);
    if (res.status >= 500) throw new ProviderError("transient", `Zoho is having trouble (${res.status}) — will retry.`, res.status);
    if (code !== 0) throw new ProviderError("validation", `Zoho rejected it: ${json.message ?? `code ${code}`}`, res.status);
    return json;
  }

  const lineItems = (lines: Line[], sign = 1) =>
    lines.map((l) => ({
      name: l.name.slice(0, 100),
      description: l.description.slice(0, 2000),
      rate: round2(l.amount * sign),
      quantity: 1,
      account_id: l.account.id,
      ...(l.taxRateId ? { tax_id: l.taxRateId } : {}),
    }));

  async function search(path: string, listKey: string, field: string, reference: string): Promise<Json | null> {
    const j = await call("GET", `${path}?search_text=${encodeURIComponent(reference)}`);
    return (j[listKey] ?? []).find((r: Json) => r[field] === reference && r.status !== "void") ?? null;
  }

  const ignoreMissing = async (fn: () => Promise<unknown>) => {
    try { await fn(); } catch (e) { if (!(e instanceof ProviderError && e.kind === "not_found")) throw e; }
  };

  return {
    provider: "zoho",
    calls: () => calls,

    async getOrganisation() {
      const o = (await call("GET", `/organizations/${opts.orgId}`)).organization ?? {};
      return { id: o.organization_id ?? opts.orgId, name: o.name ?? "Zoho Books", shortCode: null, currency: o.currency_code ?? null };
    },

    async listAccounts(): Promise<Account[]> {
      const j = await call("GET", "/chartofaccounts?filter_by=AccountType.Active");
      return (j.chartofaccounts ?? []).map((a: Json) => {
        const t = String(a.account_type ?? "");
        return {
          id: a.account_id,
          code: a.account_code || null,
          name: a.account_name,
          type: t,
          canPay: t === "bank" || t === "cash" || t === "other_current_asset" && /undeposited/i.test(a.account_name ?? ""),
          canSell: ["income", "other_income", "other_current_liability", "other_liability"].includes(t),
        };
      });
    },

    async listTaxRates(): Promise<TaxRate[]> {
      const j = await call("GET", "/settings/taxes");
      return (j.taxes ?? []).map((t: Json) => ({ id: t.tax_id, name: t.tax_name, rate: t.tax_percentage ?? null }));
    },

    async ensureContact(c) {
      const tag = c.driveRef;
      if (c.email) {
        const j = await call("GET", `/contacts?contact_type=customer&search_text=${encodeURIComponent(c.email)}`);
        const hit = (j.contacts ?? []).find((x: Json) => (x.email ?? "").toLowerCase() === c.email!.toLowerCase());
        if (hit) return { id: hit.contact_id };
      }
      const body = {
        contact_name: c.name.slice(0, 200),
        contact_type: "customer",
        notes: `Drive247 customer ${tag}`,
        ...(c.email || c.phone ? {
          contact_persons: [{ first_name: c.name.slice(0, 100), email: c.email ?? undefined, mobile: c.phone ?? undefined, is_primary_contact: true }],
        } : {}),
      };
      try {
        return { id: (await call("POST", "/contacts", body)).contact.contact_id };
      } catch (e) {
        // Contact names are unique in Zoho Books: adopt the existing one.
        if (e instanceof ProviderError && e.kind === "validation" && /exists|already/i.test(e.message)) {
          const j = await call("GET", `/contacts?contact_name=${encodeURIComponent(body.contact_name)}`);
          const hit = (j.contacts ?? [])[0];
          if (hit) return { id: hit.contact_id };
        }
        throw e;
      }
    },

    async findByReference(kind, reference) {
      if (kind === "invoice") {
        const r = await search("/invoices", "invoices", "reference_number", reference);
        return r ? { id: r.invoice_id, number: r.invoice_number } : null;
      }
      if (kind === "credit_note") {
        const r = await search("/creditnotes", "creditnotes", "reference_number", reference);
        return r ? { id: r.creditnote_id, number: r.creditnote_number } : null;
      }
      const r = await search("/customerpayments", "customerpayments", "reference_number", reference);
      return r ? { id: r.payment_id } : null;
    },

    async createInvoice(p) {
      const inv = (await call("POST", "/invoices", {
        customer_id: p.contactId,
        reference_number: p.reference,
        date: p.date,
        due_date: p.dueDate,
        is_inclusive_tax: false,
        line_items: lineItems(p.lines),
        notes: `Drive247 invoice ${p.number}`,
      })).invoice;
      // New invoices are drafts; a payment cannot be applied until it is sent.
      await call("POST", `/invoices/${inv.invoice_id}/status/sent`).catch(() => undefined);
      return { id: inv.invoice_id, number: inv.invoice_number };
    },

    async voidInvoice(id) {
      await ignoreMissing(() => call("POST", `/invoices/${id}/status/void`));
    },

    async amountDue(invoiceId) {
      const inv = (await call("GET", `/invoices/${invoiceId}`)).invoice ?? {};
      return Number(inv.balance ?? 0);
    },

    async createPayment(p) {
      const pay = (await call("POST", "/customerpayments", {
        customer_id: p.contactId,
        payment_mode: MODE[p.method],
        amount: round2(p.amount),
        date: p.date,
        reference_number: p.reference,
        account_id: p.account.id,
        invoices: [{ invoice_id: p.invoiceId, amount_applied: round2(p.amount) }],
      })).payment;
      return { id: pay.payment_id };
    },

    async deletePayment(id) {
      await ignoreMissing(() => call("DELETE", `/customerpayments/${id}`));
    },

    async createPrepayment(p) {
      const pay = (await call("POST", "/customerpayments", {
        customer_id: p.contactId,
        payment_mode: MODE[p.method],
        amount: round2(p.amount),
        date: p.date,
        reference_number: p.reference,
        account_id: p.account.id,
        invoices: [],
      })).payment;
      return { id: pay.payment_id };
    },

    async deletePrepayment(doc) {
      await ignoreMissing(() => call("DELETE", `/customerpayments/${doc.id}`));
    },

    async createCreditNote(p) {
      const cn = (await call("POST", "/creditnotes", {
        customer_id: p.contactId,
        date: p.date,
        reference_number: p.reference,
        is_inclusive_tax: false,
        line_items: lineItems(p.lines),
        notes: `Drive247 ${p.number}`,
      })).creditnote;
      await call("POST", `/creditnotes/${cn.creditnote_id}/status/open`).catch(() => undefined);
      return { id: cn.creditnote_id, number: cn.creditnote_number };
    },

    async voidCreditNote(id) {
      await ignoreMissing(() => call("POST", `/creditnotes/${id}/status/void`));
    },

    async refundCreditNote(p) {
      const r = (await call("POST", `/creditnotes/${p.creditNoteId}/refunds`, {
        date: p.date,
        refund_mode: MODE[p.method],
        reference_number: p.reference,
        amount: round2(p.amount),
        from_account_id: p.account.id,
      })).creditnote_refund;
      return { id: r.creditnote_refund_id };
    },

    async refundPrepayment(p) {
      const r = (await call("POST", `/customerpayments/${p.prepayment.id}/refunds`, {
        date: p.date,
        refund_mode: MODE[p.method],
        reference_number: p.reference,
        amount: round2(p.amount),
        from_account_id: p.account.id,
      })).payment_refund;
      return { id: r.payment_refund_id };
    },

    async deleteRefund(p) {
      if (p.creditNoteId) await ignoreMissing(() => call("DELETE", `/creditnotes/${p.creditNoteId}/refunds/${p.id}`));
      else if (p.prepaymentId) await ignoreMissing(() => call("DELETE", `/customerpayments/${p.prepaymentId}/refunds/${p.id}`));
    },

    async revoke(refreshToken) {
      if (!refreshToken || !opts.accountsServer) return;
      await fetch(`${opts.accountsServer.replace(/\/+$/, "")}/oauth/v2/token/revoke?token=${encodeURIComponent(refreshToken)}`, {
        method: "POST",
      }).catch(() => undefined);
    },
  };
}

export type { AccountRef, DocResult };
