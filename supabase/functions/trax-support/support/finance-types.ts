import type { SupportContext } from './types.ts';

export type FinanceScope = 'rental_payments' | 'account_balance';
export interface StripeMapping {
  tenantId:string; paymentId:string; platform:'uk'|'uae'; mode:'test'|'live';
  accountId:string; currency:string; verifiedAt:string;
}
/** Reviewed server configuration, never model arguments or browser capabilities. */
export interface FinancePolicy { mappings:StripeMapping[] }
export interface FinanceTenant {
  id:string; currency_code:string|null; payment_provider:string; payment_model:string;
  stripe_mode:string; stripe_account_id:string|null; stripe_onboarding_complete:boolean|null;
  own_stripe_account_id:string|null; own_stripe_test_account_id:string|null;
  /** When the current own (Standard) account was connected. Older payments are never routed to it. */
  own_stripe_connected_at?:string|null; timezone?:string|null;
}
export interface FinancePayment {
  id:string; tenant_id:string; rental_id:string|null; amount:number|string;
  status:string|null; capture_status:string|null; verification_status:string|null;
  payment_type:string; payment_provider:string; platform_account:string;
  stripe_payment_intent_id:string|null; stripe_checkout_session_id:string|null;
  refund_amount:number|string|null; refund_status:string|null; paid_at:string|null;
  created_at?:string|null;
}
export interface FinanceEntry {
  id:string; tenant_id:string; rental_id:string; type:string; amount:number|string;
  category:string; remaining_amount:number|string|null;
}
export interface FinanceApplication { id:string; tenant_id:string; payment_id:string; charge_entry_id:string; amount_applied:number|string }
/** One deposit-hold attempt. The only stored per-object record of a Stripe account and environment. */
export interface HoldLink {
  tenant_id:string; rental_id:string; platform_account:string|null; stripe_mode:string|null;
  connect_account_id:string|null; payment_intent_id:string|null; created_at:string;
}
export interface FinanceReads {
  tenant(tenantId:string):Promise<FinanceTenant|null>;
  entries(tenantId:string,rentalId:string):Promise<FinanceEntry[]>;
  applications(tenantId:string,chargeIds:string[]):Promise<FinanceApplication[]>;
  payments(tenantId:string,rentalId:string,applicationPaymentIds:string[]):Promise<FinancePayment[]>;
  // Exact count of tenants referencing an account in any supported Connect column.
  accountOwners(accountId:string):Promise<number>;
  // Tenant-scoped hold history, oldest first, with a sentinel limit.
  holdLinks?(tenantId:string):Promise<HoldLink[]>;
}
export interface StripeMoney { currency:string; minorUnits:number; display:string }
export interface StripeIntentSummary {
  status:string; mode:'test'|'live'; requested:StripeMoney; received:StripeMoney;
  capturable:StripeMoney; refunded:StripeMoney|null; captured:boolean|null;
}
export interface StripeBalanceSummary { mode:'test'|'live'; available:StripeMoney[]; pending:StripeMoney[] }
/** Backend-derived Stripe location of one payment. Never model, browser or chat input. */
export interface PaymentRoute {
  platform:'uk'|'uae'; mode:'test'|'live'; accountId:string; accountType:'standard'|'express';
  basis:'reviewed_mapping'|'hold_record'|'connected_before_payment'|'hold_history_continuity';
  /** Exactly one tenant currently references this account. */
  exclusive:boolean;
  /** Not exclusive: the Stripe record itself must name this tenant. */
  strictOwnership:boolean;
}
/** Sanitized, exactly linked Stripe objects for one payment. No secrets, card data or free text. */
export interface StripePaymentEvidence {
  intentId:string|null; sessionId:string|null; livemode:boolean; sessionStatus:string|null;
  intentStatus:string|null; currency:string|null; requested:StripeMoney|null; received:StripeMoney|null;
  capturable:StripeMoney|null; captured:boolean|null; capturedAmount:StripeMoney|null; refunded:StripeMoney|null;
  fullyRefunded:boolean|null; createdAt:number|null; receiptUrl:string|null;
  ownership:'metadata'|'exclusive_account';
  /** The PaymentIntent carries platform-flow fields (destination/on_behalf_of/application fee). */
  platformFlow:boolean;
}
export interface ReadOnlyStripe {
  intent(mapping:StripeMapping,intentId:string,signal:AbortSignal):Promise<StripeIntentSummary>;
  balance(mapping:Pick<StripeMapping,'platform'|'mode'|'accountId'>,signal:AbortSignal):Promise<StripeBalanceSummary>;
  evidence?(route:PaymentRoute,refs:{intentId:string|null;sessionId:string|null},expect:{tenantId:string;rentalId:string},signal:AbortSignal):Promise<StripePaymentEvidence>;
}
export interface FinanceServices { policy:FinancePolicy; reads:FinanceReads; stripe:ReadOnlyStripe; sharedTestAccountId?:string }
/**
 * Finance authority for reading the account's OWN database records (payments,
 * revenue, balances) through the business query layer.
 *
 * Same staff rule as financeScopes, deliberately without the FinancePolicy
 * argument: that policy describes the read-only Stripe configuration, and a
 * tenant reading its own payments table does not depend on Stripe being set up.
 * Requiring it meant an admin asking "how much did we collect last month?" was
 * refused whenever TRAX_FINANCE_READS was unset, which is every deployment today.
 *
 * Authority still comes from the authenticated staff record and nothing else:
 * head admins and admins (super admins act as head admin) may read money;
 * a manager needs the Payments tab, and Rentals as well for rental payments;
 * ops and viewers get nothing.
 */
export function databaseFinanceScopes(auth:SupportContext):FinanceScope[] {
  if(auth.role==='head_admin'||auth.role==='admin')return ['rental_payments','account_balance'];
  if(auth.role!=='manager'||!auth.permissions.some(p=>p.tab_key==='payments'))return [];
  return auth.permissions.some(p=>p.tab_key==='rentals')?['rental_payments','account_balance']:['account_balance'];
}
export function financeScopes(auth:SupportContext,policy:FinancePolicy|undefined):FinanceScope[] {
  // Access comes from the authenticated staff record in Supabase (app_users.role and the manager's
  // tab permissions), matching canReadGuidance: head admins and admins (super-admins act as head
  // admin) get both; managers need Payments, plus Rentals for rental payments; ops/viewers get none.
  if(!policy)return [];
  if(auth.role==='head_admin'||auth.role==='admin')return ['rental_payments','account_balance'];
  if(auth.role!=='manager'||!auth.permissions.some(p=>p.tab_key==='payments'))return [];
  return auth.permissions.some(p=>p.tab_key==='rentals')?['rental_payments','account_balance']:['account_balance'];
}
