/**
 * Backend-only Bonzah API request/response shapes.
 * These mirror the Bonzah wire format (MM/DD/YYYY dates, string amounts, etc.)
 * and are NOT exposed to the frontend — the frontend uses clean ISO shapes
 * from `@drive247/shared-types`.
 */

import type { BonzahMode } from '@drive247/shared-types';

// --- Generic wrapper ---
export interface BonzahApiResponse<T> {
  status: number;
  txt: string;
  data?: T;
}

// --- Auth ---
export interface BonzahAuthResponse {
  token: string;
  email: string;
}

// --- Credentials (resolved for a tenant) ---
export interface ResolvedBonzahCredentials {
  username: string;
  password: string;
  mode: BonzahMode;
  apiUrl: string;
}

// --- Premium calculation ---
export interface BonzahPremiumCalcRequest {
  trip_start_date: string; // MM/DD/YYYY
  trip_end_date: string;
  pickup_country: string;
  pickup_state: string;
  drop_off_time: string; // 'Same' | 'Later'
  cdw_cover: boolean;
  rcli_cover: boolean;
  sli_cover: boolean;
  pai_cover: boolean;
  skip_validation?: boolean;
}

export interface BonzahPremiumCalcData {
  total_premium: number;
  cdw_rate?: string;
  rcli_rate?: string;
  sli_rate?: string;
  pai_rate?: string;
  errors?: string[];
}

// --- Quote create / finalize ---
export interface BonzahQuoteRequest {
  quote_id?: string;
  trip_start_date: string; // MM/DD/YYYY HH:mm:ss
  trip_end_date: string;
  pickup_country: string;
  pickup_state: string;
  drop_off_time: string;
  residence_country: string;
  residence_state: string;
  cdw_cover?: boolean;
  rcli_cover?: boolean;
  sli_cover?: boolean;
  pai_cover?: boolean;
  first_name: string;
  last_name: string;
  dob: string; // MM/DD/YYYY
  pri_email_address: string;
  alt_email_address?: string;
  address_line_1: string;
  address_line_2?: string;
  zip_code: string;
  inspection_done?: string; // 'Renter' | 'Rental Agency'
  source: string;
  phone_no: string; // 11 digits, no +
  license_no?: string;
  drivers_license_state?: string;
  policy_booking_time_zone: string;
  finalize: 0 | 1;
}

export interface BonzahQuoteData {
  quote_id: string;
  quote_no?: string;
  policy_id?: string;
  payment_id?: string;
  total_premium: number;
  total_amount: number;
  cdw_pdf_id?: number;
  rcli_pdf_id?: number;
  sli_pdf_id?: number;
  pai_pdf_id?: number;
  addon_seq_nos?: Record<string, string>;
  /**
   * Bonzah returns HTTP 200 with `status: 0` even when finalization was
   * rejected. In that case `errors` is populated with `{name, msg}` entries
   * and `quote_no` / `payment_id` come back as empty strings. We treat this
   * as a validation failure and surface the messages to the caller.
   */
  errors?: Array<{ name?: string; msg?: string | string[] }>;
}

// --- Payment ---
export interface BonzahPaymentRequest {
  payment_id: string;
  amount: number;
}

export interface BonzahPaymentData extends BonzahQuoteData {
  policy_no: string;
  policy_id: string;
  premium_value: number;
  total_recvd: number;
}

// --- Policy lookup ---
export interface BonzahPolicyData extends BonzahPaymentData {
  issue_date: string;
  c_ts: string;
  paid_amount: number;
}

// --- Balance ---
export interface BonzahBalanceData {
  broker_code: string;
  amount: string; // comes as stringified number, e.g. "58961.500"
  as_on: string; // MM/DD/YYYY
}

// Cached token record
export interface CachedBonzahToken {
  token: string;
  expiresAt: number; // epoch ms
}
