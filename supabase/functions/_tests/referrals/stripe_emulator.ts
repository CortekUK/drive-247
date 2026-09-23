// A strict, stateful Stripe emulator for the endpoints the referral functions
// call, at API version 2023-10-16 (with the additive `discounts` parameter,
// which stripe-node 14.24.0 added to that version's surface).
//
// Strict on purpose: unknown parameters, non-expandable expand paths, missing
// coupons, duplicate coupons and Checkout's discounts + allow_promotion_codes
// all fail the way Stripe fails, so the harness catches request-shape bugs.
// State is kept per secret key (one per account x mode).
// deno-lint-ignore-file no-explicit-any

type Obj = Record<string, any>;

class StripeErr extends Error {
  constructor(public status: number, public type: string, message: string, public code?: string, public param?: string) {
    super(message);
  }
}

const now = () => Math.floor(Date.now() / 1000);

/** Decode stripe-node's form encoding (qs, indices) into nested objects/arrays. */
export function decodeForm(text: string): Obj {
  const root: Obj = {};
  if (!text) return root;
  for (const pair of text.split("&")) {
    if (!pair) continue;
    const eq = pair.indexOf("=");
    const rawKey = decodeURIComponent((eq < 0 ? pair : pair.slice(0, eq)).replace(/\+/g, " "));
    const value = eq < 0 ? "" : decodeURIComponent(pair.slice(eq + 1).replace(/\+/g, " "));
    const path = rawKey.replace(/\]/g, "").split("[");
    let cur: any = root;
    for (let i = 0; i < path.length; i++) {
      const k = path[i];
      const last = i === path.length - 1;
      const nextIsIndex = !last && /^\d+$/.test(path[i + 1]);
      if (last) cur[k] = value;
      else {
        if (cur[k] === undefined || typeof cur[k] !== "object") cur[k] = nextIsIndex ? [] : {};
        cur = cur[k];
      }
    }
  }
  return root;
}

const asInt = (v: unknown) => (v === undefined || v === "" ? undefined : Number(v));

function allowOnly(params: Obj, allowed: string[], where: string) {
  for (const k of Object.keys(params)) {
    if (!allowed.includes(k)) throw new StripeErr(400, "invalid_request_error", `Received unknown parameter: ${k} (${where})`, "parameter_unknown", k);
  }
}

type Account = {
  n: number;
  customers: Map<string, Obj>;
  products: Map<string, Obj>;
  prices: Map<string, Obj>;
  coupons: Map<string, Obj>;
  discounts: Map<string, Obj>;
  subscriptions: Map<string, Obj>;
  invoices: Map<string, Obj>;
  intents: Map<string, Obj>;
  sessions: Map<string, Obj>;
  idem: Map<string, { status: number; body: string }>;
  calls: Array<{ method: string; path: string; params: Obj }>;
};

function newAccount(): Account {
  return {
    n: 0, customers: new Map(), products: new Map(), prices: new Map(), coupons: new Map(), discounts: new Map(),
    subscriptions: new Map(), invoices: new Map(), intents: new Map(), sessions: new Map(), idem: new Map(), calls: [],
  };
}

export class StripeEmu {
  accounts = new Map<string, Account>();

  acct(key: string): Account {
    if (!this.accounts.has(key)) this.accounts.set(key, newAccount());
    return this.accounts.get(key)!;
  }

  id(a: Account, prefix: string) {
    a.n++;
    return `${prefix}_emu${String(a.n).padStart(6, "0")}`;
  }

  // ── seeding helpers (the harness's fixtures) ──────────────────────────────
  seedProductPrice(key: string, opts: { amount: number; name: string; productId?: string; priceId?: string; metered?: boolean }): { productId: string; priceId: string } {
    const a = this.acct(key);
    const productId = opts.productId ?? this.id(a, "prod");
    a.products.set(productId, { id: productId, object: "product", name: opts.name, active: true });
    const priceId = opts.priceId ?? this.id(a, "price");
    a.prices.set(priceId, {
      id: priceId, object: "price", active: true, currency: "usd", unit_amount: opts.amount, product: productId,
      type: "recurring", recurring: { interval: "month", interval_count: 1, usage_type: opts.metered ? "metered" : "licensed" },
      lookup_key: null, metadata: {},
    });
    return { productId, priceId };
  }

