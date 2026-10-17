/**
 * Accounting sync v2 — the provider-agnostic engine.
 *
 * Each sync item says "make the books match Drive for this source". The engine
 * reads Drive NOW, compares it with what `accounting_entity_map` says is
 * already upstream, and sends only the difference. That one rule is what makes
 * retries, edits, re-allocations and deletes safe:
 *
 *   invoice (a rental)  Its Charge rows are the invoice lines. A charge not yet
 *                       upstream, or changed since, is a DELTA. Positive deltas
 *                       go on the rental's invoice — the first one is the main
 *                       invoice under the Drive invoice number, later ones a
 *                       supplementary invoice (INV-1044-01-2), because an
 *                       invoice that already has payments cannot be edited.
 *                       Net-negative deltas go on a credit note.
 *   payment             Applied to the upstream invoice(s) that hold the
 *                       charges it pays (payment_applications). Money not
 *                       applied to any charge is a prepayment / excess payment.
 *                       If the allocation changed, the old upstream payments
 *                       are removed and re-posted.
 *   refund              Split over the invoices the payment was posted to,
 *                       pro rata (as the Finances tab splits it): a credit note
 *                       for each share plus a cash refund out of the account
 *                       the payment went into.
 *
 * Every create is guarded twice against duplicates: the provider's own
 * idempotency key (Xero), and a `pending:` marker written to the entity map
 * before the call — if a later run finds the marker, the outcome is unknown and
 * the object is looked up by its reference before anything is created again.
 */
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
import type { Provider } from "./config.ts";
import {
  type Account, type AccountRef, type AccountSettings, type Adapter, type Connection, type DocResult, EPS, type Line,
  type PayMethod, ProviderError, round2,
} from "./types.ts";

export interface SyncItem {
  id: string;
  tenant_id: string;
  provider: Provider;
  source_type: "invoice" | "payment" | "refund";
  source_id: string;
  operation: "sync" | "delete";
  occurred_at: string;
  /** Latest of the business date and when Drive recorded it: what the start point is checked against. */
  scope_at?: string | null;
  generation: number;
  attempts: number;
  idempotency_key: string;
  payload: Record<string, any> | null;
}

export interface Outcome {
  outcome: "sent" | "drop";
  externalId?: string | null;
}

type MapRow = {
  id: string;
  entity_type: string;
  drive_id: string;
  part: string;
  external_id: string;
  external_number: string | null;
  amount: number | null;
  meta: Record<string, any>;
};

const LANDED = new Set(["Applied", "Completed", "Partial", "Credit", "Partial Refund", "Refunded"]);

export function refundAmountOf(p: Record<string, any> | null): number {
  if (!p) return 0;
  if (["processing", "scheduled", "pending", "failed"].includes(String(p.refund_status ?? "").toLowerCase())) return 0;
  const raw = Number(p.refund_amount ?? 0);
  if (raw <= EPS) return 0;
  const whole = Number(p.amount ?? 0);
  return round2(Math.min(raw, whole > 0 ? whole : raw));
}

const day = (v: string | null | undefined) => (v ? String(v).slice(0, 10) : new Date().toISOString().slice(0, 10));

/* ───────────────────────────── settings ─────────────────────────────────── */

/**
 * Fill every unset mapping from the provider's chart so a new connection works
 * with zero configuration, and remember what was chosen (`auto`).
 */
/** The mapping once every account is filled in. */
export type ResolvedSettings = {
  card_account: AccountRef; manual_account: AccountRef; sales_account: AccountRef; deposit_account: AccountRef; tax_account: AccountRef;
  tax_rate?: AccountSettings["tax_rate"]; auto?: string[];
};

