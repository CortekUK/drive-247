import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4'
import { getConnectAccountId, getChargePlatformAccount, getStripeClientForAccount, type StripeMode, type PlatformAccount } from '../_shared/stripe-client.ts'
import { formatCurrency } from '../_shared/format-utils.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-requested-with, x-tenant-slug',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS, PUT, DELETE',
  'Access-Control-Max-Age': '86400',
}

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders, status: 200 })
  }

  try {
    const { bookingId, rentalId, customerEmail, customerName, customerId, totalAmount, tenantSlug, tenantId: bodyTenantId, bonzahPolicyId, successUrl, cancelUrl, targetCategories, extensionId, source, paygAccrualId, installmentId, placeDepositHoldAfter, holdAsCredit } = await req.json()

    // Get tenant slug from header or body
    const slug = tenantSlug || req.headers.get('x-tenant-slug')

    const origin = req.headers.get('origin') || 'http://localhost:5173'

    // Support both bookingId (legacy) and rentalId (portal integration)
    const referenceId = rentalId || bookingId

    // Initialize Supabase client to fetch tenant info
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    // Fetch tenant details for customization
    let tenantId: string | null = bodyTenantId || null
    let companyName = 'Drive 917'
    let currencyCode = 'gbp'
    let stripeMode: StripeMode = 'test' // Default to test mode for safety
    let tenantData: any = null
    let depositHoldAmount = 0
    let securityDepositEnabled = false

    // Try to get tenant by slug first, then by ID, then from rental
    if (slug) {
      const { data: tenant, error: tenantError } = await supabaseClient
        .from('tenants')
        .select('id, company_name, currency_code, stripe_mode, stripe_account_id, stripe_onboarding_complete, payment_model, own_stripe_account_id, own_stripe_test_account_id, security_deposit_enabled, global_deposit_amount')
        .eq('slug', slug)
        .eq('status', 'active')
        .single()

      if (tenant && !tenantError) {
        tenantId = tenant.id
        companyName = tenant.company_name || companyName
        currencyCode = (tenant.currency_code || 'USD').toLowerCase()
        stripeMode = (tenant.stripe_mode as StripeMode) || 'test'
        tenantData = tenant
        securityDepositEnabled = !!tenant.security_deposit_enabled
        depositHoldAmount = Number(tenant.global_deposit_amount) || 0
        console.log('Tenant loaded from slug:', tenantId, 'mode:', stripeMode)
      }
    } else if (tenantId) {
      // Lookup tenant by ID if slug not provided
      const { data: tenant, error: tenantError } = await supabaseClient
        .from('tenants')
        .select('id, company_name, currency_code, stripe_mode, stripe_account_id, stripe_onboarding_complete, payment_model, own_stripe_account_id, own_stripe_test_account_id, security_deposit_enabled, global_deposit_amount')
        .eq('id', tenantId)
        .eq('status', 'active')
        .single()

      if (tenant && !tenantError) {
        companyName = tenant.company_name || companyName
        currencyCode = (tenant.currency_code || 'USD').toLowerCase()
        stripeMode = (tenant.stripe_mode as StripeMode) || 'test'
        tenantData = tenant
        securityDepositEnabled = !!tenant.security_deposit_enabled
        depositHoldAmount = Number(tenant.global_deposit_amount) || 0
        console.log('Tenant loaded from ID:', tenantId, 'mode:', stripeMode)
      }
    } else if (rentalId) {
      // Fallback: get tenant from rental
      const { data: rental } = await supabaseClient
        .from('rentals')
        .select('tenant_id')
        .eq('id', rentalId)
        .single()

      if (rental?.tenant_id) {
        tenantId = rental.tenant_id

        const { data: tenant } = await supabaseClient
          .from('tenants')
          .select('company_name, currency_code, stripe_mode, stripe_account_id, stripe_onboarding_complete, payment_model, own_stripe_account_id, own_stripe_test_account_id, security_deposit_enabled, global_deposit_amount')
          .eq('id', tenantId)
          .single()

        if (tenant) {
          companyName = tenant.company_name || companyName
          currencyCode = (tenant.currency_code || 'USD').toLowerCase()
          stripeMode = (tenant.stripe_mode as StripeMode) || 'test'
          tenantData = tenant
          securityDepositEnabled = !!tenant.security_deposit_enabled
          depositHoldAmount = Number(tenant.global_deposit_amount) || 0
          console.log('Tenant loaded from rental:', tenantId, 'mode:', stripeMode)
        }
      }
    }

    // Per-rental deposit override beats the tenant default. The operator can
    // edit the deposit amount on the Pre-Auth input when creating a rental;
    // that value lives on rentals.deposit_amount_override. We surface the
    // override in the Stripe Checkout disclosure so the customer sees the
    // right number (instead of the global default).
    if (rentalId) {
      const { data: rentalRow } = await supabaseClient
        .from('rentals')
        .select('deposit_amount_override, auto_extend_enabled')
        .eq('id', rentalId)
        .single()
      const override = rentalRow?.deposit_amount_override
      // Any non-null override wins — including an explicit 0, which means the
      // operator unchecked the deposit for this rental. Previously the `> 0`
      // guard treated 0 as "unset" and kept the $150 tenant default, so the
      // customer was shown a deposit notice and a hold was placed despite the
      // opt-out. The `depositHoldAmount > 0` notice gate below now suppresses
      // the disclosure correctly when the override is 0.
      if (override !== null && override !== undefined) {
        depositHoldAmount = Number(override)
        console.log('Deposit amount override applied:', depositHoldAmount, 'for rental', rentalId)
      }
      // Long-running rentals carry NO deposit (this wins over any override) — no
      // notice is shown and no hold is placed (place-deposit-hold skips them too):
      // auto-extend rentals AND any rental that's been extended.
      const { count: extensionsCount } = await supabaseClient
        .from('rental_extensions')
        .select('id', { count: 'exact', head: true })
        .eq('rental_id', rentalId)
      if ((rentalRow as any)?.auto_extend_enabled || (extensionsCount ?? 0) > 0) {
        depositHoldAmount = 0
      }
    }

    // Whether to show the deposit-hold transparency notice on Stripe Checkout.
    // We do this when the caller signals placeDepositHoldAfter AND the tenant
    // actually has a non-zero security deposit configured. Without both being
    // true the notice would be misleading (no hold is going to be placed).
    const shouldShowDepositNotice = !!placeDepositHoldAfter && securityDepositEnabled && depositHoldAmount > 0;
    // formatCurrency renders proper symbols ($3.00 / £3.00 / €3.00) per the
    // tenant's currency_code instead of the raw "USD 3.00" output.
    const formattedDeposit = shouldShowDepositNotice
      ? formatCurrency(depositHoldAmount, currencyCode.toUpperCase())
      : '';
    const depositNoticeText = shouldShowDepositNotice
      ? `After payment, a ${formattedDeposit} security deposit hold (not a charge) will be authorised on the same card. Released when your rental ends.`
      : null;

    // Get Stripe client for the tenant's platform account + mode
    // ('managed' tenants → legacy UK platform, 'own' tenants → UAE platform)
    const platformAccount: PlatformAccount = tenantData ? getChargePlatformAccount(tenantData) : 'uk'
    const stripe = getStripeClientForAccount(platformAccount, stripeMode)

    // Determine which Connect account to use based on tenant mode/model
    const stripeAccountId = tenantData ? getConnectAccountId(tenantData) : null

    console.log('Checkout session - tenantId:', tenantId, 'mode:', stripeMode, 'connectAccount:', stripeAccountId)

    // Create or reuse Stripe Customer so we can save the payment method for deposit holds
    const stripeOptions = stripeAccountId ? { stripeAccount: stripeAccountId } : undefined;
    let stripeCustomerId: string | null = null;

    // Try to get customer ID from body or from rental
    let resolvedCustomerId = customerId;
    if (!resolvedCustomerId && referenceId) {
      const { data: rental } = await supabaseClient
        .from('rentals')
        .select('customer_id')
        .eq('id', referenceId)
        .single();
      resolvedCustomerId = rental?.customer_id;
    }

    if (resolvedCustomerId) {
      // Check if customer already has a Stripe customer ID
      const { data: existingCustomer } = await supabaseClient
        .from('customers')
        .select('stripe_customer_id')
        .eq('id', resolvedCustomerId)
        .single();

      if (existingCustomer?.stripe_customer_id) {
        stripeCustomerId = existingCustomer.stripe_customer_id;
        console.log('Using existing Stripe customer:', stripeCustomerId);
      } else {
        // Create new Stripe customer
        const customer = await stripe.customers.create({
          email: customerEmail,
          name: customerName,
          metadata: {
            drive247_customer_id: resolvedCustomerId,
            tenant_id: tenantId || '',
          },
        }, stripeOptions);

        stripeCustomerId = customer.id;
        console.log('Created new Stripe customer:', stripeCustomerId);

        // Save Stripe customer ID to our database
        await supabaseClient
          .from('customers')
          .update({ stripe_customer_id: stripeCustomerId })
          .eq('id', resolvedCustomerId);
      }
    }

    // Create Stripe Checkout Session
    const sessionConfig: any = {
      payment_method_types: ['card'],
      line_items: [
        {
          price_data: {
            currency: currencyCode,
            product_data: {
              name: 'Vehicle Rental',
              // Description shows directly under the amount on the Stripe
              // Checkout page. Stays minimal when no deposit is configured;
              // appends the hold disclosure when one will be placed so the
              // customer isn't surprised by a second authorisation.
              description: shouldShowDepositNotice
                ? `Rental fees — ${companyName}. ${depositNoticeText}`
                : `Rental fees — ${companyName}`,
            },
            unit_amount: Math.round(totalAmount * 100), // Convert to cents
          },
          quantity: 1,
        },
      ],
      mode: 'payment',
      // Use Stripe Customer if available, otherwise fall back to email
      ...(stripeCustomerId ? { customer: stripeCustomerId } : { customer_email: customerEmail }),
      // Save payment method for future deposit holds
      payment_intent_data: {
        setup_future_usage: 'off_session',
      },
      // Surface the deposit-hold notice as official Stripe Checkout copy: shows
      // up right next to the Pay button so the customer can't miss it.
      ...(shouldShowDepositNotice ? {
        custom_text: {
          submit: { message: depositNoticeText! },
        },
      } : {}),
      client_reference_id: referenceId,
      success_url: successUrl || (rentalId
        ? `${origin}/booking-success?session_id={CHECKOUT_SESSION_ID}&rental_id=${rentalId}`
        : `${origin}/booking-success?session_id={CHECKOUT_SESSION_ID}`),
      cancel_url: cancelUrl || (rentalId
        ? `${origin}/booking-cancelled?rental_id=${rentalId}`
        : `${origin}/booking-cancelled`),
      metadata: {
        booking_id: bookingId,
        rental_id: rentalId,
        customer_name: customerName,
        tenant_id: tenantId,
        tenant_slug: slug,
        stripe_mode: stripeMode, // Track which mode was used
        ...(bonzahPolicyId ? { bonzah_policy_id: bonzahPolicyId } : {}),
        ...(source ? { source } : {}),
        ...(targetCategories && targetCategories.length > 0 ? { target_categories: JSON.stringify(targetCategories) } : {}),
        ...(extensionId ? { extension_id: extensionId } : {}),
        ...(paygAccrualId ? { payg_accrual_id: paygAccrualId } : {}),
        ...(installmentId ? { installment_id: installmentId } : {}),
        // Tells the Stripe webhook to invoke place-deposit-hold once the
        // payment captures, so the deposit is authorised off-session on the
        // same saved card (capture_method='manual'). Stripe metadata values
        // are always strings.
        ...(placeDepositHoldAfter ? { place_deposit_hold: 'true' } : {}),
        // Account-level "collect then decide" flow: tells the webhook to commit
        // the captured money as UNALLOCATED account credit (apply-payment with
        // holdAsCredit) instead of FIFO-ing it onto charges. Carries the
        // customer id since there's no rental to resolve it from.
        ...(holdAsCredit ? { hold_as_credit: 'true', customer_id: resolvedCustomerId || customerId || '' } : {}),
      },
    }

    // For direct charges: create checkout session on connected account
    if (stripeAccountId) {
      console.log(`Creating checkout session on connected account (${stripeMode} mode):`, stripeAccountId)
    } else {
      console.log(`Creating checkout session on platform account (${stripeMode} mode)`)
    }

    const session = await stripe.checkout.sessions.create(sessionConfig, stripeOptions)

    // CRITICAL FIX: Save stripe_checkout_session_id to payment record
    // This allows the webhook to find and update the payment when checkout completes
    if (referenceId) {
      // Category-targeted and extension flows MUST get their own dedicated
      // payment record — never reuse a generic Pending row. Reusing would
      // overwrite amount, hijack target_categories/extension_id, and is the
      // root cause of "I paid for Tax but Tax shows Not Paid": the payment
      // ends up tied to whatever Pending row was sitting around (potentially
      // for a different category or extension), and apply-payment then either
      // allocates to the wrong place or stamps the wrong installment slot.
      const isTargetedFlow = !!(targetCategories && targetCategories.length > 0) || !!extensionId
      // First try to update existing PENDING payment record (portal flow)
      // Only update payments that match status=Pending to avoid corrupting existing paid records
      const updateData: any = {
        stripe_checkout_session_id: session.id,
        platform_account: platformAccount,
        updated_at: new Date().toISOString(),
      }
      // Persist targetCategories on the payment record for reliable retrieval by webhook/fallback
      if (targetCategories && targetCategories.length > 0) {
        updateData.target_categories = targetCategories
      }
      if (extensionId) {
        updateData.extension_id = extensionId
      }
      // For targeted flows, skip UPDATE entirely so we always INSERT a fresh
      // payment with the exact amount and target_categories the caller asked for.
      let updatedPayment: { id: string }[] | null = null
      let updateError: any = null
      if (!isTargetedFlow) {
        const updateResult = await supabaseClient
          .from('payments')
          .update(updateData)
          .eq('rental_id', referenceId)
          .is('stripe_checkout_session_id', null)
          .eq('status', 'Pending')
          .is('target_categories', null)
          .is('extension_id', null)
          .select('id')
        updatedPayment = updateResult.data
        updateError = updateResult.error
      } else {
        console.log('Targeted/extension flow — skipping payment UPDATE, will INSERT a dedicated row',
          targetCategories ? `(categories: ${targetCategories.join(', ')})` : '',
          extensionId ? `(extension: ${extensionId})` : '')
      }

      if (updateError) {
        console.error('Failed to update payment with session ID:', updateError)
      } else if (updatedPayment && updatedPayment.length > 0) {
        console.log('✅ Updated existing payment with session ID:', updatedPayment[0].id, 'session:', session.id)
      } else {
        // No existing payment found - create one (booking app flow)
        console.log('No existing payment found, creating new payment record for rental:', referenceId)

        // Get rental details
        const { data: rental } = await supabaseClient
          .from('rentals')
          .select('customer_id, vehicle_id, monthly_amount, tenant_id')
          .eq('id', referenceId)
          .single()

        if (rental) {
          const paymentAmount = Math.round(totalAmount * 100) / 100 // From checkout session
          const today = new Date().toISOString().split('T')[0]

          const insertData: any = {
              rental_id: referenceId,
              customer_id: rental.customer_id,
              vehicle_id: rental.vehicle_id,
              tenant_id: rental.tenant_id || tenantId,
              amount: paymentAmount,
              payment_date: today,
              method: 'Card',
              payment_type: 'Payment',
              status: 'Pending',
              remaining_amount: paymentAmount,
              verification_status: 'pending',
              stripe_checkout_session_id: session.id,
              capture_status: 'requires_capture',
              platform_account: platformAccount,
              booking_source: source === 'portal' ? 'admin' : 'website',
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
          }
          if (targetCategories && targetCategories.length > 0) {
            insertData.target_categories = targetCategories
          }
          if (extensionId) {
            insertData.extension_id = extensionId
          }
          const { data: createdPayment, error: createError } = await supabaseClient
            .from('payments')
            .insert(insertData)
            .select('id')
            .single()

          if (createError) {
            console.error('Failed to create payment record:', createError)
          } else {
            console.log('✅ Created new payment with session ID:', createdPayment.id, 'session:', session.id)
          }
        }
      }
    } else if (holdAsCredit && resolvedCustomerId) {
      // Account-level collect-then-decide: no rental, so create a customer-level
      // Pending payment keyed to this session. The webhook finds it by session
      // id, marks it Completed, then calls apply-payment with holdAsCredit so it
      // lands as unallocated account credit for the operator to allocate later.
      const paymentAmount = Math.round(totalAmount * 100) / 100
      const today = new Date().toISOString().split('T')[0]
      const { data: createdCredit, error: creditError } = await supabaseClient
        .from('payments')
        .insert({
          customer_id: resolvedCustomerId,
          tenant_id: tenantId,
          amount: paymentAmount,
          payment_date: today,
          method: 'Card',
          payment_type: 'Payment',
          status: 'Pending',
          remaining_amount: paymentAmount,
          verification_status: 'pending',
          stripe_checkout_session_id: session.id,
          capture_status: 'requires_capture',
          platform_account: platformAccount,
          booking_source: source === 'portal' ? 'admin' : 'website',
        })
        .select('id')
        .single()
      if (creditError) {
        console.error('Failed to create customer-level credit payment record:', creditError)
      } else {
        console.log('✅ Created customer-level hold-as-credit payment with session ID:', createdCredit.id, 'session:', session.id)
      }
    }

    return new Response(
      JSON.stringify({ sessionId: session.id, url: session.url }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      }
    )
  } catch (error) {
    console.error('Error creating checkout session:', error)
    return new Response(
      JSON.stringify({ error: error.message }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 400,
      }
    )
  }
})