  seedCustomer(key: string, email: string): string {
    const a = this.acct(key);
    const id = this.id(a, "cus");
    a.customers.set(id, { id, object: "customer", email, name: null, metadata: {}, deleted: undefined });
    return id;
  }

  /** A live subscription as if paid long ago (fixtures for existing operators). */
  seedSubscription(key: string, opts: { customer: string; priceId: string; status?: string; metadata?: Obj }): string {
    const a = this.acct(key);
    const sub = this.makeSubscription(a, {
      customer: opts.customer, items: [{ price: opts.priceId }], metadata: opts.metadata ?? {},
    }, opts.status ?? "active");
    return sub.id;
  }

  setStatus(key: string, subId: string, status: string) {
    const sub = this.acct(key).subscriptions.get(subId);
    if (!sub) throw new Error(`no subscription ${subId}`);
    sub.status = status;
  }

  // ── core model ──────────────────────────────────────────────────────────
  couponApplies(coupon: Obj, productId: string): boolean {
    const products = coupon.applies_to?.products;
    return !products || products.length === 0 || products.includes(productId);
  }

  /** Discount amounts for one bill of the subscription's recurring items, in list order. */
  computeDiscounts(a: Account, sub: Obj): { subtotal: number; lines: Array<{ discount: string; amount: number }>; total: number } {
    const items = sub.items.data as Obj[];
    let subtotal = 0;
    const eligible = new Map<string, number>(); // discount -> remaining eligible amount pool
    const perItem = items.map(it => ({ product: it.price.product, amount: (it.price.recurring?.usage_type === "metered" ? 0 : it.price.unit_amount * (it.quantity ?? 1)) }));
    for (const it of perItem) subtotal += it.amount;
    const remaining = perItem.map(it => it.amount);
    const lines: Array<{ discount: string; amount: number }> = [];
    for (const did of sub.discounts as string[]) {
      const d = a.discounts.get(did)!;
      const c = d.coupon;
      let off = 0;
      perItem.forEach((it, i) => {
        if (!this.couponApplies(c, it.product)) return;
        if (c.percent_off != null) {
          const x = Math.round(remaining[i] * c.percent_off / 100);
          off += x; remaining[i] -= x;
        }
      });
      if (c.amount_off != null) {
        let left = c.amount_off;
        perItem.forEach((it, i) => {
          if (!this.couponApplies(c, it.product) || left <= 0) return;
          const x = Math.min(left, remaining[i]);
          left -= x; off += x; remaining[i] -= x;
        });
      }
      eligible.set(did, off);
      lines.push({ discount: did, amount: off });
    }
    const total = remaining.reduce((s, x) => s + x, 0);
    return { subtotal, lines, total };
  }

  makeDiscount(a: Account, couponId: string, sub: Obj, checkoutSession: string | null = null): Obj {
    const coupon = a.coupons.get(couponId);
    if (!coupon) throw new StripeErr(400, "invalid_request_error", `No such coupon: '${couponId}'`, "resource_missing", "discounts");
    if (coupon.max_redemptions != null && coupon.times_redeemed >= coupon.max_redemptions) {
      throw new StripeErr(400, "invalid_request_error", `Coupon ${couponId} has been redeemed the maximum number of times.`, "coupon_expired");
    }
    coupon.times_redeemed++;
    const start = now();
    let end: number | null = null;
    if (coupon.duration === "repeating") {
      const d = new Date(start * 1000);
      d.setUTCMonth(d.getUTCMonth() + Number(coupon.duration_in_months));
      end = Math.floor(d.getTime() / 1000);
    }
    const id = this.id(a, "di");
    const disc = {
      id, object: "discount", coupon, customer: sub.customer, subscription: sub.id, start, end,
      checkout_session: checkoutSession, invoice: null, invoice_item: null, promotion_code: null,
    };
    a.discounts.set(id, disc);
    return disc;
  }