export async function resolveSettings(db: SupabaseClient, conn: Connection, adapter: Adapter): Promise<ResolvedSettings> {
  const s: AccountSettings = { ...(conn.settings ?? {}) };
  const need = ["card_account", "manual_account", "sales_account", "deposit_account", "tax_account"]
    .filter((k) => !(s as any)[k]?.id);
  if (need.length === 0) return s as any;

  const accounts = await adapter.listAccounts();
  const picked = pickDefaults(conn.provider, accounts);
  const auto = new Set(s.auto ?? []);
  for (const k of need) {
    const a = (picked as any)[k] as Account | undefined;
    if (a) {
      (s as any)[k] = { id: a.id, code: a.code, name: a.name };
      auto.add(k);
    }
  }
  s.auto = [...auto];
  const missing = need.filter((k) => !(s as any)[k]?.id);
  await db.from("accounting_v2_connections").update({ settings: s, updated_at: new Date().toISOString() }).eq("id", conn.id);
  conn.settings = s;
  if (missing.length) {
    throw new ProviderError("validation",
      `No ${missing.map((k) => k.replace("_account", "").replace("_", " ")).join(", ")} account could be found in ${conn.provider === "xero" ? "Xero" : "Zoho Books"}. Choose one under "Where things land".`);
  }
  return s as any;
}

export function pickDefaults(provider: Provider, accounts: Account[]) {
  const by = (pred: (a: Account) => boolean) => accounts.find(pred);
  const named = (re: RegExp, pred: (a: Account) => boolean = () => true) => by((a) => re.test(a.name) && pred(a));
  const payable = (a: Account) => a.canPay;
  const sellable = (a: Account) => a.canSell;

  const card = provider === "xero"
    ? by((a) => a.type === "BANK")
    : by((a) => a.type === "bank") ?? by((a) => a.type === "cash");
  const manual = named(/undeposited/i, payable) ?? named(/cash on hand|petty cash|^cash$/i, payable) ?? card;
  const sales = provider === "xero"
    ? by((a) => a.code === "200" && sellable(a)) ?? named(/^sales$/i, sellable) ?? by((a) => a.type === "REVENUE" || a.type === "SALES")
    : named(/^sales$/i, (a) => a.type === "income") ?? by((a) => a.type === "income");
  // Xero accepts any non-bank account on an invoice line, so a deposit can go to
  // a liability as it should. Zoho is stricter about line accounts; default to
  // Sales there and let the operator choose a liability if their chart allows.
  const deposit = provider === "xero"
    ? named(/deposit/i, (a) => /LIAB/.test(a.type)) ?? sales
    : named(/deposit/i, (a) => a.type === "income" || a.type === "other_income") ?? sales;
  const tax = provider === "xero"
    ? named(/sales tax|gst|vat|tax payable/i, (a) => /LIAB/.test(a.type)) ?? sales
    : sales;
  return { card_account: card, manual_account: manual, sales_account: sales, deposit_account: deposit, tax_account: tax };
}

/* ───────────────────────────── the engine ───────────────────────────────── */

export class Engine {
  private settings!: ResolvedSettings;
  private currency = "USD";
  private syncedRentals = new Set<string>();

  constructor(private db: SupabaseClient, private conn: Connection, private adapter: Adapter) {}

  async init() {
    this.settings = await resolveSettings(this.db, this.conn, this.adapter);
    const { data } = await this.db.from("tenants").select("currency_code").eq("id", this.conn.tenant_id).maybeSingle();
    this.currency = (data?.currency_code as string) || "USD";
  }

  /* ── entity map ── */

  private async maps(entityType: string, driveId: string): Promise<MapRow[]> {
    const { data, error } = await this.db.from("accounting_entity_map")
      .select("id, entity_type, drive_id, part, external_id, external_number, amount, meta")
      .eq("tenant_id", this.conn.tenant_id).eq("provider", this.conn.provider)
      .eq("entity_type", entityType).eq("drive_id", driveId);
    if (error) throw new Error(error.message);
    return (data ?? []) as MapRow[];
  }

  private async putMap(entityType: string, driveId: string, part: string, externalId: string,
    extra: { number?: string | null; amount?: number | null; meta?: Record<string, any> } = {}) {
    const { error } = await this.db.from("accounting_entity_map").upsert({
      tenant_id: this.conn.tenant_id,
      provider: this.conn.provider,
      entity_type: entityType,
      drive_id: driveId,
      part,
      external_id: externalId,
      external_number: extra.number ?? null,
      amount: extra.amount ?? null,
      meta: extra.meta ?? {},
      updated_at: new Date().toISOString(),
    }, { onConflict: "tenant_id,provider,entity_type,drive_id,part" });
    if (error) throw new Error(`Could not record the ${entityType} mapping: ${error.message}`);
  }

