/**
 * TENANT ISOLATION AROUND RENTAL CREATION — Layer 1 (source-of-record) with two
 * small Layer 3 islands. Offline; no database, no network, no keys.
 *
 * WHAT THIS FILE COVERS
 * ---------------------
 * The rental row is only as safe as the tenant id attached to it, and RLS is OFF
 * on the core tables (rentals, customers, vehicles, invoices, payments). So the
 * `tenant_id` filter in application code is not defence-in-depth — it IS the
 * boundary. This file pins every place around rental creation where that
 * boundary is optional, absent, or accidentally coupled to something else:
 *
 *   - portal global search, which runs its reads unscoped when the tenant is not
 *     yet resolved, while its own sibling caller guards for exactly that reason
 *   - portal invoice numbering, which ignores the tenant id it is handed, and the
 *     lexicographic bug that jams it permanently at the platform's 10,000th
 *     invoice of a month
 *   - the booking-site rental insert, where both the stamp and the column are
 *     optional
 *   - the single nullish-tenant test that also switches off the pre-insert guards
 *   - the DB overlap trigger's date-only comparison versus the quote engine's
 *     time-and-buffer comparison
 *   - the customers-by-email fallback that adopts NULL-tenant rows, and the
 *     producer of those rows sitting in the same function
 *   - the weekend pricing override that inserts a duplicate on every save
 *
 * LAYERS, AND WHY
 * ---------------
 * L1 (read shipped source as text) is used for everything that lives inside a
 * React component or a Postgres trigger. Neither can be imported into a Node
 * test: the components pull `@/...` aliases the spine's vitest config does not
 * define (tests/vitest.config.ts aliases only `@web` and `@fn`), and the trigger
 * is PL/pgSQL. Same idiom as tests/spine/rental/03-rental-create.test.ts.
 *
 * L3 (pure, executable, hand-typed literals) is used twice, and only where the
 * logic under test is arithmetic that can be re-typed faithfully in a few lines:
 * the invoice-number allocator's string comparison, and the overlap trigger's
 * date predicate. Both re-implementations are pinned to the source text they
 * mirror by an L1 assertion in the same describe, so a change to the original
 * that is not mirrored here shows up as a red L1 test rather than a quietly
 * wrong L3 one.
 *
 * WHAT THIS FILE DELIBERATELY DOES NOT COVER
 * ------------------------------------------
 *   - The vehicle double-booking trigger's general behaviour, the portal insert's
 *     tenant stamp, monthly_amount's double meaning and the customer-path tier
 *     toggles: all already pinned in 03-rental-create.test.ts. The one overlap
 *     with 03 that is intentional is the tier toggles on the PORTAL path — 03's
 *     assertions and watchdog are scoped to BookingCheckoutStep.tsx, and the
 *     portal case is different in kind (the columns are fetched and then ignored,
 *     so an absence test would not even be expressible).
 *   - RLS policy text. RLS being off on these tables is the premise here, not the
 *     claim; nothing below asserts a policy.
 *   - Anything live. Production is hviqoaokxvlancmftwuo and is never called.
 *
 * TWO NON-OBVIOUS MECHANISMS A LATER READER WILL TRIP ON
 * -----------------------------------------------------
 * 1. `.eq("tenant_id", tenantId || '')` is NOT the same defect as
 *    `if (tenantId) { ... .eq("tenant_id", tenantId) }`. The first sends an empty
 *    string to a uuid column and the query ERRORS (22P02) — bad, but it does not
 *    leak. The second silently drops the filter and returns every tenant's rows.
 *    search-service.ts contains both shapes and they are pinned separately.
 * 2. Postgres `UNIQUE (vehicle_id, rule_type, holiday_id)` without
 *    `NULLS NOT DISTINCT` treats two NULL holiday_ids as different values, so
 *    `ON CONFLICT` on that triple can never fire for a weekend row — whose
 *    holiday_id a CHECK constraint forces to NULL. The upsert is an insert.
 *
 * Every claim below was verified by reading the cited file at the cited line in
 * this working tree, not taken from a summary.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = (p: string) => resolve(__dirname, "../../../", p);

const GLOBAL_SEARCH_HOOK = readFileSync(root("apps/portal/src/hooks/use-global-search.ts"), "utf8");
const SIDEBAR_SEARCH = readFileSync(
  root("apps/portal/src/components/shared/layout/sidebar-search-scene.tsx"),
  "utf8",
);
const SEARCH_SERVICE = readFileSync(root("apps/portal/src/lib/search-service.ts"), "utf8");
const INVOICE_UTILS = readFileSync(root("apps/portal/src/lib/invoice-utils.ts"), "utf8");
const BOOKING_CHECKOUT = readFileSync(root("apps/booking/src/components/BookingCheckoutStep.tsx"), "utf8");
const PORTAL_NEW = readFileSync(root("apps/portal/src/app/(dashboard)/rentals/new/page.tsx"), "utf8");
const PORTAL_NEW_V2 = readFileSync(root("apps/portal/src/components/rentals-v2/rental-create-v2.tsx"), "utf8");
const OVERLAP_SQL = readFileSync(
  root("supabase/migrations/20260418120000_fix_rental_overlap_trigger_for_extensions.sql"),
  "utf8",
);
const FLEET_QUOTE = readFileSync(root("apps/portal/src/lib/fleet-quote.ts"), "utf8");
const OVERRIDES_HOOK = readFileSync(root("apps/portal/src/hooks/use-vehicle-pricing-overrides.ts"), "utf8");
const DYNAMIC_PRICING_SQL = readFileSync(
  root("supabase/migrations/20260218120000_add_dynamic_pricing.sql"),
  "utf8",
);
const PRICE_ENGINE = readFileSync(root("apps/portal/src/lib/calculate-rental-price.ts"), "utf8");
const REMOTE_SCHEMA = readFileSync(root("supabase/migrations/20251219083413_remote_schema.sql"), "utf8");
const FLEET_HEALTH_SQL = readFileSync(
  root("supabase/migrations/20260823130000_fleet_health_defect_fixes.sql"),
  "utf8",
);

const countOf = (haystack: string, needle: string) => haystack.split(needle).length - 1;

/** The body of `generateInvoiceNumber`, from its signature to the closing `};`. */
const GENERATE_INVOICE_NUMBER_BODY = (() => {
  const start = INVOICE_UTILS.indexOf("export const generateInvoiceNumber");
  const end = INVOICE_UTILS.indexOf("\n};", start);
  return INVOICE_UTILS.slice(start, end);
})();

