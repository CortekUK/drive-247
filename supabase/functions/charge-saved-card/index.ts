// charge-saved-card
//
// Operator-initiated, off-session charge of the card already on file for a
// rental. Until now the portal could only ever EMAIL a payment link (the button
// labelled "Charge via Stripe" opens a Checkout URL — it does not charge), so
// there was no way to collect an amount the renter had already agreed to — an
// extension, an agreed shortfall — without waiting on them to click a link.
//
// SCOPE LIMIT until W5 ships: this is for amounts the renter has ALREADY agreed
// to pay. Damage and cleaning recovery on a card on file needs the renter's
// express permission obtained AFTER the damage (CA Civ. Code §1939.15(a), NY GBL
// §396-z(7)); the stored-credential mandate that captures and proves that
// permission is W5 and does not exist yet. See the TODO at the charge step — the
// UI copy currently carries this, and copy is not a control.
//
// Shape is cloned from process-installment-payment/index.ts (the reference
// off-session charge already in production):
//   paymentIntents.create({ amount, currency, customer, payment_method,
//                           off_session: true, confirm: true })
//
// Non-obvious rules this function has to honour:
//
//  * RECORD-ANCHORED PLATFORM. During the UK->UAE migration two platform Stripe
//    accounts coexist. The saved Customer/PaymentMethod live on the account the
//    RENTAL was created under (rentals.platform_account), NOT on whatever
//    tenants.payment_model says today. Resolving from the tenant's current model
//    after a flip produces "No such customer" on every charge.
//
//  * validateStripeCustomerId. A stored customer id minted in test mode does not
//    exist on the live Connect account. place-deposit-hold skips this check;
//    that is how the Kedic go-live incident happened (12 blind retries against a
//    stale id). We validate first and fail with a distinct code instead of
//    charging into the dark.
//
//  * FAIL SAFE, NEVER OPEN. Every pre-flight problem (no card, wrong tenant, no
//    connected account in live mode) returns before any money moves. After a
//    successful charge we never delete or roll back the payments row — a row
//    backed by a real Stripe charge must survive even if allocation fails, or
//    the money becomes invisible.
//
//  * authentication_required gets its OWN code. An off-session charge that the
//    issuer wants SCA on is not a failure the operator should read as "declined"
//    — the correct next step is emailing a link so the customer can authenticate.
//    The UI branches on this code.
//
//  * Settlement is apply-payment's job, not ours. apply-payment already runs
//    FIFO allocation, PAYG settle, installment self-heal and auto-extend
//    finalize. We insert the payments row exactly as the manual Record-Payment
//    path does and hand off, so this path settles identically. Calling the
//    settle RPCs here as well would double-settle against the portal callers
//    that settle on the 'recorded' callback.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';
import { handleCors, jsonResponse } from '../_shared/cors.ts';
import {
  getConnectAccountId,
  getStripeClientForRecord,
  TENANT_STRIPE_COLUMNS,
  type StripeMode,
} from '../_shared/stripe-client.ts';
import { getCustomerIdForAccount, CUSTOMER_ACCOUNT_COLUMNS } from '../_shared/customer-account.ts';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CLIENT_REQUEST_ID_RE = /^[A-Za-z0-9_-]{8,64}$/;

/** Roles allowed to move money on a saved card without the customer present. */
const FULL_ACCESS_ROLES = new Set(['head_admin', 'admin']);

/** Sanity ceiling in major units. A fat-fingered amount is not a business case. */
const MAX_CHARGE_MAJOR_UNITS = 100_000;

const MIN_REASON_LENGTH = 5;
const MAX_REASON_LENGTH = 500;

/**
 * Window in which an identical amount on the same rental is treated as a likely
 * duplicate. Backstop behind the client's derived idempotency key: the key stops
 * a REPLAY of one request, this stops two genuinely distinct requests (two
 * operators, two tabs, a reload that lost the key) collecting the same money
 * twice. Requires an explicit `confirmDuplicate` to proceed.
 */
const DUPLICATE_WINDOW_MS = 10 * 60 * 1000;