  private async dropMaps(ids: string[]) {
    if (!ids.length) return;
    await this.db.from("accounting_entity_map").delete().in("id", ids).eq("tenant_id", this.conn.tenant_id);
  }

  /**
   * Create exactly once. A `pending:` marker (with how to look the object up)
   * goes in before the call and is replaced by the real id after it, with
   * `afterCreate` run in between — so whatever must be recorded alongside the
   * object (an invoice's charge amounts) is saved before the marker clears.
   * A marker found later means a run died mid-call: `resolvePending` settles it
   * by looking the object up before anything is diffed or created again.
   */
  private async once(
    entityType: string, driveId: string, part: string,
    kind: "invoice" | "payment" | "credit_note" | "prepayment", reference: string,
    create: () => Promise<DocResult>,
    extra: { amount?: number; meta?: Record<string, any>; afterCreate?: (doc: DocResult) => Promise<void> } = {},
  ): Promise<DocResult> {
    const existing = (await this.maps(entityType, driveId)).find((m) => m.part === part);
    if (existing && !existing.external_id.startsWith("pending:")) {
      return { id: existing.external_id, number: existing.external_number, extra: existing.meta?.extra };
    }
    await this.putMap(entityType, driveId, part, `pending:${reference}`, {
      amount: extra.amount, meta: { ...extra.meta, lookup: kind },
    });
    const doc = await create();
    if (extra.afterCreate) await extra.afterCreate(doc);
    await this.putMap(entityType, driveId, part, doc.id, { number: doc.number, amount: extra.amount, meta: { ...extra.meta, extra: doc.extra } });
    return doc;
  }

  /**
   * Settle markers left by a run that died mid-create. Found upstream → it was
   * created: adopt it (with `adopt` replaying what should have been recorded,
   * and `sig: null` so the caller re-checks it against Drive). Not found → it
   * never happened: drop the marker.
   */
  private async resolvePending(entityType: string, driveId: string, adopt?: (m: MapRow, found: DocResult) => Promise<void>) {
    for (const m of await this.maps(entityType, driveId)) {
      if (!m.external_id.startsWith("pending:")) continue;
      const reference = m.external_id.slice("pending:".length);
      const found = m.meta?.lookup ? await this.adapter.findByReference(m.meta.lookup, reference) : null;
      if (!found) {
        await this.dropMaps([m.id]);
        continue;
      }
      if (adopt) await adopt(m, found);
      await this.putMap(entityType, driveId, m.part, found.id, {
        number: found.number, amount: m.amount, meta: { ...m.meta, sig: null, extra: found.extra },
      });
    }
  }

  private key(...parts: (string | number)[]) {
    return [this.conn.id, ...parts].join(":");
  }

  private accountFor(category: string | null): AccountRef {
    const c = (category ?? "").toLowerCase();
    if (c.includes("deposit")) return this.settings.deposit_account;
    if (c === "tax" || c.endsWith(" tax")) return this.settings.tax_account;
    return this.settings.sales_account;
  }

  private taxFor(category: string | null): string | null {
    const c = (category ?? "").toLowerCase();
    if (c.includes("deposit") || c === "tax" || c.endsWith(" tax")) return null;
    return this.settings.tax_rate?.id ?? null;
  }

  /* ── contacts ── */

  private async contact(customerId: string | null): Promise<string> {
    if (!customerId) throw new ProviderError("validation", "This transaction has no customer, so there is no contact to post it to.");
    const [m] = await this.maps("contact", customerId);
    if (m) return m.external_id;
    const { data: c } = await this.db.from("customers").select("id, name, email, phone, company_name")
      .eq("id", customerId).eq("tenant_id", this.conn.tenant_id).maybeSingle();
    if (!c) throw new ProviderError("validation", "The customer on this transaction no longer exists.");
    const doc = await this.adapter.ensureContact({
      driveRef: `D247-${c.id}`,
      name: (c.name || c.company_name || c.email || `Customer ${String(c.id).slice(0, 8)}`) as string,
      email: (c.email as string) || null,
      phone: (c.phone as string) || null,
    });
    await this.putMap("contact", customerId, "", doc.id, { meta: { name: c.name } });
    return doc.id;
  }

  /* ── what each item does ── */

