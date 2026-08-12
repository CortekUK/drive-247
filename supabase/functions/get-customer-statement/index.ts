// get-customer-statement
//
// Returns a CONSOLIDATED statement of account for the logged-in customer,
// covering the balances across ALL of their rentals in the current tenant.
//
// SECURITY: the customer is resolved from the JWT (auth.getUser) + the tenant,
// NEVER from a client-supplied customer_id. RLS is disabled on ledger_entries
// and view_customer_statements is a security-definer view granted to anon, so a
// raw client `.eq('customer_id', …)` would NOT be a real boundary — this
// function is that boundary. The client may only pass tenantId (public), and
// can only ever read the customer row that its own auth user maps to.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';
import { handleCors, jsonResponse, errorResponse } from '../_shared/cors.ts';
import { hidePlateForTenant } from "../_shared/vehicle-privacy.ts";

// Display order for the per-rental category rollup.
const CATEGORY_ORDER = [
  'Rental', 'Extension Rental',
  'Insurance', 'Extension Insurance',
  'Service Fee', 'Delivery Fee', 'Collection Fee',
  'Excess Mileage', 'Supercharger', 'Fuel', 'Repair', 'Extras', 'Unlimited Mileage',
  'Fine',
  'Tax', 'Extension Tax',
];
function categoryRank(cat: string): number {
  const i = CATEGORY_ORDER.indexOf(cat);
  return i === -1 ? CATEGORY_ORDER.length : i;
}
function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