  applyDiscountList(a: Account, sub: Obj, list: any, where: string) {
    if (list === "") { sub.discounts = []; sub.discount = null; return; }
    if (!Array.isArray(list)) throw new StripeErr(400, "invalid_request_error", `Invalid array (${where}.discounts)`, "parameter_invalid_empty", "discounts");
    if (list.length > 20) throw new StripeErr(400, "invalid_request_error", "Too many discounts", undefined, "discounts");
    const next: string[] = [];
    const coupons = new Set<string>();
    for (const [i, entry] of list.entries()) {
      allowOnly(entry, ["coupon", "discount", "promotion_code"], `discounts[${i}]`);
      if (entry.discount) {
        if (!(sub.discounts as string[]).includes(entry.discount)) {
          throw new StripeErr(400, "invalid_request_error", `No such discount: '${entry.discount}' on this subscription`, "resource_missing", `discounts[${i}][discount]`);
        }
        const d = a.discounts.get(entry.discount)!;
        if (coupons.has(d.coupon.id)) throw new StripeErr(400, "invalid_request_error", `The coupon ${d.coupon.id} is applied more than once.`, undefined, "discounts");
        coupons.add(d.coupon.id);
        next.push(entry.discount);
      } else if (entry.coupon) {
        if (coupons.has(entry.coupon)) throw new StripeErr(400, "invalid_request_error", `The coupon ${entry.coupon} is applied more than once.`, undefined, "discounts");
        coupons.add(entry.coupon);
        next.push(this.makeDiscount(a, entry.coupon, sub).id);
      } else {
        throw new StripeErr(400, "invalid_request_error", `discounts[${i}] needs coupon or discount`, undefined, `discounts[${i}]`);
      }
    }
    sub.discounts = next;
    sub.discount = null;
  }

  makeSubscription(a: Account, p: Obj, status: string): Obj {
    const id = this.id(a, "sub");
    const start = now();
    const items = (p.items as Obj[]).map((it, i) => {
      const price = a.prices.get(it.price);
      if (!price) throw new StripeErr(400, "invalid_request_error", `No such price: '${it.price}'`, "resource_missing", `items[${i}][price]`);
      return { id: this.id(a, "si"), object: "subscription_item", price, quantity: asInt(it.quantity) ?? 1 };
    });
    const trialEnd = p.trial_end ? Number(p.trial_end) : p.trial_period_days ? start + Number(p.trial_period_days) * 86400 : null;
    const sub: Obj = {
      id, object: "subscription", customer: p.customer, status: trialEnd ? "trialing" : status,
      items: { object: "list", data: items, has_more: false },
      metadata: { ...(p.metadata ?? {}) }, discount: null, discounts: [],
      current_period_start: start, current_period_end: (trialEnd ?? start + 30 * 86400),
      trial_end: trialEnd, created: start, cancel_at_period_end: false, latest_invoice: null,
    };
    a.subscriptions.set(id, sub);
    if (p.discounts !== undefined) this.applyDiscountList(a, sub, p.discounts, "subscription");
    return sub;
  }

  /** The first invoice of an incomplete subscription, with its PaymentIntent. */
  firstInvoice(a: Account, sub: Obj, paid: boolean): Obj {
    const calc = this.computeDiscounts(a, sub);
    const inv = this.invoiceFrom(a, sub, calc, paid);
    if (!paid && inv.amount_due > 0) {
      const pi = { id: this.id(a, "pi"), object: "payment_intent", amount: inv.amount_due, currency: "usd", status: "requires_payment_method" };
      (pi as Obj).client_secret = `${pi.id}_secret_emu`;
      a.intents.set(pi.id, pi);
      inv.payment_intent = pi.id;
    }
    sub.latest_invoice = inv.id;
    return inv;
  }

  invoiceFrom(a: Account, sub: Obj, calc: ReturnType<StripeEmu["computeDiscounts"]>, paid: boolean): Obj {
    const id = this.id(a, "in");
    const inv: Obj = {
      id, object: "invoice", subscription: sub.id, customer: sub.customer, currency: "usd",
      subtotal: calc.subtotal, total: calc.total, amount_due: calc.total, amount_paid: paid ? calc.total : 0,
      status: paid ? "paid" : "open", payment_intent: null,
      total_discount_amounts: calc.lines.map(l => ({ amount: l.amount, discount: l.discount })),
      discounts: calc.lines.map(l => l.discount), created: now(),
    };
    a.invoices.set(id, inv);
    return inv;
  }

  /** The harness's "a month passes": bill the subscription, pay it, drop spent `once` discounts. */
  billAndPay(key: string, subId: string): Obj {
    const a = this.acct(key);
    const sub = a.subscriptions.get(subId)!;
    const inv = this.invoiceFrom(a, sub, this.computeDiscounts(a, sub), true);
    sub.latest_invoice = inv.id;
    sub.discounts = (sub.discounts as string[]).filter(did => a.discounts.get(did)!.coupon.duration !== "once");
    return inv;
  }