/**
 * Stripe expects ZERO-decimal currencies in whole units: 1000 JPY is
 * `amount: 1000`, not 100000. Multiplying by 100 the way every two-decimal path
 * does would charge 100x. Every other money path in this repo is fed by a
 * webhook or a stored figure; this is the first where an operator types the
 * number, so it gets the check.
 * https://docs.stripe.com/currencies#zero-decimal
 */
const ZERO_DECIMAL_CURRENCIES = new Set([
  'bif', 'clp', 'djf', 'gnf', 'jpy', 'kmf', 'krw', 'mga',
  'pyg', 'rwf', 'ugx', 'vnd', 'vuv', 'xaf', 'xof', 'xpf',
]);

/**
 * Three-decimal currencies must additionally be a multiple of 10 in minor units.
 * Rather than encode that rule for a case no tenant currently bills in, we
 * refuse outright — a rejected charge is recoverable, a 10x one is not.
 */
const THREE_DECIMAL_CURRENCIES = new Set(['bhd', 'jod', 'kwd', 'omr', 'tnd']);

/** Structured failure. `code` is load-bearing — the UI branches on it. */
function fail(
  code: string,
  message: string,
  status: number,
  extra: Record<string, unknown> = {},
): Response {
  return jsonResponse({ success: false, error: message, code, ...extra }, status);
}

function asString(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}

/** Stripe puts the useful code in different places depending on how it threw. */
function stripeErrorCode(err: unknown): string | null {
  const e = err as { code?: string; decline_code?: string; type?: string; raw?: { code?: string; decline_code?: string } };
  return e?.code ?? e?.raw?.code ?? e?.decline_code ?? e?.raw?.decline_code ?? e?.type ?? null;
}

function stripeDeclineCode(err: unknown): string | null {
  const e = err as { decline_code?: string; raw?: { decline_code?: string } };
  return e?.decline_code ?? e?.raw?.decline_code ?? null;
}

