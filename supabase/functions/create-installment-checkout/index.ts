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
  // Payment breakdown (new structure - first installment paid upfront if configured)
  baseUpfrontAmount: number       // Deposit + Service Fee + Delivery fees (based on what_gets_split)
  firstInstallmentAmount: number  // First installment amount (paid upfront if chargeFirstUpfront is true)
  upfrontAmount: number           // Total upfront = baseUpfront + firstInstallment (if applicable)
  installableAmount: number       // Total rental costs to be split
  installmentAmount: number       // Amount per scheduled installment
  // Installment configuration
  planType: 'weekly' | 'monthly'
  numberOfInstallments: number    // Total number of installments
  scheduledInstallments: number   // Number of installments to schedule
  // Dates
  pickupDate: string
  returnDate: string
  startDate: string               // Rental start date
  // Optional
  tenantId?: string
  protectionPlan?: string
  // Phase 3: Config settings
  chargeFirstUpfront?: boolean           // Whether to charge first installment at checkout (default: true)
  whatGetsSplit?: 'rental_only' | 'rental_tax' | 'rental_tax_extras'  // What's included in installments
  gracePeriodDays?: number               // Days before marking overdue (default: 3)
  maxRetryAttempts?: number              // Max retry attempts for failed payments (default: 3)
  retryIntervalDays?: number             // Days between retries (default: 1)
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

    // Extract config settings with defaults
    const chargeFirstUpfront = body.chargeFirstUpfront !== false // Default: true
    const whatGetsSplit = body.whatGetsSplit || 'rental_tax'
    const gracePeriodDays = body.gracePeriodDays ?? 3
    const maxRetryAttempts = body.maxRetryAttempts ?? 3
    const retryIntervalDays = body.retryIntervalDays ?? 1

    console.log('Creating installment checkout for rental:', body.rentalId)
    console.log('Plan type:', body.planType, 'Total Installments:', body.numberOfInstallments)
    console.log('Scheduled Installments:', body.scheduledInstallments)
    console.log('Charge first upfront:', chargeFirstUpfront, 'What gets split:', whatGetsSplit)
    console.log('Upfront Total:', body.upfrontAmount, '(Base:', body.baseUpfrontAmount, '+ 1st Installment:', body.firstInstallmentAmount, ')')
    console.log('Total Installable:', body.installableAmount)
    console.log('Recovery config - Grace:', gracePeriodDays, 'Max retries:', maxRetryAttempts, 'Interval:', retryIntervalDays)

    // Validate inputs
    if (!body.rentalId || !body.customerId || !body.customerEmail) {
      throw new Error('Missing required fields: rentalId, customerId, customerEmail')
    }
    if (body.upfrontAmount <= 0 || body.installableAmount <= 0) {
      throw new Error('Invalid payment amounts')
    }
    if (body.numberOfInstallments < 2 || body.numberOfInstallments > 12) {
      throw new Error('Invalid number of installments (must be 2-12)')
    }

    // Check for existing active/pending installment plan for this rental
    const { data: existingPlan } = await supabase
      .from('installment_plans')
      .select('id, status')
      .eq('rental_id', body.rentalId)
      .in('status', ['active', 'pending'])
      .maybeSingle()

    if (existingPlan) {
      throw new Error(`An installment plan already exists for this rental (status: ${existingPlan.status})`)
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

    // Use the installment amount provided (already calculated with proper rounding)
    const installmentAmount = body.installmentAmount

    // Calculate last installment amount (handles rounding - remainder goes to last)
    // Total installable = first installment + (scheduled installments × installment amount)
    // If there's a remainder, it goes to the last scheduled installment
    const scheduledTotal = body.installableAmount - body.firstInstallmentAmount
    const regularInstallmentsCount = body.scheduledInstallments > 1 ? body.scheduledInstallments - 1 : 0
    const lastInstallmentAmount = regularInstallmentsCount > 0
      ? Math.round((scheduledTotal - (installmentAmount * regularInstallmentsCount)) * 100) / 100
      : scheduledTotal

    console.log('Installment amounts - Regular:', installmentAmount, 'Last:', lastInstallmentAmount)

    // Total amount for checkout = deposit + fees + FIRST installment
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
      scheduled_installments: String(body.scheduledInstallments),
      upfront_amount: String(body.upfrontAmount),
      base_upfront_amount: String(body.baseUpfrontAmount),
      first_installment_amount: String(body.firstInstallmentAmount),
      installable_amount: String(body.installableAmount),
      installment_amount: String(installmentAmount),
      charge_first_upfront: String(chargeFirstUpfront),
      first_installment_date: 'today', // First installment is paid at checkout
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
    // 1. Payment for upfront amount (deposit + fees, optionally + first installment)
    // 2. SetupIntent to save card for future installment charges
    const lineItemName = chargeFirstUpfront
      ? 'Deposit, Fees & First Installment'
      : 'Deposit & Fees'
    const lineItemDescription = chargeFirstUpfront
      ? `${body.vehicleName} - Deposit & Fees (${body.baseUpfrontAmount.toFixed(2)}) + 1st installment (${body.firstInstallmentAmount.toFixed(2)})`
      : `${body.vehicleName} - Deposit & Fees (${body.baseUpfrontAmount.toFixed(2)})`
    const paymentDescription = chargeFirstUpfront
      ? `Installment Plan: ${body.vehicleName} - Upfront + 1st payment`
      : `Installment Plan: ${body.vehicleName} - Upfront deposit & fees`

    const sessionParams: Stripe.Checkout.SessionCreateParams = {
      customer: stripeCustomerId,
      payment_method_types: ['card'],
      mode: 'payment',
      // Charge the upfront amount (includes first installment if configured)
      line_items: [
        {
          price_data: {
            currency: 'usd',
            product_data: {
              name: lineItemName,
              description: lineItemDescription,
            },
            unit_amount: Math.round(totalCheckoutAmount * 100),
          },
          quantity: 1,
        },
      ],
      // Save card for future use (remaining installments)
      payment_intent_data: {
        setup_future_usage: 'off_session', // KEY: This saves the card for future charges
        metadata: metadata,
        description: paymentDescription,
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

    // Create initial payment record for upfront amount (includes first installment)
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
        capture_status: 'captured',
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

    // Create the installment plan
    // First installment is marked as paid (included in upfront)
    const today = new Date().toISOString().split('T')[0]

    // Calculate next due date for second installment
    const nextDueDate = new Date(body.startDate)
    if (body.planType === 'weekly') {
      nextDueDate.setDate(nextDueDate.getDate() + 7)
    } else {
      nextDueDate.setMonth(nextDueDate.getMonth() + 1)
    }

    // Store config settings with the plan for use during processing
    const planConfig = {
      charge_first_upfront: chargeFirstUpfront,
      what_gets_split: whatGetsSplit,
      grace_period_days: gracePeriodDays,
      max_retry_attempts: maxRetryAttempts,
      retry_interval_days: retryIntervalDays,
    }

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
        upfront_amount: body.baseUpfrontAmount, // Base upfront (deposit + fees)
        upfront_paid: false, // Will be marked true after checkout success
        paid_installments: chargeFirstUpfront ? 0 : 0, // Will be updated to 1 after checkout success if charging first upfront
        total_paid: 0, // Will be updated after checkout success
        stripe_customer_id: stripeCustomerId,
        status: 'pending', // Will be activated after successful checkout
        next_due_date: body.scheduledInstallments > 0 ? nextDueDate.toISOString().split('T')[0] : null,
        config: planConfig, // Store config settings
      })
      .select()
      .single()

    if (planError) {
      console.error('Error creating installment plan:', planError)
      throw new Error('Failed to create installment plan')
    }

    console.log('Installment plan created:', installmentPlan.id)

    // Create scheduled installments
    // If chargeFirstUpfront is true: First installment is paid today, remaining are scheduled
    // If chargeFirstUpfront is false: All installments are scheduled for future dates
    const scheduledInstallments = []
    let dueDate = new Date(body.startDate)

    // Create ALL installments
    for (let i = 1; i <= body.numberOfInstallments; i++) {
      const isFirstInstallment = i === 1
      const isLastInstallment = i === body.numberOfInstallments

      // Use last installment amount for the final one (handles rounding remainder)
      let amount: number
      if (isLastInstallment && body.numberOfInstallments > 1) {
        amount = lastInstallmentAmount
      } else if (isFirstInstallment && chargeFirstUpfront) {
        amount = body.firstInstallmentAmount
      } else {
        amount = installmentAmount
      }

      // Determine status based on whether first is charged upfront
      let status: string
      if (isFirstInstallment && chargeFirstUpfront) {
        // First installment being charged at checkout - mark as processing
        status = 'processing'
      } else {
        // Scheduled for future
        status = 'scheduled'
      }

      scheduledInstallments.push({
        installment_plan_id: installmentPlan.id,
        tenant_id: tenantId,
        rental_id: body.rentalId,
        customer_id: body.customerId,
        installment_number: i,
        amount: amount,
        due_date: dueDate.toISOString().split('T')[0],
        status: status,
      })

      // Move to next due date for subsequent installments
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

    const processingCount = chargeFirstUpfront ? 1 : 0
    const scheduledCount = body.numberOfInstallments - processingCount
    console.log('Created', scheduledInstallments.length, 'installments (', processingCount, 'processing,', scheduledCount, 'scheduled)')

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
          baseUpfrontAmount: body.baseUpfrontAmount,
          firstInstallmentAmount: body.firstInstallmentAmount,
          installableAmount: body.installableAmount,
          numberOfInstallments: body.numberOfInstallments,
          scheduledInstallments: body.scheduledInstallments,
          installmentAmount: installmentAmount,
          lastInstallmentAmount: lastInstallmentAmount,
          planType: body.planType,
          nextDueDate: body.scheduledInstallments > 0 ? nextDueDate.toISOString().split('T')[0] : null,
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