  async process(item: SyncItem): Promise<Outcome> {
    if (item.source_type === "invoice") return this.syncInvoice(item.source_id, item);
    if (item.source_type === "payment") return this.syncPayment(item.source_id, item);
    return this.syncRefund(item.source_id, item);
  }

  private inScope(item: SyncItem | null, hasMaps: boolean): boolean {
    if (!item || hasMaps) return true;
    const from = this.conn.sync_from ?? this.conn.connected_at;
    // Recorded after connecting counts, whatever date it carries (a back-dated
    // manual payment is still new money in the books).
    return !from || new Date(item.scope_at ?? item.occurred_at).getTime() >= new Date(from).getTime() - 1000;
  }

  /* ── invoice: a rental's charges ── */

  private async writeChargeMaps(rentalId: string, applied: { chargeId: string; category: string; current: number; invoice: string | null; mapId: string | null }[], docId: string) {
    for (const a of applied) {
      await this.putMap("charge", a.chargeId, "", a.mapId ?? `${docId}#${a.chargeId.slice(0, 8)}`, {
        amount: a.current,
        // invoice_external_id: the invoice a payment for this charge is applied to — where it first landed.
        meta: { rental_id: rentalId, category: a.category, invoice_external_id: a.invoice ?? null },
      });
    }
  }

