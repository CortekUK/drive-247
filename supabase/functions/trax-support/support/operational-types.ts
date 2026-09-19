import type { NavigationAction } from './types.ts';

export interface VehicleRecord {
  id: string; tenant_id: string; reg: string; make: string | null; model: string | null;
  status: string | null; is_paused: boolean | null; is_disposed: boolean | null;
  show_on_website: boolean | null; pickup_location_id: string | null;
  available_daily: boolean | null; available_weekly: boolean | null; available_monthly: boolean | null;
}
export interface RentalRecord {
  id: string; tenant_id: string; vehicle_id: string | null; rental_number: string | null;
  status: string | null; start_date: string; end_date: string | null;
  return_time: string | null; is_pay_as_you_go: boolean | null; payg_closed_at: string | null;
}
export interface HandoverRecord { id: string; tenant_id: string; rental_id: string; handover_type: string; handed_at: string | null }
export interface BlockRecord { id: string; tenant_id: string; vehicle_id: string | null; start_date: string; end_date: string }
export interface AvailabilityConfig { id: string; buffer_time_minutes: number | null; monthly_tier_days: number | null }
export type Operation = 'website_visibility' | 'date_availability' | 'booking_rejection';
export interface DiagnosticInput {
  vehicleId: string; operation: Operation;
  startDate: string | null; endDate: string | null;
  customerTimezone: string | null; pickupLocationId: string | null;
}
/** One tenant and one entity per invocation. All list methods use sentinel limits. */
export interface OperationalReads {
  vehicle(tenant: string, id: string): Promise<VehicleRecord | null>;
  rental(tenant: string, id: string): Promise<RentalRecord | null>;
  findVehicles(tenant: string, query: string, exact: boolean): Promise<VehicleRecord[]>;
  findRentals(tenant: string, number: string): Promise<RentalRecord[]>;
  config(tenant: string): Promise<AvailabilityConfig | null>;
  location(tenant: string, id: string): Promise<{id: string; tenant_id: string} | null>;
  findLocations(tenant: string, name: string): Promise<{id:string;tenant_id:string;name:string}[]>;
  occupancy(tenant: string, vehicle: string, operation: Operation, start: string, end: string): Promise<RentalRecord[]>;
  blocks(tenant: string, vehicle: string, start: string, end: string): Promise<BlockRecord[]>;
  completed(tenant: string, vehicle: string, from: string, through: string): Promise<RentalRecord[]>;
  receiving(tenant: string, rental: string): Promise<HandoverRecord[]>;
}
export type EvidenceStatus = 'verified' | 'partial' | 'restricted' | 'missing' | 'error' | 'needs_input';
export interface Evidence {
  id: string; table: 'vehicles' | 'rentals' | 'pickup_locations' | 'blocked_dates' | 'rental_key_handovers' | 'availability_check' | 'account_summary' | 'payment_check' | 'stripe_account_summary' | 'payment_evidence' | 'business_query';
  recordId?: string; title: string; observedAt: string;
}
export interface Finding { code: string; summary: string; sourceIds: string[]; blocking: boolean }
export interface OperationalResult {
  status: EvidenceStatus; observedAt: string; findings: Finding[];
  sources: Evidence[]; navigation: NavigationAction[]; checks: string[]; limitations: string[];
  matches?: {kind: 'vehicle' | 'rental' | 'pickup_location'; id: string; label: string}[];
  data?: Record<string, unknown>;
  diagnostic?: DiagnosticInput;
}
export interface CalendarClock {
  today(timezone: string, now: number): string;
  timestamp(date: string, time: string, timezone: string): number;
}
