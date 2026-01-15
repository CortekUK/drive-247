// Shared Stripe client helper for per-tenant mode support
// This module provides functions to get the correct Stripe client and keys based on tenant's mode

import Stripe from 'https://esm.sh/stripe@14.21.0?target=deno'
import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0'

export type StripeMode = 'test' | 'live';

/**
 * Get Stripe client initialized with the correct API key for the given mode
 */
export function getStripeClient(mode: StripeMode): Stripe {
  const secretKey = mode === 'live'
    ? Deno.env.get('STRIPE_LIVE_SECRET_KEY')
    : Deno.env.get('STRIPE_TEST_SECRET_KEY');

  if (!secretKey) {
    throw new Error(`Missing Stripe secret key for ${mode} mode`);
  }

  return new Stripe(secretKey, {
    apiVersion: '2024-11-20.acacia',
    httpClient: Stripe.createFetchHttpClient(),
  });
}

/**
 * Get publishable key for the given mode
 */
export function getPublishableKey(mode: StripeMode): string {
  const key = mode === 'live'
    ? Deno.env.get('STRIPE_LIVE_PUBLISHABLE_KEY')
    : Deno.env.get('STRIPE_TEST_PUBLISHABLE_KEY');

  if (!key) {
    throw new Error(`Missing Stripe publishable key for ${mode} mode`);
  }

  return key;
}

/**
 * Get webhook secret for the given mode
 */
export function getWebhookSecret(mode: StripeMode): string {
  const secret = mode === 'live'
    ? Deno.env.get('STRIPE_LIVE_WEBHOOK_SECRET')
    : Deno.env.get('STRIPE_TEST_WEBHOOK_SECRET');

  if (!secret) {
    throw new Error(`Missing Stripe webhook secret for ${mode} mode`);
  }

  return secret;
}

/**
 * Get Connect webhook secret (live mode only)
 */
export function getConnectWebhookSecret(): string {
  const secret = Deno.env.get('STRIPE_CONNECT_WEBHOOK_SECRET');

  if (!secret) {
    throw new Error('Missing Stripe Connect webhook secret');
  }

  return secret;
}

/**
 * Get tenant's Stripe mode from database
 */
export async function getTenantStripeMode(
  supabase: SupabaseClient,
  tenantId: string
): Promise<StripeMode> {
  const { data, error } = await supabase
    .from('tenants')
    .select('stripe_mode')
    .eq('id', tenantId)
    .single();

  if (error || !data) {
    console.error('Failed to get tenant stripe mode, defaulting to test:', error);
    return 'test'; // Safe default
  }

  return (data.stripe_mode as StripeMode) || 'test';
}

/**
 * Get the appropriate Stripe Connect account ID for a tenant
 * - In test mode: Returns shared test Connect account
 * - In live mode: Returns tenant's own Connect account (if onboarding complete)
 */
export function getConnectAccountId(tenant: {
  stripe_mode: string;
  stripe_account_id: string | null;
  stripe_onboarding_complete: boolean | null;
}): string | null {
  if (tenant.stripe_mode === 'test') {
    // All test tenants use the shared test Connect account
    return Deno.env.get('STRIPE_TEST_CONNECT_ACCOUNT_ID') || null;
  }

  if (tenant.stripe_mode === 'live' && tenant.stripe_onboarding_complete) {
    // Live tenants use their own Connect account
    return tenant.stripe_account_id;
  }

  return null; // No routing - payment goes to platform
}

/**
 * Create Stripe options object for API calls targeting connected accounts
 */
export function getStripeOptions(connectAccountId: string | null): Stripe.RequestOptions | undefined {
  return connectAccountId ? { stripeAccount: connectAccountId } : undefined;
}
