import { useQuery } from "@tanstack/react-query";
import { parseLocalDate } from "@/lib/date-utils";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/contexts/TenantContext";
import { formatCurrency } from "@/lib/format-utils";

// PAYG rentals: source of truth for outstanding is payg_accruals (the rental
// detail page's Balance Due tile uses exactly this — sum of dayTotal on rows
// with invoice_status='open'). Fixed-term rentals: source of truth is
// ledger_entries.remaining_amount on Charges.
//
// These two sources point at the SAME money for an unpaid PAYG day: an open
// accrual *and* a Charge row with non-zero remaining_amount both exist. Summing
// them double-counts (used to show $223 against $111 actual owed). Callers
// must keep the two sources disjoint by rental type — see fetchPaygRentalIds.
async function fetchPaygOutstandingForCustomer(
  customerId: string,
  tenantId: string,
  excludedRentalIds: Set<string>,
): Promise<number> {
  const { data, error } = await supabase
    .from("payg_accruals")
    .select("rental_id, daily_rate, tax_amount, service_fee_amount, rentals!inner(customer_id, payg_closed_at)")
    .eq("tenant_id", tenantId)
    .eq("rentals.customer_id", customerId)
    .eq("invoice_status", "open")
    .is("rentals.payg_closed_at", null);

  if (error) {
    console.error("Error fetching PAYG outstanding:", error);
    return 0;
  }

  let total = 0;
  (data as any[])?.forEach(a => {
    if (a.rental_id && excludedRentalIds.has(a.rental_id)) return;
    total += Number(a.daily_rate || 0) + Number(a.tax_amount || 0) + Number(a.service_fee_amount || 0);
  });
  return total;
}

// Return the set of rental IDs flagged is_pay_as_you_go for this customer.
// Used to exclude their ledger Charge rows from outstanding sums so the
// authoritative payg_accruals figure isn't double-counted.
async function fetchPaygRentalIds(
  customerId: string,
  tenantId: string,
): Promise<Set<string>> {
  const { data, error } = await supabase
    .from("rentals")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("customer_id", customerId)
    .eq("is_pay_as_you_go", true);

  if (error) {
    console.error("Error fetching PAYG rental IDs:", error);
    return new Set();
  }
  return new Set((data || []).map(r => r.id));
}

// Single source of truth: Customer balance calculation from ledger_entries
// Uses remaining_amount on charges which is already maintained by the payment system,
// PLUS open PAYG accrual day-totals so PAYG-only customers don't show as "Settled"
// when they have unpaid rolling invoices.
export const useCustomerBalance = (customerId: string | undefined) => {
  const { tenant } = useTenant();

  return useQuery({
    queryKey: ["customer-balance", tenant?.id, customerId],
    staleTime: 0, // Force fresh data
    gcTime: 0, // Clear cache immediately
    queryFn: async () => {
      if (!tenant) throw new Error("No tenant context available");
      if (!customerId) return null;

      // Get IDs of cancelled/rejected rentals to exclude from balance
      const { data: excludedRentals, error: rentalsError } = await supabase
        .from("rentals")
        .select("id")
        .eq("customer_id", customerId)
        .eq("tenant_id", tenant.id)
        .or("status.eq.Cancelled,approval_status.eq.rejected");

      if (rentalsError) throw rentalsError;
      const excludedRentalIds = new Set(excludedRentals?.map(r => r.id) || []);

      const paygRentalIds = await fetchPaygRentalIds(customerId, tenant.id);

      // Get all charge entries for this customer
      const { data, error } = await supabase
        .from("ledger_entries")
        .select("remaining_amount, type, due_date, category, rental_id")
        .eq("tenant_id", tenant.id)
        .eq("customer_id", customerId)
        .eq("type", "Charge");

      if (error) throw error;

      // Sum remaining_amount for charges that are currently due, excluding
      // cancelled/rejected rentals AND PAYG rentals (PAYG outstanding comes
      // from payg_accruals — counting both double-charges open PAYG days).
      const ledgerBalance = data.reduce((sum, entry) => {
        if (entry.rental_id && excludedRentalIds.has(entry.rental_id)) return sum;
        if (entry.rental_id && paygRentalIds.has(entry.rental_id)) return sum;
        // For rental charges, only include if currently due (due_date <= today)
        if (entry.category === 'Rental' && entry.due_date && parseLocalDate(entry.due_date) > new Date()) {
          return sum;
        }
        // Include all other charges (fines, etc.) regardless of due date
        return sum + (entry.remaining_amount || 0);
      }, 0);

      const paygBalance = await fetchPaygOutstandingForCustomer(
        customerId,
        tenant.id,
        excludedRentalIds,
      );

      return ledgerBalance + paygBalance;
    },
    enabled: !!tenant && !!customerId,
  });
};

