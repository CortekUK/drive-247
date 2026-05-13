import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/contexts/TenantContext";
import { useAuthStore } from "@/stores/auth-store";
import { toast } from "@/hooks/use-toast";
import type {
  OwnerOwedRow,
  OwnerPayout,
  OwnerPayoutLine,
  PaymentMethod,
  PayoutStatus,
} from "@/types/vehicle-owners";

interface UseOwnerPayoutsOptions {
  ownerId?: string;
  status?: PayoutStatus;
}

export function useOwnerPayouts({ ownerId, status }: UseOwnerPayoutsOptions = {}) {
  const { tenant } = useTenant();

  return useQuery({
    queryKey: ["owner-payouts", tenant?.id, ownerId ?? null, status ?? null],
    queryFn: async (): Promise<(OwnerPayout & { owner_full_name?: string | null })[]> => {
      let query = (supabase as any)
        .from("owner_payouts")
        .select("*, vehicle_owners!inner(full_name)")
        .eq("tenant_id", tenant!.id)
        .order("period_end", { ascending: false });
      if (ownerId) query = query.eq("owner_id", ownerId);
      if (status) query = query.eq("status", status);
      const { data, error } = await query;
      if (error) throw error;
      return (data || []).map((row: any) => ({
        ...row,
        owner_full_name: row.vehicle_owners?.full_name ?? null,
      }));
    },
    enabled: !!tenant?.id,
  });
}

export function useOwnerPayout(payoutId: string | undefined) {
  const { tenant } = useTenant();

  return useQuery({
    queryKey: ["owner-payout", tenant?.id, payoutId],
    queryFn: async () => {
      if (!payoutId) return null;
      const { data, error } = await (supabase as any)
        .from("owner_payouts")
        .select("*, vehicle_owners(full_name, email, phone), owner_payout_lines(*)")
        .eq("id", payoutId)
        .eq("tenant_id", tenant!.id)
        .maybeSingle();
      if (error) throw error;
      return data as
        | (OwnerPayout & {
            vehicle_owners: { full_name: string; email: string | null; phone: string | null } | null;
            owner_payout_lines: OwnerPayoutLine[];
          })
        | null;
    },
    enabled: !!tenant?.id && !!payoutId,
  });
}

export interface CreatePayoutInput {
  owner_id: string;
  period_start: string; // YYYY-MM-DD
  period_end: string;
  refund_adjustments?: number;
  notes?: string;
  preview: OwnerOwedRow[]; // from useOwnerOwedPreview
}

export function useCreatePayout() {
  const { tenant } = useTenant();
  const { appUser } = useAuthStore();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: CreatePayoutInput): Promise<OwnerPayout> => {
      if (!tenant?.id) throw new Error("Tenant context missing");

      // Per-vehicle overlap protection now lives in calculate_owner_owed —
      // it excludes vehicles already covered by a non-cancelled payout in
      // the requested period. The preview only contains uncovered revenue,
      // so an empty preview = nothing left to pay out.
      if (input.preview.length === 0) {
        throw new Error("No remaining revenue to pay out for this owner in the selected range.");
      }

      const grossRevenue = input.preview.reduce((sum, r) => sum + Number(r.paid_revenue || 0), 0);
      const commissionAmount = input.preview.reduce((sum, r) => sum + Number(r.commission_amount || 0), 0);
      const refundAdjustments = Number(input.refund_adjustments ?? 0);
      const netOwed = round2(grossRevenue - commissionAmount - refundAdjustments);

      const { data: payout, error: payoutErr } = await (supabase as any)
        .from("owner_payouts")
        .insert({
          tenant_id: tenant.id,
          owner_id: input.owner_id,
          period_start: input.period_start,
          period_end: input.period_end,
          gross_revenue: round2(grossRevenue),
          commission_amount: round2(commissionAmount),
          refund_adjustments: round2(refundAdjustments),
          net_owed: netOwed,
          status: "pending",
          amount_paid: 0,
          notes: input.notes ?? null,
          recorded_by: appUser?.id ?? null,
        })
        .select("*")
        .single();
      if (payoutErr) throw payoutErr;

      const lineRows = input.preview
        .filter((r) => Number(r.paid_revenue) > 0 || Number(r.commission_amount) > 0)
        .map((r) => ({
          payout_id: payout.id,
          tenant_id: tenant.id,
          vehicle_id: r.vehicle_id,
          rental_id: null, // aggregated per-vehicle in v1
          vehicle_reg: r.vehicle_reg,
          paid_revenue: round2(r.paid_revenue),
          commission_type: r.commission_type,
          commission_value: r.commission_value,
          commission_amount: round2(r.commission_amount),
          net_to_owner: round2(r.net_to_owner),
        }));

      if (lineRows.length > 0) {
        const { error: linesErr } = await (supabase as any).from("owner_payout_lines").insert(lineRows);
        if (linesErr) {
          // Roll back the header to keep state consistent.
          await (supabase as any).from("owner_payouts").delete().eq("id", payout.id);
          throw linesErr;
        }
      }

      return payout as OwnerPayout;
    },
    onSuccess: (payout) => {
      queryClient.invalidateQueries({ queryKey: ["owner-payouts", tenant?.id] });
      queryClient.invalidateQueries({ queryKey: ["owner-payout", tenant?.id, payout.id] });
      toast({ title: "Payout created", description: "The payout is ready to be paid out." });
    },
    onError: (err: Error) => {
      toast({ title: "Failed to create payout", description: err.message, variant: "destructive" });
    },
  });
}