/** The `CREATE TABLE ... "public"."rentals"` block of the remote schema dump. */
const RENTALS_DDL = (() => {
  const start = REMOTE_SCHEMA.indexOf('CREATE TABLE IF NOT EXISTS "public"."rentals" (');
  const end = REMOTE_SCHEMA.indexOf("\n);", start);
  return REMOTE_SCHEMA.slice(start, end);
})();

// @usecase A portal search typed before the tenant resolves returns, and caches,
// another operator's customers, vehicles, rentals, fines, payments, plates and
// policies — the boundary is the `if (tenantId)` and nothing else.
describe("tenant isolation — global search runs unscoped when the tenant has not resolved", () => {
  /**
   * DEFECT (critical). apps/portal/src/hooks/use-global-search.ts:32.
   *
   * `searchAll(query, filter, tenantId?, currency)` scopes SEVEN of its table
   * reads with `if (tenantId) { q = q.eq("tenant_id", tenantId) }` — customers
   * (:114), vehicles (:139), rentals (:172), fines (:209), payments (:243),
   * plates (:279), insurance_policies (:314). When `tenantId` is undefined the
   * filter is simply not applied and each read returns ten rows from ACROSS the
   * platform.
   *
   * The hook fires that call with `enabled: debouncedQuery.length > 0` — no
   * tenant term. Its sibling caller, sidebar-search-scene.tsx:186, fires the same
   * function with `enabled: term.length > 0 && !!tenant?.id` and carries a
   * comment saying the guard is load-bearing for exactly this reason. Two callers
   * of one function, one guarded and one not.
   *
   * The window is real: portal TenantContext resolves the tenant by reading the
   * SUBDOMAIN and then awaiting a fetch (TenantContext.tsx:257-296), so `tenant`
   * is null for the first paint and the search box is already typeable.
   *
   * Pinned below; the correct expectation is the `.fails` watchdog.
   */
  it("fires the global search on query length alone, with no tenant term in its enabled condition", () => {
    expect(GLOBAL_SEARCH_HOOK).toContain("enabled: debouncedQuery.length > 0,");
    // The hook HAS the tenant — it puts it in the query key and passes it on —
    // it just does not wait for it.
    expect(GLOBAL_SEARCH_HOOK).toContain("const { tenant } = useTenant();");
    expect(GLOBAL_SEARCH_HOOK).toMatch(/queryFn:.*searchAll\(debouncedQuery, entityFilter, tenant\?\.id/);
    expect(GLOBAL_SEARCH_HOOK).not.toMatch(/enabled:[^\n]*tenant/);
  });

  it("guards the same call on the sidebar path, with a comment saying the guard is load-bearing", () => {
    expect(SIDEBAR_SEARCH).toContain("enabled: term.length > 0 && !!tenant?.id,");
    expect(SIDEBAR_SEARCH).toContain("// `!!tenant` is load-bearing, not a loading nicety");
    expect(SIDEBAR_SEARCH).toContain("// before the tenant resolves would run them unscoped.");
  });

  it("leaves seven of the search's table reads conditionally scoped, so an absent tenant drops the filter", () => {
    // Seven `if (tenantId) {` blocks, one per read: customers, vehicles, rentals,
    // fines, payments, plates, insurance_policies.
    expect(countOf(SEARCH_SERVICE, "if (tenantId) {")).toBe(7);
    expect(SEARCH_SERVICE).toContain('customerQuery = customerQuery.eq("tenant_id", tenantId);');
    expect(SEARCH_SERVICE).toContain('paymentQuery = paymentQuery.eq("tenant_id", tenantId);');
    expect(SEARCH_SERVICE).toContain('insuranceQuery = insuranceQuery.eq("tenant_id", tenantId);');
    // The parameter is optional at the signature, which is what makes the
    // unguarded call legal.
    expect(SEARCH_SERVICE).toMatch(/async searchAll\([^)]*tenantId\?: string/);
  });

  it("compares the uuid column against an empty string on the other two reads, which errors instead of leaking", () => {
    // invoices (:350) and customer_documents (:428) take a different shape:
    // `.eq("tenant_id", tenantId || '')`. With no tenant that is '' against a
    // uuid column — a 22P02, not a cross-tenant read. Different failure, pinned
    // separately so a later fix cannot claim all nine are the same bug.
    expect(countOf(SEARCH_SERVICE, `.eq("tenant_id", tenantId || '')`)).toBe(2);
  });

  it.fails("should not run the global search before the tenant has resolved", () => {
    // Remove the `.fails` marker once apps/portal/src/hooks/use-global-search.ts:32
    // gates the query on the tenant the way sidebar-search-scene.tsx:186 does.
    expect(GLOBAL_SEARCH_HOOK).toMatch(/enabled:[^\n]*!!tenant\?\.id/);
  });

  it.fails("should scope every one of the search's table reads unconditionally", () => {
    // Remove the `.fails` marker once apps/portal/src/lib/search-service.ts
    // requires a tenant id instead of treating it as optional.
    expect(countOf(SEARCH_SERVICE, "if (tenantId) {")).toBe(0);
  });
});

// @usecase Each operator's invoice book is numbered by the whole platform's
// volume, so an auditor sees INV-202609-0001 followed by INV-202609-0047 in a
// document customers are told is sequential.
describe("tenant isolation — portal invoice numbers come from one platform-wide sequence", () => {
  /**
   * DEFECT (high). apps/portal/src/lib/invoice-utils.ts:44-56.
   *
   * `generateInvoiceNumber(tenantId?: string)` declares the parameter and never
   * mentions it again. Its lookup filters on the `INV-YYYYMM-` prefix only — no
   * `.eq('tenant_id', ...)` — so the "highest sequence used this month" is the
   * highest across every tenant on the platform. The caller passes the tenant id
   * in good faith (invoice-utils.ts:74, from rental create at
   * rentals/new/page.tsx:2339 and rental-create-v2.tsx:2313).
   *
   * And `invoices.invoice_number` is UNIQUE platform-wide
   * (remote_schema.sql:5849), not per tenant — so the collision this creates is a
   * real 23505, not a cosmetic one.
   */
  it("accepts a tenant id and never uses it when choosing the next number", () => {
    expect(INVOICE_UTILS).toContain(
      "export const generateInvoiceNumber = async (tenantId?: string): Promise<string> => {",
    );
    // Exactly one mention of `tenantId` in the whole function: the signature.
    expect(countOf(GENERATE_INVOICE_NUMBER_BODY, "tenantId")).toBe(1);
    expect(GENERATE_INVOICE_NUMBER_BODY).not.toContain("tenant_id");
  });

  it("picks the highest number for the month by prefix alone, across every tenant", () => {
    expect(GENERATE_INVOICE_NUMBER_BODY).toContain("const prefix = `INV-${year}${month}-`;");
    expect(GENERATE_INVOICE_NUMBER_BODY).toContain(".like('invoice_number', `${prefix}%`)");
    expect(GENERATE_INVOICE_NUMBER_BODY).toContain(".order('invoice_number', { ascending: false })");
  });

  it("passes the tenant id in from the rental-create caller regardless", () => {
    expect(INVOICE_UTILS).toContain("const invoiceNumber = await generateInvoiceNumber(data.tenant_id);");
  });

  it("holds invoice_number unique across the whole platform, not per tenant", () => {
    expect(REMOTE_SCHEMA).toContain(
      'ADD CONSTRAINT "invoices_invoice_number_key" UNIQUE ("invoice_number");',
    );
    expect(REMOTE_SCHEMA).not.toMatch(
      /UNIQUE\s*\(\s*"tenant_id"\s*,\s*"invoice_number"\s*\)/,
    );
  });

  it.fails("should number each tenant's invoices from that tenant's own sequence", () => {
    // Remove the `.fails` marker once apps/portal/src/lib/invoice-utils.ts:50-56
    // scopes the lookup to the tenant it is handed.
    expect(GENERATE_INVOICE_NUMBER_BODY).toContain("tenant_id");
  });
});

// @usecase Invoice creation — and therefore rental creation, which has already
// committed the rental row by then — throws permanently once the platform issues
// its 10,000th invoice in a calendar month, and never recovers by itself.
describe("tenant isolation — the invoice sequence jams at 9999 because it is compared as text", () => {
  /**
   * DEFECT (high). apps/portal/src/lib/invoice-utils.ts:55, :64-65, :69-113.
   *
   * `invoice_number` is TEXT and the "highest so far" query is
   * `.order('invoice_number', { ascending: false })` — a string sort. Once
   * INV-202609-10000 exists, comparing it with INV-202609-9999 at index 11 gives
   * '1' < '9', so the 9999 row still sorts highest. The generator therefore keeps
   * proposing 10000, which is already taken.
   *
   * `padStart(4, '0')` does not truncate, so nothing masks it: 10000 stays five
   * characters and stays a valid-looking number.
   *
   * `createInvoice` retries exactly once (`maxRetries = 2`, retry only while
   * `attempt < maxRetries - 1`) and re-derives the SAME number, so both attempts
   * hit 23505 and the second rethrows — after the rental row has already been
   * inserted (rentals/new/page.tsx:1922-1926, invoice at :2339).
   *
   * LAYER 3. `proposeNext` below is a faithful re-typing of lines 50-65: the
   * prefix filter, the descending string sort, `parseInt(...replace(prefix,''))`
   * and `padStart(4,'0')`. The source assertions in this same describe are what
   * keep the re-implementation honest. JS string comparison is code-unit order,
   * which for the ASCII digits in these keys matches Postgres' ordering.
   */
  const proposeNext = (prefix: string, existing: string[]): string => {
    const latest = existing
      .filter((n) => n.startsWith(prefix))
      .sort()
      .reverse()[0];
    let nextSeq = 1;
    if (latest) {
      const lastSeq = parseInt(latest.replace(prefix, ""), 10);
      if (!isNaN(lastSeq)) nextSeq = lastSeq + 1;
    }
    return `${prefix}${String(nextSeq).padStart(4, "0")}`;
  };

  it("orders a text column as text and pads without truncating", () => {
    expect(INVOICE_UTILS).toContain(".order('invoice_number', { ascending: false })");
    expect(INVOICE_UTILS).toContain("const sequence = String(nextSeq).padStart(4, '0');");
    expect(INVOICE_UTILS).toContain("return `${prefix}${sequence}`;");
  });

  it("allocates the next number correctly while the month's count is under four digits", () => {
    // 0001 is the only row -> parseInt('0001') = 1 -> 1 + 1 = 2 -> '0002'.
    expect(proposeNext("INV-202609-", ["INV-202609-0001"])).toBe("INV-202609-0002");
    // 0046 highest -> 46 + 1 = 47 -> '0047'.
    expect(proposeNext("INV-202609-", ["INV-202609-0001", "INV-202609-0046"])).toBe("INV-202609-0047");
    // Empty month -> 1 -> '0001'.
    expect(proposeNext("INV-202609-", [])).toBe("INV-202609-0001");
  });

  it("sorts INV-202609-9999 above INV-202609-10000, because '9' beats '1' at the twelfth character", () => {
    // 'INV-202609-' is 11 characters, so index 11 is the first digit: '9' vs '1'.
    expect("INV-202609-9999" > "INV-202609-10000").toBe(true);
    expect("INV-202609-10000".charAt(11)).toBe("1");
    expect("INV-202609-9999".charAt(11)).toBe("9");
  });

  it("re-proposes the already-issued 10000 forever once the platform passes 9999 in a month", () => {
    const issued = ["INV-202609-0001", "INV-202609-9999", "INV-202609-10000"];
    // 9999 still sorts highest -> 9999 + 1 = 10000 -> padStart leaves five digits.
    expect(proposeNext("INV-202609-", issued)).toBe("INV-202609-10000");
    expect(issued).toContain(proposeNext("INV-202609-", issued));
    // 10000 is five characters after padding, not truncated to '0000'.
    expect(String(10000).padStart(4, "0")).toBe("10000");
  });

  it("retries once and re-derives the identical number, so the second attempt throws too", () => {
    expect(INVOICE_UTILS).toContain("const maxRetries = 2;");
    expect(INVOICE_UTILS).toContain("for (let attempt = 0; attempt < maxRetries; attempt++)");
    expect(INVOICE_UTILS).toContain("if (error.code === '23505' && attempt < maxRetries - 1)");
    expect(INVOICE_UTILS).toContain("throw new Error('Failed to create invoice after retries');");
    // The retry calls the same pure allocator with the same inputs.
    const issued = ["INV-202609-9999", "INV-202609-10000"];
    const attemptOne = proposeNext("INV-202609-", issued);
    const attemptTwo = proposeNext("INV-202609-", issued);
    expect(attemptTwo).toBe(attemptOne);
  });

  it.fails("should allocate 10001 once 10000 has been issued", () => {
    // Remove the `.fails` marker once apps/portal/src/lib/invoice-utils.ts:50-65
    // compares the sequence numerically instead of as text.
    const issued = ["INV-202609-0001", "INV-202609-9999", "INV-202609-10000"];
    expect(proposeNext("INV-202609-", issued)).toBe("INV-202609-10001");
  });
});

// @usecase A paid, committed, car-reserving rental that carries no tenant is
// invisible to its own operator's rentals list, calendar and reminders — the
// vehicle is out and nobody knows.
describe("tenant isolation — the booking-site rental writes no tenant when the context has not resolved", () => {
  /**
   * DEFECT. apps/booking/src/components/BookingCheckoutStep.tsx:1119-1121,
   * with supabase/migrations/20251219083413_remote_schema.sql:5017.
   *
   * `tenant_id` is absent from the `rentalData` literal (:1091-1117) and added
   * afterwards only `if (tenant?.id)`. The insert at :1162-1166 is unconditional,
   * so when the stamp is skipped the row is still written — just without an
   * owner. The column is nullable with no default (`"tenant_id" "uuid",`) and no
   * migration ever adds NOT NULL, so the database accepts it.
   *
   * Note what is NOT claimed here: whether the tenant can in practice be
   * unresolved at submit time on a live subdomain was not verified. What is
   * verified, and pinned, is that nothing in either layer would stop it.
   */
  it("adds tenant_id to the payload only inside a nullish tenant check", () => {
    expect(BOOKING_CHECKOUT).toMatch(/if \(tenant\?\.id\) \{\s*\n\s*rentalData\.tenant_id = tenant\.id;\s*\n\s*\}/);
  });

  it("inserts the rental unconditionally, outside that check", () => {
    expect(BOOKING_CHECKOUT).toMatch(
      /const \{ data: rental, error: rentalError \} = await supabase\s*\n\s*\.from\("rentals"\)\s*\n\s*\.insert\(rentalData\)/,
    );
  });

  it("declares rentals.tenant_id nullable with no default, so the database accepts the ownerless row", () => {
    expect(RENTALS_DDL).toContain('"tenant_id" "uuid",');
    expect(RENTALS_DDL).not.toMatch(/"tenant_id" "uuid"[^,\n]*NOT NULL/);
    expect(RENTALS_DDL).not.toMatch(/"tenant_id" "uuid"[^,\n]*DEFAULT/);
  });

  it.fails("should refuse to write a rental that has no tenant", () => {
    // Remove the `.fails` marker once BookingCheckoutStep.tsx:1119 either throws
    // on an unresolved tenant or the rentals.tenant_id column is made NOT NULL.
    const guarded =
      /if \(!tenant\?\.id\)[^\n]*\n?\s*throw/.test(BOOKING_CHECKOUT) ||
      /"tenant_id" "uuid" NOT NULL/.test(RENTALS_DDL);
    expect(guarded).toBe(true);
  });
});

// @usecase The same nullish-tenant test that loses the tenant stamp also
// switches off the pre-insert guards, so failures arrive in a cluster instead of
// one at a time — and the duplicate-submit guard has no database backstop.
describe("tenant isolation — one nullish-tenant test also disables the pre-insert guards", () => {
  /**
   * DEFECT. BookingCheckoutStep.tsx:1128 and rentals/new/page.tsx:1902.
   *
   * Both create paths gate a pre-insert check on `tenant?.id` and then insert
   * regardless:
   *
   *   booking  — the overlap guard, `if (rentalData.vehicle_id && tenant?.id)`
   *   portal   — the 10-minute duplicate guard, `if (tenant?.id && data.customer_id && ...)`
   *
   * The two are NOT equally serious, and this describe keeps them apart:
   *
   *   - Skipping the overlap guard only degrades the error text. check_rental_overlap
   *     is a real BEFORE trigger raising 23P01
   *     (20260418120000_fix_rental_overlap_trigger_for_extensions.sql:44-45), and
   *     the guard's own comment says it exists to give a clear message instead of
   *     the raw trigger exception. An overlapping rental is still refused.
   *   - Skipping the duplicate guard has NO backstop. The only UNIQUE constraint
   *     on rentals is `rentals_rental_number_key` (remote_schema.sql:6009);
   *     nothing in any migration constrains (customer_id, vehicle_id, start_date).
   *     A double-submit therefore commits twice.
   */
  it("gates the booking overlap guard on the tenant, then inserts whether or not it ran", () => {
    expect(BOOKING_CHECKOUT).toContain(
      "// Pre-insert overlap guard: mirrors the DB trigger check_rental_overlap.",
    );
    expect(BOOKING_CHECKOUT).toContain("if (rentalData.vehicle_id && tenant?.id) {");
  });

  it("still refuses the overlapping rental at the database when that guard is skipped", () => {
    // So the booking half is a message-quality loss, not a double-booking.
    expect(OVERLAP_SQL).toContain("RAISE EXCEPTION 'Vehicle rental overlap");
    expect(OVERLAP_SQL).toContain("USING ERRCODE = '23P01'");
    expect(BOOKING_CHECKOUT).toContain("gives a clear");
  });

  it("gates the portal's duplicate-submit guard on the tenant as well", () => {
    expect(PORTAL_NEW).toContain("if (tenant?.id && data.customer_id && data.vehicle_id) {");
    expect(PORTAL_NEW).toContain("const dupSince = new Date(Date.now() - 10 * 60 * 1000).toISOString();");
  });

  it("has no database constraint behind that duplicate guard, unlike the overlap one", () => {
    // The only UNIQUE on rentals is the rental number.
    expect(REMOTE_SCHEMA).toContain('ADD CONSTRAINT "rentals_rental_number_key" UNIQUE ("rental_number");');
    expect(REMOTE_SCHEMA).not.toMatch(/UNIQUE\s*\(\s*"customer_id"\s*,\s*"vehicle_id"\s*,\s*"start_date"\s*\)/);
  });

  it.fails("should not make the accidental-double-submit guard conditional on the tenant resolving", () => {
    // Remove the `.fails` marker once apps/portal/src/app/(dashboard)/rentals/new/page.tsx:1902
    // no longer switches the duplicate guard off with the tenant (or a DB
    // constraint backs it up).
    expect(PORTAL_NEW).not.toContain("if (tenant?.id && data.customer_id && data.vehicle_id) {");
  });
});

// @usecase Same-day turnaround — one renter returns at 10:00, the next collects
// at 14:00 — is offered by the quote engine and then refused by the database.
// That is the normal rental business, structurally impossible.
describe("tenant isolation — the overlap trigger compares dates while the quote engine compares times", () => {
  /**
   * DEFECT (high).
   * supabase/migrations/20260418120000_fix_rental_overlap_trigger_for_extensions.sql:36-46
   * versus apps/portal/src/lib/fleet-quote.ts:201-244.
   *
   * The trigger's EXISTS predicate uses start_date/end_date only. The word
   * pickup_time does not appear anywhere in that migration. The quote engine
   * composes date + time + a turnaround buffer and documents adjacent handovers
   * as ALLOWED. So the two disagree on every same-day handover.
   *
   * LAYER 3 island: `triggerSeesClash` re-types the SQL predicate's two date
   * comparisons. It is pinned to the SQL by the source assertions above it.
   */
  const triggerSeesClash = (
    existing: { start: string; end: string },
    incoming: { start: string; end: string },
  ): boolean =>
    // start_date <= NEW.end_date AND end_date >= check_start
    existing.start <= incoming.end && existing.end >= incoming.start;

  it("names no time column at all in the overlap predicate", () => {
    expect(OVERLAP_SQL).toMatch(/AND start_date <= COALESCE\(NEW\.end_date, '9999-12-31'::date\)/);
    expect(OVERLAP_SQL).toMatch(/AND COALESCE\(end_date, '9999-12-31'::date\) >= check_start/);
    expect(OVERLAP_SQL).not.toContain("pickup_time");
    expect(OVERLAP_SQL).not.toContain("return_time");
    expect(OVERLAP_SQL).not.toContain("buffer");
  });

  it("reads both handover times and a turnaround buffer on the quote side", () => {
    expect(FLEET_QUOTE).toContain('rental.pickup_time?.slice(0, 5) || "00:00"');
    expect(FLEET_QUOTE).toContain('rental.return_time?.slice(0, 5) || "23:59"');
    expect(FLEET_QUOTE).toContain("const bufferMs = Math.max(0, Number(config.bufferMinutes) || 0) * 60_000;");
    expect(FLEET_QUOTE).toContain("// Adjacent handovers are allowed when the configured buffer is fully met.");
    expect(FLEET_QUOTE).toContain("return rentalStart < requestEnd && rentalEnd > requestStart;");
  });

  it("treats a 10:00 return and a 14:00 collection on one day as a clash, by date alone", () => {
    // Rental A: 2026-03-01 -> 2026-03-05, back at 10:00.
    // Rental B: 2026-03-05 -> 2026-03-09, out at 14:00. Four clear hours between.
    // Trigger: '2026-03-01' <= '2026-03-09' AND '2026-03-05' >= '2026-03-05' -> true.
    expect(
      triggerSeesClash({ start: "2026-03-01", end: "2026-03-05" }, { start: "2026-03-05", end: "2026-03-09" }),
    ).toBe(true);
    // And the day after is fine, which shows the predicate is otherwise sane:
    // '2026-03-05' >= '2026-03-06' is false.
    expect(
      triggerSeesClash({ start: "2026-03-01", end: "2026-03-05" }, { start: "2026-03-06", end: "2026-03-09" }),
    ).toBe(false);
  });

  it.fails("should allow a same-day handover the quote engine has already offered", () => {
    // Remove the `.fails` marker once check_rental_overlap (currently
    // supabase/migrations/20260418120000_fix_rental_overlap_trigger_for_extensions.sql:36-43)
    // compares pickup_time/return_time the way fleet-quote.ts:201-244 does.
    expect(OVERLAP_SQL).toContain("pickup_time");
  });
});

// @usecase A customer row is the hub for documents, payments, invoices and
// rental history. Moving one between operators by email match hands a tenant
// another operator's customer and everything joined to them.
describe("tenant isolation — the booking site adopts unowned customer rows by email, and manufactures them", () => {
  /**
   * DEFECT. apps/booking/src/components/BookingCheckoutStep.tsx:861-869 (the
   * fallback), :886-888 (the adoption), :924-926 (the producer).
   *
   * The tenant-scoped lookup at :851-858 runs first, so this only ever touches
   * rows whose tenant_id is already NULL. That is the whole argument for it —
   * and the reason it is still wrong: a NULL-tenant row is treated as UNOWNED
   * when it may hold another operator's history, and `.select("*")` brings the
   * entire row across before the update stamps the new tenant onto it.
   *
   * The closed loop is what makes this worth pinning as one unit: the producer of
   * NULL-tenant customer rows is the SAME function, forty lines further down,
   * where `tenant_id` is again added only `if (tenant?.id)`. One unresolved tenant
   * mints the orphan; the next booking on any tenant's site adopts it.
   */
  it("falls back to any customer row with the same email and no tenant", () => {
    expect(BOOKING_CHECKOUT).toContain("// Fallback: check globally (for customers without tenant_id)");
    expect(BOOKING_CHECKOUT).toMatch(
      /\.from\("customers"\)\s*\n\s*\.select\("\*"\)\s*\n\s*\.ilike\("email", normalizedEmail\)\s*\n\s*\.is\("tenant_id", null\)/,
    );
  });

  it("stamps the current tenant onto the row it found", () => {
    expect(BOOKING_CHECKOUT).toContain("// Also update tenant_id if not already set");
    expect(BOOKING_CHECKOUT).toContain("if (tenant?.id && !existingCustomer.tenant_id) {");
    expect(BOOKING_CHECKOUT).toContain("updateData.tenant_id = tenant.id;");
  });

  it("creates the very rows that fallback later adopts, because the create-side stamp is optional too", () => {
    expect(BOOKING_CHECKOUT).toMatch(/if \(tenant\?\.id\) \{\s*\n\s*customerData\.tenant_id = tenant\.id;\s*\n\s*\}/);
    expect(BOOKING_CHECKOUT).toMatch(/\.from\("customers"\)\s*\n\s*\.insert\(customerData as any\)/);
  });

  it("does the tenant-scoped lookup first, which is what keeps this to unowned rows only", () => {
    // Stated so a later reader does not over-read the defect: this never steals a
    // row that another tenant already owns.
    expect(BOOKING_CHECKOUT).toContain("// First: check within this tenant (matches the unique constraint)");
    expect(BOOKING_CHECKOUT).toContain('.eq("tenant_id", tenant.id)');
  });

  it.fails("should not treat a tenantless customer row as free to claim by email", () => {
    // Remove the `.fails` marker once BookingCheckoutStep.tsx:861-869 stops
    // matching on `.is("tenant_id", null)` alone.
    expect(BOOKING_CHECKOUT).not.toContain('.is("tenant_id", null)');
  });
});

// @usecase The duplicate-customer recovery exists for exactly the race it cannot
// survive: with no tenant it queries a uuid column with an empty string, throws
// the error away, and reports "Customer create failed" with no cause.
describe("tenant isolation — the 23505 customer recovery filters the uuid tenant column with an empty string", () => {
  /**
   * DEFECT (medium). apps/booking/src/components/BookingCheckoutStep.tsx:944-955.
   *
   * `.eq("tenant_id", tenant?.id ?? '')` sends '' to a uuid column when the
   * tenant is unresolved: Postgres answers 22P02. The destructure is
   * `const { data: refound }` with no `error`, so that is discarded, `refound` is
   * null, and the else branch throws the generic message.
   *
   * This is the {error}-never-throws class the repo's own memory names as the
   * source of most of the July 2026 money bugs — supabase-js resolves, it does
   * not throw, so an undestructured error is an invisible failure.
   */
  it("recovers by re-selecting on email and an empty-string tenant", () => {
    expect(BOOKING_CHECKOUT).toContain("// 23505 = unique_violation on (email, tenant_id).");
    expect(BOOKING_CHECKOUT).toContain(`.eq("tenant_id", tenant?.id ?? '')`);
  });

  it("discards the error from that re-select, so the cause never reaches the operator", () => {
    expect(BOOKING_CHECKOUT).toMatch(
      /const \{ data: refound \} = await supabase\s*\n\s*\.from\("customers"\)/,
    );
    expect(BOOKING_CHECKOUT).not.toMatch(/const \{ data: refound, error/);
    expect(BOOKING_CHECKOUT).toContain("throw new Error(`Customer create failed: ${describeErr(createError)}`)");
  });

  it.fails("should surface why the duplicate-customer recovery failed", () => {
    // Remove the `.fails` marker once BookingCheckoutStep.tsx:944 destructures the
    // error and stops substituting '' for a missing tenant uuid.
    const fixed =
      /const \{ data: refound, error/.test(BOOKING_CHECKOUT) &&
      !BOOKING_CHECKOUT.includes(`.eq("tenant_id", tenant?.id ?? '')`);
    expect(fixed).toBe(true);
  });
});

// @usecase An operator corrects a vehicle's weekend price, the old row stays,
// and the quote engine may keep selling the car at the superseded rate while the
// settings screen shows the new one.
describe("tenant isolation — the weekend pricing override inserts a duplicate on every save", () => {
  /**
   * DEFECT (high). apps/portal/src/hooks/use-vehicle-pricing-overrides.ts:57,:65
   * with supabase/migrations/20260218120000_add_dynamic_pricing.sql:80,:83.
   *
   * The upsert targets `vehicle_id,rule_type,holiday_id`. A weekend row's
   * holiday_id is forced to NULL by CHECK `vpo_holiday_id_for_holiday`, and the
   * UNIQUE is plain — no NULLS NOT DISTINCT — so in Postgres two NULLs are never
   * equal and ON CONFLICT can never fire. Every save is an INSERT.
   *
   * The read side orders by rule_type only, and the pricing engine resolves the
   * weekend override with `.find()` — first match wins, and which row is first is
   * whatever Postgres returned.
   */
  it("targets a conflict triple whose third column is always NULL for a weekend row", () => {
    expect(OVERRIDES_HOOK).toContain("holiday_id: override.holiday_id ?? null,");
    expect(OVERRIDES_HOOK).toContain(".upsert(payload, { onConflict: 'vehicle_id,rule_type,holiday_id' })");
    expect(DYNAMIC_PRICING_SQL).toContain(
      "CONSTRAINT vpo_holiday_id_for_holiday CHECK (rule_type = 'holiday' OR holiday_id IS NULL),",
    );
  });

  it("declares that uniqueness with NULLs distinct, so the conflict is never detected", () => {
    expect(DYNAMIC_PRICING_SQL).toContain("UNIQUE (vehicle_id, rule_type, holiday_id)");
    expect(DYNAMIC_PRICING_SQL).not.toMatch(/NULLS\s+NOT\s+DISTINCT/i);
  });

  it("resolves the weekend override with the first row that comes back, in unspecified order", () => {
    expect(OVERRIDES_HOOK).toContain(".order('rule_type', { ascending: true })");
    expect(PRICE_ENGINE).toContain("const override = overrides.find(o => o.rule_type === 'weekend');");
    // Two resolution sites — the plain weekend branch (:323) and the stacking
    // branch (:214) — both first-match-wins over the duplicated rows.
    expect(countOf(PRICE_ENGINE, "overrides.find(o => o.rule_type === 'weekend')")).toBe(2);
  });

  it.fails("should update the existing weekend override instead of adding another", () => {
    // Remove the `.fails` marker once either
    // supabase/migrations/20260218120000_add_dynamic_pricing.sql:83 declares the
    // unique index NULLS NOT DISTINCT, or use-vehicle-pricing-overrides.ts:65
    // stops relying on ON CONFLICT for weekend rows.
    const fixed =
      /NULLS\s+NOT\s+DISTINCT/i.test(DYNAMIC_PRICING_SQL) ||
      !OVERRIDES_HOOK.includes("{ onConflict: 'vehicle_id,rule_type,holiday_id' }");
    expect(fixed).toBe(true);
  });
});

// @usecase An operator who turns weekly hire off for a car can still be walked
// through creating a weekly rental for it from the portal — and the toggle that
// says no is already sitting in the component's own state.
describe("tenant isolation — the portal create path fetches the tier toggles and never reads them", () => {
  /**
   * UNCOVERED BEHAVIOUR, distinct from the customer-path gap already pinned at
   * tests/spine/rental/03-rental-create.test.ts:208 (which asserts the strings are
   * ABSENT from BookingCheckoutStep.tsx, and whose watchdog at :218 is scoped to
   * that file).
   *
   * Here the columns ARE selected — rentals/new/page.tsx:1113 and
   * rental-create-v2.tsx:1100 — and then never mentioned again in either file.
   * So the absence idiom does not work; what is asserted is presence in the
   * SELECT plus exactly one occurrence in the whole file, which is that SELECT.
   *
   * The booking widget at least filters at list time
   * (apps/booking/src/app/booking/vehicles/page.tsx:122-128), so the two apps are
   * not even consistent about an advisory rule.
   */
  it("selects all three tier toggles when loading vehicles on both portal create screens", () => {
    expect(PORTAL_NEW).toContain(
      "available_daily, available_weekly, available_monthly",
    );
    expect(PORTAL_NEW_V2).toContain(
      "available_daily, available_weekly, available_monthly",
    );
  });

  it("mentions each toggle exactly once per file — in that SELECT and nowhere else", () => {
    for (const source of [PORTAL_NEW, PORTAL_NEW_V2]) {
      expect(countOf(source, "available_daily")).toBe(1);
      expect(countOf(source, "available_weekly")).toBe(1);
      expect(countOf(source, "available_monthly")).toBe(1);
      const line = source.split("\n").find((l) => l.includes("available_daily"))!;
      expect(line).toContain(".select(");
    }
  });

  it.fails("should check the tier toggles on the portal path before writing the rental", () => {
    // Remove the `.fails` marker once apps/portal/src/app/(dashboard)/rentals/new/page.tsx
    // reads available_daily/weekly/monthly somewhere other than its line-1113 SELECT.
    expect(countOf(PORTAL_NEW, "available_daily")).toBeGreaterThan(1);
  });
});

// @usecase Five existing overlap tests assert against SQL that provably is not
// what runs in production. If nobody records that, the next person reads a green
// suite as proof the trigger behaves as written.
describe("tenant isolation — the overlap-trigger tests are pinned to a migration the repo says is behind production", () => {
  /**
   * REGRESSION GUARD, not a defect in application code.
   *
   * supabase/migrations/20260823130000_fleet_health_defect_fixes.sql:3-9 states in
   * its own header that production's check_rental_overlap already carries a
   * blocked_dates clause raising 23P02, scoped to maintenance/swap, which appears
   * in no migration file. Grepping agrees: 23P02 occurs in exactly one file in
   * supabase/migrations, and there only inside that comment.
   *
   * The newest migration that actually DEFINES the trigger body remains
   * 20260418120000, which knows nothing about blocked_dates — and that is the file
   * this suite reads, here and at 03-rental-create.test.ts:27-30.
   *
   * Repo memory records that production schema is applied through the Management
   * API without migration files, so this divergence will recur. This test exists
   * so it is written down next to the tests it undermines.
   */
  it("records in its own header that production's overlap trigger is ahead of this repo", () => {
    expect(FLEET_HEALTH_SQL).toContain("-- REBASED ONTO THE LIVE DEFINITIONS, not the migration files.");
    expect(FLEET_HEALTH_SQL).toContain("-- ahead of this repo for Fleet Health: check_rental_overlap already carries a");
    expect(FLEET_HEALTH_SQL).toContain("-- blocked_dates clause (errcode 23P02, scoped to maintenance/swap),");
    expect(FLEET_HEALTH_SQL).toContain("-- appear in any migration file.");
  });

  it("has that extra rejection path in no migration body anywhere", () => {
    // Only the comment above mentions it, and only in this one file.
    expect(countOf(FLEET_HEALTH_SQL, "23P02")).toBe(1);
    expect(FLEET_HEALTH_SQL).not.toContain("CREATE OR REPLACE FUNCTION public.check_rental_overlap");
    expect(OVERLAP_SQL).not.toContain("blocked_dates");
    expect(OVERLAP_SQL).not.toContain("23P02");
  });

  it("leaves 20260418120000 as the newest committed definition, which is the one under test", () => {
    expect(OVERLAP_SQL).toContain("CREATE OR REPLACE FUNCTION check_rental_overlap()");
    expect(OVERLAP_SQL).toContain("USING ERRCODE = '23P01'");
  });
});