  async syncInvoice(rentalId: string, item: SyncItem | null = null): Promise<Outcome> {
    const tenantId = this.conn.tenant_id;
    const replay = async (m: MapRow, found: DocResult) => {
      const applied = (m.meta?.applied ?? []) as any[];
      await this.writeChargeMaps(rentalId, applied.map((a) => ({ ...a, invoice: a.invoice ?? (m.entity_type === "invoice" ? found.id : null) })), found.id);
    };
    await this.resolvePending("invoice", rentalId, replay);
    await this.resolvePending("credit_note", rentalId, replay);
    const [{ data: rental }, { data: inv }, { data: charges }, { data: chargeMapsRaw }, invoiceMaps, creditMaps] = await Promise.all([
      this.db.from("rentals").select("id, customer_id, rental_number").eq("id", rentalId).eq("tenant_id", tenantId).maybeSingle(),
      this.db.from("invoices").select("id, invoice_number, invoice_date, due_date, customer_id").eq("rental_id", rentalId)
        .eq("tenant_id", tenantId).order("created_at").limit(1).maybeSingle(),
      this.db.from("ledger_entries").select("id, category, amount, entry_date, due_date").eq("rental_id", rentalId)
        .eq("tenant_id", tenantId).eq("type", "Charge"),
      this.db.from("accounting_entity_map").select("id, entity_type, drive_id, part, external_id, external_number, amount, meta")
        .eq("tenant_id", tenantId).eq("provider", this.conn.provider).eq("entity_type", "charge").eq("meta->>rental_id", rentalId),
      this.maps("invoice", rentalId),
      this.maps("credit_note", rentalId),
    ]);
    const chargeMaps = (chargeMapsRaw ?? []) as MapRow[];
    const hasUpstream = invoiceMaps.length > 0 || creditMaps.length > 0;
    if (!this.inScope(item, hasUpstream)) return { outcome: "drop" };

    const byId = new Map(chargeMaps.map((m) => [m.drive_id, m]));
    const number = (inv?.invoice_number as string) || `R-${rental?.rental_number ?? rentalId.slice(0, 8)}`;

    type Delta = { chargeId: string; category: string; current: number; delta: number; map?: MapRow; date: string };
    const deltas: Delta[] = [];
    for (const c of charges ?? []) {
      const current = round2(Number(c.amount ?? 0));
      const m = byId.get(c.id as string);
      const delta = round2(current - Number(m?.amount ?? 0));
      if (Math.abs(delta) > EPS) deltas.push({ chargeId: c.id, category: c.category ?? "Charge", current, delta, map: m, date: day(c.entry_date) });
    }
    const live = new Set((charges ?? []).map((c) => c.id as string));
    for (const m of chargeMaps) {
      if (!live.has(m.drive_id) && Math.abs(Number(m.amount ?? 0)) > EPS) {
        deltas.push({ chargeId: m.drive_id, category: m.meta?.category ?? "Charge", current: 0, delta: -Number(m.amount), map: m, date: day(null) });
      }
    }

    if (deltas.length === 0) {
      this.syncedRentals.add(rentalId);
      const main = invoiceMaps.find((m) => m.part === "0");
      return hasUpstream ? { outcome: "sent", externalId: main?.external_id ?? null } : { outcome: "drop" };
    }

    const contactId = await this.contact((inv?.customer_id as string) ?? (rental?.customer_id as string) ?? null);
    const sum = round2(deltas.reduce((s, d) => s + d.delta, 0));
    const mainExists = invoiceMaps.some((m) => m.part === "0" && !m.external_id.startsWith("pending:"));
    const lines: Line[] = deltas.map((d) => ({
      name: d.category,
      description: `${d.map ? `${d.category} adjustment` : d.category} · ${number}`,
      amount: d.delta,
      account: this.accountFor(d.category),
      taxRateId: this.taxFor(d.category),
    }));

    // What the charge maps become once the document exists. `invoice: null`
    // means "the invoice being created now" (filled in by writeChargeMaps).
    const applied = deltas.map((d) => ({
      chargeId: d.chargeId, category: d.category, current: d.current,
      invoice: (d.map?.meta?.invoice_external_id as string | undefined) ?? null, mapId: d.map?.external_id ?? null,
    }));

    let doc: DocResult;
    const attempt = item?.attempts ?? 0;
    if (sum >= 0) {
      const part = mainExists ? String(Math.max(1, invoiceMaps.length)) : "0";
      const docNumber = part === "0" ? number : `${number}-${Number(part) + 1}`;
      const date = part === "0" ? day((inv?.invoice_date as string) ?? deltas[0].date) : deltas.map((d) => d.date).sort().pop()!;
      const due = part === "0" ? day((inv?.due_date as string) ?? date) : date;
      doc = await this.once("invoice", rentalId, part, "invoice", docNumber,
        () => this.adapter.createInvoice({ contactId, number: docNumber, reference: docNumber, date, dueDate: due < date ? date : due, currency: this.currency, lines },
          this.key("inv", rentalId, part, item?.generation ?? 0, attempt)),
        {
          amount: sum,
          meta: { applied },
          afterCreate: (d) => this.writeChargeMaps(rentalId, applied.map((a) => ({ ...a, invoice: a.invoice ?? d.id })), d.id),
        });
    } else {
      const part = `adj-${creditMaps.length + 1}`;
      const docNumber = `${number}-CN${creditMaps.length + 1}`;
      const negated = lines.map((l) => ({ ...l, amount: -l.amount, description: `${l.name} reduced · ${number}` }));
      doc = await this.once("credit_note", rentalId, part, "credit_note", docNumber,
        () => this.adapter.createCreditNote({ contactId, number: docNumber, reference: docNumber, date: day(null), currency: this.currency, lines: negated },
          this.key("cn", rentalId, part, item?.generation ?? 0, attempt)),
        {
          amount: -sum,
          meta: { applied },
          afterCreate: (d) => this.writeChargeMaps(rentalId, applied, d.id),
        });
    }
    this.syncedRentals.add(rentalId);
    return { outcome: "sent", externalId: (invoiceMaps.find((m) => m.part === "0")?.external_id) ?? doc.id };
  }

  /* ── payment ── */

  private methodOf(p: Record<string, any>): PayMethod {
    if (p.stripe_payment_intent_id || p.stripe_checkout_session_id || p.square_payment_id) return "card";
    const m = String(p.method ?? "").toLowerCase();
    if (m.includes("card")) return "card";
    if (/cash/.test(m)) return "cash";
    if (/bank|transfer|zelle|ach|wire|cashapp|chime|venmo/.test(m)) return "bank_transfer";
    if (/cheque|check/.test(m)) return "cheque";
    return "other";
  }

  private accountForPayment(method: PayMethod): AccountRef {
    return method === "card" ? this.settings.card_account : this.settings.manual_account;
  }

  private async paymentRow(paymentId: string) {
    const { data } = await this.db.from("payments").select("*").eq("id", paymentId).eq("tenant_id", this.conn.tenant_id).maybeSingle();
    return data as Record<string, any> | null;
  }

