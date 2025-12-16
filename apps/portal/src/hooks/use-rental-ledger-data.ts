import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface RentalCharge {
  id: string;
  entry_date: string;
  due_date: string | null;
  amount: number;
  remaining_amount: number;
  category: string;
  allocations: PaymentAllocation[];
}

export interface PaymentAllocation {
  id: string;
  payment_id: string;
  amount_applied: number;
  payment_date: string;
  payment_method: string | null;
  payment_amount: number;
}

export interface RentalPayment {
  id: string;
  payment_date: string;
  amount: number;
  method: string | null;
  payment_type: string;
  allocations: ChargeAllocation[];
  remaining_amount: number;
}

export interface ChargeAllocation {
  charge_id: string;
  amount_applied: number;
  charge_category: string;
  charge_due_date: string | null;
}

// Get rental charges with their payment allocations
export const useRentalCharges = (rentalId: string | undefined) => {
  return useQuery({
    queryKey: ["rental-charges", rentalId],
    queryFn: async () => {
      if (!rentalId) return [];

      // Get all charges for this rental
      const { data: charges, error: chargesError } = await supabase
        .from("ledger_entries")
        .select("*")
        .eq("rental_id", rentalId)
        .eq("type", "Charge")
        .order("due_date", { ascending: true });

      if (chargesError) throw chargesError;

      // Get payment applications for these charges
      const chargeIds = charges.map(c => c.id);
      
      if (chargeIds.length === 0) return [];

      const { data: applications, error: appError } = await supabase
        .from("payment_applications")
        .select(`
          *,
          payments(payment_date, method, amount, payment_type)
        `)
        .in("charge_entry_id", chargeIds);

      if (appError) throw appError;

      // Build charges with allocations
      const chargesWithAllocations: RentalCharge[] = charges.map(charge => ({
        id: charge.id,
        entry_date: charge.entry_date,
        due_date: charge.due_date,
        amount: charge.amount,
        remaining_amount: charge.remaining_amount,
        category: charge.category,
        allocations: applications
          .filter(app => app.charge_entry_id === charge.id)
          .map(app => ({
            id: app.id,
            payment_id: app.payment_id,
            amount_applied: app.amount_applied,
            payment_date: app.payments.payment_date,
            payment_method: app.payments.method,
            payment_amount: app.payments.amount,
          }))
      }));

      return chargesWithAllocations;
    },
    enabled: !!rentalId,
  });
};

// Get payments that have allocations to this rental's charges
export const useRentalPayments = (rentalId: string | undefined) => {
  return useQuery({
    queryKey: ["rental-payments", rentalId],
    queryFn: async () => {
      if (!rentalId) return [];

      // First get all charges for this rental
      const { data: charges, error: chargesError } = await supabase
        .from("ledger_entries")
        .select("id")
        .eq("rental_id", rentalId)
        .eq("type", "Charge");

      if (chargesError) throw chargesError;

      const chargeIds = charges.map(c => c.id);
      
      if (chargeIds.length === 0) return [];

      // Get payment applications for these charges
      const { data: applications, error: appError } = await supabase
        .from("payment_applications")
        .select(`
          *,
          payments(*),
          ledger_entries!charge_entry_id(category, due_date)
        `)
        .in("charge_entry_id", chargeIds);

      if (appError) throw appError;

      // Group by payment_id
      const paymentMap = new Map<string, RentalPayment>();

      applications.forEach(app => {
        const payment = app.payments;
        if (!paymentMap.has(payment.id)) {
          paymentMap.set(payment.id, {
            id: payment.id,
            payment_date: payment.payment_date,
            amount: payment.amount,
            method: payment.method,
            payment_type: payment.payment_type,
            remaining_amount: payment.remaining_amount || 0,
            allocations: []
          });
        }

        paymentMap.get(payment.id)!.allocations.push({
          charge_id: app.charge_entry_id,
          amount_applied: app.amount_applied,
          charge_category: app.ledger_entries.category,
          charge_due_date: app.ledger_entries.due_date
        });
      });

      return Array.from(paymentMap.values()).sort((a, b) => 
        new Date(a.payment_date).getTime() - new Date(b.payment_date).getTime()
      );
    },
    enabled: !!rentalId,
  });
};

// Get rental totals based on allocations
export const useRentalTotals = (rentalId: string | undefined) => {
  return useQuery({
    queryKey: ["rental-totals", rentalId],
    queryFn: async () => {
      if (!rentalId) return { totalCharges: 0, totalPayments: 0, outstanding: 0 };

      // Get charges
      const { data: charges, error: chargesError } = await supabase
        .from("ledger_entries")
        .select("amount, remaining_amount")
        .eq("rental_id", rentalId)
        .eq("type", "Charge");

      if (chargesError) throw chargesError;

      // Get payment applications for these charges
      const { data: chargeIds, error: chargeIdsError } = await supabase
        .from("ledger_entries")
        .select("id")
        .eq("rental_id", rentalId)
        .eq("type", "Charge");

      if (chargeIdsError) throw chargeIdsError;

      let totalPayments = 0;
      if (chargeIds.length > 0) {
        const { data: applications, error: appError } = await supabase
          .from("payment_applications")
          .select("amount_applied")
          .in("charge_entry_id", chargeIds.map(c => c.id));

        if (appError) throw appError;

        totalPayments = applications.reduce((sum, app) => sum + app.amount_applied, 0);
      }

      const totalCharges = charges.reduce((sum, charge) => sum + charge.amount, 0);
      const outstanding = charges.reduce((sum, charge) => sum + charge.remaining_amount, 0);

      return { totalCharges, totalPayments, outstanding };
    },
    enabled: !!rentalId,
  });
};