Deno.serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY') || '';
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';

    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return errorResponse('Authorization required', 401);

    const body = await req.json().catch(() => ({}));
    const tenantId: string | undefined = body?.tenantId;
    if (!tenantId) return errorResponse('tenantId is required', 400);

    // --- SECURITY BOUNDARY: who is this session? (from the JWT, not the client) ---
    const supabaseUser = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: userError } = await supabaseUser.auth.getUser();
    if (userError || !user) return errorResponse('Invalid session', 401);

    const admin = createClient(supabaseUrl, serviceKey);
    const hidePlate = await hidePlateForTenant(admin, tenantId);

    // Resolve the caller. Two modes, both scoped so no one reads across the boundary:
    //  • CUSTOMER — a customer_users row for (auth_user_id, tenant): only their OWN
    //    statement; any client-supplied customerId is ignored.
    //  • OPERATOR — an app_user of this tenant (or a super admin): may request any
    //    customerId, but ONLY one that belongs to this tenant.
    const requestedCustomerId: string | undefined = body?.customerId;
    let customerId: string;

    const { data: cu, error: cuErr } = await admin
      .from('customer_users')
      .select('customer_id')
      .eq('auth_user_id', user.id)
      .eq('tenant_id', tenantId)
      .maybeSingle();
    if (cuErr) throw cuErr;

    if (cu?.customer_id) {
      // CUSTOMER mode — never trust a client-supplied id.
      customerId = cu.customer_id;
    } else {
      // OPERATOR mode.
      const { data: appUser, error: auErr } = await admin
        .from('app_users')
        .select('tenant_id, is_super_admin')
        .eq('auth_user_id', user.id)
        .maybeSingle();
      if (auErr) throw auErr;
      if (!appUser) return errorResponse('No profile for this account', 403);
      if (appUser.tenant_id !== tenantId && !appUser.is_super_admin) {
        return errorResponse('Not authorized for this tenant', 403);
      }
      if (!requestedCustomerId) return errorResponse('customerId is required', 400);
      // The requested customer MUST belong to this tenant — blocks cross-tenant reads.
      const { data: cust, error: custErr } = await admin
        .from('customers')
        .select('id')
        .eq('id', requestedCustomerId)
        .eq('tenant_id', tenantId)
        .maybeSingle();
      if (custErr) throw custErr;
      if (!cust) return errorResponse('Customer not found in this tenant', 404);
      customerId = requestedCustomerId;
    }

    // All ledger activity for THIS customer across every rental.
    const { data: rows, error: rowsErr } = await admin
      .from('view_customer_statements')
      .select('*')
      .eq('customer_id', customerId)
      .eq('tenant_id', tenantId);
    if (rowsErr) throw rowsErr;
    const statementRows = rows ?? [];

    // Customer identity (from the view rows; fall back to the customers table).
    let customer = {
      name: statementRows[0]?.customer_name ?? '',
      email: statementRows[0]?.customer_email ?? '',
      phone: statementRows[0]?.customer_phone ?? '',
    };
    if (!customer.name) {
      const { data: c } = await admin
        .from('customers')
        .select('name, email, phone')
        .eq('id', customerId)
        .eq('tenant_id', tenantId)
        .maybeSingle();
      if (c) customer = { name: c.name ?? '', email: c.email ?? '', phone: c.phone ?? '' };
    }

    // Rental headers (number + dates) for the distinct rental_ids.
    const rentalIds = [...new Set(statementRows.map((r: Record<string, unknown>) => r.rental_id).filter(Boolean))] as string[];
    const rentalMeta: Record<string, { rental_number: string | null; start_date: string | null; end_date: string | null }> = {};
    if (rentalIds.length) {
      const { data: rentals } = await admin
        .from('rentals')
        .select('id, rental_number, start_date, end_date')
        .in('id', rentalIds);
      for (const r of rentals ?? []) rentalMeta[r.id] = r;
    }

    // Group by rental_id; roll up charges by category (paid = charged - remaining).
    // baseCategory is the underlying ledger category ('Fine', 'Rental', …);
    // the map KEY is the display label, which for a fine is its own type.
    // Keeping both is the whole point: overwriting the key with the label
    // silently broke every consumer that matched on 'Fine' — the grand
    // "Fines & penalties" subtotal, the sort order, and the amber highlight.
    interface CatAcc { charged: number; outstanding: number; baseCategory: string }
    interface GroupAcc {
      rentalId: string | null; rentalNumber: string;
      startDate: string | null; endDate: string | null;
      vehicle: { make: string | null; model: string | null; reg: string | null };
      categories: Map<string, CatAcc>; refunds: number;
    }
    const groupsMap = new Map<string, GroupAcc>();
    const getGroup = (rid: string | null): GroupAcc => {
      const key = rid ?? '__account__';
      if (!groupsMap.has(key)) {
        const meta = rid ? rentalMeta[rid] : null;
        const sample = statementRows.find((r: Record<string, unknown>) => (r.rental_id ?? null) === (rid ?? null));
        groupsMap.set(key, {
          rentalId: rid,
          rentalNumber: meta?.rental_number ?? (rid ? `#${rid.slice(0, 8)}` : 'Account-level charges'),
          startDate: meta?.start_date ?? null,
          endDate: meta?.end_date ?? null,
          vehicle: {
            make: (sample?.vehicle_make as string) ?? null,
            model: (sample?.vehicle_model as string) ?? null,
            // Serves the customer's account + PAYG statement PDFs. Staff call
            // this too, so it is gated on the flag rather than blanked outright.
            reg: hidePlate ? null : ((sample?.vehicle_reg as string) ?? null),
          },
          categories: new Map<string, CatAcc>(),
          refunds: 0,
        });
      }
      return groupsMap.get(key)!;
    };

    for (const row of statementRows as Record<string, unknown>[]) {
      const g = getGroup((row.rental_id as string) ?? null);
      const amt = Number(row.amount) || 0;
      const rem = Number(row.remaining_amount) || 0;
      if (row.type === 'Charge') {
        // Group fines by WHAT THEY WERE FOR, not by the flat 'Fine' bucket.
        //
        // Every fine landed in one aggregated line — a guest with seven fines
        // saw "Fine $657.48" and no way to tell what any of it was for, which
        // is the fastest route to a chargeback. `description` is the fine's own
        // type, carried by view_customer_statements, and is NULL for every
        // other category, so nothing else changes shape.
        //
        // Same-type fines still merge (two toll charges become one "Toll Fees"
        // line). That is deliberate: this document is a statement of account,
        // and it already tells the reader to see the individual rental invoices
        // for a full itemisation.
        const baseCategory = (row.category as string) || 'Other';
        const cat = (row.description as string) || baseCategory;
        const c = g.categories.get(cat) ?? { charged: 0, outstanding: 0, baseCategory };
        c.charged = round2(c.charged + amt);
        c.outstanding = round2(c.outstanding + rem);
        g.categories.set(cat, c);
      } else if (row.type === 'Refund') {
        g.refunds = round2(g.refunds + Math.abs(amt));
      }
      // type === 'Payment' is derived as (charged - outstanding) so we don't
      // double-count; a raw Payment row can predate FIFO application.
    }

    const groups = [...groupsMap.values()].map((g) => {
      const categories = [...g.categories.entries()]
        .map(([category, v]) => ({
          category,
          // The ledger category behind the label. Renderers style on this, so a
          // fine keeps its amber highlight even though the line now reads
          // "Smoking/ Cleaning Violation" rather than "Fine".
          baseCategory: v.baseCategory,
          charged: v.charged,
          paid: round2(v.charged - v.outstanding),
          outstanding: v.outstanding,
        }))
        // Rank on the TRUE category, so fines still sit in their designated slot
        // (before Tax) instead of falling to the end as unknown labels.
        .sort((a, b) => categoryRank(a.baseCategory) - categoryRank(b.baseCategory) || a.category.localeCompare(b.category));
      const charged = round2(categories.reduce((s, c) => s + c.charged, 0));
      const outstanding = round2(categories.reduce((s, c) => s + c.outstanding, 0));
      return {
        rentalId: g.rentalId,
        rentalNumber: g.rentalNumber,
        startDate: g.startDate,
        endDate: g.endDate,
        vehicle: g.vehicle,
        categories,
        charged,
        paid: round2(charged - outstanding),
        outstanding,
        refunds: g.refunds,
      };
    });

    // rentals first (by start date), account-level group last.
    groups.sort((a, b) => {
      if (!a.rentalId) return 1;
      if (!b.rentalId) return -1;
      return String(a.startDate ?? '').localeCompare(String(b.startDate ?? ''));
    });

    const grandCharged = round2(groups.reduce((s, g) => s + g.charged, 0));
    const grandOutstanding = round2(groups.reduce((s, g) => s + g.outstanding, 0));
    const grandRefunds = round2(groups.reduce((s, g) => s + g.refunds, 0));
    // Match on baseCategory, NOT the display label. A fine's label is now its
    // own type ("Toll Fees"), so filtering on `category` made the 'Fine'
    // predicate match nothing and silently zeroed the grand fines subtotal for
    // every customer on the platform — the row is gated on `> 0`, so it did not
    // render as $0.00, it disappeared.
    const sumCat = (pred: (c: string) => boolean) =>
      round2(groups.reduce((s, g) => s + g.categories.filter((c) => pred(c.baseCategory)).reduce((t, c) => t + c.charged, 0), 0));

    return jsonResponse({
      customer,
      groups,
      grand: {
        charged: grandCharged,
        paid: round2(grandCharged - grandOutstanding),
        outstanding: grandOutstanding,
        refunds: grandRefunds,
        tax: sumCat((c) => c === 'Tax' || c === 'Extension Tax'),
        fines: sumCat((c) => c === 'Fine'),
      },
      generatedAt: new Date().toISOString(),
    });
  } catch (err) {
    // Log the detail server-side; return a generic message so DB/schema error
    // text never reaches the client of a financial endpoint.
    console.error('[get-customer-statement] error:', err);
    return errorResponse('Failed to build statement', 500);
  }
});