  /** The payer completing Checkout: the subscription exists, the session is complete. */
  completeCheckout(key: string, sessionId: string): Obj {
    const a = this.acct(key);
    const s = a.sessions.get(sessionId);
    if (!s) throw new Error(`no session ${sessionId}`);
    if (s.status !== "open") throw new Error(`session ${sessionId} is ${s.status}`);
    const customer = s.customer ?? this.seedCustomer(key, s.customer_email ?? "payer@example.com");
    const recurring = (s._line_items as Obj[]).filter(li => li.price && a.prices.get(li.price)?.recurring);
    const sub = this.makeSubscription(a, {
      customer, items: recurring.map(li => ({ price: li.price, quantity: li.quantity })),
      metadata: s._subscription_data?.metadata ?? {},
      trial_end: s._subscription_data?.trial_end, trial_period_days: s._subscription_data?.trial_period_days,
    }, "active");
    for (const d of (s._discounts ?? []) as Obj[]) {
      sub.discounts.push(this.makeDiscount(a, d.coupon, sub, s.id).id);
    }
    this.invoiceFrom(a, sub, this.computeDiscounts(a, sub), true);
    s.status = "complete";
    s.subscription = sub.id;
    s.customer = customer;
    return sub;
  }

  /** The card step: the first invoice is paid, the subscription goes active. */
  payFirstInvoice(key: string, subId: string) {
    const a = this.acct(key);
    const sub = a.subscriptions.get(subId)!;
    const inv = a.invoices.get(sub.latest_invoice)!;
    inv.status = "paid";
    inv.amount_paid = inv.amount_due;
    if (inv.payment_intent) a.intents.get(inv.payment_intent)!.status = "succeeded";
    sub.status = "active";
  }

  // ── expansion ────────────────────────────────────────────────────────────
  expandSub(a: Account, sub: Obj, expand: string[]): Obj {
    const out: Obj = structuredClone(sub);
    const ok = ["discounts", "latest_invoice", "latest_invoice.payment_intent", "customer", "items.data.price.product", "default_payment_method"];
    for (const e of expand) {
      if (!ok.includes(e)) throw new StripeErr(400, "invalid_request_error", `This property cannot be expanded (${e}).`, undefined, "expand");
    }
    if (expand.includes("discounts")) out.discounts = (sub.discounts as string[]).map(id => structuredClone(a.discounts.get(id)));
    if (expand.includes("latest_invoice") || expand.includes("latest_invoice.payment_intent")) {
      const inv = sub.latest_invoice ? structuredClone(a.invoices.get(sub.latest_invoice)) : null;
      if (inv && expand.includes("latest_invoice.payment_intent") && inv.payment_intent) inv.payment_intent = structuredClone(a.intents.get(inv.payment_intent));
      out.latest_invoice = inv;
    }
    if (expand.includes("items.data.price.product")) {
      for (const it of out.items.data) it.price.product = structuredClone(a.products.get(it.price.product));
    }
    if (expand.includes("customer")) out.customer = structuredClone(a.customers.get(sub.customer));
    return out;
  }

