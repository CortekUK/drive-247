// Enhanced search service with comprehensive search, ranking, and fuzzy matching
import { supabase } from "@/integrations/supabase/client";
import { formatCurrency } from "@/lib/format-utils";

/** One "Label  Value" row in the preview panel beside the results. */
export interface SearchResultDetail {
  label: string;
  value: string;
}

export interface SearchResult {
  id: string;
  title: string;
  subtitle: string;
  category: string;
  url: string;
  icon?: string;
  score?: number; // For ranking
  /** Chips above the title in the preview, e.g. ["Customers", "Active"]. */
  badges?: string[];
  /** One sentence under the title in the preview. */
  description?: string;
  /** The facts worth seeing before opening it. */
  details?: SearchResultDetail[];
  /** The preview's button, e.g. "Open customer". */
  openLabel?: string;
}

export interface SearchResults {
  customers: SearchResult[];
  vehicles: SearchResult[];
  rentals: SearchResult[];
  fines: SearchResult[];
  payments: SearchResult[];
  plates: SearchResult[];
  insurance: SearchResult[];
  invoices: SearchResult[];
  insurances: SearchResult[];
  agreements: SearchResult[];
  team: SearchResult[];
  locations: SearchResult[];
  promos: SearchResult[];
  extras: SearchResult[];
  reminders: SearchResult[];
  leads: SearchResult[];
  blog: SearchResult[];
  owners: SearchResult[];
  expenses: SearchResult[];
  enquiries: SearchResult[];
  customerDocs: SearchResult[];
  vehicleDocs: SearchResult[];
  blockedDates: SearchResult[];
  webPages: SearchResult[];
  sitePromos: SearchResult[];
  faqs: SearchResult[];
  testimonials: SearchResult[];
  emailTemplates: SearchResult[];
  agreementTemplates: SearchResult[];
  ownerPayouts: SearchResult[];
  auditLogs: SearchResult[];
}

export type RecordCategory = keyof SearchResults;

export const RECORD_CATEGORIES: readonly RecordCategory[] = [
  "customers", "vehicles", "rentals", "fines", "payments", "plates", "insurance", "invoices", "insurances", "agreements",
  "team", "locations", "promos", "extras", "reminders", "leads", "blog", "owners", "expenses", "enquiries",
  "customerDocs", "vehicleDocs", "blockedDates", "webPages", "sitePromos", "faqs", "testimonials",
  "emailTemplates", "agreementTemplates", "ownerPayouts", "auditLogs",
];

export const emptySearchResults = (): SearchResults =>
  Object.fromEntries(RECORD_CATEGORIES.map((c) => [c, []])) as unknown as SearchResults;

/**
 * Which record categories to search. A category the user cannot open (its page
 * is hidden for this tenant, or a manager lacks the permission) is left out, so
 * it is never queried and never offered.
 *
 * The original ten categories are searched unless set to `false`, as they
 * always were. The ones added later (OPT_IN_CATEGORIES) are searched only when
 * set to `true`, so a caller that predates them — sidebar-search-scene.tsx —
 * runs exactly the queries it always ran.
 */
export type SearchInclude = Partial<Record<RecordCategory, boolean>>;

export const OPT_IN_CATEGORIES: readonly RecordCategory[] = [
  "team", "locations", "promos", "extras", "reminders", "leads", "blog", "owners", "expenses", "enquiries",
  "customerDocs", "vehicleDocs", "blockedDates", "webPages", "sitePromos", "faqs", "testimonials",
  "emailTemplates", "agreementTemplates", "ownerPayouts", "auditLogs",
];

/**
 * The typed text, made safe for a PostgREST `or=(...)` filter. Commas,
 * parentheses and quotes are that syntax's own separators — a search for
 * "Smith, John" used to break the whole query and return nothing.
 */
