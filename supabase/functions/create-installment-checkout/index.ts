import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4'
import Stripe from 'https://esm.sh/stripe@14.21.0?target=deno'
import { getStripeClient, getConnectAccountId, type StripeMode } from '../_shared/stripe-client.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-requested-with',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS, PUT, DELETE',
  'Access-Control-Max-Age': '86400',
}

interface InstallmentCheckoutRequest {
  rentalId: string
  customerId: string
  customerEmail: string
  customerName: string
  customerPhone?: string
  vehicleId: string
  vehicleName: string
  // Payment breakdown
  upfrontAmount: number      // Deposit + Service Fee (charged immediately)
  installableAmount: number  // Rental + Tax (split into installments)
  // Installment configuration
  planType: 'weekly' | 'monthly'
  numberOfInstallments: number
  // Dates
  pickupDate: string
  returnDate: string
  startDate: string          // First installment due date
  // Optional
  tenantId?: string
  protectionPlan?: string
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders, status: 200 })
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    const body: InstallmentCheckoutRequest = await req.json()
    const origin = req.headers.get('origin') || 'https://drive-247.com'

    console.log('Creating installment checkout for rental:', body.rentalId)
    console.log('Plan type:', body.planType, 'Installments:', body.numberOfInstallments)
    console.log('Upfront:', body.upfrontAmount, 'Installable:', body.installableAmount)

    // Validate inputs
    if (!body.rentalId || !body.customerId || !body.customerEmail) {
      throw new Error('Missing required fields: rentalId, customerId, customerEmail')
    }
    if (body.upfrontAmount < 0 || body.installableAmount <= 0) {
      throw new Error('Invalid payment amounts')
    }
    if (body.numberOfInstallments < 1 || body.numberOfInstallments > 12) {
      throw new Error('Invalid number of installments (must be 1-12)')
    }

    // Get tenant_id from rental if not provided
    let tenantId = body.tenantId
    let stripeMode: StripeMode = 'test'
    let tenantData: any = null

    if (!tenantId && body.rentalId) {
      const { data: rental } = await supabase
        .from('rentals')
        .select('tenant_id')
        .eq('id', body.rentalId)
        .single()
      tenantId = rental?.tenant_id
    }

    // Get tenant's Stripe mode and Connect account
    if (tenantId) {
      const { data: tenant } = await supabase
        .from('tenants')
        .select('stripe_mode, stripe_account_id, stripe_onboarding_complete')
        .eq('id', tenantId)
        .single()

      if (tenant) {
        stripeMode = (tenant.stripe_mode as StripeMode) || 'test'
        tenantData = tenant
        console.log('Tenant loaded:', tenantId, 'mode:', stripeMode)
      }
    }

    // Get Stripe client for the tenant's mode
    const stripe = getStripeClient(stripeMode)
    const stripeAccountId = tenantData ? getConnectAccountId(tenantData) : null
    const stripeOptions = stripeAccountId ? { stripeAccount: stripeAccountId } : undefined

    console.log('Stripe mode:', stripeMode, 'Connect account:', stripeAccountId)

    // Calculate installment amount
    const installmentAmount = Math.round((body.installableAmount / body.numberOfInstallments) * 100) / 100

    // Total amount for checkout (upfront only - installments charged later)
    const totalCheckoutAmount = body.upfrontAmount

    // Build metadata for tracking
    const metadata = {
      rental_id: body.rentalId,
      customer_id: body.customerId,
      customer_name: body.customerName,
      customer_email: body.customerEmail,
      vehicle_id: body.vehicleId,
      vehicle_name: body.vehicleName,
      pickup_date: body.pickupDate,
      return_date: body.returnDate,
      tenant_id: tenantId || '',
      // Installment specific
      checkout_type: 'installment',
      plan_type: body.planType,
      number_of_installments: String(body.numberOfInstallments),
      upfront_amount: String(body.upfrontAmount),
      installable_amount: String(body.installableAmount),
      installment_amount: String(installmentAmount),
      first_installment_date: body.startDate,
    }

    // Create or get Stripe Customer
    let stripeCustomerId: string

    // Check if customer already has a Stripe customer ID
    const { data: existingCustomer } = await supabase
      .from('customers')
      .select('stripe_customer_id')
      .eq('id', body.customerId)
      .single()

    if (existingCustomer?.stripe_customer_id) {
      stripeCustomerId = existingCustomer.stripe_customer_id
      console.log('Using existing Stripe customer:', stripeCustomerId)
    } else {
      // Create new Stripe customer
      const customer = await stripe.customers.create({
        email: body.customerEmail,
        name: body.customerName,
        phone: body.customerPhone,
        metadata: {
          drive247_customer_id: body.customerId,
          tenant_id: tenantId || '',
        },
      }, stripeOptions)

      stripeCustomerId = customer.id
      console.log('Created new Stripe customer:', stripeCustomerId)

      // Save Stripe customer ID to our database
      await supabase
        .from('customers')
        .update({ stripe_customer_id: stripeCustomerId })
        .eq('id', body.customerId)
    }

    // Create Checkout Session with:
    // 1. Payment for upfront amount (captured immediately)
    // 2. SetupIntent to save card for future installment charges
    const sessionParams: Stripe.Checkout.SessionCreateParams = {
      customer: stripeCustomerId,
      payment_method_types: ['card'],
      mode: 'payment',
      // Charge the upfront amount
      line_items: [
        {
          price_data: {
            currency: 'usd',
            product_data: {
              name: 'Rental Deposit & Service Fee',
              description: `${body.vehicleName} - Upfront payment (Deposit + Service Fee)`,
            },
            unit_amount: Math.round(totalCheckoutAmount * 100),
          },
          quantity: 1,
        },
      ],
      // Save card for future use (installments)
      payment_intent_data: {
        setup_future_usage: 'off_session', // KEY: This saves the card for future charges
        metadata: metadata,
        description: `Installment Plan Upfront: ${body.vehicleName}`,
      },
      client_reference_id: body.rentalId,
      success_url: `${origin}/booking-success?session_id={CHECKOUT_SESSION_ID}&rental_id=${body.rentalId}&installment=true`,
      cancel_url: `${origin}/booking-cancelled?rental_id=${body.rentalId}`,
      metadata: {
        ...metadata,
        stripe_account_id: stripeAccountId || '',
        stripe_mode: stripeMode,
      },
    }

    const session = await stripe.checkout.sessions.create(sessionParams, stripeOptions)
    console.log('Installment checkout session created:', session.id)

    // Create initial payment record for upfront amount
    const { data: upfrontPayment, error: paymentError } = await supabase
      .from('payments')
      .insert({
        customer_id: body.customerId,
        rental_id: body.rentalId,
        vehicle_id: body.vehicleId,
        amount: totalCheckoutAmount,
        payment_date: new Date().toISOString().split('T')[0],
        method: 'Card',
        payment_type: 'InitialFee',
        status: 'Pending',
        verification_status: 'auto_approved',
        stripe_checkout_session_id: session.id,
        capture_status: 'captured', // Upfront is captured immediately
        booking_source: 'website',
        tenant_id: tenantId,
      })
      .select()
      .single()

    if (paymentError) {
      console.error('Error creating upfront payment record:', paymentError)
    } else {
      console.log('Upfront payment record created:', upfrontPayment?.id)
    }

    // Create the installment plan (will be activated after checkout success via webhook)
    // Note: We create it now with 'pending' status, webhook will activate it
    const { data: installmentPlan, error: planError } = await supabase
      .from('installment_plans')
      .insert({
        rental_id: body.rentalId,
        tenant_id: tenantId,
        customer_id: body.customerId,
        plan_type: body.planType,
        total_installable_amount: body.installableAmount,
        number_of_installments: body.numberOfInstallments,
        installment_amount: installmentAmount,
        upfront_amount: body.upfrontAmount,
        upfront_paid: false,
        stripe_customer_id: stripeCustomerId,
        status: 'pending', // Will be activated after successful checkout
        next_due_date: body.startDate,
      })
      .select()
      .single()

    if (planError) {
      console.error('Error creating installment plan:', planError)
      throw new Error('Failed to create installment plan')
    }

    console.log('Installment plan created:', installmentPlan.id)

    // Create scheduled installments
    const scheduledInstallments = []
    let dueDate = new Date(body.startDate)
    const intervalDays = body.planType === 'weekly' ? 7 : 30

    for (let i = 1; i <= body.numberOfInstallments; i++) {
      scheduledInstallments.push({
        installment_plan_id: installmentPlan.id,
        tenant_id: tenantId,
        rental_id: body.rentalId,
        customer_id: body.customerId,
        installment_number: i,
        amount: installmentAmount,
        due_date: dueDate.toISOString().split('T')[0],
        status: 'scheduled',
      })

      // Move to next due date
      if (body.planType === 'weekly') {
        dueDate.setDate(dueDate.getDate() + 7)
      } else {
        dueDate.setMonth(dueDate.getMonth() + 1)
      }
    }

    const { error: installmentsError } = await supabase
      .from('scheduled_installments')
      .insert(scheduledInstallments)

    if (installmentsError) {
      console.error('Error creating scheduled installments:', installmentsError)
      throw new Error('Failed to create scheduled installments')
    }

    console.log('Created', scheduledInstallments.length, 'scheduled installments')

    // Update rental with installment plan reference
    await supabase
      .from('rentals')
      .update({
        has_installment_plan: true,
        installment_plan_id: installmentPlan.id,
      })
      .eq('id', body.rentalId)

    return new Response(
      JSON.stringify({
        sessionId: session.id,
        url: session.url,
        paymentId: upfrontPayment?.id,
        installmentPlanId: installmentPlan.id,
        stripeCustomerId: stripeCustomerId,
        // Summary for UI
        summary: {
          upfrontAmount: totalCheckoutAmount,
          installableAmount: body.installableAmount,
          numberOfInstallments: body.numberOfInstallments,
          installmentAmount: installmentAmount,
          planType: body.planType,
          firstDueDate: body.startDate,
        },
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      }
    )
  } catch (error) {
    console.error('Error creating installment checkout:', error)

    let errorMessage = 'Unable to create payment session. Please try again.'
    let statusCode = 400

    if (error instanceof Stripe.errors.StripeError) {
      switch (error.type) {
        case 'StripeCardError':
          errorMessage = 'There was an issue with your card. Please check your card details.'
          break
        case 'StripeRateLimitError':
          errorMessage = 'Too many requests. Please wait a moment and try again.'
          statusCode = 429
          break
        case 'StripeInvalidRequestError':
          errorMessage = 'Invalid payment request. Please check your booking details.'
          break
        case 'StripeAPIError':
        case 'StripeConnectionError':
          errorMessage = 'Payment service temporarily unavailable. Please try again.'
          statusCode = 503
          break
        default:
          errorMessage = error.message || errorMessage
      }
    } else if (error instanceof Error) {
      errorMessage = error.message
    }

    return new Response(
      JSON.stringify({
        error: errorMessage,
        code: (error as any).code || 'payment_error',
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: statusCode,
      }
    )
  }
})