export interface RecordPaymentInput {
  payout_id: string;
  amount_paid: number;
  payment_method: PaymentMethod;
  payment_reference?: string;
  paid_at: string; // ISO
  notes?: string;
}

export function useRecordPayoutPayment() {
  const { tenant } = useTenant();
  const { appUser } = useAuthStore();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: RecordPaymentInput): Promise<OwnerPayout> => {
      // Read the payout to figure out fully-paid vs partial.
      const { data: existing, error: readErr } = await (supabase as any)
        .from("owner_payouts")
        .select("net_owed, amount_paid, status")
        .eq("id", input.payout_id)
        .eq("tenant_id", tenant!.id)
        .single();
      if (readErr) throw readErr;
      if (existing.status === "cancelled") throw new Error("Cannot record payment on a cancelled payout.");
      if (Number(existing.net_owed) < 0) throw new Error("Net owed is negative — cannot mark paid. Carry forward to next payout instead.");

      const totalPaid = round2(Number(existing.amount_paid || 0) + input.amount_paid);
      const newStatus: PayoutStatus = totalPaid >= Number(existing.net_owed) ? "paid" : "partially_paid";

      const { data, error } = await (supabase as any)
        .from("owner_payouts")
        .update({
          amount_paid: totalPaid,
          status: newStatus,
          paid_at: newStatus === "paid" ? input.paid_at : existing.amount_paid > 0 ? null : input.paid_at,
          payment_method: input.payment_method,
          payment_reference: input.payment_reference ?? null,
          notes: input.notes ?? null,
          recorded_by: appUser?.id ?? null,
        })
        .eq("id", input.payout_id)
        .eq("tenant_id", tenant!.id)
        .select("*")
        .single();
      if (error) throw error;
      return data as OwnerPayout;
    },
    onSuccess: (payout) => {
      queryClient.invalidateQueries({ queryKey: ["owner-payouts", tenant?.id] });
      queryClient.invalidateQueries({ queryKey: ["owner-payout", tenant?.id, payout.id] });
      toast({ title: "Payment recorded" });
    },
    onError: (err: Error) => {
      toast({ title: "Failed to record payment", description: err.message, variant: "destructive" });
    },
  });
}

export function useCancelPayout() {
  const { tenant } = useTenant();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (payoutId: string) => {
      const { error } = await (supabase as any)
        .from("owner_payouts")
        .update({ status: "cancelled" })
        .eq("id", payoutId)
        .eq("tenant_id", tenant!.id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["owner-payouts", tenant?.id] });
      toast({ title: "Payout cancelled" });
    },
    onError: (err: Error) => {
      toast({ title: "Failed to cancel payout", description: err.message, variant: "destructive" });
    },
  });
}

function round2(n: number) {
  return Math.round(n * 100) / 100;
}