export const toFilterText = (query: string): string =>
  query.replace(/[,()"\\*%]/g, " ").replace(/\s+/g, " ").trim();

/** A typed amount such as "500", "$500" or "49.99", as a number; otherwise null. */
export const toAmount = (query: string): number | null => {
  const m = /^\s*[$£€]?\s*(\d{1,9}(?:\.\d{1,2})?)\s*$/.exec(query);
  return m ? Number(m[1]) : null;
};

/** The words of a piece of text. Keeps the characters that appear inside emails, regs and references. */
export const tokenize = (s: string): string[] => s.toLowerCase().split(/[^a-z0-9@.+#_-]+/).filter(Boolean);

/**
 * How well one piece of text answers what was typed. 0 = not at all.
 *
 * Handles what people actually type: the whole phrase, the words in any order
 * ("smith john" finds "John Smith"), the start of a word ("mal" finds
 * "Malibu"), a word from the middle ("deposit" in a subtitle), and single-word
 * typos ("chevrolt").
 *
 * With more than one word typed, EVERY word must be found — otherwise a search
 * for "john smith" would return every John.
 */
export const scoreText = (text: string, query: string): number => {
  const haystack = (text || "").toLowerCase();
  const q = (query || "").trim().toLowerCase();
  if (!haystack || !q) return 0;

  if (haystack === q) return 100;
  if (haystack.startsWith(q)) return 92;
  if (haystack.includes(q)) return 84;

  const qWords = tokenize(q);
  if (qWords.length === 0) return 0;
  const words = tokenize(haystack);
  if (qWords.every((w) => words.some((h) => h.startsWith(w)))) return 76;
  if (qWords.every((w) => haystack.includes(w))) return 68;
  if (qWords.length > 1) return 0; // several words typed: all of them must appear

  // One word: allow a typo, by matching its letters in order.
  let matched = 0;
  let i = 0;
  for (const ch of haystack) {
    if (ch === q[i]) { matched++; i++; }
    if (i >= q.length) break;
  }
  return i === q.length ? (matched / q.length) * 50 : 0;
};

// Smart ranking function
const rankResults = (results: SearchResult[], query: string): SearchResult[] => {
  return results
    .map(result => ({
      ...result,
      score: Math.max(
        scoreText(result.title, query),
        // A subtitle match (the customer on a rental, the car on a fine) counts
        // slightly less than the same match in the title.
        scoreText(result.subtitle, query) - 1,
      )
    }))
    .filter(result => result.score > 0)
    .sort((a, b) => (b.score || 0) - (a.score || 0))
    .slice(0, 5); // Cap at 5 results per category
};

/** Label/value rows for the preview, with the empty ones dropped. */
const detailRows = (rows: [string, unknown][]): SearchResultDetail[] =>
  rows
    .filter(([, v]) => v !== null && v !== undefined && String(v).trim() !== "")
    .map(([label, v]) => ({ label, value: String(v) }));

/** `,customer_id.in.(a,b)` — or nothing when there are no ids to match. */
const inClause = (column: string, ids: string[]) => (ids.length ? `,${column}.in.(${ids.join(",")})` : "");

/**
 * A PostgREST `or=(...)` filter matching ANY of `fields` against ANY word
 * typed, so the order the words were typed in does not matter. The ranking
 * above then requires every word, so the wider net costs nothing.
 */
const anyField = (fields: readonly string[], words: readonly string[]): string =>
  fields.flatMap((f) => words.map((w) => `${f}.ilike.%${w}%`)).join(",");

export const searchService = {
  async searchAll(
    query: string,
    entityFilter: string = 'all',
    tenantId?: string,
    currencyCode: string = 'USD',
    include: SearchInclude = {},
  ): Promise<SearchResults> {
    const results = emptySearchResults();
    const text = toFilterText(query);
    if (!text) return results;

    const searchTerm = `%${text}%`;
    // Every word typed, so "smith john" and "john smith" find the same person.
    const words = tokenize(text).slice(0, 4);
    const terms = words.length ? words : [text];
    const amount = toAmount(query);
    const wants = (category: RecordCategory, ...filters: string[]) =>
      (OPT_IN_CATEGORIES.includes(category) ? include[category] === true : include[category] !== false) &&
      (entityFilter === 'all' || filters.includes(entityFilter));
    // Every query is limited to this tenant, as the original searches were.
    const scoped = <T,>(q: T): T => (tenantId ? (q as any).eq("tenant_id", tenantId) : q);

    // Customers and vehicles that match the text, so a rental, payment or fine
    // can be found by the customer's name or the car's registration too.
    let matchedCustomerIds: string[] = [];
    let matchedVehicleIds: string[] = [];
    const needsLinkedIds = wants('rentals', 'rentals') || wants('payments', 'payments') || wants('fines', 'fines');

    try {
      // Search customers (if not filtered out)
      if (wants('customers', 'customers') || needsLinkedIds) {
        const { data: customers } = await scoped(
          supabase
            .from("customers")
            .select("id, name, email, phone, status, company_name, license_number, address_city, created_at, is_blocked")
            .or(anyField(
              ["name", "email", "phone", "company_name", "license_number", "id_number", "address_street", "address_city", "address_zip", "status"],
              terms,
            ))
        ).limit(10);

        matchedCustomerIds = (customers || []).map((c) => c.id);

        if (wants('customers', 'customers')) {
          const customerResults = (customers || []).map(customer => ({
            id: customer.id,
            title: customer.name,
            subtitle: `${customer.email || customer.phone || ''} • ${customer.status || 'Active'}`,
            category: "Customers",
            url: `/customers/${customer.id}`,
            icon: "user",
            badges: ["Customer", (customer as any).is_blocked ? "Blocked" : customer.status || "Active"],
            openLabel: "Open customer",
            details: detailRows([
              ["Email", customer.email],
              ["Phone", customer.phone],
              ["Company", (customer as any).company_name],
              ["Licence", (customer as any).license_number],
              ["Town", (customer as any).address_city],
              ["Customer since", (customer as any).created_at?.split("T")[0]],
            ]),
          }));

          results.customers = rankResults(customerResults, query);
        }
      }

      // Search vehicles (if not filtered out)
      if (wants('vehicles', 'vehicles') || needsLinkedIds) {
        const { data: vehicles } = await scoped(
          supabase
            .from("vehicles")
            .select("id, reg, make, model, status, colour, color, acquisition_type, vin, category, year, daily_rent")
            .or(anyField(["reg", "make", "model", "colour", "color", "vin", "category", "status"], terms))
        ).limit(10);

        matchedVehicleIds = (vehicles || []).map((v) => v.id);

        if (wants('vehicles', 'vehicles')) {
          const vehicleResults = (vehicles || []).map(vehicle => ({
            id: vehicle.id,
            title: `${vehicle.reg}`,
            subtitle: `${vehicle.make} ${vehicle.model} • ${vehicle.colour || vehicle.color || ''} • ${vehicle.status}`,
            category: "Vehicles",
            url: `/vehicles/${vehicle.id}`,
            icon: "car",
            badges: ["Vehicle", vehicle.status].filter(Boolean) as string[],
            openLabel: "Open vehicle",
            details: detailRows([
              ["Registration", vehicle.reg],
              ["Make & model", [vehicle.make, vehicle.model].filter(Boolean).join(" ")],
              ["Year", (vehicle as any).year],
              ["Colour", vehicle.colour || vehicle.color],
              ["Class", (vehicle as any).category],
              ["Daily rate", (vehicle as any).daily_rent != null ? formatCurrency((vehicle as any).daily_rent, currencyCode) : null],
              ["VIN", (vehicle as any).vin],
            ]),
          }));

          results.vehicles = rankResults(vehicleResults, query);
        }
      }

      // Search rentals: by number, or by the customer's name / the car's reg.
      if (wants('rentals', 'rentals')) {
        const { data: rentals } = await scoped(
          supabase
            .from("rentals")
            .select(`
              id,
              rental_number,
              start_date,
              end_date,
              status,
              customers!rentals_customer_id_fkey(name),
              vehicles!rentals_vehicle_id_fkey(reg, make, model)
            `)
            .or(`${anyField(["rental_number", "status"], terms)}${inClause("customer_id", matchedCustomerIds)}${inClause("vehicle_id", matchedVehicleIds)}`)
        )
          .order('start_date', { ascending: false })
          .limit(10);

        const rentalResults = (rentals || [])
          .filter(rental => rental.customers && rental.vehicles)
          .map(rental => ({
            id: rental.id,
            title: rental.rental_number || `${(rental.customers as any)?.name} Rental`,
            subtitle: `${(rental.customers as any)?.name} • ${(rental.vehicles as any)?.reg} • ${rental.status}`,
            category: "Rentals",
            url: `/rentals/${rental.id}`,
            icon: "calendar",
            badges: ["Rental", rental.status].filter(Boolean) as string[],
            openLabel: "Open rental",
            details: detailRows([
              ["Rental", rental.rental_number],
              ["Customer", (rental.customers as any)?.name],
              ["Vehicle", [(rental.vehicles as any)?.reg, (rental.vehicles as any)?.make, (rental.vehicles as any)?.model].filter(Boolean).join(" · ")],
              ["Starts", rental.start_date],
              ["Ends", rental.end_date],
            ]),
          }));

        results.rentals = rankResults(rentalResults, query);
      }

      // Search fines: by reference or type, or by customer / vehicle.
      if (wants('fines', 'fines')) {
        const { data: fines } = await scoped(
          supabase
            .from("fines")
            .select(`
              id,
              reference_no,
              type,
              amount,
              status,
              customers!fines_customer_id_fkey(name),
              vehicles!fines_vehicle_id_fkey(reg)
            `)
            .or(`${anyField(["reference_no", "type", "status", "notes"], terms)}${inClause("customer_id", matchedCustomerIds)}${inClause("vehicle_id", matchedVehicleIds)}${amount !== null ? `,amount.eq.${amount}` : ""}`)
        )
          .order('issue_date', { ascending: false })
          .limit(10);

        const fineResults = (fines || []).map(fine => ({
          id: fine.id,
          title: fine.reference_no || `${fine.type} Fine`,
          subtitle: `${formatCurrency(fine.amount, currencyCode)} • ${(fine.vehicles as any)?.reg} • ${(fine.customers as any)?.name || 'Unknown'} • ${fine.status}`,
          category: "Fines",
          url: `/fines/${fine.id}`,
          icon: "alert-triangle",
          badges: ["Fine", fine.status].filter(Boolean) as string[],
          openLabel: "Open fine",
          details: detailRows([
            ["Reference", fine.reference_no],
            ["Type", fine.type],
            ["Amount", formatCurrency(fine.amount, currencyCode)],
            ["Vehicle", (fine.vehicles as any)?.reg],
            ["Customer", (fine.customers as any)?.name],
          ]),
        }));

        results.fines = rankResults(fineResults, query);
      }

      // Search payments: by method or type, by customer, or by amount ("500").
      if (wants('payments', 'payments')) {
        const { data: payments } = await scoped(
          supabase
            .from("payments")
            .select(`
              id,
              amount,
              payment_date,
              method,
              payment_type,
              status,
              customers!payments_customer_id_fkey(name)
            `)
            .or(`${anyField(["method", "payment_type", "status", "payment_provider", "stripe_payment_intent_id"], terms)}${inClause("customer_id", matchedCustomerIds)}${amount !== null ? `,amount.eq.${amount}` : ""}`)
        )
          .order('payment_date', { ascending: false })
          .limit(10);

        const paymentResults = (payments || [])
          .filter(payment => payment.customers)
          .map(payment => ({
            id: payment.id,
            title: `${formatCurrency(payment.amount, currencyCode)} ${payment.payment_type}`,
            subtitle: `${(payment.customers as any)?.name} • ${payment.method || 'Unknown method'} • ${payment.payment_date}`,
            category: "Payments",
            url: `/payments/${payment.id}`,
            icon: "credit-card",
            badges: ["Payment", (payment as any).status].filter(Boolean) as string[],
            openLabel: "Open payment",
            details: detailRows([
              ["Customer", (payment.customers as any)?.name],
              ["Amount", formatCurrency(payment.amount, currencyCode)],
              ["Type", payment.payment_type],
              ["Method", payment.method],
              ["Date", payment.payment_date],
            ]),
          }));

        results.payments = rankResults(paymentResults, query);
      }

      // Search plates (if not filtered out)
      if (wants('plates', 'plates')) {
        const { data: plates } = await scoped(
          supabase
            .from("plates")
            .select(`
              id,
              plate_number,
              status,
              supplier,
              notes,
              vehicles!plates_vehicle_id_fkey(reg, make, model)
            `)
            .or(anyField(["plate_number", "supplier", "notes", "status"], terms))
        ).limit(10);

        const plateResults = (plates || []).map(plate => ({
          id: plate.id,
          title: plate.plate_number,
          subtitle: plate.vehicles
            ? `${(plate.vehicles as any).reg} • ${(plate.vehicles as any).make} ${(plate.vehicles as any).model} • ${plate.status || 'Unknown'}`
            : `Not Assigned • ${plate.status || 'Unknown'}`,
          category: "Plates",
          url: `/plates/${plate.id}`,
          icon: "hash",
          badges: ["Plate", plate.status].filter(Boolean) as string[],
          openLabel: "Open plate",
          details: detailRows([
            ["Plate", plate.plate_number],
            ["Vehicle", (plate.vehicles as any)?.reg],
            ["Supplier", plate.supplier],
            ["Notes", plate.notes],
          ]),
        }));

        results.plates = rankResults(plateResults, query);
      }

      // Search insurance policies (if not filtered out)
      if (wants('insurance', 'insurance')) {
        const { data: insurance } = await scoped(
          supabase
            .from("insurance_policies")
            .select(`
              id,
              policy_number,
              provider,
              status,
              expiry_date,
              customers!insurance_policies_customer_id_fkey(name),
              vehicles!insurance_policies_vehicle_id_fkey(reg, make, model)
            `)
            .or(anyField(["policy_number", "provider", "status"], terms))
        )
          .order('expiry_date', { ascending: false })
          .limit(10);

        const insuranceResults = (insurance || [])
          .filter(policy => policy.customers)
          .map(policy => ({
            id: policy.id,
            title: `Policy ${policy.policy_number}`,
            subtitle: `${(policy.customers as any)?.name} • ${policy.provider || 'Unknown provider'} • ${policy.status} • Expires ${policy.expiry_date}`,
            category: "Insurance",
            url: `/insurance?policy=${policy.id}`,
            icon: "shield",
            badges: ["Insurance", policy.status].filter(Boolean) as string[],
            openLabel: "Open policy",
            details: detailRows([
              ["Policy", policy.policy_number],
              ["Provider", policy.provider],
              ["Customer", (policy.customers as any)?.name],
              ["Vehicle", (policy.vehicles as any)?.reg],
              ["Expires", policy.expiry_date],
            ]),
          }));

        results.insurance = rankResults(insuranceResults, query);
      }

      // Search invoices (if not filtered out)
      if (wants('invoices', 'invoices')) {
        try {
          const { data: invoices, error: invoiceError } = await supabase
            .from("invoices" as any)
            .select(`
              id,
              invoice_number,
              invoice_date,
              total_amount,
              status,
              customer_id,
              vehicle_id
            `)
            .eq("tenant_id", tenantId || '')
            .order('invoice_date', { ascending: false })
            .limit(100);

          if (invoiceError) {
            console.error('Invoice search error:', invoiceError);
          }

          // Get customer and vehicle data separately if we have invoices
          let customerMap: Record<string, string> = {};
          let vehicleMap: Record<string, { reg: string; make: string; model: string }> = {};

          if (invoices && invoices.length > 0) {
            const customerIds = [...new Set(invoices.map((i: any) => i.customer_id).filter(Boolean))];
            const vehicleIds = [...new Set(invoices.map((i: any) => i.vehicle_id).filter(Boolean))];

            if (customerIds.length > 0) {
              const { data: customers } = await supabase
                .from("customers")
                .select("id, name")
                .in("id", customerIds);
              customers?.forEach((c: any) => { customerMap[c.id] = c.name; });
            }

            if (vehicleIds.length > 0) {
              const { data: vehicles } = await supabase
                .from("vehicles")
                .select("id, reg, make, model")
                .in("id", vehicleIds);
              vehicles?.forEach((v: any) => { vehicleMap[v.id] = { reg: v.reg, make: v.make, model: v.model }; });
            }
          }

          // Filtered here rather than in the query: the number, the customer and
          // the car live in three tables. Same matching as everywhere else, so
          // the words can be typed in any order.
          const filteredInvoices = (invoices || []).filter((invoice: any) => {
            const vehicle = vehicleMap[invoice.vehicle_id];
            const haystack = [
              invoice.invoice_number,
              customerMap[invoice.customer_id],
              vehicle?.reg,
              vehicle?.make,
              vehicle?.model,
              invoice.status,
            ].filter(Boolean).join(' ');
            return scoreText(haystack, query) > 0 || (amount !== null && Number(invoice.total_amount) === amount);
          });

          const invoiceResults = filteredInvoices.map((invoice: any) => ({
            id: invoice.id,
            title: invoice.invoice_number || `Invoice`,
            subtitle: `${customerMap[invoice.customer_id] || 'Unknown'} • ${formatCurrency(invoice.total_amount, currencyCode)} • ${invoice.invoice_date}`,
            category: "Invoices",
            url: `/invoices?invoice=${invoice.id}`,
            icon: "file-text",
            badges: ["Invoice", invoice.status].filter(Boolean) as string[],
            openLabel: "Open invoice",
            details: detailRows([
              ["Invoice", invoice.invoice_number],
              ["Customer", customerMap[invoice.customer_id]],
              ["Vehicle", vehicleMap[invoice.vehicle_id]?.reg],
              ["Total", invoice.total_amount != null ? formatCurrency(invoice.total_amount, currencyCode) : null],
              ["Date", invoice.invoice_date],
            ]),
          }));

          results.invoices = rankResults(invoiceResults, query);
        } catch (err) {
          console.error('Invoice search failed:', err);
        }
      }

      // Search documents — split into insurances and agreements
      if (wants('insurances', 'insurances') || wants('agreements', 'agreements') || wants('customerDocs', 'customerDocs')) {
        try {
          const { data: documents, error: docError } = await supabase
            .from("customer_documents")
            .select(`
              id,
              document_name,
              document_type,
              created_at,
              customer_id,
              insurance_provider
            `)
            .eq("tenant_id", tenantId || '')
            .order('created_at', { ascending: false })
            .limit(100);

          if (docError) {
            console.error('Document search error:', docError);
          }

          // Get customer data separately if we have documents
          let customerMap: Record<string, string> = {};

          if (documents && documents.length > 0) {
            const customerIds = [...new Set(documents.map((d: any) => d.customer_id).filter(Boolean))];

            if (customerIds.length > 0) {
              const { data: customers } = await supabase
                .from("customers")
                .select("id, name")
                .in("id", customerIds);
              customers?.forEach((c: any) => { customerMap[c.id] = c.name; });
            }
          }

          // Same matching as everywhere else (see the invoices above).
          const filteredDocs = (documents || []).filter((doc: any) =>
            scoreText([doc.document_name, doc.document_type, customerMap[doc.customer_id], doc.insurance_provider]
              .filter(Boolean).join(' '), query) > 0,
          );

          // Split into insurances and agreements
          if (wants('insurances', 'insurances')) {
            const insuranceDocs = filteredDocs.filter((doc: any) =>
              doc.document_type === 'Insurance Certificate' || doc.insurance_provider
            );
            const insuranceResults = insuranceDocs.map((doc: any) => ({
              id: doc.id,
              title: doc.document_name || 'Insurance Document',
              subtitle: `${customerMap[doc.customer_id] || 'Unknown'} • ${doc.document_type || 'Insurance'} • ${doc.created_at?.split('T')[0] || ''}`,
              category: "Insurances",
              url: `/insurances?doc=${doc.id}`,
              icon: "shield",
              badges: ["Insurance document", doc.document_type].filter(Boolean) as string[],
              openLabel: "Open document",
              details: detailRows([
                ["Document", doc.document_name],
                ["Customer", customerMap[doc.customer_id]],
                ["Provider", doc.insurance_provider],
                ["Uploaded", doc.created_at?.split("T")[0]],
              ]),
            }));
            results.insurances = rankResults(insuranceResults, query);
          }

          if (wants('agreements', 'agreements')) {
            const agreementDocs = filteredDocs.filter((doc: any) =>
              doc.document_type === 'Agreement'
            );
            const agreementResults = agreementDocs.map((doc: any) => ({
              id: doc.id,
              title: doc.document_name || 'Agreement',
              subtitle: `${customerMap[doc.customer_id] || 'Unknown'} • Agreement • ${doc.created_at?.split('T')[0] || ''}`,
              category: "Agreements",
              url: `/agreements?doc=${doc.id}`,
              icon: "file-signature",
              badges: ["Agreement"],
              openLabel: "Open agreement",
              details: detailRows([
                ["Document", doc.document_name],
                ["Customer", customerMap[doc.customer_id]],
                ["Uploaded", doc.created_at?.split("T")[0]],
              ]),
            }));
            results.agreements = rankResults(agreementResults, query);
          }

          // Everything else a customer has uploaded — licences, ID, proof of
          // address. These were being dropped: only the two buckets above were
          // ever offered.
          if (wants('customerDocs', 'customerDocs')) {
            const otherDocs = filteredDocs.filter((doc: any) =>
              doc.document_type !== 'Agreement' && doc.document_type !== 'Insurance Certificate' && !doc.insurance_provider
            );
            results.customerDocs = rankResults(
              otherDocs.map((doc: any) => ({
                id: doc.id,
                title: doc.document_name || doc.document_type || 'Document',
                subtitle: `${customerMap[doc.customer_id] || 'Unknown'} • ${doc.document_type || 'Document'} • ${doc.created_at?.split('T')[0] || ''}`,
                category: "Customer documents",
                url: doc.customer_id ? `/customers/${doc.customer_id}` : "/customers",
                icon: "file-text",
                badges: ["Customer document", doc.document_type].filter(Boolean) as string[],
                openLabel: "Open customer",
                details: detailRows([
                  ["Document", doc.document_name],
                  ["Type", doc.document_type],
                  ["Customer", customerMap[doc.customer_id]],
                  ["Uploaded", doc.created_at?.split('T')[0]],
                ]),
              })),
              query,
            );
          }
        } catch (err) {
          console.error('Document search failed:', err);
        }
      }

      // ── Everything else a portal user looks for by name ──────────────────
      // Each runs only when the caller says the user may open its page (see
      // SearchInclude), and a failure in one never hides the others' results.
      const extra = async (category: RecordCategory, filterKey: string, run: () => Promise<SearchResult[]>) => {
        if (!wants(category, filterKey)) return;
        try {
          results[category] = rankResults(await run(), query);
        } catch (err) {
          console.error(`${category} search failed:`, err);
        }
      };

      await Promise.all([
        extra('team', 'team', async () => {
          const { data } = await scoped(
            supabase.from("app_users").select("id, name, email, role, is_active").or(anyField(["name", "email", "role"], terms))
          ).limit(10);
          return (data || []).map((u: any) => ({
            id: u.id,
            title: u.name || u.email,
            subtitle: `${u.email || ''} • ${String(u.role || '').replace(/_/g, ' ')}${u.is_active === false ? ' • inactive' : ''}`,
            category: "Team",
            url: "/users",
            icon: "users",
            badges: ["Team", u.is_active === false ? "Inactive" : "Active"],
            openLabel: "Open team",
            details: detailRows([
              ["Email", u.email],
              ["Role", String(u.role || "").replace(/_/g, " ")],
              ["Status", u.is_active === false ? "Inactive" : "Active"],
            ]),
          }));
        }),
        extra('locations', 'locations', async () => {
          const { data } = await scoped(
            supabase.from("pickup_locations").select("id, name, address, is_active").or(anyField(["name", "address", "description"], terms))
          ).limit(10);
          return (data || []).map((l: any) => ({
            id: l.id,
            title: l.name || l.address,
            subtitle: `${l.address || ''}${l.is_active === false ? ' • inactive' : ''}`,
            category: "Locations",
            url: "/settings?tab=locations",
            icon: "map-pin",
            badges: ["Location", l.is_active === false ? "Inactive" : "Active"],
            openLabel: "Open locations",
            details: detailRows([["Name", l.name], ["Address", l.address]]),
          }));
        }),
        // Settings › Promo codes reads `promocodes`; `promotions` below is the
        // website's promotions page, which is a different thing entirely.
        extra('promos', 'promos', async () => {
          const { data } = await scoped(
            supabase.from("promocodes").select("id, code, name, type, value, expires_at, max_users, min_duration_days").or(anyField(["code", "name", "type"], terms))
          ).limit(10);
          return (data || []).map((p: any) => ({
            id: p.id,
            title: p.code || p.name,
            subtitle: [
              p.code ? p.name : null,
              p.value != null ? (p.type === 'percentage' ? `${p.value}% off` : `${formatCurrency(p.value, currencyCode)} off`) : null,
              p.expires_at ? `expires ${String(p.expires_at).split('T')[0]}` : null,
            ].filter(Boolean).join(' • '),
            category: "Promo codes",
            url: "/settings?tab=promos",
            icon: "tag",
            badges: ["Promo code"],
            openLabel: "Open promo codes",
            details: detailRows([
              ["Code", p.code],
              ["Name", p.name],
              ["Discount", p.value != null ? (p.type === "percentage" ? `${p.value}%` : formatCurrency(p.value, currencyCode)) : null],
              ["Expires", p.expires_at ? String(p.expires_at).split('T')[0] : null],
              ["Minimum days", p.min_duration_days],
            ]),
          }));
        }),
        extra('sitePromos', 'sitePromos', async () => {
          const { data } = await scoped(
            supabase.from("promotions").select("id, title, description, discount_type, discount_value, is_active, end_date").or(anyField(["title", "description"], terms))
          ).limit(10);
          return (data || []).map((p: any) => ({
            id: p.id,
            title: p.title,
            subtitle: [p.description, p.is_active === false ? 'inactive' : null].filter(Boolean).join(' • '),
            category: "Website promotions",
            url: "/cms/promotions",
            icon: "tag",
            badges: ["Website promotion", p.is_active === false ? "Inactive" : "Active"],
            openLabel: "Open promotions",
            details: detailRows([
              ["Offer", p.title],
              ["Discount", p.discount_value != null ? (p.discount_type === "percentage" ? `${p.discount_value}%` : formatCurrency(p.discount_value, currencyCode)) : null],
              ["Ends", p.end_date],
            ]),
            description: p.description || undefined,
          }));
        }),
        extra('webPages', 'webPages', async () => {
          const { data } = await scoped(
            supabase.from("cms_pages").select("id, name, slug, description, status, updated_at").or(anyField(["name", "slug", "description", "status"], terms))
          ).limit(10);
          return (data || []).map((p: any) => ({
            id: p.id,
            title: p.name || p.slug,
            subtitle: `Website page • ${p.status || 'draft'}`,
            category: "Website pages",
            url: `/cms/${p.slug}`,
            icon: "globe",
            badges: ["Website page", p.status || "draft"],
            openLabel: "Open page content",
            details: detailRows([["Page", p.name], ["Address", p.slug ? `/${p.slug}` : null], ["Status", p.status], ["Updated", p.updated_at?.split('T')[0]]]),
            description: p.description || undefined,
          }));
        }),
        extra('faqs', 'faqs', async () => {
          const { data } = await scoped(
            supabase.from("faqs").select("id, question, answer, is_active").or(anyField(["question", "answer"], terms))
          ).limit(10);
          return (data || []).map((f: any) => ({
            id: f.id,
            title: f.question,
            subtitle: `FAQ${f.is_active === false ? ' • inactive' : ''}`,
            category: "FAQs",
            url: "/cms/about",
            icon: "message-square",
            badges: ["FAQ", f.is_active === false ? "Inactive" : "Active"],
            openLabel: "Open FAQs",
            details: detailRows([["Answer", f.answer]]),
            description: f.answer || undefined,
          }));
        }),
        extra('testimonials', 'testimonials', async () => {
          const { data } = await scoped(
            supabase.from("testimonials").select("id, author, review, company_name, stars").or(anyField(["author", "review", "company_name"], terms))
          ).limit(10);
          return (data || []).map((t: any) => ({
            id: t.id,
            title: t.author || 'Review',
            subtitle: [t.company_name, t.stars ? `${t.stars}★` : null].filter(Boolean).join(' • '),
            category: "Reviews",
            url: "/cms/reviews",
            icon: "message-square",
            badges: ["Review", t.stars ? `${t.stars}★` : null].filter(Boolean) as string[],
            openLabel: "Open reviews",
            details: detailRows([["Author", t.author], ["Company", t.company_name], ["Rating", t.stars ? `${t.stars} of 5` : null]]),
            description: t.review || undefined,
          }));
        }),
        extra('emailTemplates', 'emailTemplates', async () => {
          const { data } = await scoped(
            supabase.from("email_templates").select("id, name, template_name, subject, category, is_active").or(anyField(["name", "template_name", "subject", "category", "template_key"], terms))
          ).limit(10);
          return (data || []).map((t: any) => ({
            id: t.id,
            title: t.name || t.template_name || t.subject,
            subtitle: [t.subject, t.category].filter(Boolean).join(' • '),
            category: "Email templates",
            url: "/settings/email-templates",
            icon: "file-text",
            badges: ["Email template", t.is_active === false ? "Inactive" : "Active"],
            openLabel: "Open templates",
            details: detailRows([["Subject", t.subject], ["Category", t.category]]),
          }));
        }),
        extra('agreementTemplates', 'agreementTemplates', async () => {
          const { data } = await scoped(
            supabase.from("agreement_templates").select("id, template_name, template_category, is_active").or(anyField(["template_name", "template_category"], terms))
          ).limit(10);
          return (data || []).map((t: any) => ({
            id: t.id,
            title: t.template_name,
            subtitle: `Agreement template${t.template_category ? ` • ${t.template_category}` : ''}`,
            category: "Agreement templates",
            url: "/settings/agreement-templates",
            icon: "file-signature",
            badges: ["Agreement template", t.is_active === false ? "Inactive" : "Active"],
            openLabel: "Open templates",
            details: detailRows([["Template", t.template_name], ["Category", t.template_category]]),
          }));
        }),
        extra('blockedDates', 'blockedDates', async () => {
          const { data } = await scoped(
            supabase.from("blocked_dates").select("id, reason, reason_code, start_date, end_date, vehicles!blocked_dates_vehicle_id_fkey(reg)").or(anyField(["reason", "reason_code", "source_type"], terms))
          ).order('start_date', { ascending: false }).limit(10);
          return (data || []).map((b: any) => ({
            id: b.id,
            title: b.reason || b.reason_code || 'Blocked dates',
            subtitle: [b.vehicles?.reg, [b.start_date, b.end_date].filter(Boolean).join(' → ')].filter(Boolean).join(' • '),
            category: "Blocked dates",
            url: "/blocked-dates",
            icon: "calendar-days",
            badges: ["Blocked dates"],
            openLabel: "Open availability",
            details: detailRows([["Vehicle", b.vehicles?.reg], ["From", b.start_date], ["To", b.end_date], ["Reason", b.reason]]),
          }));
        }),
        extra('ownerPayouts', 'ownerPayouts', async () => {
          const { data } = await scoped(
            supabase.from("owner_payouts").select("id, payment_reference, payment_method, notes, amount_paid, net_owed, period_start, period_end, paid_at").or(`${anyField(["payment_reference", "payment_method", "notes"], terms)}${amount !== null ? `,amount_paid.eq.${amount}` : ""}`)
          ).order('period_end', { ascending: false }).limit(10);
          return (data || []).map((p: any) => ({
            id: p.id,
            title: p.payment_reference || `Payout ${p.period_end || ''}`.trim(),
            subtitle: [p.amount_paid != null ? formatCurrency(p.amount_paid, currencyCode) : null, p.payment_method, p.paid_at ? `paid ${String(p.paid_at).split('T')[0]}` : 'unpaid'].filter(Boolean).join(' • '),
            category: "Owner payouts",
            url: "/owner-payouts",
            icon: "credit-card",
            badges: ["Owner payout", p.paid_at ? "Paid" : "Unpaid"],
            openLabel: "Open payouts",
            details: detailRows([
              ["Reference", p.payment_reference],
              ["Amount paid", p.amount_paid != null ? formatCurrency(p.amount_paid, currencyCode) : null],
              ["Still owed", p.net_owed != null ? formatCurrency(p.net_owed, currencyCode) : null],
              ["Period", [p.period_start, p.period_end].filter(Boolean).join(' → ')],
            ]),
          }));
        }),
        extra('vehicleDocs', 'vehicleDocs', async () => {
          const { data } = await scoped(
            supabase.from("vehicle_files").select("id, file_name, content_type, uploaded_at, vehicle_id, vehicles!vehicle_files_vehicle_id_fkey(reg)").or(anyField(["file_name", "content_type"], terms))
          ).order('uploaded_at', { ascending: false }).limit(10);
          return (data || []).map((f: any) => ({
            id: f.id,
            title: f.file_name,
            subtitle: [f.vehicles?.reg, f.uploaded_at ? String(f.uploaded_at).split('T')[0] : null].filter(Boolean).join(' • '),
            category: "Vehicle documents",
            url: f.vehicle_id ? `/vehicles/${f.vehicle_id}` : "/vehicles",
            icon: "file-text",
            badges: ["Vehicle document"],
            openLabel: "Open vehicle",
            details: detailRows([["File", f.file_name], ["Vehicle", f.vehicles?.reg], ["Uploaded", f.uploaded_at ? String(f.uploaded_at).split('T')[0] : null]]),
          }));
        }),
        extra('auditLogs', 'auditLogs', async () => {
          const { data } = await scoped(
            supabase.from("audit_logs").select("id, action, entity_type, entity_id, created_at").or(anyField(["action", "entity_type", "activity_source"], terms))
          ).order('created_at', { ascending: false }).limit(10);
          return (data || []).map((a: any) => ({
            id: a.id,
            title: String(a.action || 'Activity').replace(/_/g, ' '),
            subtitle: [a.entity_type, a.created_at ? String(a.created_at).split('T')[0] : null].filter(Boolean).join(' • '),
            category: "Audit log",
            url: "/audit-logs",
            icon: "history",
            badges: ["Audit log", a.entity_type].filter(Boolean) as string[],
            openLabel: "Open audit logs",
            details: detailRows([["Action", String(a.action || '').replace(/_/g, ' ')], ["Record", a.entity_type], ["When", a.created_at ? String(a.created_at).replace('T', ' ').slice(0, 16) : null]]),
          }));
        }),
        extra('extras', 'extras', async () => {
          const { data } = await scoped(
            supabase.from("rental_extras").select("id, name, price, is_active").or(anyField(["name", "description"], terms))
          ).limit(10);
          return (data || []).map((x: any) => ({
            id: x.id,
            title: x.name,
            subtitle: `${x.price != null ? formatCurrency(x.price, currencyCode) : ''}${x.is_active === false ? ' • inactive' : ''}`,
            category: "Extras",
            url: "/settings?tab=extras",
            icon: "package",
            badges: ["Extra", x.is_active === false ? "Inactive" : "Active"],
            openLabel: "Open extras",
            details: detailRows([["Name", x.name], ["Price", x.price != null ? formatCurrency(x.price, currencyCode) : null]]),
          }));
        }),
        extra('reminders', 'reminders', async () => {
          const { data } = await scoped(
            supabase.from("reminders").select("id, title, message, due_on, status").or(anyField(["title", "message", "status", "rule_code"], terms))
          ).order('due_on', { ascending: true }).limit(10);
          return (data || []).map((r: any) => ({
            id: r.id,
            title: r.title,
            subtitle: `${r.due_on ? `Due ${r.due_on}` : ''}${r.status ? ` • ${r.status}` : ''}`,
            category: "Reminders",
            url: "/reminders",
            icon: "bell",
            badges: ["Reminder", r.status].filter(Boolean) as string[],
            openLabel: "Open reminders",
            details: detailRows([["Due", r.due_on], ["Status", r.status], ["Note", r.message]]),
          }));
        }),
        extra('leads', 'leads', async () => {
          const { data } = await scoped(
            supabase.from("leads").select("id, full_name, email, phone, stage").or(anyField(["full_name", "email", "phone", "stage", "source"], terms))
          ).limit(10);
          return (data || []).map((l: any) => ({
            id: l.id,
            title: l.full_name || l.email,
            subtitle: [l.email, l.phone, l.stage].filter(Boolean).join(' • '),
            category: "Leads",
            url: "/leads",
            icon: "user-plus",
            badges: ["Lead", l.stage].filter(Boolean) as string[],
            openLabel: "Open leads",
            details: detailRows([["Email", l.email], ["Phone", l.phone], ["Stage", l.stage]]),
          }));
        }),
        extra('blog', 'blog', async () => {
          const { data } = await scoped(
            supabase.from("blog_posts").select("id, title, status, slug").or(anyField(["title", "slug", "excerpt", "status"], terms))
          ).limit(10);
          return (data || []).map((b: any) => ({
            id: b.id,
            title: b.title,
            subtitle: `Blog post • ${b.status || 'draft'}`,
            category: "Blog posts",
            url: "/cms/blog",
            icon: "newspaper",
            badges: ["Blog post", b.status || "draft"],
            openLabel: "Open blog",
            details: detailRows([["Title", b.title], ["Status", b.status], ["Address", b.slug ? `/blog/${b.slug}` : null]]),
          }));
        }),
        extra('expenses', 'expenses', async () => {
          const { data } = await scoped(
            supabase
              .from("vehicle_expenses")
              .select("id, vendor, category, amount, expense_date, reference, notes, vehicles!vehicle_expenses_vehicle_id_fkey(reg)")
              .or(`${anyField(["vendor", "category", "reference", "notes", "payment_method"], terms)}${amount !== null ? `,amount.eq.${amount}` : ""}`)
          ).order('expense_date', { ascending: false }).limit(10);
          return (data || []).map((e: any) => ({
            id: e.id,
            title: e.vendor || e.category || 'Expense',
            subtitle: [
              e.category,
              e.amount != null ? formatCurrency(e.amount, currencyCode) : null,
              e.vehicles?.reg,
              e.expense_date,
            ].filter(Boolean).join(' • '),
            category: "Expenses",
            url: "/expenses",
            icon: "wallet",
            badges: ["Expense", e.category].filter(Boolean) as string[],
            openLabel: "Open expenses",
            details: detailRows([
              ["Vendor", e.vendor],
              ["Category", e.category],
              ["Amount", e.amount != null ? formatCurrency(e.amount, currencyCode) : null],
              ["Vehicle", e.vehicles?.reg],
              ["Date", e.expense_date],
            ]),
          }));
        }),
        extra('enquiries', 'enquiries', async () => {
          const { data } = await scoped(
            supabase
              .from("enquiries")
              .select("id, customer_name, customer_email, customer_phone, description, status, created_at")
              .or(anyField(["customer_name", "customer_email", "customer_phone", "description", "status"], terms))
          ).order('created_at', { ascending: false }).limit(10);
          return (data || []).map((e: any) => ({
            id: e.id,
            title: e.customer_name || e.customer_email || 'Enquiry',
            subtitle: [e.customer_email, e.customer_phone, e.status, e.created_at?.split('T')[0]].filter(Boolean).join(' • '),
            category: "Enquiries",
            url: "/enquiries",
            icon: "message-square",
            badges: ["Enquiry", e.status].filter(Boolean) as string[],
            openLabel: "Open enquiries",
            details: detailRows([
              ["Email", e.customer_email],
              ["Phone", e.customer_phone],
              ["Status", e.status],
              ["Received", e.created_at?.split("T")[0]],
            ]),
            description: e.description || undefined,
          }));
        }),
        extra('owners', 'owners', async () => {
          const { data } = await scoped(
            supabase.from("vehicle_owners").select("id, full_name, email, phone, is_active").or(anyField(["full_name", "email", "phone", "notes"], terms))
          ).limit(10);
          return (data || []).map((o: any) => ({
            id: o.id,
            title: o.full_name,
            subtitle: `${[o.email, o.phone].filter(Boolean).join(' • ')}${o.is_active === false ? ' • inactive' : ''}`,
            category: "Vehicle owners",
            url: "/vehicle-owners",
            icon: "users",
            badges: ["Vehicle owner", o.is_active === false ? "Inactive" : "Active"],
            openLabel: "Open owners",
            details: detailRows([["Email", o.email], ["Phone", o.phone]]),
          }));
        }),
      ]);

    } catch (error) {
      console.error('Search error:', error);
    }

    return results;
  },
};