  async syncPayment(paymentId: string, item: SyncItem | null = null): Promise<Outcome> {
    const p = item?.operation === "delete" ? null : await this.paymentRow(paymentId);
    await this.resolvePending("payment", paymentId);
    const existing = await this.maps("payment", paymentId);
    if (!this.inScope(item, existing.length > 0)) return { outcome: "drop" };
    const landed = !!p && LANDED.has(p.status);
    const attempt = item?.attempts ?? 0;

    // Desired: which upstream invoice gets how much of this payment.
    const desired = new Map<string, number>();
    let ref = "Credit";
    if (landed && p) {
      const { data: apps } = await this.db.from("payment_applications").select("charge_entry_id, amount_applied")
        .eq("payment_id", paymentId).eq("tenant_id", this.conn.tenant_id);
      const chargeIds = (apps ?? []).map((a) => a.charge_entry_id as string);
      const { data: charges } = chargeIds.length
        ? await this.db.from("ledger_entries").select("id, rental_id, category").in("id", chargeIds).eq("tenant_id", this.conn.tenant_id)
        : { data: [] as any[] };
      const rentals = new Set<string>((charges ?? []).map((c) => c.rental_id).filter(Boolean));
      if (rentals.size === 0 && p.rental_id) rentals.add(p.rental_id);
      // The invoice must exist upstream before money can be applied to it.
      for (const r of rentals) if (!this.syncedRentals.has(r)) await this.syncInvoice(r, null);

      const { data: cmaps } = chargeIds.length
        ? await this.db.from("accounting_entity_map").select("drive_id, meta").eq("tenant_id", this.conn.tenant_id)
          .eq("provider", this.conn.provider).eq("entity_type", "charge").in("drive_id", chargeIds)
        : { data: [] as any[] };
      const invOf = new Map((cmaps ?? []).map((m: any) => [m.drive_id as string, (m.meta?.invoice_external_id as string) ?? null]));
      let applied = 0;
      for (const a of apps ?? []) {
        const amt = round2(Number(a.amount_applied ?? 0));
        if (amt <= EPS) continue;
        const inv = invOf.get(a.charge_entry_id as string);
        const k = inv ?? "prepay";
        desired.set(k, round2((desired.get(k) ?? 0) + amt));
        applied += amt;
      }
      const rest = round2(Number(p.amount ?? 0) - applied);
      if (rest > EPS) desired.set("prepay", round2((desired.get("prepay") ?? 0) + rest));
      const rentalId = [...rentals][0] ?? p.rental_id;
      if (rentalId) {
        const { data: inv } = await this.db.from("invoices").select("invoice_number").eq("rental_id", rentalId)
          .eq("tenant_id", this.conn.tenant_id).order("created_at").limit(1).maybeSingle();
        ref = (inv?.invoice_number as string) ?? ref;
      }
    }

    const method = p ? this.methodOf(p) : "other";
    const date = day((p?.paid_at as string) ?? (p?.payment_date as string) ?? (p?.created_at as string));
    const sig = JSON.stringify({ d: [...desired.entries()].sort(), m: method, date });

    if (desired.size === 0 && existing.length === 0) return { outcome: "drop" };
    if (existing.length > 0 && existing.every((m) => m.meta?.sig === sig && !m.external_id.startsWith("pending:"))) {
      return { outcome: "sent", externalId: existing[0].external_id };
    }

    // Something changed. A refund posted against the old payment must come off
    // first (Xero will not delete a prepayment that has a refund on it), and it
    // is re-queued to be re-posted against the new allocation.
    const refunds = await this.maps("refund", paymentId);
    if (refunds.length) {
      await this.undoRefunds(refunds);
      await this.db.rpc("accounting_v2_enqueue", {
        p_tenant: this.conn.tenant_id, p_source_type: "refund", p_source_id: paymentId,
        p_operation: "sync", p_row: null, p_provider: this.conn.provider,
      });
    }
    for (const m of existing) {
      if (m.part === "prepay") await this.adapter.deletePrepayment({ id: m.external_id, extra: m.meta?.extra });
      else await this.adapter.deletePayment(m.external_id);
    }
    await this.dropMaps(existing.map((m) => m.id));
    if (desired.size === 0 || !p) return existing.length ? { outcome: "sent", externalId: null } : { outcome: "drop" };

    const contactId = await this.contact(p.customer_id);
    const account = this.accountForPayment(method);
    const short = paymentId.slice(0, 8);
    let spill = 0;
    let firstId: string | null = null;
    let i = 0;
    for (const [part, amount] of [...desired.entries()].filter(([k]) => k !== "prepay")) {
      i++;
      // Never more than the invoice still owes (a credit note may have reduced it).
      const due = await this.adapter.amountDue(part);
      const amt = round2(Math.min(amount, Math.max(0, due)));
      spill = round2(spill + amount - amt);
      if (amt <= EPS) continue;
      const reference = `${ref} · P-${short}-${i}`;
      const doc = await this.once("payment", paymentId, part, "payment", reference,
        () => this.adapter.createPayment({ invoiceId: part, contactId, amount: amt, date, account, reference, method },
          this.key("pay", paymentId, part, item?.generation ?? 0, attempt)),
        { amount: amt, meta: { sig, method } });
      firstId ??= doc.id;
    }
    const prepay = round2((desired.get("prepay") ?? 0) + spill);
    if (prepay > EPS) {
      const reference = `${ref} · P-${short}-C`;
      const doc = await this.once("payment", paymentId, "prepay", "prepayment", reference,
        () => this.adapter.createPrepayment({
          contactId, amount: prepay, date, account, reference, method, currency: this.currency, lineAccount: this.settings.sales_account,
        }, this.key("prepay", paymentId, item?.generation ?? 0, attempt)),
        { amount: prepay, meta: { sig, method } });
      firstId ??= doc.id;
    }
    return { outcome: "sent", externalId: firstId };
  }