  // ── HTTP ─────────────────────────────────────────────────────────────────
  async handle(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const key = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/, "");
    const a = this.acct(key);
    const body = req.method === "GET" || req.method === "DELETE" ? "" : await req.text();
    const params = req.method === "GET" || req.method === "DELETE" ? decodeForm(url.search.slice(1)) : decodeForm(body);
    const idem = req.headers.get("Idempotency-Key");
    const idemKey = idem ? `${req.method} ${url.pathname} ${idem}` : null;
    a.calls.push({ method: req.method, path: url.pathname, params });
    if (idemKey && a.idem.has(idemKey)) {
      const hit = a.idem.get(idemKey)!;
      return new Response(hit.body, { status: hit.status, headers: { "Content-Type": "application/json", "Idempotent-Replayed": "true" } });
    }
    let status = 200;
    let out: unknown;
    try {
      out = this.route(a, req.method, url.pathname, params);
    } catch (e) {
      if (!(e instanceof StripeErr)) throw e;
      status = e.status;
      out = { error: { type: e.type, message: e.message, ...(e.code ? { code: e.code } : {}), ...(e.param ? { param: e.param } : {}) } };
    }
    const text = JSON.stringify(out);
    if (idemKey && req.method === "POST") a.idem.set(idemKey, { status, body: text });
    return new Response(text, { status, headers: { "Content-Type": "application/json", "Request-Id": `req_emu${a.n}` } });
  }

  route(a: Account, method: string, path: string, p: Obj): unknown {
    const seg = path.replace(/^\/v1\//, "").split("/");
    const expand: string[] = Array.isArray(p.expand) ? p.expand : [];

    // prices
    if (seg[0] === "prices" && seg[1] && method === "GET") {
      allowOnly(p, ["expand"], "prices.retrieve");
      const price = a.prices.get(seg[1]);
      if (!price) throw new StripeErr(404, "invalid_request_error", `No such price: '${seg[1]}'`, "resource_missing", "id");
      return price;
    }

    // customers
    if (seg[0] === "customers") {
      if (method === "POST" && !seg[1]) {
        allowOnly(p, ["email", "name", "metadata", "description", "phone", "expand"], "customers.create");
        const id = this.id(a, "cus");
        const c = { id, object: "customer", email: p.email ?? null, name: p.name ?? null, metadata: p.metadata ?? {} };
        a.customers.set(id, c);
        return c;
      }
      if (method === "GET" && seg[1]) {
        const c = a.customers.get(seg[1]);
        if (!c) throw new StripeErr(404, "invalid_request_error", `No such customer: '${seg[1]}'`, "resource_missing", "id");
        return c;
      }
    }

    // coupons
    if (seg[0] === "coupons") {
      if (method === "POST" && !seg[1]) {
        allowOnly(p, ["id", "percent_off", "amount_off", "currency", "duration", "duration_in_months", "applies_to", "name", "metadata", "max_redemptions", "redeem_by", "expand"], "coupons.create");
        if (!["once", "repeating", "forever"].includes(p.duration)) throw new StripeErr(400, "invalid_request_error", "Invalid duration", "parameter_invalid", "duration");
        if (p.duration === "repeating" && !p.duration_in_months) throw new StripeErr(400, "invalid_request_error", "duration_in_months is required for repeating", "parameter_missing", "duration_in_months");
        if (p.duration !== "repeating" && p.duration_in_months) throw new StripeErr(400, "invalid_request_error", "duration_in_months only with repeating", undefined, "duration_in_months");
        if ((p.percent_off == null) === (p.amount_off == null)) throw new StripeErr(400, "invalid_request_error", "Exactly one of percent_off or amount_off", undefined, "percent_off");
        if (p.amount_off != null && !p.currency) throw new StripeErr(400, "invalid_request_error", "currency is required with amount_off", "parameter_missing", "currency");
        if (p.name && String(p.name).length > 40) throw new StripeErr(400, "invalid_request_error", "Coupon name must be at most 40 characters", undefined, "name");
        if (p.applies_to) allowOnly(p.applies_to, ["products"], "coupons.create applies_to");
        const id = p.id ?? this.id(a, "coupon");
        if (a.coupons.has(id)) throw new StripeErr(400, "invalid_request_error", `Coupon already exists.`, "resource_already_exists", "id");
        const c = {
          id, object: "coupon", percent_off: p.percent_off != null ? Number(p.percent_off) : null,
          amount_off: p.amount_off != null ? Number(p.amount_off) : null, currency: p.currency ?? null,
          duration: p.duration, duration_in_months: p.duration_in_months ? Number(p.duration_in_months) : null,
          applies_to: p.applies_to ? { products: p.applies_to.products ?? [] } : undefined,
          name: p.name ?? null, metadata: p.metadata ?? {}, max_redemptions: p.max_redemptions ? Number(p.max_redemptions) : null,
          times_redeemed: 0, valid: true, created: now(),
        };
        a.coupons.set(id, c);
        return c;
      }
      if (method === "GET" && seg[1]) {
        const c = a.coupons.get(decodeURIComponent(seg[1]));
        if (!c) throw new StripeErr(404, "invalid_request_error", `No such coupon: '${seg[1]}'`, "resource_missing", "id");
        return c;
      }
      if (method === "DELETE" && seg[1]) {
        const id = decodeURIComponent(seg[1]);
        if (!a.coupons.has(id)) throw new StripeErr(404, "invalid_request_error", `No such coupon: '${id}'`, "resource_missing", "id");
        a.coupons.get(id)!.valid = false;
        return { id, object: "coupon", deleted: true };
      }
    }

    // subscriptions
    if (seg[0] === "subscriptions") {
      if (method === "POST" && !seg[1]) {
        allowOnly(p, ["customer", "items", "discounts", "coupon", "promotion_code", "payment_behavior", "payment_settings", "expand", "metadata", "trial_period_days", "trial_end", "default_payment_method", "collection_method", "description", "off_session", "proration_behavior", "add_invoice_items", "automatic_tax", "billing_cycle_anchor", "cancel_at_period_end"], "subscriptions.create");
        if (!a.customers.has(p.customer)) throw new StripeErr(400, "invalid_request_error", `No such customer: '${p.customer}'`, "resource_missing", "customer");
        if (p.discounts !== undefined && p.coupon !== undefined) throw new StripeErr(400, "invalid_request_error", "You may only specify one of these parameters: coupon, discounts.");
        const incomplete = p.payment_behavior === "default_incomplete";
        const sub = this.makeSubscription(a, p, incomplete ? "incomplete" : "active");
        if (p.coupon) sub.discounts = [this.makeDiscount(a, p.coupon, sub).id];
        const inv = this.firstInvoice(a, sub, !incomplete);
        if (incomplete && inv.amount_due === 0) sub.status = "active";
        return this.expandSub(a, sub, expand);
      }
      if (method === "GET" && seg[1]) {
        allowOnly(p, ["expand"], "subscriptions.retrieve");
        const sub = a.subscriptions.get(seg[1]);
        if (!sub) throw new StripeErr(404, "invalid_request_error", `No such subscription: '${seg[1]}'`, "resource_missing", "id");
        return this.expandSub(a, sub, expand);
      }
      if (method === "POST" && seg[1]) {
        allowOnly(p, ["discounts", "coupon", "promotion_code", "metadata", "cancel_at_period_end", "items", "proration_behavior", "default_payment_method", "trial_end", "description", "expand", "payment_behavior"], "subscriptions.update");
        const sub = a.subscriptions.get(seg[1]);
        if (!sub) throw new StripeErr(404, "invalid_request_error", `No such subscription: '${seg[1]}'`, "resource_missing", "id");
        if (["canceled", "incomplete_expired"].includes(sub.status)) throw new StripeErr(400, "invalid_request_error", `A canceled subscription can only update its cancellation_details and metadata.`);
        if (p.discounts !== undefined && p.coupon !== undefined) throw new StripeErr(400, "invalid_request_error", "You may only specify one of these parameters: coupon, discounts.");
        if (p.discounts !== undefined) this.applyDiscountList(a, sub, p.discounts, "subscription");
        if (p.coupon !== undefined) {
          sub.discounts = p.coupon === "" ? [] : [this.makeDiscount(a, p.coupon, sub).id];
        }
        if (p.metadata) Object.assign(sub.metadata, p.metadata);
        return this.expandSub(a, sub, expand);
      }
      if (method === "DELETE" && seg[1]) {
        const sub = a.subscriptions.get(seg[1]);
        if (!sub) throw new StripeErr(404, "invalid_request_error", `No such subscription: '${seg[1]}'`, "resource_missing", "id");
        sub.status = sub.status === "incomplete" ? "incomplete_expired" : "canceled";
        return this.expandSub(a, sub, []);
      }
    }

    // invoices
    if (seg[0] === "invoices" && seg[1] && method === "GET") {
      allowOnly(p, ["expand"], "invoices.retrieve");
      const inv = a.invoices.get(seg[1]);
      if (!inv) throw new StripeErr(404, "invalid_request_error", `No such invoice: '${seg[1]}'`, "resource_missing", "id");
      for (const e of expand) {
        if (!["total_discount_amounts.discount", "discounts", "payment_intent", "subscription"].includes(e)) {
          throw new StripeErr(400, "invalid_request_error", `This property cannot be expanded (${e}).`, undefined, "expand");
        }
      }
      const out = structuredClone(inv);
      if (expand.includes("total_discount_amounts.discount")) {
        out.total_discount_amounts = out.total_discount_amounts.map((t: Obj) => ({ ...t, discount: structuredClone(a.discounts.get(t.discount)) }));
      }
      return out;
    }

    // checkout sessions
    if (seg[0] === "checkout" && seg[1] === "sessions") {
      if (method === "POST" && !seg[2]) {
        allowOnly(p, ["mode", "customer", "customer_email", "line_items", "discounts", "allow_promotion_codes", "expires_at", "success_url", "cancel_url", "consent_collection", "metadata", "subscription_data", "payment_method_types", "client_reference_id", "billing_address_collection", "expand"], "checkout.sessions.create");
        if (p.discounts !== undefined && p.allow_promotion_codes !== undefined) {
          throw new StripeErr(400, "invalid_request_error", "You may only specify one of these parameters: allow_promotion_codes, discounts.");
        }
        if (Array.isArray(p.discounts) && p.discounts.length > 1) throw new StripeErr(400, "invalid_request_error", "Checkout supports one discount.", undefined, "discounts");
        for (const d of (p.discounts ?? []) as Obj[]) {
          allowOnly(d, ["coupon", "promotion_code"], "checkout discounts[]");
          if (d.coupon && !a.coupons.has(d.coupon)) throw new StripeErr(400, "invalid_request_error", `No such coupon: '${d.coupon}'`, "resource_missing", "discounts");
        }
        if (p.customer && p.customer_email) throw new StripeErr(400, "invalid_request_error", "customer and customer_email are mutually exclusive");
        if (p.subscription_data) allowOnly(p.subscription_data, ["metadata", "trial_end", "trial_period_days", "description", "default_tax_rates", "billing_cycle_anchor", "proration_behavior"], "subscription_data");
        if (p.subscription_data?.trial_end && p.subscription_data?.trial_period_days) throw new StripeErr(400, "invalid_request_error", "trial_end and trial_period_days are mutually exclusive");
        const lineItems = (p.line_items as Obj[]).map((li, i) => {
          allowOnly(li, ["price", "price_data", "quantity"], `line_items[${i}]`);
          if (li.price) {
            if (!a.prices.has(li.price)) throw new StripeErr(400, "invalid_request_error", `No such price: '${li.price}'`, "resource_missing", `line_items[${i}][price]`);
            return { price: li.price, quantity: asInt(li.quantity) ?? 1 };
          }
          const pd = li.price_data;
          const productId = this.id(a, "prod");
          a.products.set(productId, { id: productId, object: "product", name: pd.product_data?.name ?? "", active: true });
          const priceId = this.id(a, "price");
          a.prices.set(priceId, { id: priceId, object: "price", currency: pd.currency, unit_amount: Number(pd.unit_amount), product: productId, type: "one_time", recurring: null });
          return { price: priceId, quantity: asInt(li.quantity) ?? 1 };
        });
        const id = this.id(a, "cs_test");
        const s = {
          id, object: "checkout.session", mode: p.mode, status: "open", url: `https://checkout.stripe.test/c/pay/${id}`,
          customer: p.customer ?? null, customer_email: p.customer_email ?? null, metadata: p.metadata ?? {},
          subscription: null, expires_at: Number(p.expires_at ?? now() + 86400), success_url: p.success_url, cancel_url: p.cancel_url,
          _line_items: lineItems, _discounts: p.discounts ?? [], _subscription_data: p.subscription_data ?? {},
        };
        a.sessions.set(id, s);
        return this.publicSession(a, s, []);
      }
      if (method === "GET" && seg[2]) {
        allowOnly(p, ["expand"], "checkout.sessions.retrieve");
        const s = a.sessions.get(seg[2]);
        if (!s) throw new StripeErr(404, "invalid_request_error", `No such checkout.session: '${seg[2]}'`, "resource_missing", "id");
        for (const e of expand) if (!["subscription", "customer", "line_items"].includes(e)) throw new StripeErr(400, "invalid_request_error", `This property cannot be expanded (${e}).`);
        return this.publicSession(a, s, expand);
      }
      if (method === "POST" && seg[2] && seg[3] === "expire") {
        const s = a.sessions.get(seg[2]);
        if (!s) throw new StripeErr(404, "invalid_request_error", `No such checkout.session: '${seg[2]}'`, "resource_missing", "id");
        if (s.status !== "open") throw new StripeErr(400, "invalid_request_error", `Only Checkout Sessions with a status in ["open"] can be expired.`);
        s.status = "expired";
        return this.publicSession(a, s, []);
      }
    }

    throw new StripeErr(404, "invalid_request_error", `Unrecognized request URL (${method}: ${path}). (emulator)`);
  }

  publicSession(a: Account, s: Obj, expand: string[]): Obj {
    const out: Obj = {};
    for (const [k, v] of Object.entries(s)) if (!k.startsWith("_")) out[k] = structuredClone(v);
    if (expand.includes("subscription") && s.subscription) out.subscription = this.expandSub(a, a.subscriptions.get(s.subscription)!, []);
    return out;
  }
}
