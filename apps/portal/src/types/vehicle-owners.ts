// Local type definitions for vehicle_owners / owner_payouts / owner_payout_lines.
// Replace with generated Database types after running:
//   supabase gen types typescript --project-id hviqoaokxvlancmftwuo > apps/portal/src/integrations/supabase/types.ts

export type CommissionType = "percentage" | "flat_fee";
export type FlatFeePeriod = "per_rental" | "per_month" | "per_day";
export type PayoutFrequency = "weekly" | "biweekly" | "monthly" | "manual";
export type PayoutStatus = "pending" | "partially_paid" | "paid" | "cancelled";
export type PaymentMethod = "bank_transfer" | "cash" | "cheque" | "stripe" | "other";

export interface VehicleOwner {
  id: string;
  tenant_id: string;
  full_name: string;
  email: string | null;
  phone: string | null;
  address: string | null;
  notes: string | null;
  commission_type: CommissionType;
  commission_value: number;
  flat_fee_period: FlatFeePeriod | null;
  payout_frequency: PayoutFrequency;
  is_active: boolean;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface VehicleOwnerInput {
  full_name: string;
  email?: string | null;
  phone?: string | null;
  address?: string | null;
  notes?: string | null;
  commission_type: CommissionType;
  commission_value: number;
  flat_fee_period?: FlatFeePeriod | null;
  payout_frequency: PayoutFrequency;
  is_active?: boolean;
}

export interface OwnerPayout {
  id: string;
  tenant_id: string;
  owner_id: string;
  period_start: string;
  period_end: string;
  gross_revenue: number;
  commission_amount: number;
  refund_adjustments: number;
  net_owed: number;
  status: PayoutStatus;
  amount_paid: number;
  paid_at: string | null;
  payment_method: PaymentMethod | null;
  payment_reference: string | null;
  notes: string | null;
  recorded_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface OwnerPayoutLine {
  id: string;
  payout_id: string;
  tenant_id: string;
  vehicle_id: string;
  rental_id: string | null;
  vehicle_reg: string;
  paid_revenue: number;
  commission_type: CommissionType;
  commission_value: number;
  commission_amount: number;
  net_to_owner: number;
  created_at: string;
}

export interface OwnerRevenueRow {
  tenant_id: string;
  owner_id: string;
  vehicle_id: string;
  vehicle_reg: string;
  rental_id: string | null;
  payment_id: string;
  revenue_date: string;
  paid_amount: number;
}

// Output of calculate_owner_owed RPC
export interface OwnerOwedRow {
  vehicle_id: string;
  vehicle_reg: string;
  rental_count: number;
  paid_revenue: number;
  commission_type: CommissionType;
  commission_value: number;
  flat_fee_period: FlatFeePeriod | null;
  commission_amount: number;
  net_to_owner: number;
}

export const COMMISSION_TYPE_OPTIONS: { value: CommissionType; label: string }[] = [
  { value: "percentage", label: "Percentage of revenue" },
  { value: "flat_fee", label: "Flat fee" },
];

export const FLAT_FEE_PERIOD_OPTIONS: { value: FlatFeePeriod; label: string }[] = [
  { value: "per_month", label: "Per month" },
  { value: "per_rental", label: "Per rental" },
  { value: "per_day", label: "Per day (per rented day)" },
];

// Short suffix for inline commission display, e.g. "$13.95 / day".
export const flatFeePeriodSuffix = (p: FlatFeePeriod | null | undefined): string =>
  p === "per_month" ? "mo" : p === "per_day" ? "day" : "rental";

export const PAYOUT_FREQUENCY_OPTIONS: { value: PayoutFrequency; label: string }[] = [
  { value: "weekly", label: "Weekly" },
  { value: "biweekly", label: "Bi-weekly (every 2 weeks)" },
  { value: "monthly", label: "Monthly" },
  { value: "manual", label: "Manual / on request" },
];

export const PAYMENT_METHOD_OPTIONS: { value: PaymentMethod; label: string }[] = [
  { value: "bank_transfer", label: "Bank transfer" },
  { value: "cash", label: "Cash" },
  { value: "cheque", label: "Cheque" },
  { value: "stripe", label: "Stripe / online" },
  { value: "other", label: "Other" },
];

export const PAYOUT_STATUS_LABEL: Record<PayoutStatus, string> = {
  pending: "Pending",
  partially_paid: "Partially paid",
  paid: "Paid",
  cancelled: "Cancelled",
};