// Enhanced customer balance with status information from ledger_entries
// Uses remaining_amount on charges and checks for unapplied payments (credit)
export const useCustomerBalanceWithStatus = (customerId: string | undefined) => {
  const { tenant } = useTenant();

  return useQuery({
    queryKey: ["customer-balance-status", tenant?.id, customerId],
    queryFn: async () => {
      if (!tenant) throw new Error("No tenant context available");
      if (!customerId) return null;

      // Get IDs of cancelled/rejected rentals to exclude from balance
      const { data: excludedRentals, error: rentalsError } = await supabase
        .from("rentals")
        .select("id")
        .eq("customer_id", customerId)
        .eq("tenant_id", tenant.id)
        .or("status.eq.Cancelled,approval_status.eq.rejected");

      if (rentalsError) throw rentalsError;
      const excludedRentalIds = new Set(excludedRentals?.map(r => r.id) || []);

      const paygRentalIds = await fetchPaygRentalIds(customerId, tenant.id);

      // Get all entries for this customer
      const { data: ledgerData, error: ledgerError } = await supabase
        .from("ledger_entries")
        .select("type, amount, remaining_amount, due_date, category, rental_id")
        .eq("tenant_id", tenant.id)
        .eq("customer_id", customerId);

      if (ledgerError) throw ledgerError;

      // Also check for unapplied payments (credit balance)
      const { data: paymentsData, error: paymentsError } = await supabase
        .from("payments")
        .select("remaining_amount, status, capture_status")
        .eq("tenant_id", tenant.id)
        .eq("customer_id", customerId);

      if (paymentsError) throw paymentsError;

      // Calculate totals, excluding charges from cancelled/rejected rentals
      let totalCharges = 0;
      let totalPayments = 0;
      let outstandingDebt = 0; // Sum of remaining_amount on due charges
      let availableCredit = 0; // Sum of unapplied payment amounts

      ledgerData.forEach(entry => {
        if (entry.type === 'Charge') {
          // Skip charges from cancelled/rejected rentals
          if (entry.rental_id && excludedRentalIds.has(entry.rental_id)) return;

          totalCharges += entry.amount;

          // Skip ledger contribution from PAYG rentals — payg_accruals is the
          // authoritative source for those and gets added separately below.
          // Including both sums the same open day twice.
          if (entry.rental_id && paygRentalIds.has(entry.rental_id)) return;

          // For rental charges, only include remaining if currently due
          if (entry.category === 'Rental' && entry.due_date && parseLocalDate(entry.due_date) > new Date()) {
            // Future charge - don't add to outstanding
            return;
          }
          // Add remaining amount to outstanding debt
          outstandingDebt += (entry.remaining_amount || 0);
        } else if (entry.type === 'Payment') {
          totalPayments += Math.abs(entry.amount);
        }
      });

      // Sum up unapplied payment amounts (credit available). ONLY captured,
      // settled money counts. Whitelist the settled statuses — matching the
      // booking app (portal/bookings/[id]/page.tsx uses
      // .in('status', ['Applied','Credit','Partial'])) — so this excludes BOTH
      // uncaptured Stripe holds (status='Pending' / capture_status=
      // 'requires_capture', which carry remaining_amount = the full amount but
      // are NOT real money) AND Refunded/Cancelled rows that reject-rental can
      // leave with remaining_amount > 0. Counting any of those inflated
      // availableCredit and, because netBalance = outstandingDebt - availableCredit,
      // could flip a customer who actually owed money into a bogus "In Credit" —
      // hiding the debt (e.g. a $147 debtor shown as ~$1,577 credit from stale holds).
      const CAPTURED_CREDIT_STATUSES = ['Applied', 'Credit', 'Partial'];
      paymentsData?.forEach((payment: any) => {
        if (!CAPTURED_CREDIT_STATUSES.includes(payment.status)) return;
        availableCredit += (payment.remaining_amount || 0);
      });

      // Add PAYG outstanding from open accruals (the ledger doesn't reflect this
      // for PAYG rentals because the auto-allocate trigger drains remaining_amount
      // before any real customer payment lands).
      const paygOutstanding = await fetchPaygOutstandingForCustomer(
        customerId,
        tenant.id,
        excludedRentalIds,
      );
      outstandingDebt += paygOutstanding;
      totalCharges += paygOutstanding;

      // Net balance: positive = debt, negative = credit
      const netBalance = outstandingDebt - availableCredit;

      // Determine status based on net balance
      let status: 'In Credit' | 'Settled' | 'In Debt';
      let displayBalance: number;

      if (Math.abs(netBalance) < 0.01) {
        status = 'Settled';
        displayBalance = 0;
      } else if (netBalance > 0) {
        status = 'In Debt';
        displayBalance = netBalance;
      } else {
        status = 'In Credit';
        displayBalance = Math.abs(netBalance);
      }

      return {
        balance: displayBalance,
        status,
        totalCharges,
        totalPayments,
        outstandingDebt,
        availableCredit
      };
    },
    enabled: !!tenant && !!customerId,
    staleTime: 0,
    gcTime: 0,
  });
};