  /* ── refund ── */

  private async undoRefunds(maps: MapRow[]) {
    for (const m of maps) {
      if (m.external_id.startsWith("pending:")) continue;
      if (m.meta?.kind === "prepay") {
        await this.adapter.deleteRefund({ id: m.external_id, prepaymentId: m.meta?.prepayment_id });
      } else {
        if (m.meta?.refund_id) await this.adapter.deleteRefund({ id: m.meta.refund_id, creditNoteId: m.external_id });
        await this.adapter.voidCreditNote(m.external_id);
      }
    }
    await this.dropMaps(maps.map((m) => m.id));
  }

  async syncRefund(paymentId: string, item: SyncItem | null = null): Promise<Outcome> {
    const p = item?.operation === "delete" ? null : await this.paymentRow(paymentId);
    await this.resolvePending("refund", paymentId);
    const existing = await this.maps("refund", paymentId);
    if (!this.inScope(item, existing.length > 0)) return { outcome: "drop" };
    const total = refundAmountOf(p);
    const attempt = item?.attempts ?? 0;

    // Where the payment went upstream; the refund is split the same way.
    let parts: { part: string; amount: number; meta: Record<string, any> }[] = [];
    if (total > EPS && p) {
      if (LANDED.has(p.status)) await this.syncPayment(paymentId, null);
      parts = (await this.maps("payment", paymentId))
        .filter((m) => !m.external_id.startsWith("pending:"))
        .map((m) => ({ part: m.part, amount: Number(m.amount ?? 0), meta: { ...m.meta, external_id: m.external_id } }));
    }
    const paid = parts.reduce((s, x) => s + x.amount, 0);
    const shares: { part: string; amount: number; meta: Record<string, any> }[] = [];
    if (total > EPS) {
      if (paid <= EPS) {
        // The payment itself is not in these books (it pre-dates the
        // connection): the refund still happened, so it is booked on its own.
        shares.push({ part: "standalone", amount: total, meta: {} });
      } else {
        let left = total;
        parts.forEach((x, i) => {
          const amt = i === parts.length - 1 ? round2(left) : round2((total * x.amount) / paid);
          left = round2(left - amt);
          if (amt > EPS) shares.push({ part: x.part, amount: amt, meta: x.meta });
        });
      }
    }

    const method = p ? this.methodOf(p) : "other";
    const date = day((p?.refund_processed_at as string) ?? (p?.updated_at as string));
    const sig = JSON.stringify({ s: shares.map((s) => [s.part, s.amount]), m: method, date });
    if (shares.length === 0 && existing.length === 0) return { outcome: "drop" };
    if (existing.length > 0 && existing.every((m) => m.meta?.sig === sig && !m.external_id.startsWith("pending:"))) {
      return { outcome: "sent", externalId: existing[0].external_id };
    }
    await this.undoRefunds(existing);
    if (shares.length === 0 || !p) return existing.length ? { outcome: "sent", externalId: null } : { outcome: "drop" };

    const contactId = await this.contact(p.customer_id);
    const account = this.accountForPayment(method);
    const short = paymentId.slice(0, 8);
    const cats = await this.refundCategories(paymentId);
    const { data: inv } = p.rental_id
      ? await this.db.from("invoices").select("invoice_number").eq("rental_id", p.rental_id).eq("tenant_id", this.conn.tenant_id)
        .order("created_at").limit(1).maybeSingle()
      : { data: null };
    const number = (inv?.invoice_number as string) ?? "Refund";

    let firstId: string | null = null;
    let i = 0;
    for (const s of shares) {
      i++;
      const reference = `${number} · RF-${short}-${i}`;
      if (s.part === "prepay") {
        const meta = { sig, kind: "prepay", prepayment_id: s.meta.external_id };
        const refund = await this.once("refund", paymentId, "prepay", "payment", reference,
          () => this.adapter.refundPrepayment({
            prepayment: { id: s.meta.external_id, extra: s.meta.extra }, amount: s.amount, date, account, reference, method,
          }, this.key("rfp", paymentId, i, item?.generation ?? 0, attempt)),
          { amount: s.amount, meta });
        firstId ??= refund.id;
        continue;
      }
      const lines = this.splitLines(cats, s.amount, number);
      // No `sig` until the cash refund is also out: a run that dies between the
      // two leaves a credit note without a sig, which the next run re-does.
      const cn = await this.once("refund", paymentId, s.part, "credit_note", reference,
        () => this.adapter.createCreditNote({ contactId, number: `${number}-RF${i}`, reference, date, currency: this.currency, lines },
          this.key("rfcn", paymentId, s.part, item?.generation ?? 0, attempt)),
        { amount: s.amount, meta: { kind: "credit_note" } });
      const refund = await this.adapter.refundCreditNote({ creditNoteId: cn.id, amount: s.amount, date, account, reference, method },
        this.key("rfcash", paymentId, s.part, item?.generation ?? 0, attempt));
      await this.putMap("refund", paymentId, s.part, cn.id, {
        number: cn.number, amount: s.amount, meta: { sig, kind: "credit_note", refund_id: refund.id },
      });
      firstId ??= cn.id;
    }
    return { outcome: "sent", externalId: firstId };
  }

