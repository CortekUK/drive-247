import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';
import { formatCurrency } from '../_shared/format-utils.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface PaymentProcessingResult {
  ok?: boolean;
  paymentId?: string;
  category?: string;
  entryDate?: string;
  error?: string;
  detail?: string;
  allocated?: number;
  remaining?: number;
  status?: string;
}

async function applyPayment(supabase: any, paymentId: string, targetCategories?: string[]): Promise<PaymentProcessingResult> {
  try {
    console.log('Processing payment:', paymentId);

    // Load payment details
    const { data: payment, error: paymentError } = await supabase
      .from('payments')
      .select('*')
      .eq('id', paymentId)
      .single();

    if (paymentError || !payment) {
      return {
        ok: false,
        error: 'Payment not found',
        detail: paymentError?.message || 'Payment does not exist'
      };
    }

    // If targetCategories not provided by caller, read from payment record (stored by create-checkout-session)
    if (!targetCategories && payment.target_categories) {
      targetCategories = payment.target_categories;
      console.log(`Read targetCategories from payment record: ${targetCategories.join(', ')}`);
    }

    // Get tenant currency code
    let currencyCode = 'GBP';
    if (payment.tenant_id) {
      const { data: tenant } = await supabase
        .from('tenants')
        .select('currency_code')
        .eq('id', payment.tenant_id)
        .single();
      if (tenant?.currency_code) currencyCode = tenant.currency_code;
    }

    // For customer payments, all are treated as generic 'Payment' type
    // InitialFee payments are system-generated and handled separately
    const isCustomerPayment = payment.payment_type === 'Payment';
    const isInitialFee = payment.payment_type === 'InitialFee';

    // Map payment_type to valid ledger category
    const getLedgerCategory = (paymentType: string): string => {
      switch (paymentType) {
        case 'InitialFee':
          return 'InitialFee';
        case 'Payment':
          return 'Rental';
        case 'Fine':
          return 'Fines';
        default:
          return 'Other';
      }
    };

    const defaultLedgerCategory = getLedgerCategory(payment.payment_type);
    // If targeting a single category, use that for the payment ledger entry
    const ledgerCategory = (targetCategories && targetCategories.length === 1)
      ? targetCategories[0]
      : defaultLedgerCategory;

    // Determine entry date
    const entryDate = payment.payment_date || payment.paid_at || payment.created_at || new Date().toISOString().split('T')[0];

    console.log(`Payment ${paymentId}: ${payment.payment_type}, ${entryDate}, ${formatCurrency(payment.amount, currencyCode)}`);

    // Insert payment ledger entry — the DB unique index (idx_ledger_payment_unique) on
    // ledger_entries(payment_id) WHERE type='Payment' acts as a lock:
    // only the FIRST caller succeeds; subsequent callers get a duplicate key error and wait.
    console.log(`Creating ledger entry for payment ${paymentId}: amount=${payment.amount}, category=${ledgerCategory}`);

    const ledgerData: any = {
      customer_id: payment.customer_id,
      rental_id: payment.rental_id,
      vehicle_id: payment.vehicle_id,
      entry_date: entryDate,
      type: 'Payment',
      category: ledgerCategory,
      amount: -Math.abs(payment.amount), // Ensure negative
      due_date: entryDate,
      remaining_amount: 0,
      payment_id: payment.id
    };

    // Include tenant_id from payment if available
    if (payment.tenant_id) {
      ledgerData.tenant_id = payment.tenant_id;
    }

    const { error: ledgerError } = await supabase
      .from('ledger_entries')
      .insert([ledgerData]);

    if (ledgerError) {
      if (ledgerError.message.includes('duplicate key') || ledgerError.message.includes('idx_ledger_payment_unique')) {
        // Another call already inserted the ledger entry — it owns allocation.
        // Wait for it to finish, then return the final state.
        console.log(`Payment ${paymentId} already being processed by another call (duplicate ledger entry). Waiting...`);
        await new Promise(r => setTimeout(r, 3000));
        const { data: fresh } = await supabase.from('payments').select('status, remaining_amount, amount').eq('id', paymentId).single();
        return {
          ok: true,
          paymentId,
          category: 'Payment',
          entryDate,
          allocated: fresh ? fresh.amount - (fresh.remaining_amount || 0) : 0,
          remaining: fresh?.remaining_amount || 0,
          status: fresh?.status || 'Applied'
        };
      }
      console.error('CRITICAL: Ledger insert failed:', ledgerError);
      return {
        ok: false,
        error: 'CRITICAL: Failed to create ledger entry',
        detail: `${ledgerError.code}: ${ledgerError.message}`
      };
    }

    // Handle InitialFee payments - allocate to rental charges using FIFO
    if (isInitialFee) {
      console.log('Processing Initial Fee payment - allocating to rental charges');

      let remainingAmount = payment.amount;
      let totalAllocated = 0;

      // Get outstanding Rental charges for this rental (FIFO by due_date)
      const { data: outstandingCharges, error: chargesError } = await supabase
        .from('ledger_entries')
        .select('id, amount, remaining_amount, due_date, entry_date, rental_id, vehicle_id')
        .eq('rental_id', payment.rental_id)
        .eq('type', 'Charge')
        .eq('category', 'Rental')
        .gt('remaining_amount', 0)
        .order('due_date', { ascending: true })
        .order('entry_date', { ascending: true });

      if (chargesError) {
        console.error('Error fetching rental charges:', chargesError);
      } else {
        console.log(`Found ${outstandingCharges?.length || 0} outstanding rental charges`);

        // Apply payment to charges in FIFO order
        for (const charge of outstandingCharges || []) {
          if (remainingAmount <= 0) break;

          const toApply = Math.min(remainingAmount, charge.remaining_amount);

          console.log(`Applying ${formatCurrency(toApply, currencyCode)} to rental charge ${charge.id} (due ${charge.due_date})`);

          // Create payment application record
          const applicationData1: any = {
            payment_id: paymentId,
            charge_entry_id: charge.id,
            amount_applied: toApply
          };
          if (payment.tenant_id) {
            applicationData1.tenant_id = payment.tenant_id;
          }
          const { error: applicationError } = await supabase
            .from('payment_applications')
            .insert(applicationData1);

          if (applicationError && !applicationError.message.includes('duplicate key')) {
            console.error('Payment application error:', applicationError);
            continue;
          }

          // Update charge remaining amount
          const { error: chargeUpdateError } = await supabase
            .from('ledger_entries')
            .update({
              remaining_amount: charge.remaining_amount - toApply
            })
            .eq('id', charge.id);

          if (chargeUpdateError) {
            console.error('Charge update error:', chargeUpdateError);
            continue;
          }

          // Create P&L revenue entry for the applied amount
          const pnlData: any = {
            vehicle_id: charge.vehicle_id || payment.vehicle_id,
            entry_date: charge.due_date,
            side: 'Revenue',
            category: 'Initial Fees',
            amount: toApply,
            source_ref: `${paymentId}_${charge.id}`,
            customer_id: payment.customer_id,
            rental_id: charge.rental_id
          };
          if (payment.tenant_id) {
            pnlData.tenant_id = payment.tenant_id;
          }
          const { error: pnlRevenueError } = await supabase
            .from('pnl_entries')
            .insert(pnlData);

          if (pnlRevenueError && !pnlRevenueError.message.includes('duplicate key')) {
            console.error('P&L revenue entry error:', pnlRevenueError);
          }

          totalAllocated += toApply;
          remainingAmount -= toApply;
        }
      }

      console.log(`Initial Fee allocation complete: ${formatCurrency(totalAllocated, currencyCode)} allocated, ${formatCurrency(remainingAmount, currencyCode)} remaining`);

      // Update payment status
      let paymentStatus = 'Applied';
      if (remainingAmount > 0) {
        paymentStatus = remainingAmount === payment.amount ? 'Credit' : 'Partial';
      }

      await supabase
        .from('payments')
        .update({ status: paymentStatus, remaining_amount: remainingAmount })
        .eq('id', paymentId);

      return {
        ok: true,
        paymentId: paymentId,
        category: 'Initial Fees',
        entryDate: entryDate,
        allocated: totalAllocated,
        remaining: remainingAmount,
        status: paymentStatus
      };
    }

    // Handle customer payments with Universal FIFO allocation
    if (isCustomerPayment) {
      console.log('Processing customer payment - applying Universal FIFO allocation');

      // Idempotency: check how much has already been allocated for this payment
      const { data: existingApps } = await supabase
        .from('payment_applications')
        .select('amount_applied')
        .eq('payment_id', paymentId);
      const alreadyAllocated = (existingApps || []).reduce((sum: number, app: any) => sum + Number(app.amount_applied), 0);

      if (alreadyAllocated >= payment.amount) {
        console.log(`Payment ${paymentId} already fully allocated (${formatCurrency(alreadyAllocated, currencyCode)}), skipping`);
        if (payment.status !== 'Applied') {
          await supabase.from('payments').update({ status: 'Applied', remaining_amount: 0 }).eq('id', paymentId);
        }
        return { ok: true, paymentId, category: 'Payment', entryDate, allocated: alreadyAllocated, remaining: 0, status: 'Applied' };
      }

      let remainingAmount = payment.amount - alreadyAllocated;
      let totalAllocated = alreadyAllocated;
      if (alreadyAllocated > 0) {
        console.log(`Payment ${paymentId} partially allocated: ${formatCurrency(alreadyAllocated, currencyCode)} already applied, ${formatCurrency(remainingAmount, currencyCode)} remaining`);
      }

      // Universal FIFO allocation order: Initial Fees → Extension → Rentals → Fines → Other
      const defaultAllocationOrder = [
        { category: 'Initial Fees', description: 'initial fees' },
        { category: 'Extension', description: 'extension charges' },
        { category: 'Rental', description: 'rental charges' },
        { category: 'Fines', description: 'fine charges' },
        { category: 'Other', description: 'other charges' }
      ];

      // If targetCategories is provided, use those categories directly (supports any ledger category)
      let allocationOrder: { category: string; description: string }[];
      if (targetCategories && targetCategories.length > 0) {
        allocationOrder = targetCategories.map(cat => ({
          category: cat,
          description: `${cat.toLowerCase()} charges`
        }));
        console.log(`Targeted allocation to categories: ${targetCategories.join(', ')}`);
      } else {
        allocationOrder = defaultAllocationOrder;
      }

      for (const { category, description } of allocationOrder) {
        if (remainingAmount <= 0) break;

        console.log(`Checking for outstanding ${description} for customer ${payment.customer_id}`);

        // Build query - if payment has rental_id, prioritize that rental first
        let query = supabase
          .from('ledger_entries')
          .select('id, amount, remaining_amount, due_date, entry_date, rental_id, vehicle_id')
          .eq('customer_id', payment.customer_id)
          .eq('type', 'Charge')
          .eq('category', category)
          .gt('remaining_amount', 0);

        // If payment is linked to a specific rental, filter to only that rental's charges
        if (payment.rental_id) {
          query = query.eq('rental_id', payment.rental_id);
          console.log(`Filtering to rental ${payment.rental_id}`);
        }

        let { data: outstandingCharges, error: chargesError } = await query
          .order('due_date', { ascending: true })
          .order('entry_date', { ascending: true })
          .order('id', { ascending: true });

        // Auto-create ledger charge from invoice if targeted category has no charge
        if (targetCategories && (!outstandingCharges || outstandingCharges.length === 0) && payment.rental_id) {
          const invoiceCategoryMap: Record<string, string> = {
            'Insurance': 'insurance_premium',
            'Service Fee': 'service_fee',
            'Security Deposit': 'security_deposit',
            'Delivery Fee': 'delivery_fee',
            'Tax': 'tax_amount',
            'Extras': 'extras_total',
          };
          const invoiceField = invoiceCategoryMap[category];
          if (invoiceField) {
            const { data: invoice } = await supabase
              .from('invoices')
              .select('*')
              .eq('rental_id', payment.rental_id)
              .order('created_at', { ascending: false })
              .limit(1)
              .maybeSingle();

            const invoiceAmount = invoice?.[invoiceField] || 0;
            if (invoiceAmount > 0) {
              console.log(`Auto-creating ${category} ledger charge from invoice: ${formatCurrency(invoiceAmount, currencyCode)}`);
              const chargeData: any = {
                customer_id: payment.customer_id,
                rental_id: payment.rental_id,
                vehicle_id: payment.vehicle_id,
                entry_date: invoice?.invoice_date || entryDate,
                type: 'Charge',
                category: category,
                amount: invoiceAmount,
                remaining_amount: invoiceAmount,
                due_date: invoice?.invoice_date || entryDate,
              };
              if (payment.tenant_id) chargeData.tenant_id = payment.tenant_id;

              const { data: newCharge, error: chargeCreateError } = await supabase
                .from('ledger_entries')
                .insert(chargeData)
                .select()
                .single();

              if (chargeCreateError) {
                console.error(`Failed to create ${category} ledger charge:`, chargeCreateError);
              } else {
                console.log(`Created ${category} charge: ${newCharge.id}`);
                outstandingCharges = [newCharge];
              }
            }
          }
        }

        if (chargesError) {
          console.error(`Error fetching ${description}:`, chargesError);
          continue;
        }

        console.log(`Found ${outstandingCharges?.length || 0} outstanding ${description}`);

        // Apply payment to charges in FIFO order
        for (const charge of outstandingCharges || []) {
          if (remainingAmount <= 0) break;

          const toApply = Math.min(remainingAmount, charge.remaining_amount);
          const chargeDueDate = charge.due_date;

          console.log(`Applying ${formatCurrency(toApply, currencyCode)} to ${category} charge ${charge.id} (due ${chargeDueDate})`);

          // Create payment application record
          const applicationData2: any = {
            payment_id: paymentId,
            charge_entry_id: charge.id,
            amount_applied: toApply
          };
          if (payment.tenant_id) {
            applicationData2.tenant_id = payment.tenant_id;
          }
          const { error: applicationError } = await supabase
            .from('payment_applications')
            .insert(applicationData2);

          if (applicationError && !applicationError.message.includes('duplicate key')) {
            console.error('Payment application error:', applicationError);
            continue;
          }

          // Update charge remaining amount
          const { error: chargeUpdateError } = await supabase
            .from('ledger_entries')
            .update({
              remaining_amount: charge.remaining_amount - toApply
            })
            .eq('id', charge.id);

          if (chargeUpdateError) {
            console.error('Charge update error:', chargeUpdateError);
            continue;
          }

          // Create P&L revenue entry for the applied amount (booked on charge due date)
          const pnlData2: any = {
            vehicle_id: charge.vehicle_id || payment.vehicle_id,
            entry_date: chargeDueDate,
            side: 'Revenue',
            category: category,
            amount: toApply,
            source_ref: `${paymentId}_${charge.id}`,
            customer_id: payment.customer_id,
            rental_id: charge.rental_id
          };
          if (payment.tenant_id) {
            pnlData2.tenant_id = payment.tenant_id;
          }
          const { error: pnlRevenueError } = await supabase
            .from('pnl_entries')
            .insert(pnlData2);

          if (pnlRevenueError && !pnlRevenueError.message.includes('duplicate key')) {
            console.error('P&L revenue entry error:', pnlRevenueError);
          }

          totalAllocated += toApply;
          remainingAmount -= toApply;
        }
      }

      console.log(`Universal FIFO allocation complete: ${formatCurrency(totalAllocated, currencyCode)} allocated, ${formatCurrency(remainingAmount, currencyCode)} remaining`);
      
      // Update payment status based on allocation
      let paymentStatus = 'Applied';
      if (remainingAmount > 0) {
        paymentStatus = remainingAmount === payment.amount ? 'Credit' : 'Partial';
      }

      const { error: paymentUpdateError } = await supabase
        .from('payments')
        .update({ 
          status: paymentStatus, 
          remaining_amount: remainingAmount 
        })
        .eq('id', paymentId);

      if (paymentUpdateError) {
        console.error('Payment update error:', paymentUpdateError);
      }

      return {
        ok: true,
        paymentId: paymentId,
        category: 'Payment',
        entryDate: entryDate,
        allocated: totalAllocated,
        remaining: remainingAmount,
        status: paymentStatus
      };
    }

    // Fallback for other payment types (should not occur with new system)
    console.log('Warning: Unknown payment type, marking as applied without allocation');
    
    await supabase
      .from('payments')
      .update({ status: 'Applied', remaining_amount: 0 })
      .eq('id', paymentId);

    return {
      ok: true,
      paymentId: paymentId,
      category: payment.payment_type,
      entryDate: entryDate
    };

  } catch (error) {
    console.error('Payment processing error:', error);
    return {
      ok: false,
      error: 'Payment processing failed',
      detail: error.message || 'Unknown error occurred'
    };
  }
}

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    
    if (!supabaseUrl || !supabaseServiceKey) {
      console.error('Missing Supabase configuration');
      return new Response(JSON.stringify({ 
        error: 'Missing Supabase configuration',
        detail: 'SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY not found'
      }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    
    // Parse request body
    let body;
    try {
      body = await req.json();
    } catch (error) {
      return new Response(JSON.stringify({ 
        error: 'Invalid JSON in request body',
        detail: error.message
      }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    
    const { paymentId, targetCategories } = body;

    if (!paymentId) {
      return new Response(JSON.stringify({
        error: 'Payment ID is required',
        detail: 'paymentId field must be provided in request body'
      }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Apply payment using universal FIFO allocation (optionally targeted to specific categories)
    const result = await applyPayment(supabase, paymentId, targetCategories);

    if (!result.ok) {
      return new Response(JSON.stringify(result), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify(result), {
      status: 201,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('Server error:', error);
    
    return new Response(JSON.stringify({
      ok: false,
      error: 'Internal server error',
      detail: error.message || 'Unknown server error'
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});