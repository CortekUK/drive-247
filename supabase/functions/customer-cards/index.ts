/**
 * customer-cards — a signed-in CUSTOMER managing their own saved cards from the
 * customer portal's Finances page: list, add (a SetupIntent), make default,
 * remove.
 *
 * WHO IS ASKING comes from the caller's JWT, never from the body: the user is
 * resolved with auth.getUser(), then `customer_users` → `customers` for the
 * tenant named in the body. A body cannot name another customer. (The older
 * `update-payment-method` trusts `body.customerId`; this function does not.)
 *
 * WHERE THE CARDS LIVE: on the tenant's charge account — the same platform
 * account + Connect account + per-account Stripe customer that
 * `update-payment-method` and the booking intents use — so a card added here
 * is the card the tenant's charges and instalments use.
 *
 * Body: { action: 'list' | 'setup' | 'set-default' | 'remove', tenantId, paymentMethodId? }
 *
 * 'set-default' also points the customer's active/overdue instalment plans at
 * the card, as update-payment-method's confirm does. 'remove' refuses the card
 * an active instalment plan collects from: the customer makes another card the
 * default first, so a plan is never left with no card.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';
import { handleCors, jsonResponse, errorResponse } from '../_shared/cors.ts';
import { getPublishableKeyForAccount, getTenantChargeContext } from '../_shared/stripe-client.ts';
import { CUSTOMER_ACCOUNT_COLUMNS, getCustomerIdForAccount, setCustomerIdForAccount } from '../_shared/customer-account.ts';

type Action = 'list' | 'setup' | 'set-default' | 'remove';

interface CardOut {
  id: string;
  brand: string | null;
  last4: string | null;
  expMonth: number | null;
  expYear: number | null;
  name: string | null;
  isDefault: boolean;
}

Deno.serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;
  if (req.method !== 'POST') return errorResponse('POST only', 405);

  try {
    const supabase = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '');

    // ── who is asking ──────────────────────────────────────────────────────
    const jwt = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
    if (!jwt) return errorResponse('Sign in to manage your cards', 401);
    const { data: auth, error: authError } = await supabase.auth.getUser(jwt);
    if (authError || !auth?.user) return errorResponse('Sign in to manage your cards', 401);

    const body = (await req.json().catch(() => ({}))) as { action?: Action; tenantId?: string; paymentMethodId?: string };
    const action = body.action;
    if (!action || !['list', 'setup', 'set-default', 'remove'].includes(action)) return errorResponse('Unknown action');
    if (!body.tenantId) return errorResponse('tenantId is required');

    const { data: links } = await supabase.from('customer_users').select('customer_id').eq('auth_user_id', auth.user.id);
    const ids = (links ?? []).map((l: { customer_id: string }) => l.customer_id).filter(Boolean);
    if (ids.length === 0) return errorResponse('No customer account for this sign-in', 403);

    const { data: customer } = await supabase
      .from('customers')
      .select(`id, email, name, phone, tenant_id, ${CUSTOMER_ACCOUNT_COLUMNS}`)
      .in('id', ids)
      .eq('tenant_id', body.tenantId)
      .maybeSingle();
    if (!customer) return errorResponse('No customer account for this sign-in on this site', 403);

    // ── where the cards live ───────────────────────────────────────────────
    const ctx = await getTenantChargeContext(supabase, body.tenantId);
    const { stripe, stripeOptions, platformAccount, connectAccountId, mode } = ctx;

    let stripeCustomerId = await getCustomerIdForAccount({
      supabase,
      stripe,
      account: platformAccount,
      stripeAccount: connectAccountId,
      customerRowId: customer.id,
      customer,
    });

    // Nothing to list or change without a Stripe customer; 'setup' creates one.
    if (!stripeCustomerId && action !== 'setup') {
      return jsonResponse(action === 'list' ? { cards: [] } : { error: 'No saved cards' }, action === 'list' ? 200 : 404);
    }

    const ownCard = async (paymentMethodId: string | undefined) => {
      if (!paymentMethodId) throw new HttpError('paymentMethodId is required', 400);
      const pm = await stripe.paymentMethods.retrieve(paymentMethodId, stripeOptions);
      if (pm.customer !== stripeCustomerId) {
        console.warn('customer-cards: payment method not on this customer', { action, pmCustomer: pm.customer, stripeCustomerId, connectAccountId });
        throw new HttpError('That card is not on your account', 403);
      }
      return pm;
    };

    const activePlans = async () => {
      const { data } = await supabase
        .from('installment_plans')
        .select('id, stripe_payment_method_id')
        .eq('customer_id', customer.id)
        .eq('tenant_id', body.tenantId)
        .in('status', ['active', 'overdue']);
      return (data ?? []) as { id: string; stripe_payment_method_id: string | null }[];
    };

    if (action === 'list') {
      const [list, stripeCustomer] = await Promise.all([
        stripe.paymentMethods.list({ customer: stripeCustomerId!, type: 'card', limit: 20 }, stripeOptions),
        stripe.customers.retrieve(stripeCustomerId!, stripeOptions),
      ]);
      const rawDefault = 'deleted' in stripeCustomer ? null : stripeCustomer.invoice_settings?.default_payment_method;
      const defaultId = typeof rawDefault === 'string' ? rawDefault : rawDefault?.id ?? null;
      const cards: CardOut[] = list.data.map((pm) => ({
        id: pm.id,
        brand: pm.card?.brand ?? null,
        last4: pm.card?.last4 ?? null,
        expMonth: pm.card?.exp_month ?? null,
        expYear: pm.card?.exp_year ?? null,
        name: pm.billing_details?.name ?? null,
        // No default set but exactly one card: that card is what gets used.
        isDefault: defaultId ? pm.id === defaultId : list.data.length === 1,
      }));
      cards.sort((a, b) => Number(b.isDefault) - Number(a.isDefault));
      return jsonResponse({ cards });
    }

    if (action === 'setup') {
      if (!stripeCustomerId) {
        const created = await stripe.customers.create(
          {
            email: customer.email ?? undefined,
            name: customer.name ?? undefined,
            phone: customer.phone ?? undefined,
            metadata: { drive247_customer_id: customer.id, tenant_id: body.tenantId },
          },
          stripeOptions,
        );
        stripeCustomerId = created.id;
        await setCustomerIdForAccount(supabase, customer.id, platformAccount, stripeCustomerId);
      }
      const intent = await stripe.setupIntents.create(
        {
          customer: stripeCustomerId,
          payment_method_types: ['card'],
          usage: 'off_session',
          metadata: { customer_id: customer.id, tenant_id: body.tenantId, purpose: 'customer_portal_add_card' },
        },
        stripeOptions,
      );
      return jsonResponse({
        clientSecret: intent.client_secret,
        // Elements must be mounted on the same account the SetupIntent is on.
        publishableKey: getPublishableKeyForAccount(platformAccount, mode),
        connectAccountId,
      });
    }

    if (action === 'set-default') {
      const pm = await ownCard(body.paymentMethodId);
      await stripe.customers.update(stripeCustomerId!, { invoice_settings: { default_payment_method: pm.id } }, stripeOptions);
      const plans = await activePlans();
      if (plans.length > 0) {
        await supabase
          .from('installment_plans')
          .update({ stripe_payment_method_id: pm.id, updated_at: new Date().toISOString() })
          .in('id', plans.map((p) => p.id));
      }
      return jsonResponse({ success: true, plansUpdated: plans.length });
    }

    // remove
    const pm = await ownCard(body.paymentMethodId);
    const plans = await activePlans();
    if (plans.some((p) => p.stripe_payment_method_id === pm.id)) {
      return errorResponse('Your instalment plan collects from this card. Make another card the default first, then remove this one.', 409);
    }
    await stripe.paymentMethods.detach(pm.id, stripeOptions);
    return jsonResponse({ success: true });
  } catch (err) {
    if (err instanceof HttpError) return errorResponse(err.message, err.status);
    console.error('customer-cards failed:', err);
    return errorResponse(err instanceof Error ? err.message : 'Something went wrong', 500);
  }
});

class HttpError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}