  /** What the refunded payment paid for, by category and weight. */
  private async refundCategories(paymentId: string): Promise<{ category: string; weight: number }[]> {
    const { data: apps } = await this.db.from("payment_applications").select("charge_entry_id, amount_applied")
      .eq("payment_id", paymentId).eq("tenant_id", this.conn.tenant_id);
    const ids = (apps ?? []).map((a) => a.charge_entry_id as string);
    if (!ids.length) return [{ category: "Rental", weight: 1 }];
    const { data: charges } = await this.db.from("ledger_entries").select("id, category").in("id", ids).eq("tenant_id", this.conn.tenant_id);
    const catOf = new Map((charges ?? []).map((c) => [c.id as string, (c.category as string) ?? "Rental"]));
    const by = new Map<string, number>();
    for (const a of apps ?? []) {
      const c = catOf.get(a.charge_entry_id as string) ?? "Rental";
      by.set(c, (by.get(c) ?? 0) + Number(a.amount_applied ?? 0));
    }
    return [...by.entries()].filter(([, w]) => w > EPS).map(([category, weight]) => ({ category, weight }));
  }

  private splitLines(cats: { category: string; weight: number }[], amount: number, number: string): Line[] {
    const total = cats.reduce((s, c) => s + c.weight, 0) || 1;
    let left = amount;
    return cats.map((c, i) => {
      const amt = i === cats.length - 1 ? round2(left) : round2((amount * c.weight) / total);
      left = round2(left - amt);
      return {
        name: c.category,
        description: `Refund · ${c.category} · ${number}`,
        amount: amt,
        account: this.accountFor(c.category),
        taxRateId: this.taxFor(c.category),
      };
    }).filter((l) => Math.abs(l.amount) > EPS);
  }
}