export const useRentalBalance = (rentalId: string | undefined, customerId: string | undefined) => {
  const { tenant } = useTenant();

  return useQuery({
    queryKey: ["rental-balance", tenant?.id, rentalId, customerId],
    queryFn: async () => {
      if (!tenant) throw new Error("No tenant context available");
      if (!rentalId) return 0;

      const { data, error } = await supabase
        .from("ledger_entries")
        .select("amount")
        .eq("tenant_id", tenant.id)
        .eq("rental_id", rentalId);

      if (error) throw error;

      const total = data.reduce((sum, entry) => sum + entry.amount, 0);
      return total;
    },
    enabled: !!tenant && !!rentalId,
  });
};

// Rental charges and payments breakdown.
// For PAYG rentals, ledger.remaining_amount goes to 0 the moment the auto-
// allocate trigger drains older Partial/Credit payments into the new Charge,
// even though the corresponding payg_accruals row is still 'open'. So we
// supplement the ledger sum with the PAYG accrual day-totals for any rows
// whose invoice_status is still 'open' on this rental.
//
// For extensions, the rental page reads outstanding from `rental_extension_totals`
// because some extension charges (e.g. Bonzah insurance) don't always have a
// ledger entry yet. We mirror that here so the Add Payment dialog's
// "outstanding balance" matches the Balance Due tile shown on the rental page.
// Without this, an unpaid extension would show $0 in the dialog and the
// operator would see "No outstanding balance" even though Balance Due > 0.
export const useRentalChargesAndPayments = (rentalId: string | undefined) => {
  const { tenant } = useTenant();

  return useQuery({
    queryKey: ["rental-charges-payments", tenant?.id, rentalId],
    queryFn: async () => {
      if (!tenant) throw new Error("No tenant context available");
      if (!rentalId) return { charges: 0, payments: 0, outstanding: 0 };

      const [ledgerRes, rentalRes] = await Promise.all([
        supabase
          .from("ledger_entries")
          .select("type, amount, remaining_amount, category")
          .eq("tenant_id", tenant.id)
          .eq("rental_id", rentalId),
        supabase
          .from("rentals")
          .select("is_pay_as_you_go")
          .eq("id", rentalId)
          .maybeSingle(),
      ]);

      if (ledgerRes.error) throw ledgerRes.error;
      const data = ledgerRes.data || [];
      const isPayg = !!(rentalRes.data as any)?.is_pay_as_you_go;

      const isExtensionCategory = (cat: string | null | undefined) =>
        typeof cat === 'string' && cat.startsWith('Extension');

      const charges = data
        .filter(entry => entry.type === 'Charge' && !isExtensionCategory(entry.category))
        .reduce((sum, entry) => sum + entry.amount, 0);

      const payments = Math.abs(data
        .filter(entry => entry.type === 'Payment')
        .reduce((sum, entry) => sum + entry.amount, 0));

      // For PAYG rentals, ignore ledger Charge.remaining — payg_accruals below
      // is authoritative and both sources track the same open days. Summing
      // them double-counts (e.g. days 8+9 showing $223 instead of $111).
      const ledgerOutstanding = isPayg
        ? 0
        : data
            .filter(entry => entry.type === 'Charge' && !isExtensionCategory(entry.category))
            .reduce((sum, entry) => sum + entry.remaining_amount, 0);

      // Add open PAYG accrual day-totals for this rental, if any.
      const { data: paygOpen } = await supabase
        .from("payg_accruals")
        .select("daily_rate, tax_amount, service_fee_amount")
        .eq("tenant_id", tenant.id)
        .eq("rental_id", rentalId)
        .eq("invoice_status", "open");

      const paygOutstanding = (paygOpen ?? []).reduce(
        (sum: number, a: any) =>
          sum + Number(a.daily_rate || 0) + Number(a.tax_amount || 0) + Number(a.service_fee_amount || 0),
        0,
      );

      // Add extension outstanding from the authoritative view. The rental page
      // uses this same source for its Balance Due tile — we mirror it here so
      // the dialog never tells the operator "No outstanding balance" while
      // an extension is unpaid.
      const { data: extensionTotals } = await supabase
        .from("rental_extension_totals")
        .select("display_status, outstanding_amount, total_charged")
        .eq("rental_id", rentalId);

      const billableExtensions = (extensionTotals ?? []).filter((re: any) =>
        re.display_status !== 'pending_approval' &&
        re.display_status !== 'cancelled' &&
        re.display_status !== 'refunded'
      );
      const extensionOutstanding = billableExtensions.reduce(
        (sum: number, re: any) => sum + Number(re.outstanding_amount || 0),
        0,
      );
      const extensionCharges = billableExtensions.reduce(
        (sum: number, re: any) => sum + Number(re.total_charged || 0),
        0,
      );

      return {
        charges: charges + paygOutstanding + extensionCharges,
        payments,
        outstanding: ledgerOutstanding + paygOutstanding + extensionOutstanding,
      };
    },
    enabled: !!tenant && !!rentalId,
  });
};

// Helper function to determine balance status with consistent ledger-based logic
export const getBalanceStatus = (
  balance: number | undefined,
  status?: 'In Credit' | 'Settled' | 'In Debt',
  currencyCode?: string
) => {
  const currency = currencyCode || 'USD'; // Default to USD if not provided

  if (balance === undefined) return { text: 'Unknown', type: 'secondary' };
  if (balance === 0 || status === 'Settled') return { text: 'Settled', type: 'secondary' };
  if (status === 'In Debt') return { text: `In Debt ${formatCurrency(balance, currency)}`, type: 'destructive' };
  if (status === 'In Credit') return { text: `In Credit ${formatCurrency(balance, currency)}`, type: 'success' };

  // Fallback to old logic if status not provided
  if (balance > 0) return { text: `In Debt ${formatCurrency(balance, currency)}`, type: 'destructive' };
  return { text: `In Credit ${formatCurrency(Math.abs(balance), currency)}`, type: 'success' };
};