Deno.serve(async (req) => {
  const preflight = handleCors(req);
  if (preflight) return preflight;

  if (req.method !== 'POST') {
    return fail('method_not_allowed', 'POST required', 405);
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
  if (!supabaseUrl || !serviceRoleKey || !anonKey) {
    console.error('[CHARGE-CARD] Missing Supabase environment configuration');
    return fail('server_misconfigured', 'Server is not configured for card charges', 500);
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey);

  // ---------------------------------------------------------------------
  // 1. Who is asking?
  // ---------------------------------------------------------------------
  const authHeader = req.headers.get('Authorization') ?? req.headers.get('authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return fail('unauthorized', 'Sign in to charge a saved card', 401);
  }

  const callerClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });

  const { data: authData, error: authError } = await callerClient.auth.getUser();
  const authUser = authData?.user;
  if (authError || !authUser) {
    return fail('unauthorized', 'Invalid session', 401);
  }

  const { data: appUser, error: appUserError } = await supabase
    .from('app_users')
    .select('id, role, is_active, tenant_id, is_super_admin, name, email')
    .eq('auth_user_id', authUser.id)
    .maybeSingle();

  if (appUserError || !appUser) {
    return fail('forbidden', 'No portal profile for this account', 403);
  }
  if (!appUser.is_active) {
    return fail('forbidden', 'This account is deactivated', 403);
  }

  const isSuperAdmin = appUser.is_super_admin === true;
  let allowed = isSuperAdmin || FULL_ACCESS_ROLES.has(appUser.role);

  // A manager is only allowed when they have been explicitly granted EDITOR on
  // the payments tab. An unscoped manager (and every viewer/ops user) is denied.
  if (!allowed && appUser.role === 'manager') {
    const { data: perm } = await supabase
      .from('manager_permissions')
      .select('access_level')
      .eq('app_user_id', appUser.id)
      .eq('tab_key', 'payments')
      .maybeSingle();
    allowed = perm?.access_level === 'editor';
  }

  if (!allowed) {
    return fail('forbidden', 'Your role cannot charge a saved card', 403);
  }

  // ---------------------------------------------------------------------
  // 2. Validate the request before touching Stripe
  // ---------------------------------------------------------------------
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return fail('invalid_body', 'Invalid JSON body', 400);
  }

  const rentalId = asString(body.rentalId);
  if (!rentalId || !UUID_RE.test(rentalId)) {
    return fail('invalid_rental', 'A valid rentalId is required', 400);
  }

  const clientRequestId = asString(body.clientRequestId);
  if (!clientRequestId || !CLIENT_REQUEST_ID_RE.test(clientRequestId)) {
    // The idempotency key is what stops a double-click or a retried request
    // becoming two charges. Refuse rather than mint one server-side.
    return fail('invalid_request_id', 'A clientRequestId is required', 400);
  }

  const rawAmount = Number(body.amount);
  if (!Number.isFinite(rawAmount) || rawAmount <= 0) {
    return fail('invalid_amount', 'Amount must be greater than 0', 400);
  }
  if (rawAmount > MAX_CHARGE_MAJOR_UNITS) {
    return fail('invalid_amount', `Amount exceeds the ${MAX_CHARGE_MAJOR_UNITS} per-charge limit`, 400);
  }
  // Rounding to minor units needs the tenant's currency, which is fetched below.
  // See `amount` / `amountInMinorUnits` after the tenant lookup.

  const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
  if (reason.length < MIN_REASON_LENGTH) {
    return fail('reason_required', 'Enter a reason for charging this card', 400);
  }
  if (reason.length > MAX_REASON_LENGTH) {
    return fail('reason_too_long', `Reason must be ${MAX_REASON_LENGTH} characters or fewer`, 400);
  }

  // Operator has looked at the matching recent payment we surfaced and said
  // "charge again anyway". Only an explicit true gets past the duplicate guard.
  const confirmDuplicate = body.confirmDuplicate === true;

  const targetCategories = Array.isArray(body.targetCategories)
    ? (body.targetCategories as unknown[]).filter((c): c is string => typeof c === 'string' && !!c.trim())
    : [];
  const extensionId = asString(body.extensionId);
  if (extensionId && !UUID_RE.test(extensionId)) {
    return fail('invalid_extension', 'extensionId is not a valid id', 400);
  }
  const placeDepositHoldAfter = body.placeDepositHoldAfter === true;

  // ---------------------------------------------------------------------
  // 3. Rental + tenant scoping
  // ---------------------------------------------------------------------
  const { data: rental, error: rentalError } = await supabase
    .from('rentals')
    .select('id, tenant_id, customer_id, vehicle_id, platform_account')
    .eq('id', rentalId)
    .maybeSingle();

  if (rentalError || !rental) {
    return fail('rental_not_found', 'Rental not found', 404);
  }
  if (!rental.tenant_id || !rental.customer_id) {
    return fail('rental_incomplete', 'Rental is missing its tenant or customer', 400);
  }
  // Tenant isolation: a non-super-admin may only charge inside their own tenant.
  if (!isSuperAdmin && appUser.tenant_id !== rental.tenant_id) {
    return fail('forbidden', 'This rental belongs to another tenant', 403);
  }

  const { data: tenant, error: tenantError } = await supabase
    .from('tenants')
    .select(`${TENANT_STRIPE_COLUMNS}, currency_code, payment_provider`)
    .eq('id', rental.tenant_id)
    .maybeSingle();

  if (tenantError || !tenant) {
    return fail('tenant_not_found', 'Tenant not found', 404);
  }

  const tenantRow = tenant as Record<string, any>;

  // Square cannot vault a card from a hosted payment link — it has no
  // SetupIntent equivalent — so there is no stored credential to charge and no
  // authorisation to place. This is designed out for Square, not merely
  // unbuilt: these features are forced off at tenant creation and rendered
  // disabled in the portal.
  //
  // A SKIP, not a throw. The same reasoning place-deposit-hold gives applies:
  // several callers reach these paths, and turning a deliberately-absent
  // feature into a 500 pages someone for working-as-designed behaviour.
  if (tenantRow.payment_provider === 'square') {
    console.log('[charge-saved-card] tenant is on Square — no saved card to charge.');
    return jsonResponse({
      success: true,
      skipped: true,
      reason: 'square_tenant',
      message: 'This tenant processes payments through Square, which cannot store a card for later use. Collect this payment with a payment link instead.',
    });
  }

  const stripeMode: StripeMode = (tenantRow.stripe_mode as StripeMode) || 'test';
  const platformAccount: 'uk' | 'uae' = rental.platform_account === 'uae' ? 'uae' : 'uk';
  const currency = String(tenantRow.currency_code || 'USD').toLowerCase();

  // Minor units are currency-dependent. Getting this wrong charges 100x, so we
  // handle the two-decimal and zero-decimal cases explicitly and refuse anything
  // whose rule we have not encoded, rather than assuming cents.
  if (THREE_DECIMAL_CURRENCIES.has(currency)) {
    return fail(
      'currency_unsupported',
      `Direct card charges are not supported in ${currency.toUpperCase()} yet. Send a payment link instead.`,
      400,
    );
  }
  const isZeroDecimal = ZERO_DECIMAL_CURRENCIES.has(currency);
  // A zero-decimal currency has no sub-unit: 1200.5 JPY is not a thing, and
  // silently rounding an operator's typed figure changes what they confirmed.
  if (isZeroDecimal && !Number.isInteger(rawAmount)) {
    return fail(
      'invalid_amount',
      `${currency.toUpperCase()} has no decimal sub-unit — enter a whole number.`,
      400,
    );
  }
  const amount = isZeroDecimal ? Math.round(rawAmount) : Math.round(rawAmount * 100) / 100;
  const amountInMinorUnits = isZeroDecimal ? amount : Math.round(amount * 100);

  let stripe!: ReturnType<typeof getStripeClientForRecord>;
  let connectAccountId: string | null = null;
  try {
    // RECORD-ANCHORED: keys + connected account of the platform this rental's
    // Stripe objects actually live on, never the tenant's current payment_model.
    stripe = getStripeClientForRecord(rental, stripeMode);
    connectAccountId = getConnectAccountId({
      ...tenantRow,
      payment_model: platformAccount === 'uae' ? 'own' : 'managed',
    });
  } catch (err) {
    console.error('[CHARGE-CARD] Stripe context resolution failed:', err);
    return fail(
      'stripe_context_unavailable',
      err instanceof Error ? err.message : 'Could not resolve Stripe account for this rental',
      400,
    );
  }

  // A live charge with no connected account lands on the Drive247 platform
  // balance instead of the operator's. Refuse rather than misroute real money.
  if (stripeMode === 'live' && !connectAccountId) {
    return fail(
      'connect_account_missing',
      'This tenant has no connected Stripe account for live charges. Finish Stripe onboarding first.',
      400,
    );
  }
  const stripeOptions = connectAccountId ? { stripeAccount: connectAccountId } : undefined;

  // ---------------------------------------------------------------------
  // 4. Resolve the saved card
  // ---------------------------------------------------------------------
  const { data: customer, error: customerError } = await supabase
    .from('customers')
    .select(`id, name, email, ${CUSTOMER_ACCOUNT_COLUMNS}`)
    .eq('id', rental.customer_id)
    .maybeSingle();

  if (customerError || !customer) {
    return fail('customer_not_found', 'Customer not found', 404);
  }

  let stripeCustomerId: string | null;
  try {
    // RECORD-ANCHORED customer id: resolved for the platform account this rental
    // lives on (platformAccount), validated against the account+mode we are about
    // to charge on. A test-era or wrong-account id would otherwise fail with
    // "No such customer" forever. Per-account column so a UAE re-mint elsewhere
    // can never have clobbered this rental's UK customer id.
    stripeCustomerId = await getCustomerIdForAccount({
      supabase,
      stripe,
      account: platformAccount,
      stripeAccount: connectAccountId,
      customerRowId: customer.id,
      customer,
    });
  } catch (err) {
    console.error('[CHARGE-CARD] Stripe customer lookup failed:', err);
    return fail('stripe_unavailable', 'Could not reach Stripe to verify the saved card', 502);
  }

  if (!stripeCustomerId) {
    return fail(
      'no_card_on_file',
      'No usable saved card for this customer. Send a payment link instead.',
      400,
    );
  }

  let paymentMethodId = '';
  let card: { brand?: string; last4?: string; exp_month?: number; exp_year?: number; funding?: string } | null = null;
  try {
    // Same resolution order place-deposit-hold uses: the customer's default
    // payment method, else their most recent card.
    const stripeCustomer: any = await stripe.customers.retrieve(
      stripeCustomerId,
      { expand: ['invoice_settings.default_payment_method'] },
      stripeOptions,
    );
    if (stripeCustomer?.deleted) {
      return fail('no_card_on_file', 'The saved Stripe customer has been deleted. Send a payment link instead.', 400);
    }

    const defaultPm = stripeCustomer?.invoice_settings?.default_payment_method;
    let pm: any = defaultPm && typeof defaultPm === 'object' ? defaultPm : null;

    if (!pm?.id) {
      const list = await stripe.paymentMethods.list(
        { customer: stripeCustomerId, type: 'card', limit: 1 },
        stripeOptions,
      );
      pm = list.data.length > 0 ? list.data[0] : null;
    }

    if (!pm?.id) {
      return fail('no_card_on_file', 'No saved card on this customer. Send a payment link instead.', 400);
    }

    paymentMethodId = pm.id as string;
    card = (pm.card ?? null) as typeof card;
  } catch (err) {
    console.error('[CHARGE-CARD] Payment method lookup failed:', err);
    return fail('stripe_unavailable', 'Could not read the saved card from Stripe', 502);
  }

  console.log(
    `[CHARGE-CARD] rental=${rentalId} tenant=${rental.tenant_id} platform=${platformAccount} mode=${stripeMode} ` +
    `connect=${connectAccountId ?? 'none'} amount=${amount}${currency.toUpperCase()} pm=${paymentMethodId} ` +
    `card=${card ? `${card.brand} ••${card.last4} funding=${card.funding}` : 'unknown'} actor=${appUser.id}`,
  );

  const auditBase = {
    rental_id: rentalId,
    customer_id: rental.customer_id,
    amount,
    currency: currency.toUpperCase(),
    reason,
    platform_account: platformAccount,
    stripe_mode: stripeMode,
    connect_account_id: connectAccountId,
    payment_method_id: paymentMethodId,
    card_brand: card?.brand ?? null,
    card_last4: card?.last4 ?? null,
    client_request_id: clientRequestId,
    // Load-bearing for after-the-fact review: this is the operator overriding a
    // duplicate warning, which is the one way two identical charges get through.
    confirm_duplicate: confirmDuplicate,
    actor_role: appUser.role,
    actor_name: (appUser as Record<string, any>).name ?? null,
    actor_email: (appUser as Record<string, any>).email ?? null,
    ...(targetCategories.length > 0 ? { target_categories: targetCategories } : {}),
    ...(extensionId ? { extension_id: extensionId } : {}),
  };

  const writeAudit = async (action: string, entityId: string | null, details: Record<string, unknown>) => {
    const { error } = await supabase.from('audit_logs').insert({
      action,
      actor_id: appUser.id,
      entity_type: 'payment',
      entity_id: entityId,
      details,
      tenant_id: rental.tenant_id,
      is_super_admin_action: isSuperAdmin,
    });
    if (error) console.error('[CHARGE-CARD] audit log insert failed:', error.message);
  };

  // ---------------------------------------------------------------------
  // 4b. Duplicate backstop
  // ---------------------------------------------------------------------
  // The client's idempotency key is derived from the charge intent, so a REPLAY
  // of one request can never charge twice. It cannot help across two genuinely
  // distinct requests — two operators on the same rental, two browser tabs, a
  // reload — and that is the shape of the RevTek R-1ac41d duplicate the manual
  // Record-Payment path already guards against with a confirm prompt. Same guard
  // here, tighter window, and it must be answered before any money moves.
  if (!confirmDuplicate) {
    const sinceIso = new Date(Date.now() - DUPLICATE_WINDOW_MS).toISOString();
    const { data: recentMatches, error: dupError } = await supabase
      .from('payments')
      .select('id, amount, payment_date, created_at, method, status, booking_source')
      .eq('rental_id', rentalId)
      .eq('amount', amount)
      .neq('status', 'Cancelled')
      .gte('created_at', sinceIso)
      .order('created_at', { ascending: false })
      .limit(1);

    if (dupError) {
      // We could not prove this ISN'T a duplicate. Fail safe: refuse and let the
      // operator look, rather than charge on an unverified assumption.
      console.error('[CHARGE-CARD] duplicate check failed:', dupError.message);
      return fail(
        'duplicate_check_failed',
        'Could not check this rental for a recent matching payment. Check the rental payments, then try again.',
        503,
      );
    }

    if (recentMatches && recentMatches.length > 0) {
      const m = recentMatches[0] as Record<string, any>;
      console.warn(`[CHARGE-CARD] possible duplicate rental=${rentalId} amount=${amount} existing=${m.id}`);
      return fail(
        'possible_duplicate',
        `A payment of ${amount} ${currency.toUpperCase()} was already recorded on this rental in the last ` +
        `${Math.round(DUPLICATE_WINDOW_MS / 60000)} minutes. Nothing has been charged.`,
        409,
        {
          existingPayment: {
            id: m.id,
            amount: m.amount,
            paymentDate: m.payment_date ?? null,
            createdAt: m.created_at ?? null,
            method: m.method ?? null,
            bookingSource: m.booking_source ?? null,
          },
        },
      );
    }
  }

  // ---------------------------------------------------------------------
  // 5. Charge
  // ---------------------------------------------------------------------
  // TODO(W5 — stored-credential mandate): before charging, look up the rental's
  // `rental_card_mandates` row and refuse when the charge is damage/cleaning
  // recovery without a mandate captured AFTER the damage (CA Civ. Code
  // §1939.15(a), NY GBL §396-z(7) both require express permission granted after
  // the fact). Until that table and its capture flow exist, the only control is
  // the confirm-dialog copy in add-payment-dialog.tsx telling operators to get
  // written permission first — copy is not a control, so this hook is the fix.
  const idempotencyKey = `charge-saved-card-${rentalId}-${clientRequestId}`;
  let paymentIntent: { id: string; status: string };
  try {
    paymentIntent = await stripe.paymentIntents.create(
      {
        amount: amountInMinorUnits,
        currency,
        customer: stripeCustomerId,
        payment_method: paymentMethodId,
        off_session: true,
        confirm: true,
        description: `Operator charge — ${reason}`.slice(0, 350),
        metadata: {
          type: 'charge_saved_card',
          rental_id: rentalId,
          customer_id: rental.customer_id,
          tenant_id: rental.tenant_id,
          actor_app_user_id: appUser.id,
          client_request_id: clientRequestId,
          reason: reason.slice(0, 480),
          ...(targetCategories.length > 0 ? { target_categories: JSON.stringify(targetCategories).slice(0, 480) } : {}),
          ...(extensionId ? { extension_id: extensionId } : {}),
        },
      },
      { ...(stripeOptions ?? {}), idempotencyKey },
    );
  } catch (err) {
    const code = stripeErrorCode(err);
    const declineCode = stripeDeclineCode(err);
    const message = err instanceof Error ? err.message : 'Card charge failed';
    console.error(`[CHARGE-CARD] charge failed rental=${rentalId} code=${code} decline=${declineCode}: ${message}`);

    await writeAudit('payment_charge_saved_card_failed', null, {
      ...auditBase,
      outcome: 'failed',
      stripe_error_code: code,
      stripe_decline_code: declineCode,
      stripe_error_message: message,
    });

    // SCA is not a decline. The card is fine; the issuer wants the cardholder
    // present. A DISTINCT code lets the UI offer "email a payment link" rather
    // than reporting a generic failure the operator can only retry blindly.
    if (code === 'authentication_required') {
      return fail(
        'authentication_required',
        'This card needs the customer to authenticate (3-D Secure). Send them a payment link instead.',
        402,
        { canFallbackToPaymentLink: true },
      );
    }

    return fail('charge_failed', message, 402, {
      stripeErrorCode: code,
      stripeDeclineCode: declineCode,
    });
  }

  if (paymentIntent.status === 'requires_action' || paymentIntent.status === 'requires_confirmation') {
    console.warn(`[CHARGE-CARD] PaymentIntent ${paymentIntent.id} needs authentication (status=${paymentIntent.status})`);
    await writeAudit('payment_charge_saved_card_failed', null, {
      ...auditBase,
      outcome: 'requires_action',
      payment_intent_id: paymentIntent.id,
      payment_intent_status: paymentIntent.status,
    });
    return fail(
      'authentication_required',
      'This card needs the customer to authenticate (3-D Secure). Send them a payment link instead.',
      402,
      { canFallbackToPaymentLink: true, paymentIntentId: paymentIntent.id },
    );
  }

  if (paymentIntent.status !== 'succeeded') {
    console.error(`[CHARGE-CARD] PaymentIntent ${paymentIntent.id} landed in status ${paymentIntent.status}`);
    await writeAudit('payment_charge_saved_card_failed', null, {
      ...auditBase,
      outcome: 'not_succeeded',
      payment_intent_id: paymentIntent.id,
      payment_intent_status: paymentIntent.status,
    });
    return fail('charge_not_succeeded', `Stripe returned status "${paymentIntent.status}"`, 402, {
      paymentIntentId: paymentIntent.id,
      paymentIntentStatus: paymentIntent.status,
    });
  }

  // ---------------------------------------------------------------------
  // 6. Record it. From here on the money HAS moved — never roll back.
  // ---------------------------------------------------------------------
  // Replay guard: an idempotent retry returns the SAME PaymentIntent, so a row
  // may already exist. Recording it twice would double-count revenue.
  const { data: existingRows, error: existingError } = await supabase
    .from('payments')
    .select('id')
    .eq('stripe_payment_intent_id', paymentIntent.id)
    .limit(1);

  if (existingError) {
    // We cannot prove this charge is unrecorded, so we must not insert a row
    // that might be its duplicate. Surface it instead of guessing.
    console.error(`[CHARGE-CARD] replay lookup failed for pi=${paymentIntent.id}:`, existingError.message);
    await writeAudit('payment_charge_saved_card_unrecorded', null, {
      ...auditBase,
      outcome: 'replay_check_failed',
      payment_intent_id: paymentIntent.id,
      db_error: existingError.message,
    });
    return fail(
      'charged_but_not_recorded',
      `The card was charged ${amount} ${currency.toUpperCase()} but we could not verify whether it was already recorded. ` +
      `Do not retry — check Stripe PaymentIntent ${paymentIntent.id} before recording anything.`,
      500,
      { paymentIntentId: paymentIntent.id, amount },
    );
  }

  const existingPayment = existingRows && existingRows.length > 0 ? existingRows[0] : null;

  if (existingPayment) {
    console.log(`[CHARGE-CARD] PaymentIntent ${paymentIntent.id} already recorded as payment ${existingPayment.id}`);
    return jsonResponse({
      success: true,
      alreadyRecorded: true,
      paymentId: existingPayment.id,
      paymentIntentId: paymentIntent.id,
      amount,
      currency: currency.toUpperCase(),
      card: card ? { brand: card.brand ?? null, last4: card.last4 ?? null } : null,
      warnings: [],
    });
  }

  const today = new Date().toISOString().split('T')[0];
  const { data: payment, error: paymentError } = await supabase
    .from('payments')
    .insert({
      rental_id: rentalId,
      customer_id: rental.customer_id,
      vehicle_id: rental.vehicle_id,
      tenant_id: rental.tenant_id,
      amount,
      payment_date: today,
      method: 'Card',
      payment_type: 'Payment',
      status: 'Completed',
      remaining_amount: amount,
      verification_status: 'approved',
      stripe_payment_intent_id: paymentIntent.id,
      capture_status: 'captured',
      paid_at: new Date().toISOString(),
      platform_account: platformAccount,
      booking_source: 'admin',
      ...(targetCategories.length > 0 ? { target_categories: targetCategories } : {}),
      ...(extensionId ? { extension_id: extensionId } : {}),
    })
    .select('id')
    .single();

  if (paymentError || !payment) {
    // Worst case in the whole function: Stripe took the money and we could not
    // write the row. Shout — do NOT refund silently and do NOT report success.
    console.error(
      `[CHARGE-CARD] CRITICAL charged_but_not_recorded rental=${rentalId} pi=${paymentIntent.id} ` +
      `amount=${amount}: ${paymentError?.message}`,
    );
    await writeAudit('payment_charge_saved_card_unrecorded', null, {
      ...auditBase,
      outcome: 'charged_but_not_recorded',
      payment_intent_id: paymentIntent.id,
      db_error: paymentError?.message ?? 'unknown',
    });
    return fail(
      'charged_but_not_recorded',
      `The card was charged ${amount} ${currency.toUpperCase()} but the payment could not be saved. ` +
      `Do not retry — record it manually against Stripe PaymentIntent ${paymentIntent.id}.`,
      500,
      { paymentIntentId: paymentIntent.id, amount },
    );
  }

  const warnings: string[] = [];

  // Allocation, PAYG settle, installment self-heal and auto-extend finalize all
  // live inside apply-payment — the same call the manual Record-Payment path
  // makes. A failure here leaves an unallocated (but recorded) payment, which is
  // recoverable; it must never delete the row.
  try {
    const { data: applyResult, error: applyError } = await supabase.functions.invoke('apply-payment', {
      body: {
        paymentId: payment.id,
        ...(targetCategories.length > 0 ? { targetCategories } : {}),
      },
    });
    if (applyError) {
      console.error('[CHARGE-CARD] apply-payment error:', applyError);
      warnings.push('Payment was charged and recorded, but allocation to the ledger failed. Open the rental and re-apply.');
    } else if (applyResult && applyResult.ok === false) {
      console.error('[CHARGE-CARD] apply-payment refused:', applyResult);
      warnings.push(`Payment was charged and recorded, but allocation failed: ${applyResult.error ?? 'unknown reason'}`);
    } else {
      console.log('[CHARGE-CARD] apply-payment result:', applyResult?.status, 'allocated:', applyResult?.allocated);
    }
  } catch (err) {
    console.error('[CHARGE-CARD] apply-payment threw:', err);
    warnings.push('Payment was charged and recorded, but allocation to the ledger failed. Open the rental and re-apply.');
  }

  await writeAudit('payment_charged_saved_card', payment.id, {
    ...auditBase,
    outcome: 'succeeded',
    payment_id: payment.id,
    payment_intent_id: paymentIntent.id,
  });

  // Optional deposit hold on the same card, mirroring what the Stripe Checkout
  // webhook does after a rental payment captures. Non-fatal: the charge above is
  // already money in the bank, and the hold can be placed from the rental page.
  // We deliberately do not write deposit_hold_* here — that state machine is
  // owned by place-deposit-hold.
  if (placeDepositHoldAfter) {
    try {
      const holdResponse = await fetch(`${supabaseUrl}/functions/v1/place-deposit-hold`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${serviceRoleKey}`,
        },
        body: JSON.stringify({ rentalId }),
      });
      const holdResult = await holdResponse.json().catch(() => ({}));
      if (!holdResponse.ok) {
        console.error('[CHARGE-CARD] place-deposit-hold failed:', holdResult?.error ?? holdResponse.statusText);
        warnings.push('The deposit hold could not be placed. Use "Place Pre-Auth Hold" on the rental page.');
      } else {
        console.log('[CHARGE-CARD] place-deposit-hold:', JSON.stringify(holdResult).slice(0, 300));
      }
    } catch (err) {
      console.error('[CHARGE-CARD] place-deposit-hold threw:', err);
      warnings.push('The deposit hold could not be placed. Use "Place Pre-Auth Hold" on the rental page.');
    }
  }

  return jsonResponse({
    success: true,
    paymentId: payment.id,
    paymentIntentId: paymentIntent.id,
    amount,
    currency: currency.toUpperCase(),
    card: card ? { brand: card.brand ?? null, last4: card.last4 ?? null } : null,
    warnings,
  });
});
