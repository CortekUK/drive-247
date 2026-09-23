import { supabase } from '@/lib/supabase';

/**
 * Drive247 platform promo codes + referral programme — the admin side.
 * Everything goes through the `admin-promo-codes` edge function (super admin,
 * or a sales agent for the read and payment-link actions).
 *
 * Not to be confused with an operator's own renter promo codes (the portal's
 * `promocodes` table): these discount what Drive247 charges operators.
 */

export type DiscountType = 'percent' | 'fixed';
export type Duration = 'once' | 'repeating' | 'forever';

export interface Terms {
  discount_type: DiscountType;
  discount_value: number;
  duration: Duration;
  duration_months: number | null;
  max_redemptions?: number | null;
  expires_at?: string | null;
  restrict_signup_plan_keys?: string[] | null;
  note?: string | null;
}

export interface PromoCode extends Terms {
  id: string;
  code: string;
  kind: 'campaign' | 'referral';
  owner_tenant_id: string | null;
  currency: string;
  status: 'active' | 'inactive' | 'superseded';
  created_at: string;
  discountText: string;
  durationText: string;
  link: string | null;
  ownerName: string | null;
  ownerSlug: string | null;
  redemptions?: number;
}

export interface Tier {
  id?: string;
  min_active_referrals: number;
  discount_type: DiscountType;
  discount_value: number;
  reward?: string;
}

export interface TenantLite {
  id: string;
  slug: string;
  company_name: string | null;
  status?: string | null;
}

export interface Referral {
  id: string;
  referrer_tenant_id: string;
  referred_tenant_id: string;
  referrer_name_snapshot: string;
  referred_name_snapshot: string;
  source: 'self_serve_checkout' | 'payment_link' | 'manual';
  status: 'active' | 'void';
  referee_discount_applied: boolean;
  attributed_at: string;
  voided_at: string | null;
  void_reason: string | null;
  note: string | null;
  counts: boolean;
}

export interface Claim {
  id: string;
  referrer_tenant_id: string;
  referrerName: string | null;
  claimed_business_name: string;
  claimed_contact: string | null;
  note: string | null;
  status: 'pending' | 'approved' | 'rejected';
  created_at: string;
}

export interface ProgramSettings {
  enabled: boolean;
  default_referee_discount_type: DiscountType;
  default_referee_discount_value: number;
  default_referee_duration: Duration;
  default_referee_duration_months: number | null;
  code_suffix_length: number;
  link_cookie_days: number;
}

/** Call an action; resolves to its JSON, or throws an Error with a readable message. */
export async function promoApi<T = Record<string, unknown>>(action: string, body: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await supabase.functions.invoke<T>('admin-promo-codes', { body: { action, ...body } });
  if (error) {
    let message = error.message || 'Something went wrong';
    try {
      const parsed = await (error as { context?: { json?: () => Promise<{ error?: string }> } }).context?.json?.();
      if (parsed?.error) message = parsed.error;
    } catch {
      // keep the transport message
    }
    throw new Error(message);
  }
  if (data && typeof data === 'object' && 'error' in data && typeof (data as { error?: unknown }).error === 'string') {
    throw new Error((data as { error: string }).error);
  }
  return data as T;
}

export const SOURCE_LABEL: Record<Referral['source'], string> = {
  self_serve_checkout: 'Self-serve signup',
  payment_link: 'Payment link',
  manual: 'Added by hand',
};

/** "$1,234" from cents. */
export function money(cents: number, currency = 'usd'): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: currency.toUpperCase(), maximumFractionDigits: 0 }).format(cents / 100);
}

/** What a set of terms reads as, for previews: "20% off for the first 3 months". */
export function termsPreview(t: Pick<Terms, 'discount_type' | 'discount_value' | 'duration' | 'duration_months'>): string {
  const value = Number(t.discount_value);
  if (!Number.isFinite(value) || value <= 0) return '—';
  const off = t.discount_type === 'percent' ? `${value}% off` : `$${Number.isInteger(value) ? value : value.toFixed(2)} off`;
  if (t.duration === 'once') return `${off} the first bill`;
  if (t.duration === 'forever') return `${off} every bill`;
  const n = t.duration_months ?? 1;
  return `${off} for the first ${n === 1 ? 'month' : `${n} months`}`;
}

/** The tier a count of subscribed referrals earns: the highest reached, never summed. */
export function tierFor(tiers: Tier[], active: number): Tier | null {
  let best: Tier | null = null;
  for (const t of tiers) {
    if (t.min_active_referrals <= active && (!best || t.min_active_referrals > best.min_active_referrals)) best = t;
  }
  return best;
}
