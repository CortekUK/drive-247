/**
 * Real staging data, frozen.
 *
 * Every value below was read from the live `northwind` tenant on the v2 staging
 * project with the anon key, so a scenario built from these fixtures prices the
 * same booking the site prices. Invented round numbers would hide exactly the
 * bugs this file exists to catch — the seeded rents are deliberately not simple
 * multiples (89 / 534 / 1958), which is what makes tier selection observable.
 *
 * These are for tests and local proofs. Nothing in the app imports them.
 */

import type {
  QuoteExtra,
  QuoteTenantConfig,
  QuoteVehicle,
} from './types';

export const NORTHWIND_TENANT_ID = '8e6bc88f-86d6-4468-8610-73f7c8a88f6e';

/**
 * `northwind` exactly as seeded: no tax, no service fee, deposits CHARGED but
 * the global amount is 0, no weekend surcharge, no delivery tiers.
 *
 * That it is this quiet is the point — it is the baseline every variant below
 * departs from by exactly one setting.
 */
export const northwindTenant: QuoteTenantConfig = {
  currency_code: 'USD',
  monthly_tier_days: 30,
  weekend_surcharge_percent: 0,
  weekend_days: [6, 0],
  stack_surcharges: false,
  tax_enabled: false,
  tax_percentage: 0,
  service_fee_enabled: false,
  service_fee_type: 'fixed_amount',
  service_fee_value: 0,
  service_fee_amount: 0,
  security_deposit_enabled: true,
  deposit_mode: 'global',
  deposit_charge_enabled: true,
  global_deposit_amount: 0,
  hide_checkout_price_breakdown: false,
  delivery_tiers_enabled: false,
  delivery_distance_tiers: [],
  area_delivery_fee: 0,
  delivery_max_distance_km: null,
};

/** Build a variant of the baseline tenant, changing only what is named. */
export const tenantWith = (
  overrides: Partial<QuoteTenantConfig>,
): QuoteTenantConfig => ({ ...northwindTenant, ...overrides });

/** Tesla Model 3 — rents 89 / 534 / 1958, and it offers the unlimited upgrade. */
export const teslaModel3: QuoteVehicle = {
  id: '326e0ccb-6210-470d-8bbc-09a61dfef2ae',
  daily_rent: 89,
  weekly_rent: 534,
  monthly_rent: 1958,
  security_deposit: 500,
  daily_mileage: 150,
  weekly_mileage: 900,
  monthly_mileage: 3000,
  excess_mileage_rate: 0.45,
  unlimited_mileage_available: true,
  unlimited_mileage_price_daily: 25,
  unlimited_mileage_price_weekly: 140,
  unlimited_mileage_price_monthly: 480,
};

/** Toyota Corolla — 50 / 265 / 1056, and NO unlimited-mileage upgrade offered. */
export const toyotaCorolla: QuoteVehicle = {
  id: '2ea71972-fa71-4c9b-a7de-771f4f468b4c',
  daily_rent: 50,
  weekly_rent: 265,
  monthly_rent: 1056,
  security_deposit: 250,
  daily_mileage: 100,
  weekly_mileage: 600,
  monthly_mileage: 2000,
  excess_mileage_rate: 0.45,
  unlimited_mileage_available: false,
  unlimited_mileage_price_daily: null,
  unlimited_mileage_price_weekly: null,
  unlimited_mileage_price_monthly: null,
};

/** Rolls-Royce Ghost — the top of the fleet, 650 / 3850 / 14000. */
export const rollsRoyceGhost: QuoteVehicle = {
  id: 'e980917d-1343-4085-96b7-e2706f2f8e0a',
  daily_rent: 650,
  weekly_rent: 3850,
  monthly_rent: 14000,
  security_deposit: 3500,
  daily_mileage: 80,
  weekly_mileage: 480,
  monthly_mileage: 1600,
  excess_mileage_rate: 0.45,
  unlimited_mileage_available: true,
  unlimited_mileage_price_daily: 25,
  unlimited_mileage_price_weekly: 140,
  unlimited_mileage_price_monthly: 480,
};

/** The five seeded extras, in the operator's `sort_order`. */
export const northwindExtras: QuoteExtra[] = [
  { id: 'eda9a7c6-128f-4245-919b-a414e3618afd', name: 'Child Seat', price: 12, billing_type: 'per_day', max_quantity: 3 },
  { id: 'e25cb8f9-542d-4ba7-be88-fa5c792577be', name: 'Additional Driver', price: 15, billing_type: 'per_day', max_quantity: 2 },
  { id: 'e8ceb5c1-7c75-46b2-9f38-7d13019b639f', name: 'Prepaid Fuel', price: 85, billing_type: 'per_trip', max_quantity: 1 },
  { id: '41c63518-c065-4252-adbf-8fa706ff43de', name: 'Roadside Assistance', price: 9, billing_type: 'per_day', max_quantity: 1 },
  { id: '0dc58fbc-b8b3-4edd-929c-e24923275b65', name: 'Toll Pass', price: 11, billing_type: 'per_day', max_quantity: 1 },
];

/** The three seeded pickup locations and their delivery fees. */
export const northwindPickupLocations = [
  { id: '9220a11f-0bee-4dde-97b7-123bbaa9a4b0', name: 'Downtown Dallas Hub', delivery_fee: 0 },
  { id: '81d932f1-a08a-4a77-8678-5ac3a1f23524', name: 'DFW International', delivery_fee: 45 },
  { id: 'dddda2a1-538e-4c88-88d0-fc1ee3acfbf0', name: 'Campbell Centre', delivery_fee: 25 },
] as const;
