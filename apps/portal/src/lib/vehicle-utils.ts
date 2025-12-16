import { supabase } from "@/integrations/supabase/client";

export type VehicleStatus = 'Available' | 'Rented' | 'Disposed';

export interface VehicleWithStatus {
  id: string;
  reg: string;
  make: string;
  model: string;
  colour: string;
  acquisition_type: string;
  purchase_price?: number;
  monthly_payment?: number;
  initial_payment?: number;
  term_months?: number;
  balloon?: number;
  mot_due_date?: string;
  tax_due_date?: string;
  is_disposed: boolean;
  disposal_date?: string;
  status: VehicleStatus;
  computed_status: VehicleStatus;
}

export interface VehiclePLData {
  vehicle_id: string;
  vehicle_reg: string;
  make_model: string;
  total_revenue: number;
  total_costs: number;
  net_profit: number;
  revenue_rental: number;
  revenue_fees: number;
  cost_acquisition: number;
  cost_service: number;
  cost_fines: number;
}

/**
 * Compute dynamic vehicle status based on disposal and rental state
 */
export function computeVehicleStatus(
  vehicle: { id: string; is_disposed: boolean; disposal_date?: string },
  activeRentals: { vehicle_id: string }[]
): VehicleStatus {
  // Check if disposed
  if (vehicle.is_disposed || vehicle.disposal_date) {
    return 'Disposed';
  }
  
  // Check if actively rented
  const isRented = activeRentals.some(rental => rental.vehicle_id === vehicle.id);
  if (isRented) {
    return 'Rented';
  }
  
  return 'Available';
}

/**
 * Get contract total for finance vehicles
 */
export function getContractTotal(vehicle: {
  acquisition_type: string;
  initial_payment?: number;
  monthly_payment?: number;
  term_months?: number;
  balloon?: number;
}): number {
  if (vehicle.acquisition_type !== 'Finance') {
    return 0;
  }
  
  // Convert to numbers explicitly in case they come as strings
  const initial = Number(vehicle.initial_payment) || 0;
  const monthly = (Number(vehicle.monthly_payment) || 0) * (Number(vehicle.term_months) || 0);
  const balloon = Number(vehicle.balloon) || 0;
  
  // Debug logging
  console.log('getContractTotal debug:', {
    acquisition_type: vehicle.acquisition_type,
    initial_payment: vehicle.initial_payment,
    monthly_payment: vehicle.monthly_payment,
    term_months: vehicle.term_months,
    balloon: vehicle.balloon,
    calculated_initial: initial,
    calculated_monthly: monthly,
    calculated_balloon: balloon,
    calculated_total: initial + monthly + balloon
  });
  
  return initial + monthly + balloon;
}

/**
 * Format currency for display
 */
export function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
}

/**
 * Normalize registration for comparison (uppercase, no spaces)
 */
export function normalizeRegistration(reg: string): string {
  return reg.toUpperCase().replace(/\s+/g, '');
}

/**
 * Check if registration is unique (case-insensitive)
 */
export async function checkRegistrationUnique(reg: string, excludeId?: string): Promise<boolean> {
  const normalizedReg = normalizeRegistration(reg);
  
  let query = supabase
    .from('vehicles')
    .select('id')
    .ilike('reg', normalizedReg.replace(/(.)/g, '$1%').slice(0, -1)); // Case-insensitive LIKE
  
  if (excludeId) {
    query = query.neq('id', excludeId);
  }
  
  const { data, error } = await query;
  
  if (error) {
    console.error('Error checking registration uniqueness:', error);
    return true; // Assume unique on error to avoid blocking
  }
  
  return data.length === 0;
}