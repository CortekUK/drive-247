import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/contexts/TenantContext";

// Single source of truth: Customer balance calculation from ledger_entries
// Uses remaining_amount on charges which is already maintained by the payment system
export const useCustomerBalance = (customerId: string | undefined) => {
  const { tenant } = useTenant();

  return useQuery({
    queryKey: ["customer-balance", tenant?.id, customerId],
    staleTime: 0, // Force fresh data
    gcTime: 0, // Clear cache immediately
    queryFn: async () => {
      if (!tenant) throw new Error("No tenant context available");
      if (!customerId) return null;

      // Get all charge entries for this customer
      const { data, error } = await supabase
        .from("ledger_entries")
        .select("remaining_amount, type, due_date, category")
        .eq("tenant_id", tenant.id)
        .eq("customer_id", customerId)
        .eq("type", "Charge");

      if (error) throw error;

      // Sum remaining_amount for charges that are currently due
      const balance = data.reduce((sum, entry) => {
        // For rental charges, only include if currently due (due_date <= today)
        if (entry.category === 'Rental' && entry.due_date && new Date(entry.due_date) > new Date()) {
          return sum;
        }
        // Include all other charges (fines, etc.) regardless of due date
        return sum + (entry.remaining_amount || 0);
      }, 0);

      return balance;
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

      // Get all entries for this customer
      const { data: ledgerData, error: ledgerError } = await supabase
        .from("ledger_entries")
        .select("type, amount, remaining_amount, due_date, category")
        .eq("tenant_id", tenant.id)
        .eq("customer_id", customerId);

      if (ledgerError) throw ledgerError;

      // Also check for unapplied payments (credit balance)
      const { data: paymentsData, error: paymentsError } = await supabase
        .from("payments")
        .select("remaining_amount")
        .eq("tenant_id", tenant.id)
        .eq("customer_id", customerId);

      if (paymentsError) throw paymentsError;

      // Calculate totals
      let totalCharges = 0;
      let totalPayments = 0;
      let outstandingDebt = 0; // Sum of remaining_amount on due charges
      let availableCredit = 0; // Sum of unapplied payment amounts

      ledgerData.forEach(entry => {
        if (entry.type === 'Charge') {
          totalCharges += entry.amount;

          // For rental charges, only include remaining if currently due
          if (entry.category === 'Rental' && entry.due_date && new Date(entry.due_date) > new Date()) {
            // Future charge - don't add to outstanding
            return;
          }
          // Add remaining amount to outstanding debt
          outstandingDebt += (entry.remaining_amount || 0);
        } else if (entry.type === 'Payment') {
          totalPayments += Math.abs(entry.amount);
        }
      });

      // Sum up unapplied payment amounts (credit available)
      paymentsData?.forEach(payment => {
        availableCredit += (payment.remaining_amount || 0);
      });

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

// Rental charges and payments breakdown - pure ledger calculation
export const useRentalChargesAndPayments = (rentalId: string | undefined) => {
  const { tenant } = useTenant();

  return useQuery({
    queryKey: ["rental-charges-payments", tenant?.id, rentalId],
    queryFn: async () => {
      if (!tenant) throw new Error("No tenant context available");
      if (!rentalId) return { charges: 0, payments: 0, outstanding: 0 };

      const { data, error } = await supabase
        .from("ledger_entries")
        .select("type, amount, remaining_amount")
        .eq("tenant_id", tenant.id)
        .eq("rental_id", rentalId);

      if (error) throw error;

      const charges = data
        .filter(entry => entry.type === 'Charge')
        .reduce((sum, entry) => sum + entry.amount, 0);

      const payments = Math.abs(data
        .filter(entry => entry.type === 'Payment')
        .reduce((sum, entry) => sum + entry.amount, 0));

      const outstanding = data
        .filter(entry => entry.type === 'Charge')
        .reduce((sum, entry) => sum + entry.remaining_amount, 0);

      return { charges, payments, outstanding };
    },
    enabled: !!tenant && !!rentalId,
  });
};

// Helper function to determine balance status with consistent ledger-based logic
export const getBalanceStatus = (balance: number | undefined, status?: 'In Credit' | 'Settled' | 'In Debt') => {
  if (balance === undefined) return { text: 'Unknown', type: 'secondary' };
  if (balance === 0 || status === 'Settled') return { text: 'Settled', type: 'secondary' };
  if (status === 'In Debt') return { text: `In Debt $${balance.toFixed(2)}`, type: 'destructive' };
  if (status === 'In Credit') return { text: `In Credit $${balance.toFixed(2)}`, type: 'success' };

  // Fallback to old logic if status not provided
  if (balance > 0) return { text: `In Debt $${balance.toFixed(2)}`, type: 'destructive' };
  return { text: `In Credit $${Math.abs(balance).toFixed(2)}`, type: 'success' };
};
